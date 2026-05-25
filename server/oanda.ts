import type { OhlcCandle } from './kraken.js';
import {
  OANDA_INSTRUMENT_MAP,
  OANDA_TRADFI_PAIRS,
  getOandaMapping,
  type OandaPairMapping,
} from './oandaInstruments.js';

export interface OandaPriceQuote {
  markPrice: number;
  bidPrice: number;
  askPrice: number;
}

const GRANULARITY_MAP: Record<number, string> = {
  1: 'M1',
  5: 'M5',
  15: 'M15',
  30: 'M30',
  60: 'H1',
  240: 'H4',
  1440: 'D',
};

const PRICING_CHUNK_SIZE = 40;

let cachedAccountId: string | null = null;
let availableInstruments: Set<string> | null = null;
let warnedMissingConfig = false;
let connectionReady = false;

function getRestBase(): string {
  return process.env.OANDA_ENV === 'live'
    ? 'https://api-fxtrade.oanda.com'
    : 'https://api-fxpractice.oanda.com';
}

function getToken(): string | null {
  return process.env.OANDA_API_TOKEN?.trim() || null;
}

export function isConfigured(): boolean {
  return Boolean(getToken());
}

function asNumber(value: unknown): number | null {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : null;
}

function transformQuote(
  bid: number,
  ask: number,
  mapping?: OandaPairMapping,
): OandaPriceQuote {
  if (!mapping?.invert) {
    const mark = (bid + ask) / 2;
    return { markPrice: mark, bidPrice: bid, askPrice: ask };
  }
  const invBid = ask > 0 ? 1 / ask : 0;
  const invAsk = bid > 0 ? 1 / bid : 0;
  const mark = invBid > 0 && invAsk > 0 ? (invBid + invAsk) / 2 : 0;
  return {
    markPrice: mark,
    bidPrice: Math.min(invBid, invAsk),
    askPrice: Math.max(invBid, invAsk),
  };
}

function transformCandlePrices(
  open: number,
  high: number,
  low: number,
  close: number,
  invert?: boolean,
): { open: number; high: number; low: number; close: number } {
  if (!invert) return { open, high, low, close };
  const inv = (value: number) => (value > 0 ? 1 / value : value);
  const values = [inv(open), inv(high), inv(low), inv(close)];
  return {
    open: values[0],
    high: Math.max(...values),
    low: Math.min(...values),
    close: values[3],
  };
}

async function oandaRequest(path: string, params?: Record<string, string>): Promise<any> {
  const token = getToken();
  if (!token) throw new Error('OANDA_API_TOKEN manquant');

  const url = new URL(`${getRestBase()}${path}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`OANDA ${response.status}: ${body.slice(0, 240)}`);
  }

  return response.json();
}

async function resolveAccountId(): Promise<string> {
  const configured = process.env.OANDA_ACCOUNT_ID?.trim();
  if (configured) {
    cachedAccountId = configured;
    return configured;
  }
  if (cachedAccountId) return cachedAccountId;

  const payload = await oandaRequest('/v3/accounts');
  const accountId = payload?.accounts?.[0]?.id;
  if (!accountId) throw new Error('Aucun compte OANDA trouvé pour ce token');
  cachedAccountId = String(accountId);
  return cachedAccountId;
}

async function loadAvailableInstruments(): Promise<Set<string>> {
  if (availableInstruments) return availableInstruments;
  const accountId = await resolveAccountId();
  const payload = await oandaRequest(`/v3/accounts/${accountId}/instruments`);
  availableInstruments = new Set(
    (payload?.instruments || [])
      .map((item: { name?: string }) => String(item?.name || '').trim())
      .filter(Boolean),
  );
  return availableInstruments;
}

function activeTradfiMappings(): OandaPairMapping[] {
  if (!availableInstruments) return OANDA_TRADFI_PAIRS;
  return OANDA_TRADFI_PAIRS.filter((item) => availableInstruments!.has(item.instrument));
}

async function ensureReady(): Promise<boolean> {
  if (!isConfigured()) {
    if (!warnedMissingConfig) {
      console.warn('[OANDA] OANDA_API_TOKEN absent — TradFi désactivée');
      warnedMissingConfig = true;
    }
    return false;
  }
  if (connectionReady) return true;

  await resolveAccountId();
  const available = await loadAvailableInstruments();
  const supported = OANDA_TRADFI_PAIRS.filter((item) => available.has(item.instrument));
  const missing = OANDA_TRADFI_PAIRS
    .filter((item) => !available.has(item.instrument))
    .map((item) => item.instrument);

  console.log(`[OANDA] Connecté — ${supported.length}/${OANDA_TRADFI_PAIRS.length} instruments TradFi disponibles`);
  if (missing.length > 0) {
    console.warn(`[OANDA] Instruments indisponibles sur ce compte: ${missing.slice(0, 12).join(', ')}${missing.length > 12 ? '…' : ''}`);
  }

  connectionReady = true;
  return true;
}

export async function validateConnection(): Promise<void> {
  await ensureReady();
}

export async function getPricing(): Promise<Record<string, OandaPriceQuote>> {
  if (!(await ensureReady())) return {};

  try {
    const accountId = await resolveAccountId();
    const mappings = activeTradfiMappings();
    if (mappings.length === 0) return {};

    const byInstrument = new Map(mappings.map((item) => [item.instrument, item]));
    const uniqueInstruments = [...new Set(mappings.map((item) => item.instrument))];
    const quotes: Record<string, OandaPriceQuote> = {};

    for (let i = 0; i < uniqueInstruments.length; i += PRICING_CHUNK_SIZE) {
      const chunk = uniqueInstruments.slice(i, i + PRICING_CHUNK_SIZE);
      const payload = await oandaRequest(`/v3/accounts/${accountId}/pricing`, {
        instruments: chunk.join(','),
      });

      for (const price of payload?.prices || []) {
        const instrument = String(price?.instrument || '');
        const mapping = byInstrument.get(instrument) || OANDA_INSTRUMENT_MAP.get(instrument);
        if (!mapping) continue;
        if (price?.status && price.status !== 'tradeable') continue;

        const bid = asNumber(price?.bids?.[0]?.price ?? price?.closeoutBid);
        const ask = asNumber(price?.asks?.[0]?.price ?? price?.closeoutAsk);
        if (bid == null || ask == null) continue;

        quotes[mapping.instrument] = transformQuote(bid, ask, mapping);
      }
    }

    return quotes;
  } catch (error) {
    console.error('[OANDA] Pricing failed:', (error as Error).message);
    return {};
  }
}

export async function getOhlcCandles(pair: string, interval = 1): Promise<OhlcCandle[]> {
  const mapping = getOandaMapping(pair);
  if (!mapping) throw new Error('Pair non supportée pour historique OANDA');
  if (!isConfigured()) throw new Error('OANDA_API_TOKEN manquant');

  const accountId = await resolveAccountId();
  const available = await loadAvailableInstruments();
  if (!available.has(mapping.instrument)) {
    throw new Error(`Instrument OANDA indisponible: ${mapping.instrument}`);
  }

  const safeInterval = GRANULARITY_MAP[interval] ? interval : 1;
  const granularity = GRANULARITY_MAP[safeInterval];
  const count = Math.min(5000, Math.max(240, Math.ceil(24 * 60 / safeInterval)));

  const payload = await oandaRequest(
    `/v3/accounts/${accountId}/instruments/${encodeURIComponent(mapping.instrument)}/candles`,
    {
      granularity,
      count: String(count),
      price: 'M',
    },
  );

  if (!Array.isArray(payload?.candles)) return [];

  return payload.candles
    .map((row: any) => {
      const rawTime = Date.parse(String(row?.time || ''));
      const time = Number.isFinite(rawTime) ? Math.floor(rawTime / 1000) : 0;
      const open = asNumber(row?.mid?.o);
      const high = asNumber(row?.mid?.h);
      const low = asNumber(row?.mid?.l);
      const close = asNumber(row?.mid?.c);
      if (time <= 0 || open == null || high == null || low == null || close == null) return null;
      const transformed = transformCandlePrices(open, high, low, close, mapping.invert);
      return {
        time,
        open: transformed.open,
        high: transformed.high,
        low: transformed.low,
        close: transformed.close,
      } satisfies OhlcCandle;
    })
    .filter((candle: OhlcCandle | null): candle is OhlcCandle => Boolean(candle));
}
