import { motion, AnimatePresence } from 'framer-motion';
import { useGameStore } from '../stores/useGameStore';
import type { Player } from '../stores/useGameStore';
import { formatPnl, formatPercent } from '../utils/formatters';
import PlayerAvatar from './PlayerAvatar';

function RankBadge({ rank }: { rank: number }) {
  const styles: Record<number, string> = {
    1: 'from-yellow-400 to-amber-500 text-black shadow-amber-500/30',
    2: 'from-gray-300 to-gray-400 text-black shadow-gray-400/30',
    3: 'from-orange-400 to-orange-600 text-black shadow-orange-500/30',
  };

  if (rank <= 3) {
    return (
      <div
        className={`w-9 h-9 rounded-lg bg-gradient-to-br ${styles[rank]} font-rajdhani font-bold text-lg flex items-center justify-center shadow-lg`}
      >
        {rank}
      </div>
    );
  }
  return (
    <div className="w-9 h-9 rounded-lg bg-gray-800 border border-gray-700 font-rajdhani font-bold text-lg flex items-center justify-center text-gray-400">
      {rank}
    </div>
  );
}

function RankChange({ current, previous }: { current: number; previous: number }) {
  const diff = previous - current;
  if (diff === 0) return null;

  return (
    <motion.span
      initial={{ opacity: 0, y: diff > 0 ? 10 : -10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`text-xs font-bold ${diff > 0 ? 'text-green-400' : 'text-red-400'}`}
    >
      {diff > 0 ? `+${diff}` : diff}
    </motion.span>
  );
}

function LeaderboardRow({ player, index }: { player: Player; index: number }) {
  const isPositive = player.pnl >= 0;

  return (
    <motion.div
      layout
      layoutId={player.id}
      initial={{ opacity: 0, x: -50 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{
        layout: { type: 'spring', stiffness: 300, damping: 30 },
        delay: index * 0.05,
      }}
      className={`relative flex items-center gap-4 px-4 py-3 rounded-xl transition-colors ${
        player.rank === 1
          ? 'bg-gradient-to-r from-amber-500/10 to-transparent border border-amber-500/20'
          : 'bg-gray-900/50 border border-gray-800/50 hover:border-gray-700/50'
      }`}
    >
      {/* Rank glow for #1 */}
      {player.rank === 1 && (
        <motion.div
          className="absolute inset-0 rounded-xl bg-amber-400/5"
          animate={{ opacity: [0.3, 0.6, 0.3] }}
          transition={{ duration: 2, repeat: Infinity }}
        />
      )}

      <RankBadge rank={player.rank} />
      <RankChange current={player.rank} previous={player.previousRank} />

      {/* Player info */}
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <PlayerAvatar name={player.name} color={player.color} avatar={player.avatar} size="sm" glow />
        <div className="min-w-0">
          <div className="font-semibold text-white truncate">{player.name}</div>
          <div className="text-xs text-gray-500">
            {player.tradeCount} trade{player.tradeCount !== 1 ? 's' : ''}
          </div>
        </div>
      </div>

      {/* Badges */}
      <div className="flex gap-1">
        {player.badges.slice(0, 3).map((badge) => (
          <motion.span
            key={badge.type}
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="text-lg"
            title={badge.label}
          >
            {badge.icon}
          </motion.span>
        ))}
      </div>

      {/* PNL */}
      <div className="text-right min-w-[120px]">
        <motion.div
          key={player.pnl}
          initial={{ scale: 1.1 }}
          animate={{ scale: 1 }}
          className={`font-rajdhani font-bold text-xl ${
            isPositive ? 'text-green-400' : 'text-red-400'
          }`}
        >
          {formatPnl(player.pnl)}
        </motion.div>
        <div
          className={`text-sm font-medium ${
            isPositive ? 'text-green-500/70' : 'text-red-500/70'
          }`}
        >
          {formatPercent(player.pnlPercent)}
        </div>
      </div>

      {/* PNL bar */}
      <div className="w-24 h-2 bg-gray-800 rounded-full overflow-hidden">
        <motion.div
          className={`h-full rounded-full ${
            isPositive
              ? 'bg-gradient-to-r from-green-500 to-emerald-400'
              : 'bg-gradient-to-r from-red-500 to-rose-400'
          }`}
          initial={{ width: 0 }}
          animate={{
            width: `${Math.min(Math.abs(player.pnlPercent) * 5, 100)}%`,
          }}
          transition={{ type: 'spring', stiffness: 100 }}
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
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-rajdhani text-xl font-bold text-white uppercase tracking-wider">
          Classement
        </h2>
        <div className="text-xs text-gray-500 uppercase tracking-wider">
          PNL %
        </div>
      </div>
      <AnimatePresence mode="popLayout">
        {sorted.map((player, i) => (
          <LeaderboardRow key={player.id} player={player} index={i} />
        ))}
      </AnimatePresence>
      {sorted.length === 0 && (
        <div className="text-center py-12 text-gray-600">
          <div className="text-4xl mb-3">🏆</div>
          <p>En attente des joueurs...</p>
        </div>
      )}
    </div>
  );
}
