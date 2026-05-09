import { motion, AnimatePresence } from 'framer-motion';
import { useGameStore } from '../stores/useGameStore';
import { formatPnl, timeAgo } from '../utils/formatters';

export default function TradesFeed() {
  const recentTrades = useGameStore((s) => s.recentTrades);
  const display = recentTrades.slice(0, 20);

  return (
    <div className="w-full">
      <h2 className="font-rajdhani text-lg font-bold text-white uppercase tracking-wider mb-3 px-2">
        Activité en direct
      </h2>
      <div className="space-y-1 max-h-[calc(100vh-200px)] overflow-hidden">
        <AnimatePresence initial={false}>
          {display.map((trade) => {
            const isOpen = trade.action === 'open';
            const isLong = trade.side === 'long';

            return (
              <motion.div
                key={trade.id}
                initial={{ opacity: 0, x: 50, height: 0 }}
                animate={{ opacity: 1, x: 0, height: 'auto' }}
                exit={{ opacity: 0, x: -50, height: 0 }}
                transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-900/50 border border-gray-800/30"
              >
                {/* Player dot */}
                <div
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{
                    backgroundColor: trade.playerColor,
                    boxShadow: `0 0 8px ${trade.playerColor}60`,
                  }}
                />

                {/* Player name */}
                <span className="text-xs text-gray-400 w-20 truncate">
                  {trade.playerName}
                </span>

                {/* Action */}
                <span
                  className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                    isOpen
                      ? 'bg-blue-500/20 text-blue-400'
                      : 'bg-orange-500/20 text-orange-400'
                  }`}
                >
                  {isOpen ? 'OPEN' : 'CLOSE'}
                </span>

                {/* Direction */}
                <span
                  className={`text-[10px] font-bold ${
                    isLong ? 'text-green-400' : 'text-red-400'
                  }`}
                >
                  {isLong ? 'LONG' : 'SHORT'}
                </span>

                {/* Pair */}
                <span className="text-sm text-white font-medium flex-1 truncate">
                  {trade.pair}
                </span>

                {/* PnL if close */}
                {!isOpen && trade.pnl !== 0 && (
                  <span
                    className={`text-xs font-semibold ${
                      trade.pnl >= 0 ? 'text-green-400' : 'text-red-400'
                    }`}
                  >
                    {formatPnl(trade.pnl)}
                  </span>
                )}

                {/* Time */}
                <span className="text-[10px] text-gray-600 w-14 text-right shrink-0">
                  {timeAgo(trade.time)}
                </span>
              </motion.div>
            );
          })}
        </AnimatePresence>
        {display.length === 0 && (
          <div className="text-center py-8 text-gray-600 text-sm">
            En attente de la première position...
          </div>
        )}
      </div>
    </div>
  );
}
