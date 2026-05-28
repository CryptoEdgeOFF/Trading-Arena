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
    <div className="ticker">
      <motion.div
        className="flex items-center gap-7 h-full whitespace-nowrap pl-20 pr-20"
        animate={{ x: ['0%', '-50%'] }}
        transition={{ duration: 38, repeat: Infinity, ease: 'linear' }}
      >
        {items.map((pos, i) => {
          const isLong = pos.side === 'long';
          const isProfit = pos.pnl >= 0;
          return (
            <div key={`${pos.pair}-${i}`} className="flex items-center gap-2 text-[11px] shrink-0">
              <div
                className="w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: pos.playerColor, boxShadow: `0 0 6px ${pos.playerColor}` }}
              />
              <span className="text-zinc-500 tracking-wide">{pos.playerName}</span>
              <span
                className={`font-mono text-[9px] font-bold tracking-[0.16em] uppercase ${
                  isLong ? 'text-emerald-400' : 'text-red-400'
                }`}
              >
                {isLong ? 'LONG' : 'SHORT'}
              </span>
              <span className="num text-white font-medium">{pos.pair}</span>
              <span className={`num font-bold ${isProfit ? 'text-emerald-400' : 'text-red-400'}`}>
                {isProfit ? '+' : ''}
                {pos.pnl.toFixed(2)}$
              </span>
              <span className="text-zinc-700">·</span>
            </div>
          );
        })}
      </motion.div>
    </div>
  );
}
