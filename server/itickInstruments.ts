/**
 * Mapping bidirectionnel entre nos pairs internes ("EUR/USD", "XAU/USD",
 * "SPX/USD"…) et les codes iTick (`forex/EURUSD`, `forex/XAUUSD`,
 * `indices/SPX`).
 *
 * Toutes les commodities (or, argent, pétrole, cuivre) sont chez iTick
 * dans le cluster `forex` — c'est leur classification, pas la nôtre.
 */

import type { ItickAssetClass } from './itick.js';

export interface ItickInstrument {
  pair: string;
  asset: ItickAssetClass;
  code: string;
  /** Catégorie côté UI / paper engine. */
  category: 'forex' | 'commodity' | 'index';
  pricescale: number;
  label: string;
  /** Symbol Hyperliquid (`xyz:GOLD`, `xyz:SP500`, …) utilisé en fallback
   *  historique si iTick REST échoue. `null` ou absent = pas de fallback. */
  hyperliquidCoin?: string | null;
}

/**
 * Liste production : 4 forex + 3 commodities + 3 indices = 10 instruments.
 * - Cluster `/forex` chez iTick : 8 subscriptions
 * - Cluster `/indices` chez iTick : 3 subscriptions
 * → 2 connexions WS sur les 6 dispos en plan pro.
 *
 * Source de vérité unique : iTick (live WS + historique REST).
 * Fallback historique : Hyperliquid xyz pour les pairs supportées.
 */
export const ITICK_INSTRUMENTS: ItickInstrument[] = [
  // Forex majors
  { pair: 'EUR/USD',      asset: 'forex',   code: 'EURUSD', category: 'forex',     pricescale: 100_000, label: 'EUR/USD',   hyperliquidCoin: 'xyz:EUR' },
  { pair: 'GBP/USD',      asset: 'forex',   code: 'GBPUSD', category: 'forex',     pricescale: 100_000, label: 'GBP/USD' },
  { pair: 'USD/JPY',      asset: 'forex',   code: 'USDJPY', category: 'forex',     pricescale: 1_000,   label: 'USD/JPY' },
  { pair: 'USD/CHF',      asset: 'forex',   code: 'USDCHF', category: 'forex',     pricescale: 100_000, label: 'USD/CHF' },

  // Precious metals
  { pair: 'GOLD/USD',     asset: 'forex',   code: 'XAUUSD', category: 'commodity', pricescale: 1_000,   label: 'Gold',      hyperliquidCoin: 'xyz:GOLD' },
  { pair: 'SILVER/USD',   asset: 'forex',   code: 'XAGUSD', category: 'commodity', pricescale: 1_000,   label: 'Silver',    hyperliquidCoin: 'xyz:SILVER' },

  // Energy
  { pair: 'WTI/USD',      asset: 'forex',   code: 'USOIL',  category: 'commodity', pricescale: 1_000,   label: 'WTI Crude' },

  // Indices US
  { pair: 'SP500/USD',    asset: 'indices', code: 'SPX',    category: 'index',     pricescale: 100,     label: 'S&P 500',   hyperliquidCoin: 'xyz:SP500' },
  { pair: 'NAS100/USD',   asset: 'indices', code: 'NDX',    category: 'index',     pricescale: 100,     label: 'Nasdaq 100' },
  { pair: 'US30/USD',     asset: 'indices', code: 'DJI',    category: 'index',     pricescale: 100,     label: 'Dow Jones' },
];

const BY_PAIR = new Map<string, ItickInstrument>();
const BY_CODE = new Map<string, ItickInstrument>();
for (const inst of ITICK_INSTRUMENTS) {
  BY_PAIR.set(inst.pair.toUpperCase(), inst);
  BY_CODE.set(`${inst.asset}:${inst.code.toUpperCase()}`, inst);
}

/**
 * Registre crypto séparé (code iTick ↔ pair interne). Les pairs crypto
 * vivent dans `exchangePaperEngine.PAPER_PAIRS` (source kraken_futures pour
 * le failover), pas dans `ITICK_INSTRUMENTS`. On les enregistre au boot via
 * `registerItickCrypto()` pour que le bridge iTick → paper engine sache
 * mapper un tick crypto (`BTCUSDT`) vers notre pair (`BTC/USD`).
 */
const CRYPTO_PAIR_BY_CODE = new Map<string, string>();
const CRYPTO_CODE_BY_PAIR = new Map<string, string>();

/** "BTC/USD" → "BTCUSDT" (code crypto iTick, aligné Binance spot). */
function pairToCryptoCode(pair: string): string | null {
  const base = pair.split('/')[0]?.trim().toUpperCase();
  if (!base) return null;
  return `${base}USDT`;
}

export function registerItickCrypto(pairs: string[]): void {
  for (const pair of pairs) {
    const code = pairToCryptoCode(pair);
    if (!code) continue;
    CRYPTO_PAIR_BY_CODE.set(code, pair.trim().toUpperCase());
    CRYPTO_CODE_BY_PAIR.set(pair.trim().toUpperCase(), code);
  }
}

/** Code crypto iTick (`BTCUSDT`) → pair interne (`BTC/USD`). */
export function findCryptoPairByCode(code: string): string | undefined {
  return CRYPTO_PAIR_BY_CODE.get(code.trim().toUpperCase());
}

/** Liste des codes crypto enregistrés (pour la subscription WS). */
export function cryptoCodes(): string[] {
  return [...CRYPTO_PAIR_BY_CODE.keys()];
}

export function findByPair(pair: string): ItickInstrument | undefined {
  return BY_PAIR.get(pair.trim().toUpperCase());
}

export function findByCode(asset: ItickAssetClass, code: string): ItickInstrument | undefined {
  return BY_CODE.get(`${asset}:${code.trim().toUpperCase()}`);
}

export function isItickPair(pair: string): boolean {
  return BY_PAIR.has(pair.trim().toUpperCase());
}

/** Symbols groupés par cluster, prêt pour `itickFeed.setSubscriptions()`. */
export function symbolsByAsset(): Partial<Record<ItickAssetClass, string[]>> {
  const out: Partial<Record<ItickAssetClass, string[]>> = {};
  for (const inst of ITICK_INSTRUMENTS) {
    if (!out[inst.asset]) out[inst.asset] = [];
    out[inst.asset]!.push(inst.code);
  }
  return out;
}
