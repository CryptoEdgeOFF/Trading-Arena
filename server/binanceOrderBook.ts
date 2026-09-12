/**
 * Carnets Binance USDⓈ-M locaux, partagés par tous les joueurs.
 *
 * Le moteur ne fait jamais de requête au fill : il lit un snapshot
 * immuable déjà en mémoire. Les diffs WS (250 ms) tournent à côté,
 * hors du chemin d'exécution.
 *
 * Staging uniquement (`MOBILE_STAGING_TEST_MODE`). Prod inchangée.
 *
 * Procédure Binance :
 * https://developers.binance.com/en/docs/derivatives/usds-margined-futures/websocket-market-streams/How-to-manage-a-local-order-book-correctly
 */
import WebSocket from 'ws';
import { pairToBinanceSymbol } from './binance.js';
import type { PaperOrderBook } from './paperSlippage.js';

const FUTURES_WS = 'wss://fstream.binance.com/stream';
const FUTURES_REST = 'https://fapi.binance.com';
const RECONNECT_MS = 3_000;
const REFRESH_CONNECTION_MS = 23 * 60 * 60_000;
const SNAPSHOT_GAP_MS = 250;
const DEFAULT_LIMIT = 100;
const DEFAULT_MAX_AGE_MS = 4_000;

export type BinanceDepthEvent = {
  e?: string;
  s?: string;
  U?: number;
  u?: number;
  pu?: number;
  b?: Array<[string, string]>;
  a?: Array<[string, string]>;
  E?: number;
  T?: number;
};

export type BinanceDepthSnapshot = {
  lastUpdateId: number;
  bids: Array<[string, string]>;
  asks: Array<[string, string]>;
};

type BookSide = Map<string, number>;

type LocalBook = {
  pair: string;
  symbol: string;
  bids: BookSide;
  asks: BookSide;
  lastUpdateId: number;
  synced: boolean;
  buffer: BinanceDepthEvent[];
  ts: number;
  snapshot: PaperOrderBook | null;
  resyncs: number;
  lastError: string | null;
  snapshotInflight: boolean;
};

export function isBinanceOrderBookEnabled(): boolean {
  if (process.env.MOBILE_STAGING_TEST_MODE !== 'true') return false;
  if (process.env.NETLIFY) return false;
  return process.env.PAPER_BINANCE_BOOK !== 'false';
}

export function binanceBookLimit(): number {
  const parsed = Number(process.env.PAPER_BINANCE_BOOK_LIMIT);
  if (parsed === 500 || parsed === 1000) return parsed;
  return DEFAULT_LIMIT;
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

function resetBook(book: LocalBook): void {
  book.bids.clear();
  book.asks.clear();
  book.lastUpdateId = 0;
  book.synced = false;
  book.buffer = [];
  book.snapshot = null;
}

const books = new Map<string, LocalBook>();
const booksBySymbol = new Map<string, LocalBook>();
let socket: WebSocket | null = null;
let started = false;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let snapshotQueue: Promise<void> = Promise.resolve();

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
    limit: binanceBookLimit(),
    books: rows,
    synced: rows.filter((row) => row.synced).length,
    lastError: rows.find((row) => row.lastError)?.lastError || null,
  };
}

async function fetchSnapshot(symbol: string): Promise<BinanceDepthSnapshot> {
  const url = `${FUTURES_REST}/fapi/v1/depth?symbol=${encodeURIComponent(symbol)}&limit=${binanceBookLimit()}`;
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0 (compatible; BTFArena/1.0)',
    },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Binance depth ${response.status} ${symbol} ${body.slice(0, 80)}`);
  }
  const payload = await response.json() as BinanceDepthSnapshot;
  if (!Number.isFinite(Number(payload.lastUpdateId))) {
    throw new Error(`Binance depth invalide ${symbol}`);
  }
  return payload;
}

function enqueueSnapshot(book: LocalBook, delayMs = SNAPSHOT_GAP_MS): void {
  if (book.snapshotInflight) return;
  book.snapshotInflight = true;
  snapshotQueue = snapshotQueue
    .catch(() => undefined)
    .then(async () => {
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
      try {
        await syncBook(book);
      } finally {
        book.snapshotInflight = false;
      }
    });
}

function tryStartFromEvent(book: LocalBook, event: BinanceDepthEvent): boolean {
  const last = Number(event.u);
  if (!Number.isFinite(last) || last < book.lastUpdateId) return false;
  if (shouldAcceptFirstDepthEvent(event, book.lastUpdateId) || isContiguousDepthEvent(event, book.lastUpdateId)) {
    applyDepthEvent(book, event);
    return true;
  }
  return false;
}

async function syncBook(book: LocalBook): Promise<void> {
  try {
    const snapshot = await fetchSnapshot(book.symbol);
    book.bids.clear();
    book.asks.clear();
    applyDepthLevels(book.bids, snapshot.bids);
    applyDepthLevels(book.asks, snapshot.asks);
    book.lastUpdateId = Number(snapshot.lastUpdateId);
    book.ts = Date.now();
    book.synced = false;
    book.lastError = null;
    publishSnapshot(book);

    const pending = book.buffer;
    book.buffer = [];
    for (const event of pending) {
      if (!book.synced) {
        tryStartFromEvent(book, event);
        continue;
      }
      if (!isContiguousDepthEvent(event, book.lastUpdateId)) {
        book.resyncs += 1;
        resetBook(book);
        enqueueSnapshot(book, 1_000);
        return;
      }
      applyDepthEvent(book, event);
    }
  } catch (error) {
    const message = (error as Error).message;
    book.lastError = message;
    book.resyncs += 1;
    console.warn(`[binanceBook] snapshot ${book.symbol} KO:`, message);
    enqueueSnapshot(book, message.includes('429') ? 8_000 : 3_000);
  }
}

function applyDepthEvent(book: LocalBook, event: BinanceDepthEvent): void {
  applyDepthLevels(book.bids, event.b);
  applyDepthLevels(book.asks, event.a);
  book.lastUpdateId = Number(event.u);
  book.ts = Number(event.E) || Date.now();
  book.synced = true;
  publishSnapshot(book);
}

function handleDepthEvent(event: BinanceDepthEvent): void {
  const symbol = String(event.s || '').toUpperCase();
  const book = booksBySymbol.get(symbol);
  if (!book) return;
  if (!book.lastUpdateId) {
    book.buffer.push(event);
    if (book.buffer.length > 200) book.buffer.splice(0, book.buffer.length - 200);
    return;
  }
  if (!book.synced) {
    if (tryStartFromEvent(book, event)) return;
    book.buffer.push(event);
    if (book.buffer.length > 200) book.buffer.splice(0, book.buffer.length - 200);
    return;
  }
  if (!isContiguousDepthEvent(event, book.lastUpdateId)) {
    book.resyncs += 1;
    resetBook(book);
    enqueueSnapshot(book);
    return;
  }
  applyDepthEvent(book, event);
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
    .map((symbol) => `${symbol.toLowerCase()}@depth@250ms`)
    .join('/');
  const ws = new WebSocket(`${FUTURES_WS}?streams=${streams}`);
  socket = ws;
  ws.on('open', () => {
    console.log(`[binanceBook] WS ouvert — ${books.size} carnets @250ms`);
    refreshTimer = setTimeout(() => connect(), REFRESH_CONNECTION_MS);
    refreshTimer.unref?.();
    for (const book of books.values()) {
      if (!book.synced) enqueueSnapshot(book);
    }
  });
  ws.on('message', (raw) => {
    try {
      const payload = JSON.parse(String(raw)) as { data?: BinanceDepthEvent } | BinanceDepthEvent;
      const event = 'data' in payload && payload.data ? payload.data : payload as BinanceDepthEvent;
      if (event?.e === 'depthUpdate' || event?.b || event?.a) handleDepthEvent(event);
    } catch {
      // frame ignorée
    }
  });
  ws.on('close', () => {
    if (!started) return;
    reconnectTimer = setTimeout(connect, RECONNECT_MS);
  });
  ws.on('error', () => {
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
      buffer: [],
      ts: 0,
      snapshot: null,
      resyncs: 0,
      lastError: null,
      snapshotInflight: false,
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
