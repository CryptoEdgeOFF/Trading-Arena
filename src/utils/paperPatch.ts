import type { Player, Trade } from '../stores/useGameStore';

export type PaperPlayerPatch = Partial<Player> & {
  tradesAdded?: Trade[];
};

export function applyPaperPlayerPatch(current: Player, patch: PaperPlayerPatch): Player {
  const { tradesAdded, ...fields } = patch;
  let trades = fields.trades ?? current.trades;
  if (!fields.trades && tradesAdded?.length) {
    const known = new Set(current.trades.map((trade) => trade.id));
    trades = [
      ...current.trades,
      ...tradesAdded.filter((trade) => !known.has(trade.id)),
    ];
  }
  return {
    ...current,
    ...fields,
    trades,
    openPositions: fields.openPositions ?? current.openPositions,
    openOrders: fields.openOrders ?? current.openOrders,
    badges: fields.badges ?? current.badges,
  };
}
