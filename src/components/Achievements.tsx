import { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useGameStore } from '../stores/useGameStore';

export default function Achievements() {
  const badgeQueue = useGameStore((s) => s.badgeQueue);
  const shiftBadgeQueue = useGameStore((s) => s.shiftBadgeQueue);

  const current = badgeQueue[0] || null;

  useEffect(() => {
    if (!current) return;
    const timer = setTimeout(() => {
      shiftBadgeQueue();
    }, 4000);
    return () => clearTimeout(timer);
  }, [current, shiftBadgeQueue]);

  return (
    <div className="fixed top-24 right-8 z-50 w-80">
      <AnimatePresence>
        {current && (
          <motion.div
            key={`${current.playerId}-${current.badge.type}`}
            initial={{ opacity: 0, x: 100, scale: 0.8 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 100, scale: 0.8 }}
            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
            className="relative overflow-hidden rounded-xl border border-amber-500/30 bg-gradient-to-r from-gray-900 to-amber-950/30 p-4 shadow-2xl"
          >
            {/* Glow effect */}
            <motion.div
              className="absolute inset-0 bg-gradient-to-r from-amber-400/10 to-purple-400/10"
              animate={{ opacity: [0, 0.5, 0] }}
              transition={{ duration: 2, repeat: Infinity }}
            />

            <div className="relative flex items-center gap-4">
              {/* Badge icon */}
              <motion.div
                initial={{ rotate: -180, scale: 0 }}
                animate={{ rotate: 0, scale: 1 }}
                transition={{ type: 'spring', delay: 0.2 }}
                className="text-4xl"
              >
                {current.badge.icon}
              </motion.div>

              <div className="flex-1">
                <div className="text-[10px] uppercase tracking-widest text-amber-400/70 mb-0.5">
                  Achievement
                </div>
                <div className="font-rajdhani font-bold text-lg text-white">
                  {current.badge.label}
                </div>
                <div className="text-xs text-gray-400">
                  {current.playerName} — {current.badge.description}
                </div>
              </div>
            </div>

            {/* Progress bar for auto-dismiss */}
            <motion.div
              className="absolute bottom-0 left-0 h-0.5 bg-amber-400/50"
              initial={{ width: '100%' }}
              animate={{ width: '0%' }}
              transition={{ duration: 4, ease: 'linear' }}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
