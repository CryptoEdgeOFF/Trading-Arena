/**
 * Carnets Binance USDⓈ-M locaux, partagés par tous les joueurs.
 *
 * Railway (US) est géo-bloqué sur le REST Binance (HTTP 451). On n'utilise
 * donc pas le snapshot + diffs incrémentaux : chaque tick `@depth20`
 * remplace le top 20. Aucune requête au fill — le moteur lit un snapshot
 * immuable déjà en mémoire.
 *
 * Staging uniquement (`MOBILE_STAGING_TEST_MODE`). Prod inchangée.
 */
import WebSocket from 'ws';
import { pairToBinanceSymbol } from './binance.js';
import type { PaperOrderBook } from './paperSlippage.js';

const FUTURES_WS = 'wss://fstream.binance.com/stream';
const RECONNECT_MS = 3_000;
const REFRESH_CONNECTION_MS = 23 * 60 * 60_000;
const BOOK_LEVELS = 20;
const DEFAULT_MAX_AGE_MS = 4_000;

export type BinanceDepthEvent = {
  e?: string;
  s?: string;
  U?: number;
  u?: number;
  pu?: number;
  b?: Array<[string, string]>;
  a?: Array<[string, string]>;
  bids?: Array<[string, string]>;
  asks?: Array<[string, string]>;
  E?: number;
  T?: number;
  lastUpdateId?: number;
};

type BookSide = Map<string, number>;

type LocalBook = {
  pair: string;
  symbol: string;
  bids: BookSide;
  asks: BookSide;
  lastUpdateId: number;
  synced: boolean;
  ts: number;
  snapshot: PaperOrderBook | null;
  resyncs: number;
  lastError: string | null;
};

export function isBinanceOrderBookEnabled(): boolean {
  if (process.env.MOBILE_STAGING_TEST_MODE !== 'true') return false;
  if (process.env.NETLIFY) return false;
  return process.env.PAPER_BINANCE_BOOK !== 'false';
}

export function binanceBookLimit(): number {
  return BOOK_LEVELS;
}

export function binanceBookMaxAgeMs(): number {
  const parsed = Number(process.env.PAPER_BINANCE_BOOK_MAX_AGE_MS);
  return Number.isFinite(parsed) && parsed >= 1000 ? parsed : DEFAULT_MAX_AGE_MS;
}

export function shouldAcceptFirstDepthEvent(event: BinanceDepthEvent, lastUpdateId: number): boolean {
  const first = Number(event.U);
  const last = Number(event.u);
  return Number.isFinite(first) && Number.isFinite(last) && first <= lastUpdateId && last >= lastUpdateId;
}

export function isContiguousDepthEvent(event: BinanceDepthEvent, previousUpdateId: number): boolean {
  const previous = Number(event.pu);
  return Number.isFinite(previous) && previous === previousUpdateId;
}

export function applyDepthLevels(side: BookSide, levels: Array<[string, string]> | undefined): void {
  if (!Array.isArray(levels)) return;
  for (const row of levels) {
    const price = String(row?.[0] || '');
    const qty = Number(row?.[1]);
    if (!price || !Number.isFinite(qty)) continue;
    if (qty <= 0) side.delete(price);
    else side.set(price, qty);
  }
}

export function replaceBookLevels(
  bids: BookSide,
  asks: BookSide,
  event: BinanceDepthEvent,
): { bidCount: number; askCount: number } {
  bids.clear();
  asks.clear();
  applyDepthLevels(bids, event.b || event.bids);
  applyDepthLevels(asks, event.a || event.asks);
  return { bidCount: bids.size, askCount: asks.size };
}

function publishSnapshot(book: LocalBook): void {
  const bids = Array.from(book.bids.entries())
    .map(([price, volume]) => ({ price: Number(price), volume }))
    .filter((level) => Number.isFinite(level.price) && level.price > 0 && level.volume > 0)
    .sort((a, b) => b.price - a.price);
  const asks = Array.from(book.asks.entries())
    .map(([price, volume]) => ({ price: Number(price), volume }))
    .filter((level) => Number.isFinite(level.price) && level.price > 0 && level.volume > 0)
    .sort((a, b) => a.price - b.price);
  book.snapshot = {
    bids,
    asks,
    ts: book.ts,
    source: 'binance-depth',
  };
}

const books = new Map<string, LocalBook>();
const booksBySymbol = new Map<string, LocalBook>();
let socket: WebSocket | null = null;
let started = false;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let lastSocketError: string | null = null;

function bookForPair(pair: string): LocalBook | undefined {
  return books.get(pair.trim().toUpperCase());
}

export function getBinanceOrderBook(pair: string): PaperOrderBook | undefined {
  if (!isBinanceOrderBookEnabled()) return undefined;
  const book = bookForPair(pair);
  const snapshot = book?.snapshot;
  if (!snapshot?.ts) return undefined;
  if (Date.now() - snapshot.ts > binanceBookMaxAgeMs()) return undefined;
  return snapshot;
}

export function getBinanceOrderBookStatus() {
  const rows = [...books.values()].map((book) => ({
    pair: book.pair,
    symbol: book.symbol,
    synced: book.synced,
    levels: (book.snapshot?.bids.length || 0) + (book.snapshot?.asks.length || 0),
    ageMs: book.ts ? Date.now() - book.ts : null,
    resyncs: book.resyncs,
    lastError: book.lastError,
  }));
  return {
    enabled: isBinanceOrderBookEnabled(),
    started,
    connected: socket?.readyState === WebSocket.OPEN,
    mode: 'partial-20',
    limit: binanceBookLimit(),
    books: rows,
    synced: rows.filter((row) => row.synced).length,
    lastError: lastSocketError || rows.find((row) => row.lastError)?.lastError || null,
  };
}

function applyPartialEvent(book: LocalBook, event: BinanceDepthEvent): void {
  const { bidCount, askCount } = replaceBookLevels(book.bids, book.asks, event);
  if (bidCount === 0 && askCount === 0) return;
  book.lastUpdateId = Number(event.u || event.lastUpdateId) || book.lastUpdateId;
  book.ts = Number(event.E) || Date.now();
  book.synced = true;
  book.lastError = null;
  publishSnapshot(book);
}

function symbolFromPayload(payload: { stream?: string }, event: BinanceDepthEvent): string {
  const fromEvent = String(event.s || '').toUpperCase();
  if (fromEvent) return fromEvent;
  return String(payload.stream || '').split('@')[0].trim().toUpperCase();
}

function handleDepthEvent(payload: { stream?: string; data?: BinanceDepthEvent } | BinanceDepthEvent): void {
  const event = 'data' in payload && payload.data ? payload.data : payload as BinanceDepthEvent;
  const symbol = symbolFromPayload(payload, event);
  const book = booksBySymbol.get(symbol);
  if (!book) return;
  applyPartialEvent(book, event);
}

function closeSocket(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
  if (socket) {
    socket.removeAllListeners();
    socket.close();
    socket = null;
  }
}

function connect(): void {
  if (!books.size) return;
  closeSocket();
  const streams = [...booksBySymbol.keys()]
    .map((symbol) => `${symbol.toLowerCase()}@depth${BOOK_LEVELS}`)
    .join('/');
  const ws = new WebSocket(`${FUTURES_WS}?streams=${streams}`);
  socket = ws;
  ws.on('open', () => {
    lastSocketError = null;
    console.log(`[binanceBook] WS ouvert — ${books.size} carnets @depth${BOOK_LEVELS}`);
    refreshTimer = setTimeout(() => connect(), REFRESH_CONNECTION_MS);
    refreshTimer.unref?.();
  });
  ws.on('message', (raw) => {
    try {
      const payload = JSON.parse(String(raw)) as { stream?: string; data?: BinanceDepthEvent } | BinanceDepthEvent;
      handleDepthEvent(payload);
    } catch {
      // frame ignorée
    }
  });
  ws.on('close', () => {
    if (!started) return;
    reconnectTimer = setTimeout(connect, RECONNECT_MS);
  });
  ws.on('error', (error) => {
    lastSocketError = (error as Error).message || 'ws error';
    ws.close();
  });
}

export function startBinanceOrderBooks(pairs: string[]): void {
  if (!isBinanceOrderBookEnabled() || started) return;
  for (const pair of pairs) {
    const normalized = pair.trim().toUpperCase();
    const symbol = pairToBinanceSymbol(normalized);
    if (!symbol || books.has(normalized)) continue;
    const book: LocalBook = {
      pair: normalized,
      symbol,
      bids: new Map(),
      asks: new Map(),
      lastUpdateId: 0,
      synced: false,
      ts: 0,
      snapshot: null,
      resyncs: 0,
      lastError: null,
    };
    books.set(normalized, book);
    booksBySymbol.set(symbol, book);
  }
  if (!books.size) return;
  started = true;
  connect();
}

export function stopBinanceOrderBooks(): void {
  started = false;
  closeSocket();
  books.clear();
  booksBySymbol.clear();
}
