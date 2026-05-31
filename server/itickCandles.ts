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

export const ITICK_CANDLE_INTERVALS = new Set([1, 5, 15, 30, 60, 240, 1440]);
const MAX_HISTORY_BARS = 100_000;

/**
 * Profondeur cible (en bougies) à conserver dans Postgres pour chaque
 * timeframe. iTick plafonne à 500 bars par appel REST `/kline` (vérifié
 * en live : limit=2000 ou 5000 renvoie quand même 500 bars max), donc
 * on pagine via `et` pour atteindre ces volumes.
 *
 *   1m   → 20000 bars  (~14 j)    — 40 pages
 *   5m   → 5000 bars   (~17 j)    — 10 pages
 *   15m  → 5000 bars   (~52 j)    — 10 pages
 *   30m  → 3000 bars   (~62 j)    — 6 pages
 *   60m  → 3000 bars   (~125 j)   — 6 pages
 *   240m → 750 bars    (~125 j)   — dérivé du 60m
 *   1d   → 2000 bars   (~5.5 ans) — 4 pages
 *
 * Coût total au boot par paire : ~76 appels iTick. Avec 11 paires =
 * ~836 appels (backfill background, espacé de 250 ms/page + cooldown
 * quota). Effectué une seule fois grâce au skip `existing >= target`
 * au prochain redémarrage. iTick s'arrête tout seul si l'historique 1m
 * est moins profond (page < pageLimit → fin de pagination).
 */
const HISTORY_DEPTH: Record<number, number> = {
  1: 20000,
  5: 5000,
  15: 5000,
  30: 3000,
  60: 3000,
  240: 750,
  1440: 2000,
};

/* -------------------------------------------------------------------------- */
/*                            iTick quota cooldown                             */
/* -------------------------------------------------------------------------- */

/**
 * Si iTick refuse une requête (quota compute dépassé, rate-limit, etc.)
 * on entre en cooldown global pour ne pas spammer la suite du backfill
 * et ne pas faire échouer chaque requête user pendant que le quota est
 * cramé. Pendant le cooldown, on retourne directement [] et on tombe
 * sur le fallback Hyperliquid.
 */
let itickCooldownUntil = 0;

function isItickInCooldown(): boolean {
  return Date.now() < itickCooldownUntil;
}

function triggerItickCooldown(reason: string, durationMs = 10 * 60_000): void {
  const until = Date.now() + durationMs;
  if (until > itickCooldownUntil) {
    itickCooldownUntil = until;
    console.warn(`[itickCandles] cooldown iTick ${Math.round(durationMs / 1000)}s — ${reason}`);
  }
}

function isQuotaError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes('quota') ||
    m.includes('compute time') ||
    m.includes('rate limit') ||
    m.includes('too many requests') ||
    m.includes('429')
  );
}

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
  // Suivi du code source iTick utilisé pour chaque paire. Permet de
  // détecter un changement de flux (ex. indice cash → CFD) et de purger
  // l'historique obsolète pour forcer un re-backfill propre.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS itick_candle_source (
      pair TEXT PRIMARY KEY,
      code TEXT NOT NULL,
      asset TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

/**
 * Codes iTick "legacy" connus avant le passage aux flux CFD 24h
 * (indices cash → CFD). Sert uniquement à amorcer `itick_candle_source`
 * la toute première fois : la réconciliation détecte alors le diff et
 * purge l'historique cash obsolète. Les changements futurs sont gérés
 * automatiquement par la table (inutile d'y retoucher).
 */
const LEGACY_SOURCE_CODES: Record<string, string> = {
  'SP500/USD': 'SPX',
  'NAS100/USD': 'NDX',
  'US30/USD': 'DJI',
};

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

// 4h (240) est inclus pour que les ticks alimentent aussi cette série en
// temps réel. Le backfill historique 4h, lui, est dérivé du 1h (iTick
// REST ne renvoie pas de bougies 4h fiables sur toutes les paires).
const LIVE_INTERVALS = [1, 5, 15, 30, 60, 240, 1440];

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
  /** Profondeur totale demandée (paginée si > 1000). */
  limit?: number;
  endTs?: number;
  /** Si true, écrase les bougies existantes (init / refresh). */
  upsert?: boolean;
}

// iTick REST plafonne à 500 bars par appel /kline (pour forex/indices/
// commodities) même quand on passe limit=1000. La pagination doit donc
// utiliser cette taille réelle pour ne pas s'arrêter après 1 page sur
// la condition `bars.length < pageLimit`.
const ITICK_PAGE_SIZE = 500;

/**
 * Récupère un seul page (≤ 1000 bars) depuis iTick avec un fallback
 * Hyperliquid quand iTick ne renvoie rien pour cette paire/TF.
 */
async function fetchOnePage(
  inst: ItickInstrument,
  intervalMin: number,
  limit: number,
  endTs: number | undefined,
): Promise<OhlcCandle[]> {
  let bars: OhlcCandle[] = [];

  if (itick.isConfigured() && !isItickInCooldown()) {
    try {
      const rows = await itick.getKline(inst.code, intervalMin, limit, endTs, inst.asset);
      bars = rows.map(({ time, open, high, low, close }) => ({ time, open, high, low, close }));
    } catch (err) {
      const message = (err as Error).message || '';
      console.warn(
        `[itickCandles] iTick ${inst.pair} ${intervalMin}m page KO:`,
        message,
      );
      if (isQuotaError(message)) {
        triggerItickCooldown(`${inst.pair} ${intervalMin}m: ${message}`);
      }
    }
  }

  const hlCoin = inst.hyperliquidCoin || null;
  if (bars.length === 0 && hlCoin) {
    try {
      const fromSec = endTs
        ? Math.floor(endTs / 1000) - intervalMin * 60 * limit
        : Math.floor(Date.now() / 1000) - intervalMin * 60 * limit;
      const toSec = endTs ? Math.floor(endTs / 1000) : Math.floor(Date.now() / 1000);
      bars = await hyperliquid.getOhlcCandles({ coin: hlCoin }, intervalMin, {
        from: fromSec,
        to: toSec,
        countBack: limit,
      });
      if (bars.length > 0) {
        console.log(`[itickCandles] fallback Hyperliquid ${inst.pair} (${hlCoin}) ${intervalMin}m → ${bars.length} bars`);
      }
    } catch (err) {
      console.warn(
        `[itickCandles] fallback Hyperliquid ${inst.pair} ${intervalMin}m KO:`,
        (err as Error).message,
      );
    }
  }

  return bars;
}

/**
 * Hydrate la mémoire + Postgres avec un lot de bougies.
 * Ne remplace pas les bougies déjà présentes en RAM (live = source de
 * vérité pour la bar la plus récente).
 */
async function ingestBars(
  inst: ItickInstrument,
  intervalMin: number,
  bars: OhlcCandle[],
  upsert: boolean,
): Promise<void> {
  if (bars.length === 0) return;

  const series = getSeries(inst.pair, intervalMin);
  for (const bar of bars) {
    if (!series.bars.has(bar.time)) {
      series.bars.set(bar.time, bar);
    }
  }
  series.updatedAt = Date.now();

  try {
    await persistCandles(inst.pair, inst.asset, intervalMin, bars, upsert ? 'upsert' : 'fillGap');
  } catch (err) {
    console.warn(
      `[itickCandles] persist ${inst.pair} ${intervalMin}m KO:`,
      (err as Error).message,
    );
  }
}

/**
 * Backfill paginé : appelle iTick page par page (≤ 1000 bars/page) en
 * remontant `endTs` jusqu'à atteindre la profondeur cible ou jusqu'à
 * ce qu'iTick ne renvoie plus rien. 250 ms de gap entre les pages.
 */
async function backfillSeries(inst: ItickInstrument, opts: BackfillOptions): Promise<number> {
  const totalTarget = Math.max(50, opts.limit ?? HISTORY_DEPTH[opts.intervalMin] ?? 1000);
  let endTs = opts.endTs;
  let total = 0;
  const seenOldest = new Set<number>();
  // 1 page suffit si la cible tient en 1000 bars, sinon on pagine jusqu'à
  // 4 pages (= 4000 bars) pour atteindre les profondeurs HISTORY_DEPTH
  // sans dépasser raisonnablement le quota iTick.
  const maxPages = totalTarget > ITICK_PAGE_SIZE ? Math.ceil(totalTarget / ITICK_PAGE_SIZE) : 1;
  let pages = 0;

  while (total < totalTarget && pages < maxPages) {
    const remaining = totalTarget - total;
    const pageLimit = Math.min(ITICK_PAGE_SIZE, remaining);
    const bars = await fetchOnePage(inst, opts.intervalMin, pageLimit, endTs);
    if (bars.length === 0) break;

    await ingestBars(inst, opts.intervalMin, bars, opts.upsert ?? false);
    total += bars.length;
    pages += 1;

    const oldest = bars.reduce((min, bar) => (bar.time < min ? bar.time : min), bars[0].time);
    if (seenOldest.has(oldest)) break;
    seenOldest.add(oldest);
    endTs = oldest * 1000 - 1;
    if (bars.length < pageLimit) break;
    if (pages < maxPages) {
      // Petit gap pour ne pas saturer le rate-limit / quota iTick.
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  return total;
}

/* -------------------------------------------------------------------------- */
/*                       4h derivation (60m → 240m)                            */
/* -------------------------------------------------------------------------- */

/**
 * Construit l'historique 4h pour `pair` à partir des bougies 60m
 * présentes en RAM. iTick REST ne renvoie pas systématiquement le 4h
 * pour toutes les paires forex/commos/indices, on dérive donc côté
 * serveur en agrégeant 4 bougies 1h adjacentes.
 *
 * Persiste les bougies dérivées en DB (mode fillGap, on n'écrase pas
 * les 4h déjà construites en live).
 */
async function deriveH4FromH1(inst: ItickInstrument): Promise<number> {
  const h1Series = memorySeries.get(seriesKey(inst.pair, 60));
  if (!h1Series || h1Series.bars.size === 0) return 0;

  const h4BucketSec = 240 * 60;
  type Agg = { time: number; open: number; high: number; low: number; close: number; lastT: number };
  const buckets = new Map<number, Agg>();
  // On itère par ordre chronologique pour bien capturer open=premier 1h, close=dernier 1h.
  const sortedH1 = [...h1Series.bars.values()].sort((a, b) => a.time - b.time);
  for (const bar of sortedH1) {
    const bucket = Math.floor(bar.time / h4BucketSec) * h4BucketSec;
    const agg = buckets.get(bucket);
    if (!agg) {
      buckets.set(bucket, {
        time: bucket,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        lastT: bar.time,
      });
    } else {
      if (bar.high > agg.high) agg.high = bar.high;
      if (bar.low < agg.low) agg.low = bar.low;
      if (bar.time > agg.lastT) {
        agg.close = bar.close;
        agg.lastT = bar.time;
      }
    }
  }

  if (buckets.size === 0) return 0;

  const h4Bars: OhlcCandle[] = [...buckets.values()]
    .map(({ time, open, high, low, close }) => ({ time, open, high, low, close }))
    .sort((a, b) => a.time - b.time);

  await ingestBars(inst, 240, h4Bars, false);
  return h4Bars.length;
}

/**
 * Compte le nombre de bougies déjà persistées en DB pour (pair, TF).
 * Permet de décider au boot si on backfill ou pas.
 */
async function countPersistedBars(pair: string, intervalMin: number): Promise<number> {
  if (!pool) return 0;
  await schemaReady;
  try {
    const result = await pool.query(
      'SELECT COUNT(*)::int AS n FROM itick_candles WHERE pair = $1 AND timeframe = $2',
      [pair, intervalMin],
    );
    return Number(result.rows?.[0]?.n ?? 0);
  } catch {
    return 0;
  }
}

/* -------------------------------------------------------------------------- */
/*                     Réconciliation source (code iTick)                      */
/* -------------------------------------------------------------------------- */

/** Purge toutes les bougies d'une paire (DB + RAM). */
async function purgePairCandles(pair: string): Promise<void> {
  if (pool) {
    await schemaReady;
    try {
      await pool.query('DELETE FROM itick_candles WHERE pair = $1', [pair]);
    } catch (err) {
      console.warn(`[itickCandles] purge DB ${pair} KO:`, (err as Error).message);
    }
  }
  for (const key of [...memorySeries.keys()]) {
    if (key.startsWith(`${pair}:`)) memorySeries.delete(key);
  }
}

async function getStoredSourceCode(pair: string): Promise<string | null> {
  if (!pool) return null;
  await schemaReady;
  try {
    const result = await pool.query(
      'SELECT code FROM itick_candle_source WHERE pair = $1',
      [pair],
    );
    const code = result.rows?.[0]?.code;
    return code != null ? String(code) : null;
  } catch {
    return null;
  }
}

async function upsertSourceCode(pair: string, code: string, asset: string): Promise<void> {
  if (!pool) return;
  await schemaReady;
  try {
    await pool.query(
      `INSERT INTO itick_candle_source (pair, code, asset, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (pair) DO UPDATE SET code = EXCLUDED.code, asset = EXCLUDED.asset, updated_at = NOW()`,
      [pair, code, asset],
    );
  } catch (err) {
    console.warn(`[itickCandles] upsert source ${pair} KO:`, (err as Error).message);
  }
}

/**
 * Détecte les paires dont le code source iTick a changé (ex. indice cash
 * → CFD 24h) et purge leur historique obsolète pour forcer un re-backfill
 * propre. À appeler avant `backfillAll` (la profondeur tombe alors à 0,
 * donc le backfill ré-récupère la donnée du nouveau flux).
 */
async function reconcileSourceCodes(): Promise<void> {
  if (!pool) return;
  for (const inst of ITICK_INSTRUMENTS) {
    const stored = await getStoredSourceCode(inst.pair);
    // Premier passage (table neuve) : on retombe sur le code legacy connu
    // pour détecter le switch cash → CFD. Sinon on compare au code stocké.
    const previousCode = stored ?? LEGACY_SOURCE_CODES[inst.pair] ?? inst.code;
    if (previousCode !== inst.code) {
      await purgePairCandles(inst.pair);
      console.log(
        `[itickCandles] source ${inst.pair} changée ${previousCode} → ${inst.code}, historique purgé (re-backfill)`,
      );
    }
    await upsertSourceCode(inst.pair, inst.code, inst.asset);
  }
}

/**
 * Backfill historique de toutes les paires iTick. Stratégie :
 *   - Skip si la DB a déjà ≥ HISTORY_DEPTH[TF] bougies — la profondeur
 *     cible est atteinte, le live tick (ws) garde la chose à jour.
 *   - Sinon backfill jusqu'à la profondeur cible, paginé.
 *   - Délai inter-TF pour ne pas saturer iTick / Neon.
 *   - Cooldown global si iTick refuse (quota / rate-limit) → arrêt
 *     anticipé pour ne pas spammer.
 *
 * Le 4h n'est jamais demandé à iTick : il est dérivé du 60m après la
 * paire complète.
 *
 * Si `force=true`, on rebackfill même si la DB est déjà pleine
 * (utilisé par l'endpoint admin `/api/admin/itick/backfill`).
 */
export async function backfillAll(force = false): Promise<void> {
  const restIntervals = [1, 5, 15, 30, 60, 1440];

  // Purge l'historique des paires dont le flux source a changé (cash →
  // CFD) avant de (re)backfiller, pour ne pas mélanger ancienne et
  // nouvelle donnée.
  await reconcileSourceCodes().catch((err) =>
    console.warn('[itickCandles] reconcileSourceCodes KO:', (err as Error).message),
  );

  for (const inst of ITICK_INSTRUMENTS) {
    for (const intervalMin of restIntervals) {
      try {
        const target = HISTORY_DEPTH[intervalMin] ?? 1000;
        if (!force) {
          const existing = await countPersistedBars(inst.pair, intervalMin);
          if (existing >= target) {
            continue;
          }
        }
        const fetched = await backfillSeries(inst, { intervalMin, limit: target, upsert: true });
        if (fetched > 0) {
          console.log(`[itickCandles] backfill ${inst.pair} ${intervalMin}m → ${fetched} bars`);
        }
        if (isItickInCooldown()) {
          console.warn('[itickCandles] backfillAll: iTick en cooldown, arrêt anticipé');
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
      } catch (err) {
        console.warn(
          `[itickCandles] backfillAll ${inst.pair} ${intervalMin}m KO:`,
          (err as Error).message,
        );
      }
    }
    try {
      const derived = await deriveH4FromH1(inst);
      if (derived > 0) {
        console.log(`[itickCandles] derived H4 ${inst.pair} → ${derived} bars`);
      }
    } catch (err) {
      console.warn(
        `[itickCandles] deriveH4FromH1 ${inst.pair} KO:`,
        (err as Error).message,
      );
    }
  }
  console.log(`[itickCandles] backfill historique terminé (${ITICK_INSTRUMENTS.length} paires)`);
}

/**
 * Backfill ciblé pour une paire / intervalle spécifique. Utilisé par le
 * datafeed lorsque l'historique demandé sort de ce qui est en cache.
 *
 * Pour le 4h, on backfill d'abord le 1h puis on agrège, ce qui évite de
 * dépendre d'un éventuel kType iTick 4h indispo.
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

  if (intervalMin === 240) {
    // Pour le 4h, on backfill d'abord le 1h (avec une marge ×4 sur le
    // count) puis on dérive.
    const h1Count = Math.max(
      200,
      Math.min(ITICK_PAGE_SIZE * 3, Math.ceil((toSec - fromSec) / (60 * 60)) + 50),
    );
    await backfillSeries(inst, { intervalMin: 60, limit: h1Count, endTs: toSec * 1000, upsert: false });
    return deriveH4FromH1(inst);
  }

  const count = Math.max(50, Math.min(ITICK_PAGE_SIZE * 3, Math.ceil((toSec - fromSec) / (intervalMin * 60))));
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
