import { motion, AnimatePresence } from 'framer-motion';
import { useGameStore } from '../stores/useGameStore';
import { formatPnl, timeAgo } from '../utils/formatters';

export default function TradesFeed() {
  const recentTrades = useGameStore((s) => s.recentTrades);
  const display = recentTrades.slice(0, 30);

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="micro text-zinc-500 mb-0.5">Live Feed</div>
          <h3 className="display text-lg font-bold tracking-[0.04em] text-white uppercase">
            Trades
          </h3>
        </div>
        <span className="num text-[11px] text-red-300/80 tabular-nums">
          {display.length}
        </span>
      </div>

      <div className="flex-1 space-y-1 overflow-y-auto pr-1 scrollbar-hide">
        <AnimatePresence initial={false}>
          {display.map((trade) => {
            const isOpen = trade.action === 'open';
            const isLong = trade.side === 'long';
            const profitable = trade.pnl >= 0;

            return (
              <motion.div
                key={trade.id}
                initial={{ opacity: 0, x: 28, height: 0 }}
                animate={{ opacity: 1, x: 0, height: 'auto' }}
                exit={{ opacity: 0, x: -28, height: 0 }}
                transition={{ type: 'spring', stiffness: 320, damping: 30 }}
                className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-white/[0.04] bg-black/30 hover:border-red-500/25 hover:bg-red-500/[0.04] transition-colors"
              >
                <div
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{
                    backgroundColor: trade.playerColor,
                    boxShadow: `0 0 8px ${trade.playerColor}90`,
                  }}
                />

                <span className="text-[11px] text-zinc-400 w-16 truncate font-medium">
                  {trade.playerName}
                </span>

                <span
                  className={`text-[8.5px] font-bold px-1.5 py-0.5 rounded tracking-[0.16em] uppercase font-mono ${
                    isOpen
                      ? 'bg-red-500/15 text-red-300 border border-red-500/30'
                      : 'bg-zinc-700/40 text-zinc-300 border border-zinc-600/50'
                  }`}
                >
                  {isOpen ? 'OPEN' : 'CLOSE'}
                </span>

                <span
                  className={`text-[9px] font-bold tracking-[0.16em] ${
                    isLong ? 'text-emerald-400' : 'text-red-400'
                  }`}
                >
                  {isLong ? 'L' : 'S'}
                </span>

                <span className="num text-[12px] text-white font-medium flex-1 truncate">
                  {trade.pair}
                </span>

                {!isOpen && trade.pnl !== 0 && (
                  <span
                    className={`num text-[11px] font-bold ${
                      profitable ? 'text-emerald-400' : 'text-red-400'
                    }`}
                  >
                    {formatPnl(trade.pnl)}
                  </span>
                )}

                <span className="text-[9.5px] text-zinc-600 w-12 text-right shrink-0 tabular-nums">
                  {timeAgo(trade.time)}
                </span>
              </motion.div>
            );
          })}
        </AnimatePresence>

        {display.length === 0 && (
          <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-white/[0.06] bg-white/[0.005] px-4 py-10 text-center text-xs text-zinc-600">
            En attente de la première position...
          </div>
        )}
      </div>
    </div>
  );
}
