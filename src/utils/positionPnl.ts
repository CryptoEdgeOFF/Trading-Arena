import type { Player, Position } from '../stores/useGameStore';

const ACCOUNT_CURRENCY = 'USD';

function quoteCurrencyOf(pair: string): string {
  return (pair.split('/')[1] || '').toUpperCase();
}

/** Miroir client de `server/pairFx.ts` — convertit le PnL quote → USD. */
export function pnlToAccountCcy(pair: string, rawPnl: number, conversionPrice: number): number {
  if (!Number.isFinite(rawPnl)) return 0;
  const quote = quoteCurrencyOf(pair);
  if (!quote || quote === ACCOUNT_CURRENCY) return rawPnl;
  if (!Number.isFinite(conversionPrice) || conversionPrice <= 0) return rawPnl;
  return rawPnl / conversionPrice;
}

/** Miroir client de `computePositionPnl` dans exchangePaperEngine.ts. */
export function computePositionPnl(
  position: Pick<Position, 'pair' | 'side' | 'size' | 'entryPrice' | 'markPrice'>,
  markPrice?: number,
): number {
  const mark = markPrice ?? position.markPrice ?? position.entryPrice;
  const rawPnl = position.side === 'long'
    ? (mark - position.entryPrice) * position.size
    : (position.entryPrice - mark) * position.size;
  return pnlToAccountCcy(position.pair, rawPnl, mark);
}

/** Rafraîchit markPrice + pnl de chaque position ouverte à partir du marché live. */
export function refreshOpenPositions(
  positions: Position[],
  market: Record<string, { markPrice?: number }>,
): Position[] {
  if (!positions.length) return positions;
  return positions.map((position) => {
    const markPrice = market[position.pair]?.markPrice ?? position.markPrice ?? position.entryPrice;
    return {
      ...position,
      markPrice,
      pnl: computePositionPnl(position, markPrice),
    };
  });
}

/** Miroir client de `updatePlayerEquity` (exchangePaperEngine.ts). */
export function refreshPlayerPaperMetrics(
  player: Player,
  market: Record<string, { markPrice?: number }>,
  startingBalance = 10_000,
): Player {
  const openPositions = refreshOpenPositions(player.openPositions || [], market);
  // Miroir de getRealizedPnl côté serveur : PnL archivé (trades évincés de
  // l'historique) + PnL des trades de fermeture encore présents.
  const realizedPnl = (player.realizedPnlArchived || 0)
    + (player.trades || [])
      .filter((trade) => trade.action === 'close')
      .reduce((total, trade) => total + trade.pnl, 0);
  const unrealizedPnl = openPositions.reduce((total, position) => total + position.pnl, 0);
  const initialBalance = player.initialBalance ?? startingBalance;
  const usedMargin = openPositions.reduce((total, position) => total + position.margin, 0);
  const reservedCapital = (player.openOrders || []).reduce(
    (total, order) => total + (order.marginReserved || 0) + (order.feeEstimate || 0),
    0,
  );
  // Inclut pnlAdjustment (ajustements admin / restauration) comme le serveur.
  const currentBalance = initialBalance + realizedPnl + unrealizedPnl
    - (player.feesPaid || 0) + (player.pnlAdjustment || 0);
  const availableMargin = Math.max(0, currentBalance - usedMargin - reservedCapital);
  const pnl = currentBalance - initialBalance;
  const pnlPercent = initialBalance > 0 ? (pnl / initialBalance) * 100 : 0;

  return {
    ...player,
    openPositions,
    usedMargin,
    currentBalance,
    availableMargin,
    pnl,
    pnlPercent,
  };
}
