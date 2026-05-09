import type { OhlcCandle } from './kraken.js';

const HYPERLIQUID_INFO_URL = 'https://api.hyperliquid.xyz/info';

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

export async function getOhlcCandles(pair: string, interval = 1): Promise<OhlcCandle[]> {
  const coin = PAIR_TO_COIN[pair];
  if (!coin) {
    throw new Error('Pair non supportee pour historique Hyperliquid');
  }

  const safeInterval = INTERVAL_MAP[interval] ? interval : 1;
  const intervalKey = INTERVAL_MAP[safeInterval];
  const now = Date.now();
  const lookbackMs = Math.max(240, Math.ceil(24 * 60 / safeInterval)) * safeInterval * 60 * 1000;
  const startTime = now - lookbackMs;

  const rows = await postInfo({
    type: 'candleSnapshot',
    req: {
      coin,
      interval: intervalKey,
      startTime,
      endTime: now,
    },
  });

  if (!Array.isArray(rows)) return [];

  return rows
    .map((row: any) => {
      const rawTime = Number(row?.t ?? row?.time ?? row?.T);
      const time = rawTime > 1e12 ? Math.floor(rawTime / 1000) : rawTime;
      return {
        time,
        open: Number(row?.o ?? row?.open),
        high: Number(row?.h ?? row?.high),
        low: Number(row?.l ?? row?.low),
        close: Number(row?.c ?? row?.close),
      };
    })
    .filter((candle) => (
      Number.isFinite(candle.time)
      && Number.isFinite(candle.open)
      && Number.isFinite(candle.high)
      && Number.isFinite(candle.low)
      && Number.isFinite(candle.close)
      && candle.time > 0
    ));
}
