/**
 * Bridge iTick → paper engine.
 *
 * Le `exchangePaperEngine.applyItickQuotes()` traite les pairs marquées
 * `source: 'itick'` dans PAPER_PAIRS — ce qui couvre les 11 instruments
 * définis dans `itickInstruments.ts` (forex / commodities / indices).
 *
 * On collecte les ticks iTick dans un buffer en mémoire et on flush
 * toutes les ~80ms vers le paper engine. Cela évite d'appeler le moteur
 * à 12 Hz (~84 ticks/s sur 11 pairs) tout en gardant la latence < 100ms.
 */

import * as itick from './itick.js';
import { findByCode, findCryptoPairByCode } from './itickInstruments.js';
import type { ItickLiveTick } from './itick.js';
import type { ExternalQuote } from './exchangePaperEngine.js';

const FLUSH_INTERVAL_MS = 80;

type ApplyFn = (quotes: Record<string, ExternalQuote>) => string[];
type BroadcastFn = (pairs: string[]) => void;

let pendingByPair = new Map<string, ExternalQuote>();
let flushTimer: ReturnType<typeof setInterval> | null = null;
let started = false;

function flush(apply: ApplyFn, broadcast: BroadcastFn): void {
  if (pendingByPair.size === 0) return;
  const quotes: Record<string, ExternalQuote> = {};
  for (const [pair, q] of pendingByPair) quotes[pair] = q;
  pendingByPair = new Map();
  let updated: string[] = [];
  try {
    updated = apply(quotes);
  } catch (err) {
    console.warn('[itickBridge] applyQuotes KO:', (err as Error).message);
    return;
  }
  if (updated.length > 0) broadcast(updated);
}

/**
 * Démarre la collecte des ticks iTick et leur dispatch vers le paper
 * engine + broadcast clients. Idempotent.
 */
export function startItickToPaperBridge(apply: ApplyFn, broadcast: BroadcastFn): void {
  if (started) return;
  started = true;

  itick.itickFeed.on('tick', (tick: ItickLiveTick) => {
    const price = tick.price;
    if (!Number.isFinite(price) || price <= 0) return;

    // Crypto (region BA) : prix spot Binance = TradingView. On mappe le
    // code iTick (`BTCUSDT`) vers notre pair (`BTC/USD`).
    if (tick.asset === 'crypto') {
      const pair = findCryptoPairByCode(tick.symbol);
      if (!pair) return;
      pendingByPair.set(pair, {
        pair,
        sourceSymbol: tick.symbol.toUpperCase(),
        markPrice: price,
        bidPrice: tick.bid && tick.bid > 0 ? tick.bid : price,
        askPrice: tick.ask && tick.ask > 0 ? tick.ask : price,
        updatedAt: tick.ts,
      });
      return;
    }

    const inst = findByCode(tick.asset, tick.symbol);
    if (!inst) return;

    pendingByPair.set(inst.pair, {
      pair: inst.pair,
      sourceSymbol: inst.code,
      markPrice: price,
      bidPrice: tick.bid && tick.bid > 0 ? tick.bid : price,
      askPrice: tick.ask && tick.ask > 0 ? tick.ask : price,
      updatedAt: tick.ts,
    });
  });

  flushTimer = setInterval(() => flush(apply, broadcast), FLUSH_INTERVAL_MS);
  if (typeof flushTimer.unref === 'function') flushTimer.unref();
}

export function stopItickToPaperBridge(): void {
  if (flushTimer) clearInterval(flushTimer);
  flushTimer = null;
  started = false;
  pendingByPair.clear();
}
