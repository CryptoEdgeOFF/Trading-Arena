import { motion } from 'framer-motion';
import type { Player, Position } from '../stores/useGameStore';
import { formatPnl, formatPercent, formatUSD } from '../utils/formatters';
import PlayerAvatar from './PlayerAvatar';

function PositionRow({ position, large }: { position: Position; large?: boolean }) {
  const isLong = position.side === 'long';
  const isProfit = position.pnl >= 0;

  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      className={`flex items-center justify-between rounded-lg bg-gray-800/40 ${
        large ? 'py-3 px-4' : 'py-2 px-3'
      }`}
    >
      <div className="flex items-center gap-2.5">
        <span
          className={`font-bold px-2 py-0.5 rounded ${
            large ? 'text-xs' : 'text-[10px]'
          } ${
            isLong
              ? 'bg-green-500/20 text-green-400'
              : 'bg-red-500/20 text-red-400'
          }`}
        >
          {isLong ? 'LONG' : 'SHORT'}
        </span>
        <span className={`text-white font-medium ${large ? 'text-base' : 'text-sm'}`}>
          {position.pair}
        </span>
        <span className={`text-gray-500 ${large ? 'text-sm' : 'text-xs'}`}>
          {position.size}
        </span>
      </div>
      <span
        className={`font-semibold font-rajdhani ${
          large ? 'text-base' : 'text-sm'
        } ${isProfit ? 'text-green-400' : 'text-red-400'}`}
      >
        {formatPnl(position.pnl)}
      </span>
    </motion.div>
  );
}

interface PlayerCardProps {
  player: Player;
  playerCount: number;
}

export default function PlayerCard({ player, playerCount }: PlayerCardProps) {
  const isPositive = player.pnl >= 0;
  const rankUp = player.previousRank > player.rank;
  const rankDown = player.previousRank < player.rank;
  const isLarge = playerCount <= 4;

  return (
    <motion.div
      layout
      layoutId={`card-${player.id}`}
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{
        opacity: 1,
        scale: 1,
        ...(rankUp ? { y: [0, -4, 0] } : {}),
      }}
      transition={{
        layout: { type: 'spring', stiffness: 300, damping: 30 },
      }}
      className={`relative rounded-2xl border overflow-hidden ${
        player.rank === 1
          ? 'border-amber-500/30 bg-gradient-to-br from-gray-900 to-amber-950/20'
          : 'border-gray-800 bg-gray-900/80'
      }`}
    >
      {/* Top color bar */}
      <div
        className={`w-full ${isLarge ? 'h-1.5' : 'h-1'}`}
        style={{
          background: `linear-gradient(90deg, ${player.color}, ${player.color}80)`,
        }}
      />

      <div className={isLarge ? 'p-6' : 'p-4'}>
        {/* Player header */}
        <div className={`flex items-center justify-between ${isLarge ? 'mb-5' : 'mb-3'}`}>
          <div className={`flex items-center ${isLarge ? 'gap-4' : 'gap-3'}`}>
            <PlayerAvatar
              name={player.name}
              color={player.color}
              avatar={player.avatar}
              size={isLarge ? 'lg' : 'md'}
              glow
            />
            <div>
              <div className={`font-semibold text-white ${isLarge ? 'text-xl' : 'text-base'}`}>
                {player.name}
              </div>
              <div className={`text-gray-500 flex items-center gap-1.5 ${isLarge ? 'text-sm' : 'text-xs'}`}>
                <span
                  className={`rounded-full ${
                    isLarge ? 'w-2 h-2' : 'w-1.5 h-1.5'
                  } ${player.connected ? 'bg-green-400' : 'bg-red-400'}`}
                />
                #{player.rank}
                {rankUp && (
                  <motion.span
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="text-green-400 text-xs"
                  >
                    ▲
                  </motion.span>
                )}
                {rankDown && (
                  <motion.span
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="text-red-400 text-xs"
                  >
                    ▼
                  </motion.span>
                )}
              </div>
            </div>
          </div>

          {/* Badges */}
          <div className="flex gap-1.5">
            {player.badges.map((b) => (
              <motion.span
                key={b.type}
                initial={{ scale: 0, rotate: -180 }}
                animate={{ scale: 1, rotate: 0 }}
                className={isLarge ? 'text-2xl' : 'text-lg'}
                title={b.label}
              >
                {b.icon}
              </motion.span>
            ))}
          </div>
        </div>

        {/* PNL display */}
        <div className={isLarge ? 'mb-5' : 'mb-3'}>
          <motion.div
            key={player.pnl}
            initial={{ scale: 1.05 }}
            animate={{ scale: 1 }}
            className={`font-rajdhani font-bold ${
              isLarge ? 'text-5xl' : 'text-3xl'
            } ${isPositive ? 'text-green-400' : 'text-red-400'}`}
            style={{
              textShadow: isPositive
                ? '0 0 20px rgba(34,197,94,0.3)'
                : '0 0 20px rgba(239,68,68,0.3)',
            }}
          >
            {formatPnl(player.pnl)}
          </motion.div>
          <div
            className={`font-medium ${
              isLarge ? 'text-lg' : 'text-sm'
            } ${isPositive ? 'text-green-500/70' : 'text-red-500/70'}`}
          >
            {formatPercent(player.pnlPercent)}
          </div>
        </div>

        {/* PNL progress bar */}
        <div className={`w-full bg-gray-800 rounded-full overflow-hidden ${
          isLarge ? 'h-2 mb-6' : 'h-1.5 mb-4'
        }`}>
          <motion.div
            className={`h-full rounded-full ${
              isPositive
                ? 'bg-gradient-to-r from-green-500 to-emerald-400'
                : 'bg-gradient-to-r from-red-500 to-rose-400'
            }`}
            animate={{
              width: `${Math.min(Math.abs(player.pnlPercent) * 10, 100)}%`,
            }}
            transition={{ type: 'spring', stiffness: 100 }}
          />
        </div>

        {/* Stats row */}
        <div className={`grid grid-cols-2 gap-3 ${isLarge ? 'mb-5' : 'mb-3'}`}>
          <div className={`text-center rounded-lg bg-gray-800/30 ${isLarge ? 'py-3' : 'py-2'}`}>
            <div className={`text-gray-500 uppercase ${isLarge ? 'text-xs mb-1' : 'text-[10px]'}`}>
              Balance
            </div>
            <div className={`font-semibold text-white font-rajdhani ${isLarge ? 'text-lg' : 'text-sm'}`}>
              ${formatUSD(player.currentBalance)}
            </div>
          </div>
          <div className={`text-center rounded-lg bg-gray-800/30 ${isLarge ? 'py-3' : 'py-2'}`}>
            <div className={`text-gray-500 uppercase ${isLarge ? 'text-xs mb-1' : 'text-[10px]'}`}>
              Positions
            </div>
            <div className={`font-semibold text-white font-rajdhani ${isLarge ? 'text-lg' : 'text-sm'}`}>
              {player.openPositions.length}
            </div>
          </div>
        </div>

        {/* Open positions list */}
        {player.openPositions.length > 0 && (
          <div className={isLarge ? 'space-y-2' : 'space-y-1'}>
            <div className={`text-gray-500 uppercase ${isLarge ? 'text-xs mb-2' : 'text-[10px] mb-1'}`}>
              Positions ouvertes
            </div>
            {player.openPositions.map((pos) => (
              <PositionRow key={pos.pair} position={pos} large={isLarge} />
            ))}
          </div>
        )}

        {player.openPositions.length === 0 && (
          <div className={`text-center text-gray-600 ${isLarge ? 'text-sm py-4' : 'text-xs py-2'}`}>
            Aucune position ouverte
          </div>
        )}
      </div>
    </motion.div>
  );
}
