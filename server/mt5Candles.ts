import { Pool } from 'pg';
import type { OhlcCandle, OhlcQueryOptions } from './kraken.js';
import { mt5SymbolToPair, pairToMt5Symbol } from './mt5Instruments.js';

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

function parseCandle(row: Mt5CandleInput): OhlcCandle | null {
  const time = asBarTime(row.time);
  const open = asOhlc(row.open);
  const high = asOhlc(row.high);
  const low = asOhlc(row.low);
  const close = asOhlc(row.close);
  if (time == null || open == null || high == null || low == null || close == null) return null;
  if (high < low) return null;
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
  return schemaReady;
}

async function persistCandles(
  pair: string,
  intervalMin: number,
  candles: OhlcCandle[],
): Promise<void> {
  if (!pool) return;
  await schemaReady;

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
       ON CONFLICT (pair, timeframe, bar_time) DO UPDATE SET
         open = EXCLUDED.open,
         high = EXCLUDED.high,
         low = EXCLUDED.low,
         close = EXCLUDED.close,
         ingested_at = NOW()`,
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

export async function hasCandles(pair: string, intervalMin: number): Promise<boolean> {
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

  const defaultCount = 5000;
  const targetCount = Math.min(
    MAX_HISTORY_BARS,
    opts.countBack && opts.countBack > 0 ? Math.floor(opts.countBack) : defaultCount,
  );

  const fromSec = opts.from && opts.from > 0 ? Math.floor(opts.from) : null;

  if (pool) {
    await schemaReady;

    // Toujours renvoyer les `targetCount` dernières bougies avant `to` (optionnellement
    // après `from`). Couvre l'ouverture du chart ET le scroll vers le passé.
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
    .filter((bar) => bar.time < toSec)
    .sort((a, b) => a.time - b.time);

  if (fromSec != null) {
    bars = bars.filter((bar) => bar.time >= fromSec);
  }

  if (bars.length <= targetCount) return bars;
  return bars.slice(bars.length - targetCount);
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
