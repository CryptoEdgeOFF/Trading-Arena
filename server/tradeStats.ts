import type { Trade } from './types.js';

/**
 * Statistiques de trading dérivées des trades fermés (action === 'close').
 * trade.pnl est un PnL prix pur (cf. exchangePaperEngine) : toutes les
 * métriques ici sont nettes de frais — chaque close compte pour
 * pnl - frais de sortie, et les frais d'ouverture sont déduits du PnL net.
 */
export interface TradeStats {
  /** Nombre de trades fermés (opérations réalisées). */
  closedTrades: number;
  wins: number;
  losses: number;
  /** Taux de réussite 0..1 = wins / (wins + losses). */
  winRate: number;
  /** Somme des gains (PnL positifs). */
  grossProfit: number;
  /** Somme des pertes en valeur absolue. */
  grossLoss: number;
  /** grossProfit / grossLoss. null si aucune perte (non défini / "infini"). */
  profitFactor: number | null;
  /** Gain moyen par trade gagnant. */
  avgWin: number;
  /** Perte moyenne (valeur absolue) par trade perdant. */
  avgLoss: number;
  /** Ratio risque/récompense moyen = avgWin / avgLoss. null si non calculable. */
  avgRR: number | null;
  /** PnL net réalisé, frais inclus (closes nets - frais d'ouverture). */
  netPnl: number;
  /** Total des frais payés (ouvertures + clôtures). */
  totalFees: number;
}

export function emptyTradeStats(): TradeStats {
  return {
    closedTrades: 0,
    wins: 0,
    losses: 0,
    winRate: 0,
    grossProfit: 0,
    grossLoss: 0,
    profitFactor: null,
    avgWin: 0,
    avgLoss: 0,
    avgRR: null,
    netPnl: 0,
    totalFees: 0,
  };
}

/** Calcule les stats nettes de frais à partir d'une liste de trades (opens + closes mélangés). */
export function computeTradeStats(trades: Trade[]): TradeStats {
  let wins = 0;
  let losses = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  let netPnl = 0;
  let totalFees = 0;
  let closedTrades = 0;

  for (const trade of trades) {
    if (!trade) continue;
    const fee = Number(trade.fee) || 0;
    totalFees += fee;
    if (trade.action !== 'close') {
      // Frais d'ouverture : coût réel mais pas un trade "décidé".
      netPnl -= fee;
      continue;
    }
    const pnl = (Number(trade.pnl) || 0) - fee;
    closedTrades += 1;
    netPnl += pnl;
    if (pnl > 0) {
      wins += 1;
      grossProfit += pnl;
    } else if (pnl < 0) {
      losses += 1;
      grossLoss += -pnl;
    }
  }

  const decided = wins + losses;
  const winRate = decided > 0 ? wins / decided : 0;
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : null;
  const avgWin = wins > 0 ? grossProfit / wins : 0;
  const avgLoss = losses > 0 ? grossLoss / losses : 0;
  const avgRR = avgLoss > 0 ? avgWin / avgLoss : null;

  return {
    closedTrades,
    wins,
    losses,
    winRate,
    grossProfit,
    grossLoss,
    profitFactor,
    avgWin,
    avgLoss,
    avgRR,
    netPnl,
    totalFees,
  };
}
