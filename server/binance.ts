import type { OhlcCandle, OhlcQueryOptions } from './kraken.js';

const FUTURES_REST_BASE = 'https://fapi.binance.com';
const MAX_CANDLES = 50000;
const DEFAULT_LOOKBACK_DAYS = 30;
const INTRADAY_DEFAULT_BARS = 10000;

const INTERVAL_MAP: Record<number, string> = {
  1: '1m',
  5: '5m',
  15: '15m',
  30: '30m',
  60: '1h',
  240: '4h',
  1440: '1d',
};

export function pairToBinanceSymbol(pair: string): string | null {
  const base = pair.split('/')[0]?.trim().toUpperCase();
  if (!base) return null;
  return `${base}USDT`;
}

async function requestJson<T>(path: string): Promise<T> {
  const response = await fetch(`${FUTURES_REST_BASE}${path}`);
  if (!response.ok) {
    throw new Error(`Binance Futures API ${response.status}`);
  }
  return response.json() as Promise<T>;
}

function parseKlineRow(row: unknown): OhlcCandle | null {
  const values = row as unknown[];
  const time = Math.floor(Number(values?.[0]) / 1000);
  const open = Number(values?.[1]);
  const high = Number(values?.[2]);
  const low = Number(values?.[3]);
  const close = Number(values?.[4]);
  if (
    !Number.isFinite(time) || time <= 0
    || !Number.isFinite(open) || !Number.isFinite(high)
    || !Number.isFinite(low) || !Number.isFinite(close)
  ) {
    return null;
  }
  return { time, open, high, low, close };
}

export async function getTickerStats(): Promise<Record<string, { markPrice: number; change24h: number | null }>> {
  const [markRows, statsRows] = await Promise.all([
    requestJson<Array<{ symbol?: string; markPrice?: string }>>('/fapi/v1/premiumIndex'),
    requestJson<Array<{ symbol?: string; priceChangePercent?: string; lastPrice?: string }>>('/fapi/v1/ticker/24hr')
      .catch(() => []),
  ]);

  const changeBySymbol = new Map<string, number | null>();
  for (const row of statsRows) {
    const symbol = String(row.symbol || '').toUpperCase();
    const change = Number(row.priceChangePercent);
    if (symbol) changeBySymbol.set(symbol, Number.isFinite(change) ? change : null);
  }

  const prices: Record<string, { markPrice: number; change24h: number | null }> = {};
  for (const row of markRows) {
    const symbol = String(row.symbol || '').toUpperCase();
    const markPrice = Number(row.markPrice);
    if (symbol && Number.isFinite(markPrice) && markPrice > 0) {
      prices[symbol] = {
        markPrice,
        change24h: changeBySymbol.get(symbol) ?? null,
      };
    }
  }

  return prices;
}

export async function getTickers(): Promise<Record<string, number>> {
  const stats = await getTickerStats();
  return Object.fromEntries(Object.entries(stats).map(([symbol, ticker]) => [symbol, ticker.markPrice]));
}

export async function getOhlcCandles(
  pair: string,
  interval = 1,
  opts: OhlcQueryOptions = {},
): Promise<OhlcCandle[]> {
  const symbol = pairToBinanceSymbol(pair);
  if (!symbol) throw new Error('Pair non supportee pour historique Binance');

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

  // countBack has priority over TV's `from` (often years in the past on first load).
  const fromSec = opts.countBack && opts.countBack > 0
    ? Math.max(0, toSec - targetCount * intervalSec)
    : opts.from && opts.from > 0
      ? opts.from
      : Math.max(0, toSec - targetCount * intervalSec);

  const byTime = new Map<number, OhlcCandle>();
  let endMs = toSec * 1000 - 1;

  while (byTime.size < targetCount && endMs > fromSec * 1000) {
    const limit = Math.min(1500, targetCount - byTime.size);
    const rows = await requestJson<unknown[]>(
      `/fapi/v1/klines?symbol=${encodeURIComponent(symbol)}&interval=${intervalKey}&limit=${limit}&endTime=${endMs}`,
    );
    if (!Array.isArray(rows) || rows.length === 0) break;

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
