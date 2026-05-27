import { Pool } from 'pg';
import type { OhlcCandle, OhlcQueryOptions } from './kraken.js';
import { mt5SymbolToPair, pairToMt5Symbol, listMt5Symbols } from './mt5Instruments.js';
import * as oanda from './oanda.js';
import * as hyperliquid from './hyperliquid.js';

export interface Mt5CandleInput {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface Mt5CandlesIngestInput {
  symbol: string;
  timeframe: number;
  candles: Mt5CandleInput[];
}

export interface Mt5CandlesIngestResult {
  ok: boolean;
  pair?: string;
  timeframe?: number;
  accepted?: number;
  total?: number;
  persisted?: boolean;
  error?: string;
}

export interface Mt5CandleSeriesStatus {
  pair: string;
  mt5Symbol: string;
  timeframe: number;
  count: number;
  oldestTime: number | null;
  newestTime: number | null;
  ageMs: number;
}

/** Intervalles minutes acceptés (alignés sur le script VPS Python). */
export const MT5_CANDLE_INTERVALS = new Set([1, 5, 15, 30, 60, 240, 1440]);
export const MT5_INTERVALS_SORTED = [1, 5, 15, 30, 60, 240, 1440] as const;
const MAX_HISTORY_BARS = 100_000;

type SeriesKey = `${string}:${number}`;

interface StoredSeries {
  pair: string;
  intervalMin: number;
  mt5Symbol: string;
  bars: Map<number, OhlcCandle>;
  updatedAt: number;
}

const memorySeries = new Map<SeriesKey, StoredSeries>();
const mt5SymbolBySeries = new Map<SeriesKey, string>();

/**
 * In-flight bougies construites en temps réel à partir des ticks MT5.
 * Map<pair, Map<intervalMin, OhlcCandle>>. La bougie "courante" pour la
 * minute actuelle est mise à jour à chaque tick et persistée en DB lors
 * de la rotation de bucket (changement de minute / 5min / etc.). Cela
 * évite tout gap entre la dernière bougie historique persistée et
 * l'instant présent.
 */
const inflightCandles = new Map<string, Map<number, OhlcCandle>>();
const inflightSymbols = new Map<string, string>();

let pool: Pool | null = null;
let schemaReady: Promise<void> = Promise.resolve();

function seriesKey(pair: string, intervalMin: number): SeriesKey {
  return `${pair}:${intervalMin}`;
}

function asBarTime(raw: unknown): number | null {
  const num = Number(raw);
  if (!Number.isFinite(num) || num <= 0) return null;
  return num > 1e12 ? Math.floor(num / 1000) : Math.floor(num);
}

function asOhlc(value: unknown): number | null {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function normalizeInterval(raw: unknown): number | null {
  const num = Math.floor(Number(raw));
  if (!Number.isFinite(num) || !MT5_CANDLE_INTERVALS.has(num)) return null;
  return num;
}

/**
 * Borne maximale autorisée pour un timestamp de bougie reçu via l'API.
 * Les brokers MT5 (FTMO, IC Markets, etc.) livrent souvent leurs temps
 * dans leur propre fuseau (GMT+2/+3). Sans compensation côté VPS Python,
 * on recevrait des bougies dans le futur qui resteraient invisibles côté
 * TradingView (la query SQL filtre `bar_time < to` avec to = now). On
 * rejette donc tout ce qui est > 5 min dans le futur et on log un warning
 * explicite pour aider à diagnostiquer le décalage broker.
 */
const FUTURE_BAR_TOLERANCE_SEC = 300;
let lastFutureWarnAt = 0;

function parseCandle(row: Mt5CandleInput): OhlcCandle | null {
  const time = asBarTime(row.time);
  const open = asOhlc(row.open);
  const high = asOhlc(row.high);
  const low = asOhlc(row.low);
  const close = asOhlc(row.close);
  if (time == null || open == null || high == null || low == null || close == null) return null;
  if (high < low) return null;
  const nowSec = Math.floor(Date.now() / 1000);
  if (time > nowSec + FUTURE_BAR_TOLERANCE_SEC) {
    const now = Date.now();
    if (now - lastFutureWarnAt > 60_000) {
      lastFutureWarnAt = now;
      const offsetHours = ((time - nowSec) / 3600).toFixed(1);
      console.warn(
        `[mt5Candles] bougie rejetée — timestamp ${time} dans le futur (~${offsetHours}h). ` +
        'Vérifie BROKER_OFFSET_SEC dans le script VPS Python.',
      );
    }
    return null;
  }
  return { time, open, high, low, close };
}

function getMemorySeries(pair: string, intervalMin: number, mt5Symbol: string): StoredSeries {
  const key = seriesKey(pair, intervalMin);
  let series = memorySeries.get(key);
  if (!series) {
    series = {
      pair,
      intervalMin,
      mt5Symbol,
      bars: new Map(),
      updatedAt: Date.now(),
    };
    memorySeries.set(key, series);
  }
  series.mt5Symbol = mt5Symbol;
  mt5SymbolBySeries.set(key, mt5Symbol);
  return series;
}

function mergeIntoMemory(pair: string, intervalMin: number, mt5Symbol: string, candles: OhlcCandle[]): StoredSeries {
  const series = getMemorySeries(pair, intervalMin, mt5Symbol);
  for (const candle of candles) {
    series.bars.set(candle.time, candle);
  }
  series.updatedAt = Date.now();
  return series;
}

async function ensureSchema(): Promise<void> {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS mt5_candles (
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
    CREATE INDEX IF NOT EXISTS idx_mt5_candles_pair_tf_time
    ON mt5_candles (pair, timeframe, bar_time DESC)
  `);
}

async function purgeFutureBars(): Promise<void> {
  if (!pool) return;
  try {
    const result = await pool.query(
      `DELETE FROM mt5_candles
       WHERE bar_time > EXTRACT(EPOCH FROM NOW())::bigint + $1`,
      [FUTURE_BAR_TOLERANCE_SEC],
    );
    const removed = result.rowCount ?? 0;
    if (removed > 0) {
      console.warn(`[mt5Candles] purgé ${removed} bougies dans le futur (offset broker non corrigé côté VPS)`);
    }
  } catch (err) {
    console.warn('[mt5Candles] purge futures bars failed:', (err as Error).message);
  }
}

let purgeTimer: ReturnType<typeof setInterval> | null = null;
function startPurgeLoop(): void {
  if (purgeTimer) return;
  // Lance immédiatement puis répète chaque minute. Couvre le cas où la
  // garde côté API rejette de nouvelles bougies futures mais où des
  // résidus polluent encore la DB (push antérieur avec offset broker).
  void purgeFutureBars();
  purgeTimer = setInterval(() => void purgeFutureBars(), 60_000);
  if (typeof purgeTimer.unref === 'function') purgeTimer.unref();
}

export function initMt5CandlesStore(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    console.warn('[mt5Candles] DATABASE_URL absent — historique MT5 conservé en RAM uniquement');
    return Promise.resolve();
  }

  pool = new Pool({
    connectionString: databaseUrl,
    ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
  });
  pool.on('error', (err) => {
    console.error('[mt5Candles pool] idle client error:', err.message || err);
  });

  schemaReady = ensureSchema().catch((err) => {
    console.error('[mt5Candles] schema init failed:', (err as Error).message);
    throw err;
  });
  // Nettoyer en continu les bougies polluées (futures) issues d'un broker
  // MT5 non compensé. Idempotent : si tout est OK, removed=0 à chaque pass.
  void schemaReady.then(() => startPurgeLoop());
  return schemaReady;
}

/**
 * @param mode 'upsert' (défaut) écrase une bougie existante — utilisé par le
 *             push VPS qui est la source de vérité (bid FTMO). 'fillGap' ne
 *             touche pas une bougie déjà persistée — utilisé par le backfill
 *             OANDA pour ne pas écraser les bougies VPS avec un prix mid.
 */
async function persistCandles(
  pair: string,
  intervalMin: number,
  candles: OhlcCandle[],
  mode: 'upsert' | 'fillGap' = 'upsert',
): Promise<void> {
  if (!pool) return;
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
      `INSERT INTO mt5_candles (pair, timeframe, bar_time, open, high, low, close)
       VALUES ${placeholders.join(', ')}
       ${conflictClause}`,
      values,
    );
  }
}

export async function ingestCandles(input: Mt5CandlesIngestInput): Promise<Mt5CandlesIngestResult> {
  const pair = mt5SymbolToPair(input.symbol);
  if (!pair) {
    return { ok: false, error: `Symbole MT5 inconnu: ${input.symbol}` };
  }

  const intervalMin = normalizeInterval(input.timeframe);
  if (intervalMin == null) {
    return { ok: false, error: `Timeframe invalide: ${input.timeframe} (attendu: 1,5,15,30,60,240,1440)` };
  }

  if (!Array.isArray(input.candles) || input.candles.length === 0) {
    return { ok: false, error: 'candles[] vide ou absent' };
  }

  const mt5Symbol = String(input.symbol).trim().toUpperCase();
  const parsed: OhlcCandle[] = [];
  for (const row of input.candles) {
    const candle = parseCandle(row);
    if (candle) parsed.push(candle);
  }

  if (parsed.length === 0) {
    return { ok: false, error: 'Aucune bougie valide dans le batch' };
  }

  mt5SymbolBySeries.set(seriesKey(pair, intervalMin), mt5Symbol);

  let persisted = false;
  let total = parsed.length;

  if (pool) {
    try {
      await persistCandles(pair, intervalMin, parsed);
      persisted = true;
      await schemaReady;
      const countResult = await pool.query(
        'SELECT COUNT(*)::int AS count FROM mt5_candles WHERE pair = $1 AND timeframe = $2',
        [pair, intervalMin],
      );
      total = Number(countResult.rows[0]?.count) || parsed.length;
    } catch (err) {
      console.error('[mt5Candles] persist failed:', (err as Error).message);
      return { ok: false, error: 'Échec écriture Postgres mt5_candles' };
    }
  } else {
    const series = mergeIntoMemory(pair, intervalMin, mt5Symbol, parsed);
    total = series.bars.size;
  }

  return {
    ok: true,
    pair,
    timeframe: intervalMin,
    accepted: parsed.length,
    total,
    persisted,
  };
}

/**
 * Met à jour les bougies "in-flight" pour toutes les timeframes supportées
 * à partir d'un tick MT5. Persiste la bougie précédente quand le bucket
 * change (rotation de minute / 5min / etc.) — ainsi la DB reste alignée
 * avec le présent à la seconde près, sans attendre la sync incrémentale
 * du VPS Python.
 */
export async function updateInflight(
  pair: string,
  mt5Symbol: string,
  price: number,
  tsMs: number,
): Promise<void> {
  if (!Number.isFinite(price) || price <= 0) return;
  const tsSec = Math.floor(tsMs / 1000);
  if (!Number.isFinite(tsSec) || tsSec <= 0) return;

  inflightSymbols.set(pair, mt5Symbol);
  let pairMap = inflightCandles.get(pair);
  if (!pairMap) {
    pairMap = new Map();
    inflightCandles.set(pair, pairMap);
  }

  const rotated: Array<{ interval: number; candle: OhlcCandle }> = [];

  for (const interval of MT5_INTERVALS_SORTED) {
    const intervalSec = interval * 60;
    const bucket = Math.floor(tsSec / intervalSec) * intervalSec;
    const current = pairMap.get(interval);

    if (!current || current.time !== bucket) {
      if (current && current.time < bucket) {
        rotated.push({ interval, candle: { ...current } });
      }
      pairMap.set(interval, {
        time: bucket,
        open: price,
        high: price,
        low: price,
        close: price,
      });
    } else {
      current.high = Math.max(current.high, price);
      current.low = Math.min(current.low, price);
      current.close = price;
    }
  }

  if (rotated.length === 0) return;

  // Persistance fire-and-forget : on ne bloque pas le tick. Une rotation
  // ratée sera de toute façon recouverte par la sync incrémentale du VPS.
  for (const { interval, candle } of rotated) {
    if (pool) {
      persistCandles(pair, interval, [candle]).catch((err) => {
        console.error('[mt5Candles] inflight persist failed:', (err as Error).message);
      });
    } else {
      mergeIntoMemory(pair, interval, mt5Symbol, [candle]);
    }
  }
}

/**
 * Retourne la bougie courante (in-flight) pour (pair, interval) si elle
 * couvre `nowSec`. Utilisé par `getCandles` pour combler le delta entre
 * la dernière bougie persistée et l'instant présent.
 */
export function getInflight(pair: string, intervalMin: number): OhlcCandle | null {
  const candle = inflightCandles.get(pair)?.get(intervalMin);
  if (!candle) return null;
  return { ...candle };
}

/**
 * Compense le délai entre la dernière sync VPS Python (~30 min) et l'instant
 * présent en complétant les bougies manquantes via OANDA / Hyperliquid. Le
 * résultat est persisté en DB pour que les requêtes suivantes soient
 * instantanées et n'aient plus de gap. Idempotent : ne fait rien si la
 * dernière bougie persistée est récente (<2 minutes).
 */
const lastBackfillAt = new Map<string, number>();
const BACKFILL_THROTTLE_MS = 30_000;
const BACKFILL_MAX_GAP_MIN = 60;

async function backfillFromSource(
  pair: string,
  intervalMin: number,
  fromSec: number,
  toSec: number,
): Promise<OhlcCandle[]> {
  const count = Math.max(1, Math.ceil((toSec - fromSec) / (intervalMin * 60)));
  if (oanda.isConfigured()) {
    try {
      const available = await oanda.isInstrumentAvailable(pair);
      if (available) {
        const bars = await oanda.getOhlcCandles(pair, intervalMin, {
          from: fromSec,
          to: toSec,
          countBack: count,
        });
        if (bars.length > 0) return bars;
      }
    } catch (err) {
      console.warn(
        `[mt5Candles] OANDA backfill ${pair} ${intervalMin}m KO:`,
        (err as Error).message,
      );
    }
  }
  try {
    const bars = await hyperliquid.getOhlcCandles(pair, intervalMin, {
      from: fromSec,
      to: toSec,
      countBack: count,
    });
    return bars;
  } catch (err) {
    console.warn(
      `[mt5Candles] Hyperliquid backfill ${pair} ${intervalMin}m KO:`,
      (err as Error).message,
    );
    return [];
  }
}

export async function ensureRecentBackfill(
  pair: string,
  intervalMin: number,
): Promise<void> {
  if (!MT5_CANDLE_INTERVALS.has(intervalMin)) return;
  if (!pool) return;

  const k = seriesKey(pair, intervalMin);
  const now = Date.now();
  const last = lastBackfillAt.get(k) || 0;
  if (now - last < BACKFILL_THROTTLE_MS) return;
  lastBackfillAt.set(k, now);

  try {
    await schemaReady;
    const result = await pool.query(
      'SELECT MAX(bar_time) AS max_time FROM mt5_candles WHERE pair = $1 AND timeframe = $2',
      [pair, intervalMin],
    );
    const intervalSec = intervalMin * 60;
    const lastBarTime = Number(result.rows[0]?.max_time) || 0;
    const nowSec = Math.floor(now / 1000);
    const currentBucket = Math.floor(nowSec / intervalSec) * intervalSec;
    const gapBars = lastBarTime > 0
      ? Math.floor((currentBucket - lastBarTime) / intervalSec) - 1
      : BACKFILL_MAX_GAP_MIN;
    if (gapBars < 1) return;
    const cappedGap = Math.min(gapBars, Math.ceil(BACKFILL_MAX_GAP_MIN * 60 / intervalSec));
    const fromSec = currentBucket - (cappedGap + 1) * intervalSec;

    const bars = await backfillFromSource(pair, intervalMin, fromSec, currentBucket);
    if (bars.length === 0) return;

    // Ne pas écraser les bougies in-flight déjà construites en mémoire :
    // on filtre celles qui chevauchent l'in-flight courant.
    const inflight = inflightCandles.get(pair)?.get(intervalMin);
    const filtered = inflight
      ? bars.filter((bar) => bar.time !== inflight.time)
      : bars;
    if (filtered.length === 0) return;

    // Mode 'fillGap' : ne touche pas aux bougies VPS déjà persistées (prix
    // FTMO bid). OANDA est juste là pour combler les trous historiques.
    await persistCandles(pair, intervalMin, filtered, 'fillGap');
  } catch (err) {
    console.warn(
      `[mt5Candles] backfill ${pair} ${intervalMin}m failed:`,
      (err as Error).message,
    );
  }
}

/**
 * Lance le backfill pour tous les pairs MT5 connus sur l'intervalle M1.
 * Appelé au boot et toutes les 60 secondes pour garder la DB à jour.
 */
let backfillTimer: ReturnType<typeof setInterval> | null = null;

export function startBackfillLoop(intervalMs = 60_000): void {
  if (backfillTimer) return;
  const tick = async () => {
    const symbols = listMt5Symbols();
    for (const pair of symbols) {
      // M1 est l'intervalle critique pour le live tick — les autres
      // timeframes sont buildées à la demande par TradingView.
      await ensureRecentBackfill(pair, 1).catch(() => undefined);
    }
  };
  void tick();
  backfillTimer = setInterval(() => void tick(), intervalMs);
  if (typeof backfillTimer.unref === 'function') backfillTimer.unref();
}

export async function hasCandles(pair: string, intervalMin: number): Promise<boolean> {
  if (inflightCandles.get(pair)?.has(intervalMin)) return true;
  if (pool) {
    await schemaReady;
    const result = await pool.query(
      'SELECT 1 FROM mt5_candles WHERE pair = $1 AND timeframe = $2 LIMIT 1',
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
  const safeInterval = MT5_CANDLE_INTERVALS.has(intervalMin) ? intervalMin : 1;
  const intervalSec = safeInterval * 60;
  const nowSec = Math.floor(Date.now() / 1000);
  const toSec = opts.to && opts.to > 0 ? Math.floor(opts.to) : nowSec;

  // Avant de servir la requête, s'assurer que la DB est à jour à la minute
  // près. Throttlée à 30s pour éviter de hammerer OANDA quand TradingView
  // multiplie les requêtes au démarrage du chart.
  await ensureRecentBackfill(pair, safeInterval).catch(() => undefined);

  const defaultCount = 5000;
  const targetCount = Math.min(
    MAX_HISTORY_BARS,
    opts.countBack && opts.countBack > 0 ? Math.floor(opts.countBack) : defaultCount,
  );

  const fromSec = opts.from && opts.from > 0 ? Math.floor(opts.from) : null;

  let bars: OhlcCandle[];

  if (pool) {
    await schemaReady;

    // Renvoie les `targetCount` dernières bougies persistées en DB.
    // L'ingestion live se fait via le VPS Python qui push directement les
    // bougies MT5 (POST /api/mt5/candles) chaque seconde — on ne
    // reconstruit plus depuis les ticks pour éviter d'envoyer des bougies
    // décalées (open au mauvais prix sur H1, H4, D1…).
    const result = await pool.query(
      `SELECT bar_time AS time, open, high, low, close
       FROM (
         SELECT bar_time, open, high, low, close
         FROM mt5_candles
         WHERE pair = $1
           AND timeframe = $2
           AND bar_time < $3
           AND ($4::bigint IS NULL OR bar_time >= $4)
         ORDER BY bar_time DESC
         LIMIT $5
       ) recent
       ORDER BY bar_time ASC`,
      [pair, safeInterval, toSec, fromSec, targetCount],
    );
    bars = result.rows.map((row) => ({
      time: Number(row.time),
      open: Number(row.open),
      high: Number(row.high),
      low: Number(row.low),
      close: Number(row.close),
    }));
  } else {
    const series = memorySeries.get(seriesKey(pair, safeInterval));
    if (!series || series.bars.size === 0) {
      bars = [];
    } else {
      let memBars = [...series.bars.values()]
        .filter((bar) => bar.time < toSec)
        .sort((a, b) => a.time - b.time);
      if (fromSec != null) {
        memBars = memBars.filter((bar) => bar.time >= fromSec);
      }
      bars = memBars.length <= targetCount ? memBars : memBars.slice(memBars.length - targetCount);
    }
  }

  // L'in-flight bar (construite depuis les ticks au mid) n'est plus
  // appendée du tout. MT5 dessine ses bougies au bid, donc utiliser le mid
  // côté serveur produit des bougies à forme légèrement différente de ce
  // que le trader voit dans MT5. Le VPS push la bougie courante toutes les
  // 5s avec les vraies valeurs MT5 — c'est ça qu'on sert. La fluidité
  // visuelle entre 2 push VPS est assurée côté client par pushTick().
  return bars;
}

export async function getCandlesStatus(): Promise<Mt5CandleSeriesStatus[]> {
  const now = Date.now();

  if (pool) {
    await schemaReady;
    const result = await pool.query(`
      SELECT
        pair,
        timeframe,
        COUNT(*)::int AS count,
        MIN(bar_time)::bigint AS oldest_time,
        MAX(bar_time)::bigint AS newest_time,
        EXTRACT(EPOCH FROM (NOW() - MAX(ingested_at))) * 1000 AS age_ms
      FROM mt5_candles
      GROUP BY pair, timeframe
      ORDER BY pair, timeframe
    `);

    return result.rows.map((row) => ({
      pair: String(row.pair),
      mt5Symbol: mt5SymbolBySeries.get(seriesKey(String(row.pair), Number(row.timeframe)))
        ?? pairToMt5Symbol(String(row.pair))
        ?? '',
      timeframe: Number(row.timeframe),
      count: Number(row.count),
      oldestTime: row.oldest_time != null ? Number(row.oldest_time) : null,
      newestTime: row.newest_time != null ? Number(row.newest_time) : null,
      ageMs: Math.max(0, Math.floor(Number(row.age_ms) || 0)),
    }));
  }

  return [...memorySeries.values()]
    .map((series) => {
      const times = [...series.bars.keys()].sort((a, b) => a - b);
      return {
        pair: series.pair,
        mt5Symbol: series.mt5Symbol,
        timeframe: series.intervalMin,
        count: series.bars.size,
        oldestTime: times[0] ?? null,
        newestTime: times[times.length - 1] ?? null,
        ageMs: Math.max(0, now - series.updatedAt),
      };
    })
    .sort((a, b) => a.pair.localeCompare(b.pair) || a.timeframe - b.timeframe);
}
