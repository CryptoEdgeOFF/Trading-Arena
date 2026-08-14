import type { Trade } from './types.js';

export interface TradingAchievement {
  key: string;
  amount: number;
  label: string;
}

interface TradeOutcome {
  pnl: number;
  time: number;
  takeProfit: boolean;
  liquidation: boolean;
}

function outcomesFromTrades(trades: Trade[]): TradeOutcome[] {
  const outcomes: Array<TradeOutcome & { positionKey: string }> = [];
  const closed = trades.filter((trade) => trade.action === 'close').sort((a, b) => a.time - b.time);
  for (const trade of closed) {
    const positionKey = `${trade.pair}:${trade.side}:${Number(trade.entryPrice || 0).toFixed(8)}`;
    const previous = outcomes.at(-1);
    if (previous?.positionKey === positionKey) {
      previous.pnl += Number(trade.pnl) || 0;
      previous.time = Math.max(previous.time, trade.time);
      previous.takeProfit ||= trade.closeReason === 'take-profit';
      previous.liquidation ||= trade.closeReason === 'liquidation';
      continue;
    }
    outcomes.push({
      positionKey,
      pnl: Number(trade.pnl) || 0,
      time: trade.time,
      takeProfit: trade.closeReason === 'take-profit',
      liquidation: trade.closeReason === 'liquidation',
    });
  }
  return outcomes.map(({ pnl, time, takeProfit, liquidation }) => ({ pnl, time, takeProfit, liquidation }));
}

function longestWinningStreak(outcomes: TradeOutcome[], meaningfulWin: number): number {
  let current = 0;
  let best = 0;
  for (const outcome of outcomes) {
    if (outcome.pnl >= meaningfulWin) {
      current += 1;
      best = Math.max(best, current);
    } else {
      current = 0;
    }
  }
  return best;
}

function maxDrawdownPercent(outcomes: TradeOutcome[], startingBalance: number): number {
  let equity = startingBalance;
  let peak = startingBalance;
  let maxDrawdown = 0;
  for (const outcome of outcomes) {
    equity += outcome.pnl;
    peak = Math.max(peak, equity);
    if (peak > 0) maxDrawdown = Math.max(maxDrawdown, ((peak - equity) / peak) * 100);
  }
  return maxDrawdown;
}

export function computeTradingAchievements(input: {
  playerId: string;
  arenaTitle: string;
  startingBalance: number;
  trades: Trade[];
  arenaEnded: boolean;
  breached: boolean;
}): TradingAchievement[] {
  const outcomes = outcomesFromTrades(input.trades);
  if (!outcomes.length) return [];
  const achievements: TradingAchievement[] = [];
  const prefix = input.playerId;
  const meaningfulWin = Math.max(1, input.startingBalance * 0.0005);
  const winStreak = longestWinningStreak(outcomes, meaningfulWin);
  for (const milestone of [3, 5, 10]) {
    if (winStreak >= milestone) achievements.push({
      key: `${prefix}:winning-streak:${milestone}`,
      amount: milestone === 3 ? 120 : milestone === 5 ? 250 : 600,
      label: `${milestone} trades gagnants d’affilée · ${input.arenaTitle}`,
    });
  }

  const wins = outcomes.filter((outcome) => outcome.pnl > 0);
  const losses = outcomes.filter((outcome) => outcome.pnl < 0);
  const grossProfit = wins.reduce((sum, outcome) => sum + outcome.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((sum, outcome) => sum + outcome.pnl, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Number.POSITIVE_INFINITY : 0;
  const winRate = wins.length / outcomes.length;
  const netPnl = grossProfit - grossLoss;
  const largestLossPercent = losses.length
    ? (Math.abs(Math.min(...losses.map((outcome) => outcome.pnl))) / input.startingBalance) * 100
    : 0;
  const drawdown = maxDrawdownPercent(outcomes, input.startingBalance);
  const liquidated = outcomes.some((outcome) => outcome.liquidation);

  if (outcomes.filter((outcome) => outcome.takeProfit).length >= 3 && !liquidated) achievements.push({
    key: `${prefix}:take-profit-discipline`,
    amount: 180,
    label: `Plan respecté · 3 Take Profits · ${input.arenaTitle}`,
  });

  if (input.arenaEnded && outcomes.length >= 5 && !input.breached && !liquidated) achievements.push({
    key: `${prefix}:capital-preserved`,
    amount: 200,
    label: `Capital préservé · ${input.arenaTitle}`,
  });

  if (input.arenaEnded && outcomes.length >= 10 && drawdown <= 4 && largestLossPercent <= 2 && !liquidated) achievements.push({
    key: `${prefix}:risk-manager`,
    amount: 400,
    label: `Risk Manager · drawdown ${drawdown.toFixed(1)} %`,
  });

  if (input.arenaEnded && outcomes.length >= 10 && winRate >= 0.55 && profitFactor >= 1.5 && netPnl > 0) achievements.push({
    key: `${prefix}:positive-expectancy`,
    amount: 450,
    label: `Espérance positive · ${input.arenaTitle}`,
  });

  const dailyPnl = new Map<string, number>();
  for (const outcome of outcomes) {
    const day = new Date(outcome.time).toISOString().slice(0, 10);
    dailyPnl.set(day, (dailyPnl.get(day) || 0) + outcome.pnl);
  }
  const positiveDays = [...dailyPnl.values()].filter((pnl) => pnl >= meaningfulWin).length;
  if (input.arenaEnded && positiveDays >= 3 && !liquidated) achievements.push({
    key: `${prefix}:positive-days:3`,
    amount: 350,
    label: `Régularité · 3 journées positives · ${input.arenaTitle}`,
  });

  return achievements;
}
