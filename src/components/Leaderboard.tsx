import { motion, AnimatePresence } from 'framer-motion';
import { useGameStore } from '../stores/useGameStore';
import type { Player } from '../stores/useGameStore';
import { formatPnl, formatPercent } from '../utils/formatters';
import PlayerAvatar from './PlayerAvatar';

function RankChip({ rank }: { rank: number }) {
  const tone = rank === 1 ? 'gold' : rank === 2 ? 'silver' : rank === 3 ? 'bronze' : '';
  return <span className={`rank-chip ${tone}`}>{rank}</span>;
}

function RankDelta({ current, previous }: { current: number; previous: number }) {
  const diff = previous - current;
  if (diff === 0) return null;
  return (
    <motion.span
      initial={{ opacity: 0, y: diff > 0 ? 8 : -8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`text-[10px] font-bold tabular-nums ${diff > 0 ? 'text-emerald-400' : 'text-red-400'}`}
    >
      {diff > 0 ? `▲${diff}` : `▼${Math.abs(diff)}`}
    </motion.span>
  );
}

function LeaderboardRow({ player, index }: { player: Player; index: number }) {
  const isPositive = player.pnl >= 0;
  const intensity = Math.min(Math.abs(player.pnlPercent) * 5, 100);

  return (
    <motion.div
      layout
      layoutId={player.id}
      initial={{ opacity: 0, x: -24 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{
        layout: { type: 'spring', stiffness: 180, damping: 26, mass: 0.9 },
        delay: index * 0.03,
      }}
      className={`leader-row ${player.rank === 1 ? 'rank-1' : ''}`}
    >
      <RankChip rank={player.rank} />

      <div className="flex items-center gap-2.5 flex-1 min-w-0">
        <PlayerAvatar name={player.name} color={player.color} avatar={player.avatar} size="sm" glow />
        <div className="min-w-0">
          <div className="display text-[15px] font-bold text-white truncate leading-tight">
            {player.name}
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <RankDelta current={player.rank} previous={player.previousRank} />
            <span className="micro text-[9px] tracking-[0.16em] text-zinc-500">
              {player.tradeCount} TRD
            </span>
          </div>
        </div>
      </div>

      {player.badges.length > 0 && (
        <div className="flex gap-0.5 mr-1 shrink-0">
          {player.badges.slice(0, 3).map((badge) => (
            <motion.span
              key={badge.type}
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              className="text-base leading-none"
              title={badge.label}
            >
              {badge.icon}
            </motion.span>
          ))}
        </div>
      )}

      <div className="text-right min-w-[70px] shrink-0">
        <motion.div
          key={player.pnl}
          initial={{ scale: 1.1 }}
          animate={{ scale: 1 }}
          className={`num text-[14px] font-bold leading-none ${
            isPositive ? 'text-emerald-400' : 'text-red-400'
          }`}
        >
          {formatPnl(player.pnl)}
        </motion.div>
        <div
          className={`num text-[10.5px] mt-0.5 ${
            isPositive ? 'text-emerald-500/80' : 'text-red-500/80'
          }`}
        >
          {formatPercent(player.pnlPercent)}
        </div>
      </div>

      {/* PnL bar collée en bas. */}
      <div className="absolute bottom-0 left-2 right-2 h-px overflow-hidden rounded-full">
        <motion.div
          className={`h-full ${
            isPositive
              ? 'bg-gradient-to-r from-emerald-500/0 via-emerald-400 to-emerald-500/0'
              : 'bg-gradient-to-r from-red-500/0 via-red-500 to-red-500/0'
          }`}
          initial={{ width: 0 }}
          animate={{ width: `${intensity}%` }}
          transition={{ type: 'spring', stiffness: 90 }}
        />
      </div>
    </motion.div>
  );
}

export default function Leaderboard() {
  const players = useGameStore((s) => s.players);
  const sorted = [...players].sort((a, b) => a.rank - b.rank);

  return (
    <div className="space-y-2">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <div className="micro text-zinc-500 mb-1">Classement</div>
          <h2 className="display text-xl font-bold tracking-[0.04em] text-white uppercase">
            Standings
          </h2>
        </div>
        <span className="micro text-red-300/80 text-[9.5px]">PNL</span>
      </div>

      <AnimatePresence mode="popLayout">
        {sorted.map((player, i) => (
          <LeaderboardRow key={player.id} player={player} index={i} />
        ))}
      </AnimatePresence>

      {sorted.length === 0 && (
        <div className="text-center py-12 text-zinc-600">
          <div className="text-4xl mb-3">🩸</div>
          <p className="text-sm">En attente des combattants...</p>
        </div>
      )}
    </div>
  );
}
