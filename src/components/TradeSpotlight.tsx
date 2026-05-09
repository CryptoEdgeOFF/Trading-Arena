import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useGameStore } from '../stores/useGameStore';
import type { SpotlightTrade } from '../stores/useGameStore';
import PlayerAvatar from './PlayerAvatar';
import { formatUSD } from '../utils/formatters';

const DISPLAY_DURATION = 5000;

export default function TradeSpotlight() {
  const spotlightQueue = useGameStore((s) => s.spotlightQueue);
  const shiftSpotlight = useGameStore((s) => s.shiftSpotlight);
  const [current, setCurrent] = useState<SpotlightTrade | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (current || spotlightQueue.length === 0) return;
    const next = spotlightQueue[0];
    shiftSpotlight();
    setCurrent(next);
  }, [spotlightQueue, current, shiftSpotlight]);

  useEffect(() => {
    if (!current) return;
    timerRef.current = setTimeout(() => setCurrent(null), DISPLAY_DURATION);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [current]);

  const isOpen = current?.action === 'open';
  const isLong = current?.side === 'long';

  return (
    <AnimatePresence>
      {current && (
        <motion.div
          key={current.id}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
        >
          <motion.div
            initial={{ scale: 0.7, y: 60 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.85, y: -30, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 180, damping: 22 }}
            className="relative w-[640px] rounded-3xl border-2 overflow-hidden"
            style={{
              borderColor: current.playerColor,
              background: 'linear-gradient(135deg, #0f0f0f 0%, #1a1a2e 100%)',
              boxShadow: `0 0 80px ${current.playerColor}30, 0 0 160px ${current.playerColor}15, inset 0 1px 0 rgba(255,255,255,0.05)`,
            }}
          >
            {/* Action banner */}
            <div
              className={`w-full py-3 text-center text-sm font-bold uppercase tracking-[0.2em] ${
                isOpen
                  ? 'bg-gradient-to-r from-blue-600 to-blue-500 text-white'
                  : 'bg-gradient-to-r from-orange-600 to-orange-500 text-white'
              }`}
            >
              {isOpen ? 'NOUVELLE POSITION' : 'POSITION FERMÉE'}
            </div>

            <div className="px-10 py-8">
              {/* Player info */}
              <div className="flex items-center gap-5 mb-8">
                <PlayerAvatar
                  name={current.playerName}
                  color={current.playerColor}
                  avatar={current.playerAvatar}
                  size="lg"
                  glow
                />
                <div>
                  <div className="text-3xl font-bold text-white leading-tight">
                    {current.playerName}
                  </div>
                  <div className="text-base text-gray-400 mt-1">
                    {isOpen ? 'vient d\'ouvrir une position' : 'vient de fermer une position'}
                  </div>
                </div>
              </div>

              {/* Direction + Pair */}
              <div className="flex items-center gap-5 mb-8">
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ delay: 0.15, type: 'spring' }}
                  className={`text-lg font-bold px-5 py-2.5 rounded-xl ${
                    isLong
                      ? 'bg-green-500/15 text-green-400 border border-green-500/25'
                      : 'bg-red-500/15 text-red-400 border border-red-500/25'
                  }`}
                >
                  {isLong ? '▲ LONG' : '▼ SHORT'}
                </motion.div>

                <motion.div
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.25 }}
                  className="text-5xl font-rajdhani font-bold text-white tracking-wide"
                >
                  {current.pair}
                </motion.div>
              </div>

              {/* Details grid */}
              <div className="grid grid-cols-2 gap-5">
                <motion.div
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.35 }}
                  className="bg-white/5 rounded-xl p-5 border border-white/5"
                >
                  <div className="text-xs text-gray-500 uppercase tracking-wider mb-2">
                    Taille
                  </div>
                  <div className="text-3xl font-rajdhani font-bold text-white">
                    {current.size}
                  </div>
                </motion.div>

                <motion.div
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.45 }}
                  className="bg-white/5 rounded-xl p-5 border border-white/5"
                >
                  {isOpen && current.entryPrice > 0 ? (
                    <>
                      <div className="text-xs text-gray-500 uppercase tracking-wider mb-2">
                        Prix d'entrée
                      </div>
                      <div className="text-3xl font-rajdhani font-bold text-white">
                        ${formatUSD(current.entryPrice)}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="text-xs text-gray-500 uppercase tracking-wider mb-2">
                        PnL
                      </div>
                      <div className={`text-3xl font-rajdhani font-bold ${
                        current.pnl >= 0 ? 'text-green-400' : 'text-red-400'
                      }`}>
                        {current.pnl >= 0 ? '+' : ''}{current.pnl.toFixed(2)}$
                      </div>
                    </>
                  )}
                </motion.div>
              </div>
            </div>

            {/* Timer bar */}
            <motion.div
              className="h-1.5"
              style={{ background: current.playerColor }}
              initial={{ width: '100%' }}
              animate={{ width: '0%' }}
              transition={{ duration: DISPLAY_DURATION / 1000, ease: 'linear' }}
            />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
