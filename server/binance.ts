import type { OhlcCandle } from './kraken.js';

const FUTURES_REST_BASE = 'https://fapi.binance.com';

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

export async function getOhlcCandles(pair: string, interval = 1): Promise<OhlcCandle[]> {
  const symbol = pairToBinanceSymbol(pair);
  if (!symbol) throw new Error('Pair non supportee pour historique Binance');

  const safeInterval = INTERVAL_MAP[interval] ? interval : 1;
  const intervalKey = INTERVAL_MAP[safeInterval];
  const limit = Math.min(1500, Math.max(240, Math.ceil(24 * 60 / safeInterval)));
  const rows = await requestJson<unknown[]>(
    `/fapi/v1/klines?symbol=${encodeURIComponent(symbol)}&interval=${intervalKey}&limit=${limit}`,
  );

  if (!Array.isArray(rows)) return [];

  return rows
    .map((row: any) => ({
      time: Math.floor(Number(row?.[0]) / 1000),
      open: Number(row?.[1]),
      high: Number(row?.[2]),
      low: Number(row?.[3]),
      close: Number(row?.[4]),
    }))
    .filter((candle) => (
      Number.isFinite(candle.time)
      && Number.isFinite(candle.open)
      && Number.isFinite(candle.high)
      && Number.isFinite(candle.low)
      && Number.isFinite(candle.close)
      && candle.time > 0
    ));
}
