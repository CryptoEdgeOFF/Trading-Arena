export const FOREX_LOT_SIZE = 100_000;

export type Side = 'long' | 'short';

/** SL valide : sous le prix de ref pour un long, au-dessus pour un short. */
export function isValidStopLoss(side: Side, refPrice: number, stopLoss: number | null | undefined): boolean {
  if (stopLoss == null || !Number.isFinite(stopLoss) || stopLoss <= 0) return true;
  if (!Number.isFinite(refPrice) || refPrice <= 0) return true;
  return side === 'long' ? stopLoss < refPrice : stopLoss > refPrice;
}

/** TP valide : au-dessus du prix de ref pour un long, en-dessous pour un short. */
export function isValidTakeProfit(side: Side, refPrice: number, takeProfit: number | null | undefined): boolean {
  if (takeProfit == null || !Number.isFinite(takeProfit) || takeProfit <= 0) return true;
  if (!Number.isFinite(refPrice) || refPrice <= 0) return true;
  return side === 'long' ? takeProfit > refPrice : takeProfit < refPrice;
}

export function isValidRiskPrice(
  kind: 'sl' | 'tp',
  side: Side,
  refPrice: number,
  price: number | null | undefined,
): boolean {
  return kind === 'sl' ? isValidStopLoss(side, refPrice, price) : isValidTakeProfit(side, refPrice, price);
}

export type MarketCategory = 'crypto' | 'actions' | 'indices' | 'commodities' | 'forex';

export function isForexCategory(category?: string): boolean {
  return category === 'forex';
}

/** Convertit la quantité saisie (lots pour le forex) en unités moteur. */
export function engineSizeFromInput(category: string | undefined, inputSize: number): number {
  if (!Number.isFinite(inputSize) || inputSize <= 0) return 0;
  if (isForexCategory(category)) return inputSize * FOREX_LOT_SIZE;
  return inputSize;
}

/** Convertit les unités moteur en quantité affichée/saisie. */
export function inputSizeFromEngine(category: string | undefined, engineSize: number): number {
  if (!Number.isFinite(engineSize) || engineSize <= 0) return 0;
  if (isForexCategory(category)) return engineSize / FOREX_LOT_SIZE;
  return engineSize;
}

export function formatInputSize(category: string | undefined, inputSize: number): string {
  if (!Number.isFinite(inputSize) || inputSize <= 0) return '';
  if (isForexCategory(category)) return inputSize.toFixed(2);
  if (inputSize >= 1) return inputSize.toFixed(4);
  return inputSize.toFixed(6);
}

export function formatEngineSizeDisplay(
  category: string | undefined,
  engineSize: number,
  base: string,
): { text: string; unit: string } {
  if (isForexCategory(category)) {
    const lots = engineSize / FOREX_LOT_SIZE;
    return { text: lots.toFixed(2), unit: 'lots' };
  }
  const text = engineSize >= 1 ? engineSize.toFixed(4) : engineSize.toFixed(5);
  return { text, unit: base };
}

export function sizeUnitLabel(category: string | undefined, base: string): string {
  if (isForexCategory(category)) return 'lots';
  return base;
}

export function fmtMarketPrice(price: number | null | undefined, category?: string): string {
  if (price == null || !Number.isFinite(price)) return '–';
  if (category === 'forex') {
    return price.toLocaleString('en-US', { minimumFractionDigits: 5, maximumFractionDigits: 5 });
  }
  if (price >= 1000) {
    return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (price >= 1) {
    return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  }
  return price.toPrecision(6);
}

/** Décimales d'arrondi pour un prix selon la catégorie. */
export function priceDecimals(category: string | undefined, price: number): number {
  if (category === 'forex') return 5;
  if (!Number.isFinite(price)) return 4;
  if (price >= 1000) return 2;
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
