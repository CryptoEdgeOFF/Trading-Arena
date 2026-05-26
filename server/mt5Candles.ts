import type { OhlcCandle, OhlcQueryOptions } from './kraken.js';
import { mt5SymbolToPair } from './mt5Instruments.js';

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
  error?: string;
}

/** Intervalles minutes acceptés (alignés sur le script VPS Python). */
export const MT5_CANDLE_INTERVALS = new Set([1, 5, 15, 30, 60, 240, 1440]);

type SeriesKey = `${string}:${number}`;

interface StoredSeries {
  pair: string;
  intervalMin: number;
  mt5Symbol: string;
  /** bar open time (unix sec) → candle */
  bars: Map<number, OhlcCandle>;
  updatedAt: number;
}

const seriesByKey = new Map<SeriesKey, StoredSeries>();

function seriesKey(pair: string, intervalMin: number): SeriesKey {
  return `${pair}:${intervalMin}`;
}

function asBarTime(raw: unknown): number | null {
  const num = Number(raw);
  if (!Number.isFinite(num) || num <= 0) return null;
  // MT5 Python envoie des secondes ; on tolère les ms par erreur.
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

export function ingestCandles(input: Mt5CandlesIngestInput): Mt5CandlesIngestResult {
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

  const key = seriesKey(pair, intervalMin);
  let series = seriesByKey.get(key);
  if (!series) {
    series = {
      pair,
      intervalMin,
      mt5Symbol: String(input.symbol).trim().toUpperCase(),
      bars: new Map(),
      updatedAt: Date.now(),
    };
    seriesByKey.set(key, series);
  }

  let accepted = 0;
  for (const row of input.candles) {
    const candle = parseCandle(row);
    if (!candle) continue;
    series.bars.set(candle.time, candle);
    accepted += 1;
  }

  if (accepted === 0) {
    return { ok: false, error: 'Aucune bougie valide dans le batch' };
  }

  series.updatedAt = Date.now();
  return {
    ok: true,
    pair,
    timeframe: intervalMin,
    accepted,
    total: series.bars.size,
  };
}

export function hasCandles(pair: string, intervalMin: number): boolean {
  const series = seriesByKey.get(seriesKey(pair, intervalMin));
  return Boolean(series && series.bars.size > 0);
}

export function getCandles(
  pair: string,
  intervalMin: number,
  opts: OhlcQueryOptions = {},
): OhlcCandle[] {
  const series = seriesByKey.get(seriesKey(pair, intervalMin));
  if (!series || series.bars.size === 0) return [];

  const safeInterval = MT5_CANDLE_INTERVALS.has(intervalMin) ? intervalMin : 1;
  const intervalSec = safeInterval * 60;
  const nowSec = Math.floor(Date.now() / 1000);
  const toSec = opts.to && opts.to > 0 ? Math.floor(opts.to) : nowSec;

  const defaultCount = 5000;
  const targetCount = Math.min(
    50000,
    opts.countBack && opts.countBack > 0 ? Math.floor(opts.countBack) : defaultCount,
  );

  const fromSec = opts.from && opts.from > 0
    ? Math.floor(opts.from)
    : toSec - targetCount * intervalSec;

  const bars = [...series.bars.values()]
    .filter((bar) => bar.time >= fromSec && bar.time < toSec)
    .sort((a, b) => a.time - b.time);

  if (bars.length <= targetCount) return bars;
  return bars.slice(bars.length - targetCount);
}

export function getCandlesStatus() {
  const now = Date.now();
  return [...seriesByKey.values()]
    .map((series) => {
      const times = [...series.bars.keys()].sort((a, b) => a - b);
      const oldest = times[0] ?? null;
      const newest = times[times.length - 1] ?? null;
      return {
        pair: series.pair,
        mt5Symbol: series.mt5Symbol,
        timeframe: series.intervalMin,
        count: series.bars.size,
        oldestTime: oldest,
        newestTime: newest,
        ageMs: Math.max(0, now - series.updatedAt),
      };
    })
    .sort((a, b) => a.pair.localeCompare(b.pair) || a.timeframe - b.timeframe);
}
