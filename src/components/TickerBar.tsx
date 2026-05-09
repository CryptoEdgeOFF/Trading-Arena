import { motion } from 'framer-motion';
import { useGameStore } from '../stores/useGameStore';

export default function TickerBar() {
  const players = useGameStore((s) => s.players);

  const allPositions = players.flatMap((p) =>
    p.openPositions.map((pos) => ({
      ...pos,
      playerName: p.name,
      playerColor: p.color,
    }))
  );

  if (allPositions.length === 0) return null;

  const items = [...allPositions, ...allPositions];

  return (
    <div className="h-8 bg-gray-900/80 border-t border-gray-800/50 overflow-hidden relative">
      <div className="absolute left-0 top-0 bottom-0 w-16 bg-gradient-to-r from-gray-900 to-transparent z-10" />
      <div className="absolute right-0 top-0 bottom-0 w-16 bg-gradient-to-l from-gray-900 to-transparent z-10" />

      <motion.div
        className="flex items-center gap-8 h-full whitespace-nowrap"
        animate={{ x: ['0%', '-50%'] }}
        transition={{ duration: 30, repeat: Infinity, ease: 'linear' }}
      >
        {items.map((pos, i) => {
          const isLong = pos.side === 'long';
          const isProfit = pos.pnl >= 0;
          return (
            <div key={`${pos.pair}-${i}`} className="flex items-center gap-2 text-xs shrink-0">
              <div
                className="w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: pos.playerColor }}
              />
              <span className="text-gray-500">{pos.playerName}</span>
              <span
                className={`font-bold ${isLong ? 'text-green-400' : 'text-red-400'}`}
              >
                {isLong ? 'LONG' : 'SHORT'}
              </span>
              <span className="text-white font-medium">{pos.pair}</span>
              <span className={`font-semibold ${isProfit ? 'text-green-400' : 'text-red-400'}`}>
                {isProfit ? '+' : ''}{pos.pnl.toFixed(2)}$
              </span>
            </div>
          );
        })}
      </motion.div>
    </div>
  );
}
