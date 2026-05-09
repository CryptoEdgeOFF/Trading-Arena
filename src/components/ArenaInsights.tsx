import { useMemo } from 'react';
import { useGameStore } from '../stores/useGameStore';
import { formatPnl, timeAgo } from '../utils/formatters';

function StatCard({
  label,
  value,
  accent = 'text-white',
  detail,
}: {
  label: string;
  value: string;
  accent?: string;
  detail?: string;
}) {
  return (
    <div className="min-w-0 rounded-[22px] border border-gray-800/60 bg-gray-900/45 px-5 py-4 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.02)]">
      <div className="text-[10px] uppercase tracking-[0.18em] text-gray-500">{label}</div>
      <div className={`mt-3 font-rajdhani text-2xl font-bold leading-none ${accent}`}>{value}</div>
      {detail ? <div className="mt-2 text-xs leading-5 text-gray-400 truncate">{detail}</div> : null}
    </div>
  );
}

export default function ArenaInsights() {
  const players = useGameStore((s) => s.players);
  const recentTrades = useGameStore((s) => s.recentTrades);
  const teams = useGameStore((s) => s.teams);
  const eventMode = useGameStore((s) => s.eventMode);

  const metrics = useMemo(() => {
    const sortedByPnl = [...players].sort((a, b) => b.pnl - a.pnl);
    const leader = sortedByPnl[0];
    const trailing = sortedByPnl[sortedByPnl.length - 1];
    const totalOpenPositions = players.reduce((sum, player) => sum + player.openPositions.length, 0);
    const activeTraders = players.filter((player) => player.openPositions.length > 0).length;
    const latestTrade = recentTrades[0];

    let leadingTeam: { name: string; pnl: number } | null = null;
    if (eventMode === '4v4' && teams) {
      const teamScores = teams.map((team) => ({
        name: team.name,
        pnl: team.playerIds.reduce((sum, id) => sum + (players.find((player) => player.id === id)?.pnl || 0), 0),
      }));
      leadingTeam = [...teamScores].sort((a, b) => b.pnl - a.pnl)[0] || null;
    }

    return {
      leader,
      trailing,
      totalOpenPositions,
      activeTraders,
      latestTrade,
      leadingTeam,
    };
  }, [eventMode, players, recentTrades, teams]);

  return (
    <div className="grid h-full grid-cols-4 gap-4 px-1 py-1">
      <StatCard
        label="Leader"
        value={metrics.leader ? formatPnl(metrics.leader.pnl) : '$0.00'}
        accent={metrics.leader && metrics.leader.pnl >= 0 ? 'text-green-400' : 'text-red-400'}
        detail={metrics.leader ? `${metrics.leader.name} en tete` : 'Aucun joueur'}
      />

      <StatCard
        label={eventMode === '4v4' ? 'Equipe devant' : 'Sous pression'}
        value={
          eventMode === '4v4'
            ? metrics.leadingTeam
              ? formatPnl(metrics.leadingTeam.pnl)
              : '$0.00'
            : metrics.trailing
              ? formatPnl(metrics.trailing.pnl)
              : '$0.00'
        }
        accent={
          eventMode === '4v4'
            ? metrics.leadingTeam && metrics.leadingTeam.pnl >= 0
              ? 'text-green-400'
              : 'text-red-400'
            : metrics.trailing && metrics.trailing.pnl >= 0
              ? 'text-green-400'
              : 'text-red-400'
        }
        detail={
          eventMode === '4v4'
            ? metrics.leadingTeam
              ? metrics.leadingTeam.name
              : 'Aucune equipe'
            : metrics.trailing
              ? metrics.trailing.name
              : 'Aucun joueur'
        }
      />

      <StatCard
        label="Positions live"
        value={`${metrics.totalOpenPositions}`}
        accent="text-indigo-300"
        detail={`${metrics.activeTraders} joueur${metrics.activeTraders > 1 ? 's' : ''} expose${metrics.activeTraders > 1 ? 's' : ''}`}
      />

      <StatCard
        label="Dernier trade"
        value={metrics.latestTrade ? `${metrics.latestTrade.action.toUpperCase()} ${metrics.latestTrade.pair}` : 'AUCUN'}
        accent={metrics.latestTrade ? (metrics.latestTrade.action === 'open' ? 'text-cyan-300' : 'text-orange-300') : 'text-gray-400'}
        detail={
          metrics.latestTrade
            ? `${metrics.latestTrade.playerName} • ${timeAgo(metrics.latestTrade.time)}`
            : 'En attente de la premiere action'
        }
      />
    </div>
  );
}
