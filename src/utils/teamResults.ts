import type { TeamInfo } from '../stores/useGameStore';

export interface TeamResultPlayer {
  id: string;
  name: string;
  color: string;
  avatar?: string | null;
  pnl: number;
  pnlPercent: number;
  tradeCount: number;
  currentBalance?: number;
  initialBalance?: number | null;
  feesPaid?: number;
  bestTradePercent?: number;
  biggestTradePnl?: number;
  winStreak?: number;
}

export interface TeamGroup<T extends TeamResultPlayer = TeamResultPlayer> {
  team: TeamInfo;
  players: T[];
  totalPnl: number;
  avgPnlPercent: number;
}

/** Regroupe les joueurs par équipe, classés par P&L total décroissant. */
export function buildTeamGroups<T extends TeamResultPlayer>(
  teams: [TeamInfo, TeamInfo],
  players: T[],
): TeamGroup<T>[] {
  const byId = new Map(players.map((p) => [p.id, p]));
  const groups = teams.map((team) => {
    const teamPlayers = team.playerIds
      .map((id) => byId.get(id))
      .filter(Boolean) as T[];
    const totalPnl = teamPlayers.reduce((sum, p) => sum + p.pnl, 0);
    const avgPnlPercent = teamPlayers.length
      ? teamPlayers.reduce((sum, p) => sum + p.pnlPercent, 0) / teamPlayers.length
      : 0;
    return { team, players: teamPlayers, totalPnl, avgPnlPercent };
  });
  return groups.sort((a, b) => b.totalPnl - a.totalPnl);
}
