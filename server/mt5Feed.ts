import { mt5SymbolToPair } from './mt5Instruments.js';

export interface Mt5Quote {
  pair: string;
  mt5Symbol: string;
  markPrice: number;
  bidPrice: number;
  askPrice: number;
  updatedAt: number;
}

export interface Mt5TickInput {
  symbol: string;
  bid: number;
  ask: number;
  ts_ms?: number;
}

export interface Mt5IngestResult {
  ok: boolean;
  pair?: string;
  error?: string;
}

const STALE_MS = 15_000;
const quotes = new Map<string, Mt5Quote>();

let onTickListener: (() => void) | null = null;
let notifyTimer: ReturnType<typeof setTimeout> | null = null;

function normalizeTimestamp(ts_ms?: number): number {
  if (!Number.isFinite(ts_ms) || !ts_ms || ts_ms <= 0) return Date.now();
  let ms = ts_ms;
  if (ms < 1e12) ms *= 1000;
  const now = Date.now();
  // MT5 parfois en avance sur l'horloge locale — on clamp à now.
  if (ms > now + 5000) return now;
  return ms;
}

function asPrice(value: unknown): number | null {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : null;
}

function isFresh(updatedAt: number, now = Date.now()): boolean {
  const ageMs = now - updatedAt;
  return ageMs >= 0 && ageMs <= STALE_MS;
}

function scheduleNotify(): void {
  if (!onTickListener) return;
  if (notifyTimer) return;
  notifyTimer = setTimeout(() => {
    notifyTimer = null;
    onTickListener?.();
  }, 200);
}

export function setOnTick(listener: (() => void) | null): void {
  onTickListener = listener;
}

export function isConfigured(): boolean {
  return true;
}

export function ingestTick(input: Mt5TickInput): Mt5IngestResult {
  const pair = mt5SymbolToPair(input.symbol);
  if (!pair) {
    return { ok: false, error: `Symbole MT5 inconnu: ${input.symbol}` };
  }

  const bid = asPrice(input.bid);
  const ask = asPrice(input.ask);
  if (bid == null || ask == null) {
    return { ok: false, error: 'bid/ask invalides' };
  }

  const updatedAt = normalizeTimestamp(input.ts_ms);
  quotes.set(pair, {
    pair,
    mt5Symbol: String(input.symbol).trim().toUpperCase(),
    markPrice: (bid + ask) / 2,
    bidPrice: bid,
    askPrice: ask,
    updatedAt,
  });
  scheduleNotify();
  return { ok: true, pair };
}

export function ingestTickLine(line: string): Mt5IngestResult {
  const trimmed = line.trim();
  const match = trimmed.match(
    /\[TICK\]\s+(\S+)\s+bid=([\d.]+)\s+ask=([\d.]+)(?:\s+last=[^\s]+)?(?:\s+vol=\d+)?\s+ts_ms=(\d+)/i,
  );
  if (!match) {
    return { ok: false, error: 'Format tick MT5 non reconnu' };
  }
  return ingestTick({
    symbol: match[1]!,
    bid: Number(match[2]),
    ask: Number(match[3]),
    ts_ms: Number(match[4]),
  });
}

export function getQuote(pair: string): Mt5Quote | undefined {
  const quote = quotes.get(pair);
  if (!quote || !isFresh(quote.updatedAt)) return undefined;
  return quote;
}

export function getPricing(): Record<string, Mt5Quote> {
  const now = Date.now();
  const out: Record<string, Mt5Quote> = {};
  for (const [pair, quote] of quotes) {
    if (isFresh(quote.updatedAt, now)) out[pair] = quote;
  }
  return out;
}

export function getStatus() {
  const now = Date.now();
  return {
    staleMs: STALE_MS,
    quotes: [...quotes.values()].map((quote) => ({
      ...quote,
      ageMs: Math.max(0, now - quote.updatedAt),
      fresh: isFresh(quote.updatedAt, now),
    })),
  };
}
