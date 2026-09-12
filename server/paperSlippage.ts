import type { PaperExecutionModel } from './types.js';

export type { PaperExecutionModel };

export interface PaperSlippageQuote {
  requestedPrice: number;
  executionPrice: number;
  slippageBps: number;
  source: 'legacy' | 'model' | 'itick-l5' | 'binance-depth';
  fills: PaperFillDetail[];
}

export interface PaperFillDetail {
  price: number;
  size: number;
  source: 'book' | 'estimated';
}

export interface PaperOrderBookLevel {
  price: number;
  volume: number;
}

export interface PaperOrderBook {
  asks: PaperOrderBookLevel[];
  bids: PaperOrderBookLevel[];
  /** Timestamp du snapshot utilisé par le moteur (optionnel en tests). */
  ts?: number;
  source?: 'itick-l5' | 'binance-depth';
}

export interface PaperLimitFillQuote {
  requestedSize: number;
  filledSize: number;
  remainingSize: number;
  executionPrice: number | null;
  fills: PaperFillDetail[];
}

const VERY_LIQUID = new Set(['BTC', 'ETH']);
const LIQUID = new Set(['SOL', 'XRP', 'BNB']);
const MEDIUM = new Set(['TRX', 'DOGE', 'ADA', 'LINK', 'AVAX', 'LTC', 'BCH']);
const NON_CRYPTO_PAIRS = new Set([
  'EUR/USD',
  'GBP/USD',
  'USD/JPY',
  'USD/CHF',
  'GOLD/USD',
  'SILVER/USD',
  'WTI/USD',
  'SP500/USD',
  'NAS100/USD',
  'US30/USD',
]);

function cryptoBase(pair: string): string | null {
  const normalized = pair.trim().toUpperCase();
  if (NON_CRYPTO_PAIRS.has(normalized)) return null;
  if (!normalized.endsWith('/USD')) return null;
  return normalized.split('/')[0] || null;
}

/**
 * Impact paper déterministe, en plus du bid/ask.
 *
 * Utilisé seulement si le carnet iTick L5 est absent/périmé, ou pour le
 * reliquat après avoir vidé les 5 niveaux visibles.
 * BTC/ETH : petits notionnels restent près du touch (un market $50k ne
 * "mange" pas le book). TRX et moins liquides gardent un impact réel.
 */
export function estimatePaperSlippageBps(pair: string, notionalUsd: number): number {
  const base = cryptoBase(pair);
  if (!base || !Number.isFinite(notionalUsd) || notionalUsd <= 0) return 0;

  const coefficient = VERY_LIQUID.has(base)
    ? 0.25
    : LIQUID.has(base)
      ? 2
      : MEDIUM.has(base)
        ? 4
        : 7;
  const floorBps = VERY_LIQUID.has(base) ? 0.05 : LIQUID.has(base) ? 1 : MEDIUM.has(base) ? 2 : 3;
  const impact = floorBps + coefficient * Math.sqrt(notionalUsd / 100_000);
  return Math.min(50, Math.max(floorBps, impact));
}

/**
 * Impact du reliquat après le carnet visible (L5 / depth20).
 *
 * Le top 20 est le bout fin du book. Extrapoler sa densité 1:1, puis
 * réappliquer le modèle entier depuis le dernier niveau, empile deux
 * fois l'impact (18 bps sur un TRX 970 k$ alors que le walk visible
 * n'était que ~3 bps). On continue en racine carrée, avec un book
 * caché plus épais que le tip.
 */
export function estimateBookOverflowBps(
  pair: string,
  remainingNotional: number,
  visibleNotional: number,
  visibleSpanBps: number,
): number {
  const remaining = Math.max(0, remainingNotional);
  if (remaining <= 0) return 0;
  const visible = Math.max(visibleNotional, 1);
  const tipSpan = Math.max(visibleSpanBps, 0.25);
  const extra = tipSpan * (Math.sqrt(1 + remaining / visible) - 1) / 2.5;
  const floorBps = estimatePaperSlippageBps(pair, remaining) * 0.35;
  return Math.min(40, Math.max(floorBps, extra));
}

export function applyPaperSlippage(
  pair: string,
  requestedPrice: number,
  size: number,
  direction: 'buy' | 'sell',
  model: PaperExecutionModel,
  orderBook?: PaperOrderBook,
): PaperSlippageQuote {
  if (
    model === 'legacy'
    || !Number.isFinite(requestedPrice)
    || requestedPrice <= 0
    || !Number.isFinite(size)
    || size <= 0
  ) {
    return {
      requestedPrice,
      executionPrice: requestedPrice,
      slippageBps: 0,
      source: 'legacy',
      fills: [],
    };
  }

  const levels = (direction === 'buy' ? orderBook?.asks || [] : orderBook?.bids || [])
    .filter((level) => Number.isFinite(level.price) && level.price > 0 && Number.isFinite(level.volume) && level.volume > 0)
    .sort((a, b) => (direction === 'buy' ? a.price - b.price : b.price - a.price));
  const touch = levels[0]?.price;
  // Le mark paper et le carnet Binance peuvent diverger de quelques bps.
  // On ne reprend que la *forme* du book (impact hors touch). Un écart
  // absurde (> 80 bps) = mauvais carnet, on retombe sur le modèle.
  const bookUsable = Number.isFinite(touch)
    && touch > 0
    && Math.abs(touch / requestedPrice - 1) * 10_000 <= 80;

  let remaining = size;
  let totalValue = 0;
  let lastPrice = requestedPrice;
  const fills: PaperFillDetail[] = [];

  if (bookUsable) {
    for (const level of levels) {
      if (remaining <= 0) break;
      const offset = direction === 'buy'
        ? Math.max(0, level.price - touch)
        : Math.max(0, touch - level.price);
      const fillPrice = direction === 'buy'
        ? requestedPrice + offset
        : Math.max(Number.EPSILON, requestedPrice - offset);
      const filled = Math.min(remaining, level.volume);
      totalValue += filled * fillPrice;
      remaining -= filled;
      lastPrice = fillPrice;
      fills.push({ price: fillPrice, size: filled, source: 'book' });
    }
  }

  if (remaining > 0 && bookUsable && totalValue > 0) {
    const visibleSize = size - remaining;
    const visibleNotional = visibleSize > 0 ? totalValue : 0;
    const visibleSpanBps = requestedPrice > 0
      ? Math.abs(lastPrice / requestedPrice - 1) * 10_000
      : 0;
    const overflowBps = estimateBookOverflowBps(
      pair,
      requestedPrice * remaining,
      visibleNotional,
      visibleSpanBps,
    );
    const overflowPrice = direction === 'buy'
      ? lastPrice * (1 + overflowBps / 10_000)
      : lastPrice * (1 - overflowBps / 10_000);
    totalValue += remaining * overflowPrice;
    fills.push({ price: overflowPrice, size: remaining, source: 'estimated' });
  }

  if (bookUsable && totalValue > 0) {
    const rawAverage = totalValue / size;
    const executionPrice = direction === 'buy'
      ? Math.max(requestedPrice, rawAverage)
      : Math.min(requestedPrice, rawAverage);
    return {
      requestedPrice,
      executionPrice,
      slippageBps: Math.abs(executionPrice / requestedPrice - 1) * 10_000,
      source: orderBook?.source || 'itick-l5',
      fills,
    };
  }

  const notionalUsd = requestedPrice * size;
  const slippageBps = estimatePaperSlippageBps(pair, notionalUsd);
  const multiplier = direction === 'buy'
    ? 1 + slippageBps / 10_000
    : 1 - slippageBps / 10_000;

  return {
    requestedPrice,
    executionPrice: Math.max(Number.EPSILON, requestedPrice * multiplier),
    slippageBps,
    source: 'model',
    fills: [{
      price: Math.max(Number.EPSILON, requestedPrice * multiplier),
      size,
      source: 'estimated',
    }],
  };
}

/**
 * Parcourt uniquement la liquidité visible compatible avec un prix limite.
 *
 * Contrairement au market walk, une amélioration de prix est conservée et
 * aucune liquidité n'est extrapolée après le dernier niveau du carnet.
 * La fonction est pure : le moteur décide ensuite comment partager/consommer
 * les niveaux entre plusieurs ordres selon leur priorité price-time.
 */
export function walkPaperLimitOrderBook(
  limitPrice: number,
  size: number,
  direction: 'buy' | 'sell',
  orderBook?: PaperOrderBook,
): PaperLimitFillQuote {
  const invalid = !Number.isFinite(limitPrice)
    || limitPrice <= 0
    || !Number.isFinite(size)
    || size <= 0;
  if (invalid || !orderBook) {
    return {
      requestedSize: size,
      filledSize: 0,
      remainingSize: Math.max(0, Number.isFinite(size) ? size : 0),
      executionPrice: null,
      fills: [],
    };
  }

  const levels = direction === 'buy'
    ? [...orderBook.asks].sort((a, b) => a.price - b.price)
    : [...orderBook.bids].sort((a, b) => b.price - a.price);
  let remaining = size;
  let totalValue = 0;
  const fills: PaperFillDetail[] = [];
  const epsilon = Math.max(size * 1e-12, 1e-12);

  for (const level of levels) {
    if (remaining <= epsilon) break;
    if (!Number.isFinite(level.price) || level.price <= 0 || !Number.isFinite(level.volume) || level.volume <= 0) {
      continue;
    }
    const eligible = direction === 'buy'
      ? level.price <= limitPrice
      : level.price >= limitPrice;
    if (!eligible) break;

    const filled = Math.min(remaining, level.volume);
    if (filled <= epsilon) continue;
    totalValue += filled * level.price;
    remaining = Math.max(0, remaining - filled);
    fills.push({ price: level.price, size: filled, source: 'book' });
  }

  const filledSize = Math.max(0, size - remaining);
  return {
    requestedSize: size,
    filledSize,
    remainingSize: Math.max(0, size - filledSize),
    executionPrice: filledSize > epsilon ? totalValue / filledSize : null,
    fills,
  };
}

export function isPaperSlippageEnabled(): boolean {
  // Opt-out : les positions/ordres déjà ouverts restent legacy (executionModel absent).
  return process.env.PAPER_SLIPPAGE_ENABLED !== 'false';
}

export function configuredPaperExecutionModel(): PaperExecutionModel {
  return isPaperSlippageEnabled() ? 'slippage-v1' : 'legacy';
}
