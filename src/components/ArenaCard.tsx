import { useState } from 'react';
import { motion } from 'framer-motion';
import type { Player, Position, Trade } from '../stores/useGameStore';
import { formatPnl, formatPercent, formatUSD } from '../utils/formatters';
import { getCryptoIconUrl } from '../utils/cryptoIcons';
import PlayerAvatar from './PlayerAvatar';

function CryptoIcon({ pair, className }: { pair: string; className?: string }) {
  const [error, setError] = useState(false);
  const url = getCryptoIconUrl(pair);

  if (!url || error) {
    return (
      <div className={`rounded-full bg-gray-700 flex items-center justify-center text-[9px] font-bold text-gray-400 ${className || 'w-6 h-6'}`}>
        {pair.replace(/\/.*|USD.*$/i, '').slice(0, 3)}
      </div>
    );
  }

  return (
    <img
      src={url}
      alt={pair}
      onError={() => setError(true)}
      className={`rounded-full object-contain ${className || 'w-6 h-6'}`}
    />
  );
}

function PositionRow({ position }: { position: Position }) {
  const isLong = position.side === 'long';
  const isProfit = position.pnl >= 0;

  return (
    <div className="flex items-center gap-3.5 rounded-2xl border border-gray-800/60 bg-gray-800/35 px-4 py-3">
      <CryptoIcon pair={position.pair} className="w-8 h-8 shrink-0" />
      <span className={`text-[10px] font-bold px-2.5 py-1 rounded-lg shrink-0 ${isLong ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
        {isLong ? 'LONG' : 'SHORT'}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-white">{position.pair}</div>
        <div className="mt-0.5 text-xs text-gray-500">Taille {position.size}</div>
      </div>
      <span className={`text-sm font-semibold font-rajdhani shrink-0 ${isProfit ? 'text-green-400' : 'text-red-400'}`}>
        {formatPnl(position.pnl)}
      </span>
    </div>
  );
}

function ClosedTradeRow({ trade }: { trade: Trade }) {
  const isLong = trade.side === 'long';
  const isProfit = trade.pnl >= 0;

  return (
    <div className="flex items-center gap-3.5 rounded-2xl border border-gray-800/40 bg-gray-800/20 px-4 py-3 opacity-80">
      <CryptoIcon pair={trade.pair} className="w-7 h-7 shrink-0" />
      <span className={`text-[9px] font-bold px-2 py-1 rounded-lg shrink-0 ${isLong ? 'bg-green-500/10 text-green-500/70' : 'bg-red-500/10 text-red-500/70'}`}>
        {isLong ? 'LONG' : 'SHORT'}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-gray-300">{trade.pair}</div>
        <div className="mt-0.5 text-[11px] text-gray-500">Trade ferme</div>
      </div>
      <span className={`text-sm font-semibold font-rajdhani shrink-0 ${isProfit ? 'text-green-400' : 'text-red-400'}`}>
        {formatPnl(trade.pnl)}
      </span>
    </div>
  );
}

interface ArenaCardProps {
  player: Player;
  side?: 'left' | 'right' | 'center';
  size?: 'full' | 'half' | 'third' | 'quarter';
  teamColor?: string;
}

export default function ArenaCard({ player, side = 'center', size = 'half', teamColor }: ArenaCardProps) {
  const isPositive = player.pnl >= 0;
  const isFull = size === 'full' || size === 'half';
  const borderColor = teamColor || player.color;

  const closedTrades = player.trades
    .filter((t) => t.action === 'close')
    .slice(-5)
    .reverse();

  return (
    <motion.div
      layout
      layoutId={`arena-${player.id}`}
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ layout: { type: 'spring', stiffness: 300, damping: 30 } }}
      className={`relative rounded-2xl border-2 overflow-hidden h-full flex flex-col ${
        player.rank === 1
          ? 'bg-gradient-to-br from-gray-900 to-amber-950/10'
          : 'bg-gray-900/90'
      }`}
      style={{
        borderColor: `${borderColor}40`,
        boxShadow: `0 0 30px ${borderColor}10`,
      }}
    >
      <div className="h-1.5 w-full" style={{ background: `linear-gradient(90deg, ${borderColor}, ${borderColor}60)` }} />

      <div className={`flex-1 flex flex-col overflow-hidden ${isFull ? 'p-6' : 'p-5'}`}>
        {/* Header */}
        <div className={`flex items-start justify-between ${isFull ? 'mb-5' : 'mb-4'}`}>
          <div className={`flex items-center ${isFull ? 'gap-4' : 'gap-3'}`}>
            <PlayerAvatar name={player.name} color={player.color} avatar={player.avatar} size={isFull ? 'lg' : 'md'} glow />
            <div>
              <div className={`font-bold text-white ${isFull ? 'text-xl' : 'text-lg'}`}>{player.name}</div>
              <div className={`mt-1 text-gray-500 flex items-center gap-1.5 ${isFull ? 'text-sm' : 'text-xs'}`}>
                <span className={`rounded-full ${isFull ? 'w-2 h-2' : 'w-1.5 h-1.5'} ${player.connected ? 'bg-green-400' : 'bg-red-400'}`} />
                #{player.rank}
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            {player.badges.map((b) => (
              <motion.span key={b.type} initial={{ scale: 0 }} animate={{ scale: 1 }} className={isFull ? 'text-2xl' : 'text-xl'} title={b.label}>
                {b.icon}
              </motion.span>
            ))}
          </div>
        </div>

        {/* PNL */}
        <div className={`${isFull ? 'mb-5' : 'mb-4'} ${side === 'right' ? 'text-right' : side === 'left' ? 'text-left' : 'text-center'}`}>
          <motion.div
            key={player.pnl}
            initial={{ scale: 1.05 }}
            animate={{ scale: 1 }}
            className={`font-rajdhani font-bold ${isFull ? 'text-5xl' : 'text-3xl'} ${isPositive ? 'text-green-400' : 'text-red-400'}`}
            style={{ textShadow: isPositive ? '0 0 30px rgba(34,197,94,0.3)' : '0 0 30px rgba(239,68,68,0.3)' }}
          >
            {formatPnl(player.pnl)}
          </motion.div>
          <div className={`font-medium ${isFull ? 'text-lg' : 'text-sm'} ${isPositive ? 'text-green-500/70' : 'text-red-500/70'}`}>
            {formatPercent(player.pnlPercent)}
          </div>
        </div>

        {/* Progress */}
        <div className={`w-full bg-gray-800/80 rounded-full overflow-hidden ${isFull ? 'h-2.5 mb-5' : 'h-2 mb-4'}`}>
          <motion.div
            className={`h-full rounded-full ${isPositive ? 'bg-gradient-to-r from-green-500 to-emerald-400' : 'bg-gradient-to-r from-red-500 to-rose-400'}`}
            animate={{ width: `${Math.min(Math.abs(player.pnlPercent) * 10, 100)}%` }}
            transition={{ type: 'spring', stiffness: 100 }}
          />
        </div>

        {/* Stats */}
        <div className={`grid grid-cols-2 gap-3 ${isFull ? 'mb-5' : 'mb-4'}`}>
          <div className={`rounded-2xl border border-gray-800/50 bg-gray-800/25 px-4 text-center ${isFull ? 'py-3.5' : 'py-3'}`}>
            <div className={`text-gray-500 uppercase tracking-[0.16em] ${isFull ? 'text-[10px] mb-1' : 'text-[9px] mb-0.5'}`}>Balance</div>
            <div className={`font-semibold text-white font-rajdhani ${isFull ? 'text-lg' : 'text-sm'}`}>
              ${formatUSD(player.currentBalance)}
            </div>
          </div>
          <div className={`rounded-2xl border border-gray-800/50 bg-gray-800/25 px-4 text-center ${isFull ? 'py-3.5' : 'py-3'}`}>
            <div className={`text-gray-500 uppercase tracking-[0.16em] ${isFull ? 'text-[10px] mb-1' : 'text-[9px] mb-0.5'}`}>Trades</div>
            <div className={`font-semibold text-white font-rajdhani ${isFull ? 'text-lg' : 'text-sm'}`}>
              {player.tradeCount}
            </div>
          </div>
        </div>

        {/* Two sections: open + closed */}
        <div className="flex-1 flex flex-col gap-4 min-h-0 overflow-y-auto scrollbar-hide pr-1">
          {/* Open positions */}
          <div className="rounded-2xl border border-gray-800/50 bg-gray-900/35 px-4 py-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              <span className="text-[10px] text-gray-500 uppercase tracking-wider">
                Positions actives ({player.openPositions.length})
              </span>
            </div>
            {player.openPositions.length > 0 ? (
              <div className="space-y-2.5">
                {player.openPositions.map((pos) => (
                  <PositionRow key={pos.pair} position={pos} />
                ))}
              </div>
            ) : (
              <div className="rounded-2xl bg-gray-800/20 px-4 py-4 text-center text-sm text-gray-600">
                Aucune position
              </div>
            )}
          </div>

          {/* Closed trades */}
          {closedTrades.length > 0 && (
            <div className="rounded-2xl border border-gray-800/40 bg-gray-900/25 px-4 py-4">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-1.5 h-1.5 rounded-full bg-gray-500" />
                <span className="text-[10px] text-gray-500 uppercase tracking-wider">
                  Trades fermés ({closedTrades.length})
                </span>
              </div>
              <div className="space-y-2">
                {closedTrades.map((t) => (
                  <ClosedTradeRow key={t.id} trade={t} />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
