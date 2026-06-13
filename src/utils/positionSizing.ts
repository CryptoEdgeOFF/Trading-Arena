/**
 * Position sizing helpers — convertit la saisie utilisateur (lots pour
 * les instruments TradFi, unités natives pour les cryptos) vers les
 * unités stockées dans le moteur paper, et inversement.
 *
 * Contract sizes alignés sur les standards MT5 (FTMO / IC Markets /
 * Pepperstone) :
 *   - Forex majors          : 1 lot = 100 000 unités base currency
 *   - Gold (XAUUSD)         : 1 lot = 100 oz
 *   - Silver (XAGUSD)       : 1 lot = 5 000 oz
 *   - Oil (USOIL)             : 1 lot = 1 000 barrels
 *   - SP500                 : 1 lot = 50 contracts ($50/point)
 *   - NAS100                : 1 lot = 20 contracts ($20/point)
 *   - US30                  : 1 lot = 5 contracts ($5/point)
 *   - Crypto                : pas de lot, on saisit directement les unités
 */

const CONTRACT_SIZE_BY_PAIR: Record<string, number> = {
  // Forex majors
  'EUR/USD': 100_000,
  'GBP/USD': 100_000,
  'USD/JPY': 100_000,
  'USD/CHF': 100_000,
  // Precious metals
  'GOLD/USD': 100,
  'SILVER/USD': 5_000,
  // Energy
  'WTI/USD': 1_000,
  // Indices
  'SP500/USD': 50,
  'NAS100/USD': 20,
  'US30/USD': 5,
};

/** Contract size MT5 pour la pair. 1 si la pair n'est pas TradFi (= crypto). */
export function pairContractSize(pair: string): number {
  return CONTRACT_SIZE_BY_PAIR[pair] || 1;
}

/** True si la pair est saisie en lots (= a un contract size MT5). */
export function isLotBased(pair: string): boolean {
  return pair in CONTRACT_SIZE_BY_PAIR;
}

export type Side = 'long' | 'short';

/** SL valide : sous le prix de ref pour un long, au-dessus pour un short. */
export function isValidStopLoss(side: Side, refPrice: number, stopLoss: number | null | undefined): boolean {
  if (stopLoss == null || !Number.isFinite(stopLoss) || stopLoss <= 0) return true;
  if (!Number.isFinite(refPrice) || refPrice <= 0) return true;
  return side === 'long' ? stopLoss < refPrice : stopLoss > refPrice;
}

/** TP valide vs prix actuel : ne doit pas être déjà atteint (pas de trigger immédiat). */
export function isValidTakeProfit(side: Side, refPrice: number, takeProfit: number | null | undefined): boolean {
  if (takeProfit == null || !Number.isFinite(takeProfit) || takeProfit <= 0) return true;
  if (!Number.isFinite(refPrice) || refPrice <= 0) return true;
  return side === 'long' ? takeProfit > refPrice : takeProfit < refPrice;
}

/** TP valide vs entrée : doit rester côté gain (pas un stop loss déguisé). */
export function isValidTakeProfitVsEntry(
  side: Side,
  entryPrice: number,
  takeProfit: number | null | undefined,
): boolean {
  if (takeProfit == null || !Number.isFinite(takeProfit) || takeProfit <= 0) return true;
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) return true;
  return side === 'long' ? takeProfit > entryPrice : takeProfit < entryPrice;
}

export function isValidRiskPrice(
  kind: 'sl' | 'tp',
  side: Side,
  refPrice: number,
  price: number | null | undefined,
): boolean {
  return kind === 'sl' ? isValidStopLoss(side, refPrice, price) : isValidTakeProfit(side, refPrice, price);
}

export type MarketCategory = 'crypto' | 'indices' | 'commodities' | 'forex';

/** Convertit la quantité saisie (lots TradFi, unités crypto) en unités moteur. */
export function engineSizeFromInput(pair: string, inputSize: number): number {
  if (!Number.isFinite(inputSize) || inputSize <= 0) return 0;
  return inputSize * pairContractSize(pair);
}

/** Convertit les unités moteur en quantité affichée/saisie. */
export function inputSizeFromEngine(pair: string, engineSize: number): number {
  if (!Number.isFinite(engineSize) || engineSize <= 0) return 0;
  return engineSize / pairContractSize(pair);
}

export function formatInputSize(pair: string, inputSize: number): string {
  if (!Number.isFinite(inputSize) || inputSize <= 0) return '';
  if (isLotBased(pair)) return inputSize.toFixed(2);
  if (inputSize >= 1) return inputSize.toFixed(4);
  return inputSize.toFixed(6);
}

export function formatEngineSizeDisplay(
  pair: string,
  engineSize: number,
  base: string,
): { text: string; unit: string } {
  if (isLotBased(pair)) {
    const lots = engineSize / pairContractSize(pair);
    return { text: lots.toFixed(2), unit: 'lots' };
  }
  const text = engineSize >= 1 ? engineSize.toFixed(4) : engineSize.toFixed(5);
  return { text, unit: base };
}

export function sizeUnitLabel(pair: string, base: string): string {
  if (isLotBased(pair)) return 'lots';
  return base;
}

/** Step et min de l'input quantité, en unités utilisateur (lots ou crypto). */
export function inputSizeStep(pair: string): { min: string; step: string } {
  if (isLotBased(pair)) return { min: '0.01', step: '0.01' };
  return { min: '0.00001', step: '0.00001' };
}

export function fmtMarketPrice(price: number | null | undefined, category?: string): string {
  if (price == null || !Number.isFinite(price)) return '–';
  if (category === 'forex') {
    return price.toLocaleString('en-US', { minimumFractionDigits: 5, maximumFractionDigits: 5 });
  }
  if (category === 'indices') {
    return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (category === 'commodities') {
    return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 3 });
  }
  // Crypto & défaut : plus de décimales sur les gros prix (BTC, ETH…) sans
  // forcer des zéros inutiles — min 2, max 4 pour rester lisible dans l'UI.
  if (price >= 1000) {
    return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  }
  if (price >= 1) {
    return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  }
  return price.toPrecision(6);
}

/** Décimales d'arrondi pour un prix selon la catégorie. */
export function priceDecimals(category: string | undefined, price: number): number {
  if (category === 'forex') return 5;
  if (category === 'indices') return 2;
  if (category === 'commodities') return 3;
  if (!Number.isFinite(price)) return 4;
  if (price >= 1000) return 4;
  if (price >= 1) return 4;
  return 6;
}

/** Arrondit un prix à la précision usuelle de sa catégorie. */
export function roundPriceForCategory(price: number, category?: string): number {
  if (!Number.isFinite(price)) return price;
  const decimals = priceDecimals(category, price);
  const factor = Math.pow(10, decimals);
  return Math.round(price * factor) / factor;
}

/** Sérialise un prix pour un input/serveur, sans zéros de fin superflus. */
export function priceToInputString(price: number | null | undefined, category?: string): string {
  if (price == null || !Number.isFinite(price) || price <= 0) return '';
  const decimals = priceDecimals(category, price);
  return price.toFixed(decimals).replace(/\.?0+$/, '');
}
