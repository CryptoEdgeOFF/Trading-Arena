/**
 * Store de bougies crypto persistant (Postgres).
 *
 * Pendant longtemps les bougies crypto (BTC, ETH, …) ne vivaient qu'en RAM
 * (`engineCandlesCache`), plafonnées à ~10k barres et perdues à chaque
 * redémarrage. Ce store les persiste en base pour :
 *   1. garder un historique profond qui survit aux redéploiements ;
 *   2. servir le scroll vers le passé depuis la DB (lazy-load) au lieu de
 *      retaper Binance/iTick à chaque fois.
 *
 * Pipeline :
 *   - Lecture : `getCandles()` lit Postgres (+ overlay des bougies live en
 *     RAM pour que la dernière bougie soit fraîche avant le flush).
 *   - Backfill à la demande : si la DB n'a pas assez de barres avant la date
 *     demandée (premier chargement ou scroll gauche), on télécharge UNE page
 *     en amont (chaîne Binance → iTick → Bybit → Kraken via cryptoCandles),
 *     on la persiste, puis les lectures suivantes sont servies depuis la DB.
 *   - Live : `updateLiveCandle()` (branché sur les ticks du paper engine)
 *     met à jour la bougie courante en RAM, flushée en Postgres toutes les ~2s.
 *
 * Sans `DATABASE_URL`, tout reste en RAM (mode dev), comme `itickCandles`.
 */

import { Pool } from 'pg';
import type { OhlcCandle, OhlcQueryOptions } from './kraken.js';
import * as cryptoCandles from './cryptoCandles.js';
import { isItickPair } from './itickInstruments.js';

export const CRYPTO_CANDLE_INTERVALS = new Set([1, 5, 15, 30, 60, 240, 1440]);

/**
 * Profondeur d'historique conservée par timeframe (rétention « modérée ») :
 *   1m   → ~31 j     (45 000 barres)
 *   5m   → ~90 j     (26 000)
 *   15m  → ~187 j    (18 000)
 *   30m  → ~250 j    (12 000)
 *   60m  → ~1 an     (9 000)
 *   240m → ~1 an     (2 300)
 *   1d   → ~5 ans    (2 000)
 *
 * Sert à la fois de cible de backfill par défaut et de plafond de purge.
 */
const RETENTION_BARS: Record<number, number> = {
  1: 45000,
  5: 26000,
  15: 18000,
  30: 12000,
  60: 9000,
  240: 2300,
  1440: 2000,
};

const DEFAULT_COUNT_BACK = 1500;
const MAX_READ_BARS = 100_000;
/** Marge ajoutée au backfill pour absorber les trous / arrondis. */
const BACKFILL_MARGIN = 200;

type SeriesKey = `${string}:${number}`;

interface LiveSeries {
  bars: Map<number, OhlcCandle>;
  dirty: Set<number>;
}

/** Bougies live récentes en RAM (uniquement le « head », borné). */
const liveSeries = new Map<SeriesKey, LiveSeries>();
/** Garde-fou mémoire : nb max de buckets récents conservés par série. */
const MAX_LIVE_BARS = 200;

let pool: Pool | null = null;
let schemaReady: Promise<void> = Promise.resolve();

/** Backfills en cours, dédupliqués par (pair, interval, to). */
const inflightBackfills = new Map<string, Promise<void>>();

function seriesKey(pair: string, intervalMin: number): SeriesKey {
  return `${pair}:${intervalMin}`;
}

function safeInterval(intervalMin: number): number {
  return CRYPTO_CANDLE_INTERVALS.has(intervalMin) ? intervalMin : 1;
}

function bucketStart(timeSec: number, intervalMin: number): number {
  const bucketSec = intervalMin * 60;
  return Math.floor(timeSec / bucketSec) * bucketSec;
}

/* -------------------------------------------------------------------------- */
/*                                  Schema                                     */
/* -------------------------------------------------------------------------- */

async function ensureSchema(): Promise<void> {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS crypto_candles (
      pair TEXT NOT NULL,
      timeframe INT NOT NULL,
      bar_time BIGINT NOT NULL,
      open DOUBLE PRECISION NOT NULL,
      high DOUBLE PRECISION NOT NULL,
      low DOUBLE PRECISION NOT NULL,
      close DOUBLE PRECISION NOT NULL,
      ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (pair, timeframe, bar_time)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_crypto_candles_pair_tf_time
    ON crypto_candles (pair, timeframe, bar_time DESC)
  `);
}

export function initCryptoCandlesStore(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    console.warn('[cryptoCandles] DATABASE_URL absent — historique crypto conservé en RAM uniquement');
    return Promise.resolve();
  }
  pool = new Pool({
    connectionString: databaseUrl,
    ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
    max: Number(process.env.PG_POOL_MAX_CANDLES) || 4,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  pool.on('error', (err) => {
    console.error('[cryptoCandles pool] idle client error:', err.message || err);
  });
  schemaReady = ensureSchema().catch((err) => {
    console.error('[cryptoCandles] schema init KO:', (err as Error).message);
  });
  startFlushLoop();
  startPruneLoop();
  return schemaReady;
}

/* -------------------------------------------------------------------------- */
/*                                Persistence                                  */
/* -------------------------------------------------------------------------- */

async function persistCandles(
  pair: string,
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
      const base = index * 7;
      placeholders.push(
        `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`,
      );
      values.push(pair, intervalMin, candle.time, candle.open, candle.high, candle.low, candle.close);
    });
    await pool.query(
      `INSERT INTO crypto_candles (pair, timeframe, bar_time, open, high, low, close)
       VALUES ${placeholders.join(', ')}
       ${conflictClause}`,
      values,
    );
  }
}

/* -------------------------------------------------------------------------- */
/*                              Live tick → bars                               */
/* -------------------------------------------------------------------------- */

/**
 * Met à jour la bougie courante de tous les intervalles pour un tick crypto.
 * Ignoré pour les paires iTick (forex/indices) qui ont leur propre store.
 */
export function updateLiveCandle(pair: string, price: number, tsMs: number): void {
  if (!Number.isFinite(price) || price <= 0) return;
  if (isItickPair(pair)) return; // géré par itickCandles
  const timeSec = Math.floor(tsMs / 1000);
  if (!Number.isFinite(timeSec) || timeSec <= 0) return;

  for (const intervalMin of CRYPTO_CANDLE_INTERVALS) {
    const bucket = bucketStart(timeSec, intervalMin);
    const key = seriesKey(pair, intervalMin);
    let series = liveSeries.get(key);
    if (!series) {
      series = { bars: new Map(), dirty: new Set() };
      liveSeries.set(key, series);
    }
    let bar = series.bars.get(bucket);
    if (!bar) {
      bar = { time: bucket, open: price, high: price, low: price, close: price };
      series.bars.set(bucket, bar);
      // Borne mémoire : on ne garde que les buckets récents.
      if (series.bars.size > MAX_LIVE_BARS) {
        const oldest = Math.min(...series.bars.keys());
        series.bars.delete(oldest);
        series.dirty.delete(oldest);
      }
    } else {
      if (price > bar.high) bar.high = price;
      if (price < bar.low) bar.low = price;
      bar.close = price;
    }
    series.dirty.add(bucket);
  }
}

async function flushDirty(): Promise<void> {
  if (!pool) return;
  for (const [key, series] of liveSeries.entries()) {
    if (series.dirty.size === 0) continue;
    const [pair, intervalStr] = key.split(':');
    const intervalMin = Number(intervalStr);
    const candles: OhlcCandle[] = [];
    for (const t of series.dirty) {
      const bar = series.bars.get(t);
      if (bar) candles.push(bar);
    }
    series.dirty.clear();
    if (candles.length === 0) continue;
    try {
      await persistCandles(pair, intervalMin, candles, 'upsert');
    } catch (err) {
      console.warn(`[cryptoCandles] flush ${pair} ${intervalMin}m KO:`, (err as Error).message);
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
/*                                   Prune                                     */
/* -------------------------------------------------------------------------- */

/** Supprime les bougies au-delà du plafond de rétention pour chaque série. */
async function pruneOldCandles(): Promise<void> {
  if (!pool) return;
  await schemaReady;
  try {
    const distinct = await pool.query<{ pair: string; timeframe: number }>(
      'SELECT DISTINCT pair, timeframe FROM crypto_candles',
    );
    for (const row of distinct.rows) {
      const cap = RETENTION_BARS[Number(row.timeframe)] ?? DEFAULT_COUNT_BACK;
      await pool.query(
        `DELETE FROM crypto_candles
         WHERE pair = $1 AND timeframe = $2
           AND bar_time < (
             SELECT bar_time FROM crypto_candles
             WHERE pair = $1 AND timeframe = $2
             ORDER BY bar_time DESC OFFSET $3 LIMIT 1
           )`,
        [row.pair, Number(row.timeframe), cap],
      );
    }
  } catch (err) {
    console.warn('[cryptoCandles] prune KO:', (err as Error).message);
  }
}

let pruneTimer: ReturnType<typeof setInterval> | null = null;
function startPruneLoop(): void {
  if (pruneTimer) return;
  // Première purge après 5 min (laisse le boot respirer), puis toutes les 24h.
  setTimeout(() => { void pruneOldCandles(); }, 5 * 60_000).unref?.();
  pruneTimer = setInterval(() => { void pruneOldCandles(); }, 24 * 60 * 60_000);
  if (typeof pruneTimer.unref === 'function') pruneTimer.unref();
}

/* -------------------------------------------------------------------------- */
/*                                  Backfill                                   */
/* -------------------------------------------------------------------------- */

/** Nombre de bougies en DB dont bar_time <= toSec (mesure la profondeur dispo). */
async function countBefore(pair: string, intervalMin: number, toSec: number): Promise<number> {
  if (!pool) return 0;
  await schemaReady;
  const result = await pool.query<{ n: string }>(
    'SELECT COUNT(*)::bigint AS n FROM crypto_candles WHERE pair = $1 AND timeframe = $2 AND bar_time <= $3',
    [pair, intervalMin, toSec],
  );
  return Number(result.rows[0]?.n ?? 0);
}

/**
 * S'assure que la DB contient au moins `countBack` bougies avant `toSec`.
 * Sinon télécharge une fenêtre en amont (Binance → iTick → Bybit → Kraken)
 * et la persiste. Déduplique les backfills concurrents.
 */
async function backfillWindow(
  pair: string,
  intervalMin: number,
  toSec: number,
  countBack: number,
): Promise<void> {
  const dedupeKey = `${pair}:${intervalMin}:${toSec}:${countBack}`;
  const existing = inflightBackfills.get(dedupeKey);
  if (existing) {
    await existing;
    return;
  }

  const job = (async () => {
    try {
      const { candles } = await cryptoCandles.getCryptoOhlc(pair, intervalMin, {
        to: toSec,
        countBack: countBack + BACKFILL_MARGIN,
      });
      if (candles.length > 0) {
        await persistCandles(pair, intervalMin, candles, 'fillGap');
      }
    } catch (err) {
      console.warn(
        `[cryptoCandles] backfill ${pair} ${intervalMin}m (to=${toSec}) KO:`,
        (err as Error).message,
      );
    } finally {
      inflightBackfills.delete(dedupeKey);
    }
  })();
  inflightBackfills.set(dedupeKey, job);
  await job;
}

/**
 * Backfill paginé jusqu'à avoir assez de barres avant `toSec` (scroll gauche).
 * Boucle tant que la DB gagne des barres — une seule page upstream ne suffit
 * pas toujours pour les grosses `countBack`.
 */
async function ensureHistory(
  pair: string,
  intervalMin: number,
  toSec: number,
  countBack: number,
  fromSec: number | null,
): Promise<void> {
  if (!pool) return;
  const intervalSec = intervalMin * 60;
  const required = fromSec != null
    ? Math.max(countBack, Math.ceil((toSec - fromSec) / intervalSec) + 2)
    : countBack;
  const maxAttempts = 8;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const available = await countBefore(pair, intervalMin, toSec);
    if (available >= required) return;

    const prevAvailable = available;
    const stillMissing = required - available + BACKFILL_MARGIN;
    await backfillWindow(pair, intervalMin, toSec, stillMissing);

    const after = await countBefore(pair, intervalMin, toSec);
    if (after <= prevAvailable) break;
  }
}

/* -------------------------------------------------------------------------- */
/*                                   Reads                                     */
/* -------------------------------------------------------------------------- */

async function readDb(
  pair: string,
  intervalMin: number,
  toSec: number,
  fromSec: number | null,
  targetCount: number,
): Promise<OhlcCandle[]> {
  if (!pool) return [];
  await schemaReady;
  const result = await pool.query(
    `SELECT bar_time AS time, open, high, low, close
     FROM (
       SELECT bar_time, open, high, low, close
       FROM crypto_candles
       WHERE pair = $1
         AND timeframe = $2
         AND bar_time <= $3
         AND ($4::bigint IS NULL OR bar_time >= $4)
       ORDER BY bar_time DESC
       LIMIT $5
     ) recent
     ORDER BY bar_time ASC`,
    [pair, intervalMin, toSec, fromSec, targetCount],
  );
  return result.rows.map((row) => ({
    time: Number(row.time),
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close),
  }));
}

/** Overlay des bougies live RAM (head frais) sur le résultat DB. */
function overlayLive(
  pair: string,
  intervalMin: number,
  dbBars: OhlcCandle[],
  toSec: number,
  fromSec: number | null,
  targetCount: number,
): OhlcCandle[] {
  const series = liveSeries.get(seriesKey(pair, intervalMin));
  if (!series || series.bars.size === 0) return dbBars;

  const map = new Map<number, OhlcCandle>();
  for (const bar of dbBars) map.set(bar.time, bar);
  for (const bar of series.bars.values()) {
    if (bar.time <= toSec && (fromSec == null || bar.time >= fromSec)) {
      map.set(bar.time, bar);
    }
  }
  let merged = [...map.values()].sort((a, b) => a.time - b.time);
  if (merged.length > targetCount) merged = merged.slice(merged.length - targetCount);
  return merged;
}

/**
 * Lecture principale pour le chart : backfill à la demande si l'historique
 * DB est insuffisant avant `to`, puis renvoie les bougies (DB + head live).
 */
export async function getCandles(
  pair: string,
  intervalMin: number,
  opts: OhlcQueryOptions = {},
): Promise<OhlcCandle[]> {
  const interval = safeInterval(intervalMin);
  const nowSec = Math.floor(Date.now() / 1000);
  const toSec = opts.to && opts.to > 0 ? Math.floor(opts.to) : nowSec;
  const fromSec = opts.from && opts.from > 0 ? Math.floor(opts.from) : null;
  const targetCount = Math.min(
    MAX_READ_BARS,
    opts.countBack && opts.countBack > 0 ? Math.floor(opts.countBack) : DEFAULT_COUNT_BACK,
  );

  if (!pool) {
    // Mode RAM (dev sans Postgres) : on sert uniquement le head live.
    return overlayLive(pair, interval, [], toSec, fromSec, targetCount);
  }

  await ensureHistory(pair, interval, toSec, targetCount, fromSec);
  const dbBars = await readDb(pair, interval, toSec, fromSec, targetCount);
  return overlayLive(pair, interval, dbBars, toSec, fromSec, targetCount);
}

export function isStorePersistent(): boolean {
  return Boolean(pool);
}
