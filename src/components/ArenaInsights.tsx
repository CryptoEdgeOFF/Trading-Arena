import { useMemo, type ReactNode } from 'react';
import { useGameStore } from '../stores/useGameStore';
import { formatPnl, timeAgo } from '../utils/formatters';

function StatTile({
  label,
  value,
  accent = 'neutral',
  detail,
  glyph,
}: {
  label: string;
  value: string;
  accent?: 'pos' | 'neg' | 'red' | 'neutral';
  detail?: string;
  glyph?: ReactNode;
}) {
  const accentClass =
    accent === 'pos'
      ? 'text-emerald-400'
      : accent === 'neg'
        ? 'text-red-400'
        : accent === 'red'
          ? 'text-red-300'
          : 'text-white';

  return (
    <div className="blood-panel relative px-5 py-4 overflow-hidden">
      {glyph && (
        <div className="absolute -right-2 -top-2 h-16 w-16 rounded-full bg-red-500/15 blur-2xl" />
      )}
      <div className="micro mb-2 flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full bg-red-500/70" />
        {label}
      </div>
      <div className={`display text-2xl font-bold leading-none tabular-nums ${accentClass}`}>
        {value}
      </div>
      {detail ? (
        <div className="mt-2 text-xs leading-snug text-zinc-400 truncate">{detail}</div>
      ) : null}
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
    const totalOpenPositions = players.reduce((sum, p) => sum + p.openPositions.length, 0);
    const activeTraders = players.filter((p) => p.openPositions.length > 0).length;
    const latestTrade = recentTrades[0];

    let leadingTeam: { name: string; pnl: number } | null = null;
    if (eventMode === '4v4' && teams) {
      const teamScores = teams.map((team) => ({
        name: team.name,
        pnl: team.playerIds.reduce(
          (sum, id) => sum + (players.find((p) => p.id === id)?.pnl || 0),
          0,
        ),
      }));
      leadingTeam = [...teamScores].sort((a, b) => b.pnl - a.pnl)[0] || null;
    }

    return { leader, trailing, totalOpenPositions, activeTraders, latestTrade, leadingTeam };
  }, [eventMode, players, recentTrades, teams]);

  return (
    <div className="grid h-full grid-cols-4 gap-3">
      <StatTile
        label="Leader"
        value={metrics.leader ? formatPnl(metrics.leader.pnl) : '$0.00'}
        accent={metrics.leader && metrics.leader.pnl >= 0 ? 'pos' : 'neg'}
        detail={metrics.leader ? `${metrics.leader.name} en tête` : 'Aucun joueur'}
        glyph
      />

      <StatTile
        label={eventMode === '4v4' ? 'Équipe leader' : 'Sous pression'}
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
              ? 'pos'
              : 'neg'
            : metrics.trailing && metrics.trailing.pnl >= 0
              ? 'pos'
              : 'neg'
        }
        detail={
          eventMode === '4v4'
            ? metrics.leadingTeam
              ? metrics.leadingTeam.name
              : 'Aucune équipe'
            : metrics.trailing
              ? metrics.trailing.name
              : 'Aucun joueur'
        }
      />

      <StatTile
        label="Positions live"
        value={`${metrics.totalOpenPositions}`}
        accent="red"
        detail={`${metrics.activeTraders} trader${metrics.activeTraders > 1 ? 's' : ''} exposé${
          metrics.activeTraders > 1 ? 's' : ''
        }`}
      />

      <StatTile
        label="Dernier coup"
        value={
          metrics.latestTrade
            ? `${metrics.latestTrade.action.toUpperCase()} ${metrics.latestTrade.pair}`
            : 'AUCUN'
        }
        accent={
          metrics.latestTrade
            ? metrics.latestTrade.action === 'open'
              ? 'red'
              : 'neutral'
            : 'neutral'
        }
        detail={
          metrics.latestTrade
            ? `${metrics.latestTrade.playerName} • ${timeAgo(metrics.latestTrade.time)}`
            : 'En attente de la première action'
        }
      />
    </div>
  );
}
