/**
 * Store de bougies iTick — source unique pour les pairs
 * forex / commodities / indices.
 *
 * Pipeline :
 *   1. Au boot : backfill historique via REST iTick (kline) pour chaque
 *      (pair, interval). Fallback OANDA si iTick échoue / pair indispo.
 *   2. En continu : à chaque live tick reçu (WS itick), on met à jour
 *      la bougie courante de chaque interval (M1, M5, M15, M30, H1, D1)
 *      en RAM puis on flush en Postgres toutes les ~2s par batch.
 *   3. Lecture : `getCandles()` lit Postgres et renvoie les `count`
 *      dernières bougies < `to`.
 *
 * Fallback OANDA : déclenché si une bougie n'a pas été mise à jour
 * depuis > 60s alors qu'iTick devrait l'avoir poussée. Backfill un
 * range et persiste en mode `fillGap` (n'écrase pas iTick).
 */

import { Pool } from 'pg';
import type { OhlcCandle, OhlcQueryOptions } from './kraken.js';
import * as itick from './itick.js';
import * as hyperliquid from './hyperliquid.js';
import { ITICK_INSTRUMENTS, findByPair, findByCode, type ItickInstrument } from './itickInstruments.js';
import type { ItickLiveTick } from './itick.js';

export const ITICK_CANDLE_INTERVALS = new Set([1, 5, 15, 30, 60, 1440]);
const MAX_HISTORY_BARS = 100_000;

type SeriesKey = `${string}:${number}`;

interface StoredSeries {
  pair: string;
  intervalMin: number;
  /** Toutes les bougies pour cette série, indexées par bar_time (sec). */
  bars: Map<number, OhlcCandle>;
  /** Bougies modifiées depuis le dernier flush DB. */
  dirty: Set<number>;
  updatedAt: number;
}

const memorySeries = new Map<SeriesKey, StoredSeries>();

let pool: Pool | null = null;
let schemaReady: Promise<void> = Promise.resolve();

function seriesKey(pair: string, intervalMin: number): SeriesKey {
  return `${pair}:${intervalMin}`;
}

function bucketStart(timeSec: number, intervalMin: number): number {
  const bucketSec = intervalMin * 60;
  return Math.floor(timeSec / bucketSec) * bucketSec;
}

function getSeries(pair: string, intervalMin: number): StoredSeries {
  const key = seriesKey(pair, intervalMin);
  let series = memorySeries.get(key);
  if (!series) {
    series = {
      pair,
      intervalMin,
      bars: new Map(),
      dirty: new Set(),
      updatedAt: Date.now(),
    };
    memorySeries.set(key, series);
  }
  return series;
}

async function ensureSchema(): Promise<void> {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS itick_candles (
      pair TEXT NOT NULL,
      asset TEXT NOT NULL,
      timeframe INT NOT NULL,
      bar_time BIGINT NOT NULL,
      open DOUBLE PRECISION NOT NULL,
      high DOUBLE PRECISION NOT NULL,
      low DOUBLE PRECISION NOT NULL,
      close DOUBLE PRECISION NOT NULL,
      volume DOUBLE PRECISION,
      ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (pair, timeframe, bar_time)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_itick_candles_pair_tf_time
    ON itick_candles (pair, timeframe, bar_time DESC)
  `);
}

export function initItickCandlesStore(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    console.warn('[itickCandles] DATABASE_URL absent — historique iTick conservé en RAM uniquement');
    return Promise.resolve();
  }
  pool = new Pool({
    connectionString: databaseUrl,
    ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
  });
  pool.on('error', (err) => {
    console.error('[itickCandles pool] idle client error:', err.message || err);
  });
  schemaReady = ensureSchema().catch((err) => {
    console.error('[itickCandles] schema init failed:', (err as Error).message);
    throw err;
  });
  return schemaReady;
}

/* -------------------------------------------------------------------------- */
/*                                Persistence                                  */
/* -------------------------------------------------------------------------- */

async function persistCandles(
  pair: string,
  asset: string,
  intervalMin: number,
  candles: OhlcCandle[],
  mode: 'upsert' | 'fillGap' = 'upsert',
): Promise<void> {
  if (!pool || candles.length === 0) return;
  await schemaReady;

  const conflictClause = mode === 'fillGap'
    ? 'ON CONFLICT (pair, timeframe, bar_time) DO NOTHING'
    : `ON CONFLICT (pair, timeframe, bar_time) DO UPDATE SET
         open = EXCLUDED.open,
         high = EXCLUDED.high,
         low = EXCLUDED.low,
         close = EXCLUDED.close,
         ingested_at = NOW()`;

  const chunkSize = 400;
  for (let offset = 0; offset < candles.length; offset += chunkSize) {
    const chunk = candles.slice(offset, offset + chunkSize);
    const values: unknown[] = [];
    const placeholders: string[] = [];
    chunk.forEach((candle, index) => {
      const base = index * 8;
      placeholders.push(
        `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8})`,
      );
      values.push(pair, asset, intervalMin, candle.time, candle.open, candle.high, candle.low, candle.close);
    });
    await pool.query(
      `INSERT INTO itick_candles (pair, asset, timeframe, bar_time, open, high, low, close)
       VALUES ${placeholders.join(', ')}
       ${conflictClause}`,
      values,
    );
  }
}

/* -------------------------------------------------------------------------- */
/*                              Live tick → bars                               */
/* -------------------------------------------------------------------------- */

const LIVE_INTERVALS = [1, 5, 15, 30, 60, 1440];

/**
 * Met à jour la bougie courante de tous les intervalles pour un tick.
 * Si le tick ouvre un nouveau bucket, la bougie précédente est marquée
 * dirty (pour flush DB) et une nouvelle bougie est créée.
 */
export function applyLiveTick(tick: ItickLiveTick): void {
  const inst = findByCode(tick.asset, tick.symbol);
  if (!inst) return;
  const timeSec = Math.floor(tick.ts / 1000);
  if (!Number.isFinite(timeSec) || timeSec <= 0) return;
  const price = tick.price;
  if (!Number.isFinite(price) || price <= 0) return;

  for (const intervalMin of LIVE_INTERVALS) {
    const bucket = bucketStart(timeSec, intervalMin);
    const series = getSeries(inst.pair, intervalMin);
    let bar = series.bars.get(bucket);
    if (!bar) {
      bar = { time: bucket, open: price, high: price, low: price, close: price };
      series.bars.set(bucket, bar);
    } else {
      if (price > bar.high) bar.high = price;
      if (price < bar.low) bar.low = price;
      bar.close = price;
    }
    series.dirty.add(bucket);
    series.updatedAt = Date.now();
  }
}

/** Flush périodique : écrit en Postgres les bougies dirty puis vide le set. */
async function flushDirty(): Promise<void> {
  if (!pool) return;
  for (const series of memorySeries.values()) {
    if (series.dirty.size === 0) continue;
    const inst = findByPair(series.pair);
    if (!inst) {
      series.dirty.clear();
      continue;
    }
    const candles: OhlcCandle[] = [];
    for (const t of series.dirty) {
      const bar = series.bars.get(t);
      if (bar) candles.push(bar);
    }
    series.dirty.clear();
    if (candles.length === 0) continue;
    try {
      await persistCandles(series.pair, inst.asset, series.intervalMin, candles, 'upsert');
    } catch (err) {
      console.warn(
        `[itickCandles] flush ${series.pair} ${series.intervalMin}m KO:`,
        (err as Error).message,
      );
    }
  }
}

let flushTimer: ReturnType<typeof setInterval> | null = null;
function startFlushLoop(): void {
  if (flushTimer) return;
  flushTimer = setInterval(() => { void flushDirty(); }, 2_000);
  if (typeof flushTimer.unref === 'function') flushTimer.unref();
}

/* -------------------------------------------------------------------------- */
/*                            Backfill (REST)                                  */
/* -------------------------------------------------------------------------- */

interface BackfillOptions {
  intervalMin: number;
  limit?: number;
  endTs?: number;
  /** Si true, écrase les bougies existantes (init / refresh). */
  upsert?: boolean;
}

async function backfillSeries(inst: ItickInstrument, opts: BackfillOptions): Promise<number> {
  const limit = Math.max(50, Math.min(1000, opts.limit ?? 1000));
  let bars: OhlcCandle[] = [];

  // Source primaire : iTick REST kline.
  if (itick.isConfigured()) {
    try {
      const rows = await itick.getKline(inst.code, opts.intervalMin, limit, opts.endTs, inst.asset);
      bars = rows.map(({ time, open, high, low, close }) => ({ time, open, high, low, close }));
    } catch (err) {
      console.warn(
        `[itickCandles] backfill iTick ${inst.pair} ${opts.intervalMin}m KO:`,
        (err as Error).message,
      );
    }
  }

  // Fallback Hyperliquid pour les pairs disposant d'un xyz:* coin.
  const hlCoin = inst.hyperliquidCoin || null;
  if (bars.length === 0 && hlCoin) {
    try {
      const fromSec = opts.endTs
        ? Math.floor(opts.endTs / 1000) - opts.intervalMin * 60 * limit
        : Math.floor(Date.now() / 1000) - opts.intervalMin * 60 * limit;
      const toSec = opts.endTs ? Math.floor(opts.endTs / 1000) : Math.floor(Date.now() / 1000);
      bars = await hyperliquid.getOhlcCandles({ coin: hlCoin }, opts.intervalMin, {
        from: fromSec,
        to: toSec,
        countBack: limit,
      });
      if (bars.length > 0) {
        console.log(`[itickCandles] fallback Hyperliquid ${inst.pair} (${hlCoin}) ${opts.intervalMin}m → ${bars.length} bars`);
      }
    } catch (err) {
      console.warn(
        `[itickCandles] fallback Hyperliquid ${inst.pair} ${opts.intervalMin}m KO:`,
        (err as Error).message,
      );
    }
  }

  if (bars.length === 0) return 0;

  // Hydrate la mémoire (sans écraser une bougie live courante plus récente).
  const series = getSeries(inst.pair, opts.intervalMin);
  for (const bar of bars) {
    if (!series.bars.has(bar.time)) {
      series.bars.set(bar.time, bar);
    }
  }
  series.updatedAt = Date.now();

  // Persist DB.
  try {
    await persistCandles(inst.pair, inst.asset, opts.intervalMin, bars, opts.upsert ? 'upsert' : 'fillGap');
  } catch (err) {
    console.warn(
      `[itickCandles] persist backfill ${inst.pair} ${opts.intervalMin}m KO:`,
      (err as Error).message,
    );
  }
  return bars.length;
}

/**
 * Backfill historique de toutes les paires iTick configurées sur tous
 * les intervalles. À appeler une fois au boot (en arrière-plan).
 *
 * Coût : ~11 paires × 6 intervalles ≈ 66 calls REST. Plan pro = 600/min.
 */
export async function backfillAll(): Promise<void> {
  for (const inst of ITICK_INSTRUMENTS) {
    for (const intervalMin of LIVE_INTERVALS) {
      try {
        await backfillSeries(inst, { intervalMin, limit: 1000, upsert: true });
      } catch (err) {
        console.warn(
          `[itickCandles] backfillAll ${inst.pair} ${intervalMin}m KO:`,
          (err as Error).message,
        );
      }
    }
  }
  console.log(`[itickCandles] backfill historique terminé (${ITICK_INSTRUMENTS.length} paires)`);
}

/**
 * Backfill ciblé pour une paire / intervalle spécifique. Utilisé par le
 * datafeed lorsque l'historique demandé sort de ce qui est en cache.
 */
export async function backfillRange(
  pair: string,
  intervalMin: number,
  fromSec: number,
  toSec: number,
): Promise<number> {
  const inst = findByPair(pair);
  if (!inst) return 0;
  if (!ITICK_CANDLE_INTERVALS.has(intervalMin)) return 0;
  const count = Math.max(50, Math.min(1000, Math.ceil((toSec - fromSec) / (intervalMin * 60))));
  return backfillSeries(inst, { intervalMin, limit: count, endTs: toSec * 1000, upsert: false });
}

/* -------------------------------------------------------------------------- */
/*                                  Reads                                      */
/* -------------------------------------------------------------------------- */

export async function hasCandles(pair: string, intervalMin: number): Promise<boolean> {
  if (pool) {
    await schemaReady;
    const result = await pool.query(
      'SELECT 1 FROM itick_candles WHERE pair = $1 AND timeframe = $2 LIMIT 1',
      [pair, intervalMin],
    );
    if ((result.rowCount ?? 0) > 0) return true;
  }
  const series = memorySeries.get(seriesKey(pair, intervalMin));
  return Boolean(series && series.bars.size > 0);
}

export async function getCandles(
  pair: string,
  intervalMin: number,
  opts: OhlcQueryOptions = {},
): Promise<OhlcCandle[]> {
  const safeInterval = ITICK_CANDLE_INTERVALS.has(intervalMin) ? intervalMin : 1;
  const nowSec = Math.floor(Date.now() / 1000);
  const toSec = opts.to && opts.to > 0 ? Math.floor(opts.to) : nowSec;
  const targetCount = Math.min(
    MAX_HISTORY_BARS,
    opts.countBack && opts.countBack > 0 ? Math.floor(opts.countBack) : 5000,
  );
  const fromSec = opts.from && opts.from > 0 ? Math.floor(opts.from) : null;

  if (pool) {
    await schemaReady;
    const result = await pool.query(
      `SELECT bar_time AS time, open, high, low, close
       FROM (
         SELECT bar_time, open, high, low, close
         FROM itick_candles
         WHERE pair = $1
           AND timeframe = $2
           AND bar_time <= $3
           AND ($4::bigint IS NULL OR bar_time >= $4)
         ORDER BY bar_time DESC
         LIMIT $5
       ) recent
       ORDER BY bar_time ASC`,
      [pair, safeInterval, toSec, fromSec, targetCount],
    );
    return result.rows.map((row) => ({
      time: Number(row.time),
      open: Number(row.open),
      high: Number(row.high),
      low: Number(row.low),
      close: Number(row.close),
    }));
  }

  const series = memorySeries.get(seriesKey(pair, safeInterval));
  if (!series || series.bars.size === 0) return [];
  let bars = [...series.bars.values()]
    .filter((bar) => bar.time <= toSec)
    .sort((a, b) => a.time - b.time);
  if (fromSec != null) bars = bars.filter((bar) => bar.time >= fromSec);
  if (bars.length <= targetCount) return bars;
  return bars.slice(bars.length - targetCount);
}

export async function getCandlesStatus() {
  const now = Date.now();
  if (pool) {
    await schemaReady;
    const result = await pool.query(`
      SELECT pair, asset, timeframe,
        COUNT(*)::int AS count,
        MIN(bar_time)::bigint AS oldest_time,
        MAX(bar_time)::bigint AS newest_time,
        EXTRACT(EPOCH FROM (NOW() - MAX(ingested_at))) * 1000 AS age_ms
      FROM itick_candles
      GROUP BY pair, asset, timeframe
      ORDER BY pair, timeframe
    `);
    return result.rows.map((row) => ({
      pair: String(row.pair),
      asset: String(row.asset),
      timeframe: Number(row.timeframe),
      count: Number(row.count),
      oldestTime: row.oldest_time != null ? Number(row.oldest_time) : null,
      newestTime: row.newest_time != null ? Number(row.newest_time) : null,
      ageMs: Math.max(0, Math.floor(Number(row.age_ms) || 0)),
    }));
  }
  return [...memorySeries.values()].map((series) => {
    const inst = findByPair(series.pair);
    const times = [...series.bars.keys()].sort((a, b) => a - b);
    return {
      pair: series.pair,
      asset: inst?.asset ?? 'forex',
      timeframe: series.intervalMin,
      count: series.bars.size,
      oldestTime: times[0] ?? null,
      newestTime: times[times.length - 1] ?? null,
      ageMs: Math.max(0, now - series.updatedAt),
    };
  });
}

/* -------------------------------------------------------------------------- */
/*                              Lifecycle helpers                              */
/* -------------------------------------------------------------------------- */

let started = false;

/**
 * À appeler après `initItickCandlesStore()` :
 *   - branche le live tick → applyLiveTick
 *   - démarre le flush loop DB
 *   - lance le backfill historique en arrière-plan
 */
export function startLiveBuilder(): void {
  if (started) return;
  started = true;
  itick.itickFeed.on('tick', (tick: ItickLiveTick) => {
    try { applyLiveTick(tick); } catch (err) {
      console.warn('[itickCandles] applyLiveTick KO:', (err as Error).message);
    }
  });
  startFlushLoop();
  // Backfill en background — pas bloquant pour le boot serveur.
  void backfillAll().catch((err) => {
    console.warn('[itickCandles] backfillAll KO:', (err as Error).message);
  });
}

/** Pour tests / admin : reset complet du cache mémoire. */
export function resetMemory(): void {
  memorySeries.clear();
}
