import { motion } from 'framer-motion';
import type { Player, TeamInfo } from '../stores/useGameStore';
import { formatPnl, formatPercent } from '../utils/formatters';
import { TEAM_PLAYERS_PER_SIDE } from '../utils/teamMode';
import ArenaCard from './ArenaCard';
import PlayerAvatar from './PlayerAvatar';

const TALL_CARD_HEIGHT = 'h-full min-h-0';
const QUARTER_CARD_HEIGHT = 'h-full min-h-0';

function TeamScoreCard({ team, players }: { team: TeamInfo; players: Player[] }) {
  const totalPnl = players.reduce((sum, p) => sum + p.pnl, 0);
  const avgPercent = players.length > 0
    ? players.reduce((sum, p) => sum + p.pnlPercent, 0) / players.length
    : 0;
  const isPositive = totalPnl >= 0;

  return (
    <div
      className="relative flex items-center gap-4 overflow-hidden rounded-xl px-4 py-3 border"
      style={{
        borderColor: `${team.color}55`,
        background: `
          radial-gradient(420px 200px at 100% 0%, ${team.color}22, transparent 60%),
          linear-gradient(180deg, rgba(255,255,255,0.025), rgba(255,255,255,0.005)),
          #0a0a0e
        `,
        boxShadow: `0 24px 64px -38px ${team.color}80, inset 0 1px 0 rgba(255,255,255,0.05)`,
      }}
    >
      <div
        className="absolute top-0 left-0 right-0 h-[3px]"
        style={{ background: `linear-gradient(90deg, ${team.color}, transparent 70%)` }}
      />

      <div className="w-2.5 h-14 rounded-full" style={{ background: team.color, boxShadow: `0 0 18px ${team.color}` }} />

      <div className="flex-1 min-w-0">
        <div className="micro text-zinc-500 mb-1">Équipe</div>
        <div className="display text-xl font-bold tracking-[0.04em] text-white leading-none uppercase truncate">
          {team.name.trim() || 'Équipe'}
        </div>
        <div className="mt-2 flex items-center gap-2">
          {players.map((p) => (
            <PlayerAvatar key={p.id} name={p.name} color={p.color} avatar={p.avatar} size="xs" />
          ))}
          <span className="ml-2 num text-[11px] text-zinc-500">{players.length} traders</span>
        </div>
      </div>

      <div className="text-right">
        <div className="micro text-zinc-500 mb-1">Score équipe</div>
        <motion.div
          key={totalPnl}
          initial={{ scale: 1.05 }}
          animate={{ scale: 1 }}
          className={`display text-5xl font-bold tabular-nums leading-none ${
            isPositive ? 'text-emerald-400' : 'text-red-400'
          }`}
          style={{
            textShadow: isPositive
              ? '0 0 28px rgba(16,185,129,0.35)'
              : '0 0 28px rgba(239,68,68,0.45)',
          }}
        >
          {formatPnl(totalPnl)}
        </motion.div>
        <div className={`num text-sm mt-1 ${isPositive ? 'text-emerald-500/80' : 'text-red-500/80'}`}>
          {formatPercent(avgPercent)} moy.
        </div>
      </div>
    </div>
  );
}

// --- 1v1 Layout ---
export function Layout1v1({ players }: { players: Player[] }) {
  const [p1, p2] = players;
  if (!p1) return null;

  return (
    <div className="relative h-full w-full flex items-stretch justify-center gap-5 xl:gap-6 px-2 py-2 xl:px-4 xl:py-3">
      <div className={`flex-1 min-w-0 ${TALL_CARD_HEIGHT}`}>
        <ArenaCard player={p1} side="left" size="full" />
      </div>
      {p2 ? (
        <div className={`flex-1 min-w-0 ${TALL_CARD_HEIGHT}`}>
          <ArenaCard player={p2} side="right" size="full" />
        </div>
      ) : (
        <div className={`flex-1 flex items-center justify-center ${TALL_CARD_HEIGHT}`}>
          <div className="text-zinc-700 display text-2xl tracking-wide">En attente...</div>
        </div>
      )}
    </div>
  );
}

// --- 1v1v1 Layout ---
export function Layout1v1v1({ players }: { players: Player[] }) {
  return (
    <div className="h-full w-full flex items-stretch justify-center gap-4 xl:gap-5 px-2 py-2 xl:px-4 xl:py-3">
      {players.map((p) => (
        <div key={p.id} className={`flex-1 min-w-0 ${TALL_CARD_HEIGHT}`}>
          <ArenaCard player={p} side="center" size="third" />
        </div>
      ))}
    </div>
  );
}

// --- 1v1v1v1 Layout ---
export function Layout1v1v1v1({ players }: { players: Player[] }) {
  const top = players.slice(0, 2);
  const bottom = players.slice(2, 4);

  return (
    <div className="h-full w-full flex flex-col gap-3 xl:gap-4 px-2 py-2 xl:px-4 xl:py-3">
      <div className="flex flex-1 min-h-0 justify-center gap-3 xl:gap-4">
        {top.map((p) => (
          <div key={p.id} className={`flex-1 min-w-0 ${QUARTER_CARD_HEIGHT}`}>
            <ArenaCard player={p} side="center" size="quarter" />
          </div>
        ))}
      </div>
      <div className="flex flex-1 min-h-0 justify-center gap-3 xl:gap-4">
        {bottom.map((p) => (
          <div key={p.id} className={`flex-1 min-w-0 ${QUARTER_CARD_HEIGHT}`}>
            <ArenaCard player={p} side="center" size="quarter" />
          </div>
        ))}
      </div>
    </div>
  );
}

// --- 5v5 Layout (mode API `4v4`) ---
export function Layout4v4({ players, teams }: { players: Player[]; teams: [TeamInfo, TeamInfo] }) {
  const teamAPlayers = teams[0].playerIds.map((id) => players.find((p) => p.id === id)).filter(Boolean) as Player[];
  const teamBPlayers = teams[1].playerIds.map((id) => players.find((p) => p.id === id)).filter(Boolean) as Player[];
  const teamGridClass = TEAM_PLAYERS_PER_SIDE <= 5 ? 'grid-cols-5' : 'grid-cols-4';

  return (
    <div className="h-full w-full flex flex-col gap-3 px-2 py-2 xl:px-4 xl:py-3">
      <div className="flex flex-1 flex-col gap-2 min-h-0">
        <div className="shrink-0">
          <TeamScoreCard team={teams[0]} players={teamAPlayers} />
        </div>
        <div className={`grid flex-1 min-h-0 ${teamGridClass} gap-2`}>
          {teamAPlayers.map((p) => (
            <div key={p.id} className={QUARTER_CARD_HEIGHT}>
              <ArenaCard player={p} side="center" size="team" teamColor={teams[0].color} />
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-2 min-h-0">
        <div className="shrink-0">
          <TeamScoreCard team={teams[1]} players={teamBPlayers} />
        </div>
        <div className={`grid flex-1 min-h-0 ${teamGridClass} gap-2`}>
          {teamBPlayers.map((p) => (
            <div key={p.id} className={QUARTER_CARD_HEIGHT}>
              <ArenaCard player={p} side="center" size="team" teamColor={teams[1].color} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
