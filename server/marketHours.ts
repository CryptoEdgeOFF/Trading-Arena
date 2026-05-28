import { findByPair, isItickPair } from './itickInstruments.js';
import { getMarketSession, type MarketSessionInfo } from '../src/utils/marketHours.js';

export type { MarketSessionInfo };

/** Session d'ouverture pour une pair paper (crypto / iTick). */
export function getMarketSessionForPair(pair: string, now?: Date): MarketSessionInfo {
  if (!isItickPair(pair)) {
    return getMarketSession(pair, { category: 'crypto' }, now);
  }
  const inst = findByPair(pair);
  const category = inst?.category === 'commodity'
    ? 'commodities'
    : inst?.category === 'index'
      ? 'indices'
      : inst?.category;
  return getMarketSession(pair, { category, code: inst?.code }, now);
}

export function assertMarketOpen(pair: string): void {
  const session = getMarketSessionForPair(pair);
  if (!session.open) {
    throw new Error(session.label || 'Marché fermé');
  }
}
