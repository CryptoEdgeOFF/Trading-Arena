export const DRAWDOWN_WARNING_RATIO = 0.8;

export function drawdownBufferConsumedRatio(
  baselineEquity: number,
  equity: number,
  limitEquity: number,
): number {
  const availableBuffer = baselineEquity - limitEquity;
  if (!Number.isFinite(availableBuffer) || availableBuffer <= 0) return 0;
  return (baselineEquity - equity) / availableBuffer;
}

export function shouldNotifyCompletedLimit(
  trade: { id: string; orderId?: string; action: string; orderType: string },
  openOrderIds: ReadonlySet<string>,
): boolean {
  if (trade.action !== 'open' || trade.orderType !== 'limit') return false;
  return !openOrderIds.has(trade.orderId || trade.id);
}

export function isPodiumLoss(previousRank: number | undefined, nextRank: number): boolean {
  return Boolean(previousRank && previousRank <= 3 && nextRank > 3);
}
