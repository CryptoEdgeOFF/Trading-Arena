import { motion } from 'framer-motion';
import type { Player, TeamInfo } from '../stores/useGameStore';
import { formatPnl, formatPercent } from '../utils/formatters';
import ArenaCard from './ArenaCard';
import PlayerAvatar from './PlayerAvatar';

const TALL_CARD_HEIGHT = 'h-[clamp(440px,68vh,560px)]';
const QUARTER_CARD_HEIGHT = 'h-[clamp(240px,31vh,300px)]';

function TeamScoreCard({ team, players }: { team: TeamInfo; players: Player[] }) {
  const totalPnl = players.reduce((sum, p) => sum + p.pnl, 0);
  const avgPercent = players.length > 0
    ? players.reduce((sum, p) => sum + p.pnlPercent, 0) / players.length
    : 0;
  const isPositive = totalPnl >= 0;

  return (
    <div
      className="rounded-2xl border-2 p-5 flex items-center gap-6"
      style={{
        borderColor: team.color + '40',
        background: `linear-gradient(135deg, ${team.color}08, ${team.color}03)`,
        boxShadow: `0 0 40px ${team.color}10`,
      }}
    >
      <div className="w-3 h-16 rounded-full" style={{ background: team.color }} />
      <div className="flex-1">
        <div className="font-rajdhani font-bold text-xl text-white">{team.name}</div>
        <div className="flex items-center gap-3 mt-1">
          {players.map((p) => (
            <PlayerAvatar key={p.id} name={p.name} color={p.color} avatar={p.avatar} size="xs" />
          ))}
        </div>
      </div>
      <div className="text-right">
        <motion.div
          key={totalPnl}
          initial={{ scale: 1.05 }}
          animate={{ scale: 1 }}
          className={`font-rajdhani font-bold text-4xl ${isPositive ? 'text-green-400' : 'text-red-400'}`}
          style={{ textShadow: isPositive ? '0 0 20px rgba(34,197,94,0.3)' : '0 0 20px rgba(239,68,68,0.3)' }}
        >
          {formatPnl(totalPnl)}
        </motion.div>
        <div className={`text-base font-medium ${isPositive ? 'text-green-500/70' : 'text-red-500/70'}`}>
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
    <div className="h-full w-full flex items-center justify-center gap-6 px-6 py-6 xl:px-10 xl:py-8">
      <div className={`flex-1 min-w-0 max-w-[430px] ${TALL_CARD_HEIGHT}`}>
        <ArenaCard player={p1} side="left" size="full" />
      </div>
      {p2 ? (
        <div className={`flex-1 min-w-0 max-w-[430px] ${TALL_CARD_HEIGHT}`}>
          <ArenaCard player={p2} side="right" size="full" />
        </div>
      ) : (
        <div className={`flex-1 max-w-[430px] flex items-center justify-center ${TALL_CARD_HEIGHT}`}>
          <div className="text-gray-600 font-rajdhani text-2xl">En attente...</div>
        </div>
      )}
    </div>
  );
}

// --- 1v1v1 Layout ---
export function Layout1v1v1({ players }: { players: Player[] }) {
  return (
    <div className="h-full w-full flex items-center justify-center gap-6 px-6 py-6 xl:px-10 xl:py-8">
      {players.map((p) => (
        <div key={p.id} className={`flex-1 min-w-0 max-w-[320px] ${TALL_CARD_HEIGHT}`}>
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
    <div className="h-full w-full flex flex-col justify-center gap-6 px-4 py-4 xl:px-8 xl:py-6">
      <div className="flex justify-center gap-6 min-h-0">
        {top.map((p) => (
          <div key={p.id} className={`flex-1 min-w-0 max-w-[360px] ${QUARTER_CARD_HEIGHT}`}>
            <ArenaCard player={p} side="center" size="quarter" />
          </div>
        ))}
      </div>
      <div className="flex justify-center gap-6 min-h-0">
        {bottom.map((p) => (
          <div key={p.id} className={`flex-1 min-w-0 max-w-[360px] ${QUARTER_CARD_HEIGHT}`}>
            <ArenaCard player={p} side="center" size="quarter" />
          </div>
        ))}
      </div>
    </div>
  );
}

// --- 4v4 Layout ---
export function Layout4v4({ players, teams }: { players: Player[]; teams: [TeamInfo, TeamInfo] }) {
  const teamAPlayers = teams[0].playerIds.map((id) => players.find((p) => p.id === id)).filter(Boolean) as Player[];
  const teamBPlayers = teams[1].playerIds.map((id) => players.find((p) => p.id === id)).filter(Boolean) as Player[];

  return (
    <div className="h-full w-full flex flex-col justify-center gap-5 px-2 py-3 xl:px-4 xl:py-4">
      {/* Team A */}
      <div className="flex flex-col gap-3 min-h-0">
        <div className="shrink-0">
          <TeamScoreCard team={teams[0]} players={teamAPlayers} />
        </div>
        <div className="grid grid-cols-4 gap-4 min-h-0">
          {teamAPlayers.map((p) => (
            <div key={p.id} className={QUARTER_CARD_HEIGHT}>
              <ArenaCard player={p} side="center" size="quarter" teamColor={teams[0].color} />
            </div>
          ))}
        </div>
      </div>

      {/* Team B */}
      <div className="flex flex-col gap-3 min-h-0">
        <div className="shrink-0">
          <TeamScoreCard team={teams[1]} players={teamBPlayers} />
        </div>
        <div className="grid grid-cols-4 gap-4 min-h-0">
          {teamBPlayers.map((p) => (
            <div key={p.id} className={QUARTER_CARD_HEIGHT}>
              <ArenaCard player={p} side="center" size="quarter" teamColor={teams[1].color} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
