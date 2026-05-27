/**
 * Helpers de conversion FX pour le PnL.
 *
 * Le moteur paper calcule un PnL "raw" en multipliant `priceDiff * size`,
 * ce qui donne un montant dans la **quote currency** de la pair :
 *   - EUR/USD  → quote=USD, raw PnL est déjà en USD ✓
 *   - GOLD/USD → quote=USD, idem ✓
 *   - USD/JPY  → quote=JPY, raw PnL est en JPY ✗ (à convertir)
 *   - USD/CHF  → quote=CHF, raw PnL est en CHF ✗ (à convertir)
 *
 * Pour aligner sur la convention MT5 retail (compte en USD), on convertit
 * le PnL en USD en divisant par le current price (= prix de la quote en
 * USD pour les pairs `USD/<X>`).
 *
 * Formule MT5 standard :
 *   pnl_usd = pnl_quote / pair_price   (quand quote != USD)
 */

const ACCOUNT_CURRENCY = 'USD';

function quoteCurrencyOf(pair: string): string {
  const parts = pair.split('/');
  return (parts[1] || '').toUpperCase();
}

/**
 * Convertit un PnL brut (en quote currency) vers l'USD en utilisant le
 * `conversionPrice` (= mark price ou exit price selon le contexte).
 *
 * - Pour les pairs avec quote=USD : retourne `rawPnl` tel quel.
 * - Pour USD/JPY, USD/CHF, etc. : divise par `conversionPrice`.
 * - Si `conversionPrice` invalide : fallback sur `rawPnl` (pas pire que
 *   l'ancien comportement, et évite de produire des NaN/Infinity).
 */
export function pnlToAccountCcy(pair: string, rawPnl: number, conversionPrice: number): number {
  if (!Number.isFinite(rawPnl)) return 0;
  const quote = quoteCurrencyOf(pair);
  if (!quote || quote === ACCOUNT_CURRENCY) return rawPnl;
  if (!Number.isFinite(conversionPrice) || conversionPrice <= 0) return rawPnl;
  return rawPnl / conversionPrice;
}

/** True si le PnL doit être converti (quote != USD). */
export function needsFxConversion(pair: string): boolean {
  const quote = quoteCurrencyOf(pair);
  return quote.length > 0 && quote !== ACCOUNT_CURRENCY;
}
