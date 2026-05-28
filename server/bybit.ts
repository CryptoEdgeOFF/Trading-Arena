import type { OhlcCandle, OhlcQueryOptions } from './kraken.js';

/**
 * Bybit V5 REST — source de bougies crypto de dernier recours.
 *
 * `api.bybit.com` n'est pas géo-bloqué pour cet accès public (contrairement
 * à Binance Futures qui renvoie 451 sur certaines IP datacenter). Sert les
 * mêmes pairs USDT-perp que Binance, sous le même symbole de base.
 */

const REST_BASE = 'https://api.bybit.com';
const MAX_CANDLES = 50_000;
const DEFAULT_LOOKBACK_DAYS = 30;
const INTRADAY_DEFAULT_BARS = 10_000;
/** Bybit plafonne chaque appel `/v5/market/kline` à 1000 bougies. */
const PAGE_LIMIT = 1000;

/** Minutes → code interval Bybit. 1440 = daily ("D"). */
const INTERVAL_MAP: Record<number, string> = {
  1: '1',
  5: '5',
  15: '15',
  30: '30',
  60: '60',
  240: '240',
  1440: 'D',
};

export function pairToBybitSymbol(pair: string): string | null {
  const base = pair.split('/')[0]?.trim().toUpperCase();
  if (!base) return null;
  return `${base}USDT`;
}

interface BybitKlineResponse {
  retCode?: number;
  retMsg?: string;
  result?: { list?: unknown[][] };
}

function parseKlineRow(row: unknown[]): OhlcCandle | null {
  // Bybit row: [startMs, open, high, low, close, volume, turnover]
  const time = Math.floor(Number(row?.[0]) / 1000);
  const open = Number(row?.[1]);
  const high = Number(row?.[2]);
  const low = Number(row?.[3]);
  const close = Number(row?.[4]);
  if (
    !Number.isFinite(time) || time <= 0
    || !Number.isFinite(open) || !Number.isFinite(high)
    || !Number.isFinite(low) || !Number.isFinite(close)
  ) {
    return null;
  }
  return { time, open, high, low, close };
}

export async function getOhlcCandles(
  pair: string,
  interval = 1,
  opts: OhlcQueryOptions = {},
): Promise<OhlcCandle[]> {
  const symbol = pairToBybitSymbol(pair);
  if (!symbol) throw new Error('Pair non supportee pour historique Bybit');

  const safeInterval = INTERVAL_MAP[interval] ? interval : 1;
  const intervalKey = INTERVAL_MAP[safeInterval];
  const intervalSec = safeInterval * 60;
  const nowSec = Math.floor(Date.now() / 1000);

  const toSec = opts.to && opts.to > 0 ? opts.to : nowSec;
  const thirtyDayBars = Math.ceil((DEFAULT_LOOKBACK_DAYS * 24 * 60) / safeInterval);
  const defaultCount = safeInterval <= 5
    ? Math.min(MAX_CANDLES, INTRADAY_DEFAULT_BARS)
    : Math.min(MAX_CANDLES, thirtyDayBars);
  const targetCount = Math.min(
    MAX_CANDLES,
    opts.countBack && opts.countBack > 0
      ? opts.countBack
      : opts.from && opts.from > 0
        ? Math.ceil((toSec - opts.from) / intervalSec) + 2
        : defaultCount,
  );

  const fromSec = opts.countBack && opts.countBack > 0
    ? Math.max(0, toSec - targetCount * intervalSec)
    : opts.from && opts.from > 0
      ? opts.from
      : Math.max(0, toSec - targetCount * intervalSec);

  const byTime = new Map<number, OhlcCandle>();
  let endMs = toSec * 1000;

  while (byTime.size < targetCount && endMs > fromSec * 1000) {
    const limit = Math.min(PAGE_LIMIT, targetCount - byTime.size);
    const url = `${REST_BASE}/v5/market/kline?category=linear&symbol=${encodeURIComponent(symbol)}`
      + `&interval=${intervalKey}&start=${fromSec * 1000}&end=${endMs}&limit=${limit}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Bybit API ${response.status}`);
    const payload = (await response.json()) as BybitKlineResponse;
    if (payload.retCode !== 0) {
      throw new Error(`Bybit API retCode=${payload.retCode} ${payload.retMsg ?? ''}`);
    }
    const rows = payload.result?.list;
    if (!Array.isArray(rows) || rows.length === 0) break;

    // Bybit renvoie les bougies en ordre décroissant (récent → ancien).
    let oldestMs = endMs;
    for (const row of rows) {
      const candle = parseKlineRow(row);
      if (!candle) continue;
      oldestMs = Math.min(oldestMs, candle.time * 1000);
      if (candle.time >= toSec || candle.time < fromSec) continue;
      byTime.set(candle.time, candle);
    }

    if (rows.length < limit) break;
    if (oldestMs >= endMs) break;
    endMs = oldestMs - 1;
    if (oldestMs <= fromSec * 1000) break;
  }

  return [...byTime.values()].sort((a, b) => a.time - b.time);
}
