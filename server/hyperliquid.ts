import type { OhlcCandle, OhlcQueryOptions } from './kraken.js';
import { getHyperliquidTradfiSymbol } from './oandaInstruments.js';

const HYPERLIQUID_INFO_URL = 'https://api.hyperliquid.xyz/info';
const MAX_CANDLES = 50000;
const HL_CHUNK_LIMIT = 5000;
const DEFAULT_LOOKBACK_DAYS = 30;
/** Hyperliquid caps ~5165 x 1m candles per symbol. */
const HL_1M_MAX_BARS = 5165;

const PAIR_TO_COIN: Record<string, string> = {
  'BTC/USD': 'BTC',
  'ETH/USD': 'ETH',
  'SOL/USD': 'SOL',
  'XRP/USD': 'XRP',
};

const INTERVAL_MAP: Record<number, string> = {
  1: '1m',
  5: '5m',
  15: '15m',
  30: '30m',
  60: '1h',
  240: '4h',
  1440: '1d',
};

async function postInfo(payload: unknown): Promise<any> {
  const response = await fetch(HYPERLIQUID_INFO_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Hyperliquid API ${response.status}`);
  }

  return response.json();
}

export async function getTickers(): Promise<Record<string, number>> {
  const mids = await postInfo({ type: 'allMids' });
  const prices: Record<string, number> = {};

  for (const [pair, coin] of Object.entries(PAIR_TO_COIN)) {
    const rawPrice = Number(mids?.[coin]);
    if (Number.isFinite(rawPrice) && rawPrice > 0) {
      prices[pair] = rawPrice;
    }
  }

  return prices;
}

export async function getAllMids(): Promise<Record<string, number>> {
  const [defaultMids, xyzMids] = await Promise.all([
    postInfo({ type: 'allMids' }),
    postInfo({ type: 'allMids', dex: 'xyz' }).catch(() => ({})),
  ]);
  const mids = { ...defaultMids, ...xyzMids };
  const prices: Record<string, number> = {};

  for (const [symbol, value] of Object.entries(mids || {})) {
    const rawPrice = Number(value);
    if (Number.isFinite(rawPrice) && rawPrice > 0) {
      prices[symbol] = rawPrice;
    }
  }

  return prices;
}

function pairToHyperliquidCoin(pair: string): string | null {
  if (PAIR_TO_COIN[pair]) return PAIR_TO_COIN[pair];
  return getHyperliquidTradfiSymbol(pair);
}

function parseCandleRow(row: any): OhlcCandle | null {
  const rawTime = Number(row?.t ?? row?.time ?? row?.T);
  const time = rawTime > 1e12 ? Math.floor(rawTime / 1000) : rawTime;
  const open = Number(row?.o ?? row?.open);
  const high = Number(row?.h ?? row?.high);
  const low = Number(row?.l ?? row?.low);
  const close = Number(row?.c ?? row?.close);
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
  const coin = pairToHyperliquidCoin(pair);
  if (!coin) {
    throw new Error('Pair non supportee pour historique Hyperliquid');
  }

  const safeInterval = INTERVAL_MAP[interval] ? interval : 1;
  const intervalKey = INTERVAL_MAP[safeInterval];
  const intervalMs = safeInterval * 60 * 1000;
  const nowMs = Date.now();
  const toMs = opts.to && opts.to > 0 ? opts.to * 1000 : nowMs;

  const thirtyDayBars = Math.ceil((DEFAULT_LOOKBACK_DAYS * 24 * 60) / safeInterval);
  const defaultCount = safeInterval === 1
    ? HL_1M_MAX_BARS
    : Math.min(MAX_CANDLES, thirtyDayBars);

  const targetCount = Math.min(
    MAX_CANDLES,
    opts.countBack && opts.countBack > 0
      ? opts.countBack
      : defaultCount,
  );

  const fromMs = opts.countBack && opts.countBack > 0
    ? toMs - targetCount * intervalMs
    : opts.from && opts.from > 0
      ? opts.from * 1000
      : toMs - targetCount * intervalMs;

  const byTime = new Map<number, OhlcCandle>();
  let endMs = toMs;

  while (byTime.size < targetCount && endMs > fromMs) {
    const rows = await postInfo({
      type: 'candleSnapshot',
      req: {
        coin,
        interval: intervalKey,
        startTime: fromMs,
        endTime: endMs,
      },
    });

    if (!Array.isArray(rows) || rows.length === 0) break;

    let oldestMs = endMs;
    for (const row of rows) {
      const candle = parseCandleRow(row);
      if (!candle) continue;
      const candleMs = candle.time * 1000;
      if (candleMs >= toMs || candleMs < fromMs) continue;
      oldestMs = Math.min(oldestMs, candleMs);
      byTime.set(candle.time, candle);
    }

    if (rows.length < HL_CHUNK_LIMIT) break;
    if (oldestMs >= endMs || oldestMs <= fromMs) break;
    endMs = oldestMs - 1;
  }

  return [...byTime.values()].sort((a, b) => a.time - b.time);
}
