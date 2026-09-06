/**
 * Même modèle d'impact que server/paperSlippage.ts (fallback sans carnet L5).
 * Sert à peindre le fill au bon prix dès le clic, avant la réponse HTTP.
 */

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

export function estimatePaperSlippageBps(pair: string, notionalUsd: number): number {
  const base = cryptoBase(pair);
  if (!base || !Number.isFinite(notionalUsd) || notionalUsd <= 0) return 0;

  const coefficient = VERY_LIQUID.has(base)
    ? 1
    : LIQUID.has(base)
      ? 2
      : MEDIUM.has(base)
        ? 4
        : 7;
  const floorBps = VERY_LIQUID.has(base) ? 0.5 : LIQUID.has(base) ? 1 : MEDIUM.has(base) ? 2 : 3;
  const impact = floorBps + coefficient * Math.sqrt(notionalUsd / 100_000);
  return Math.min(50, Math.max(floorBps, impact));
}

export function previewMarketExecutionPrice(
  pair: string,
  requestedPrice: number,
  size: number,
  side: 'long' | 'short',
): number {
  if (!Number.isFinite(requestedPrice) || requestedPrice <= 0 || !Number.isFinite(size) || size <= 0) {
    return requestedPrice;
  }
  const slippageBps = estimatePaperSlippageBps(pair, requestedPrice * size);
  if (slippageBps <= 0) return requestedPrice;
  const multiplier = side === 'long'
    ? 1 + slippageBps / 10_000
    : 1 - slippageBps / 10_000;
  return Math.max(Number.EPSILON, requestedPrice * multiplier);
}
