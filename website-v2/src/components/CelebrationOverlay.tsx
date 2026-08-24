import { useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import confetti from 'canvas-confetti';
import { useGameStore } from '../stores/useGameStore';

export default function CelebrationOverlay() {
  const celebrationQueue = useGameStore((s) => s.celebrationQueue);
  const shiftCelebration = useGameStore((s) => s.shiftCelebration);
  const players = useGameStore((s) => s.players);

  const current = celebrationQueue[0] || null;

  const fireConfetti = useCallback(() => {
    const duration = 3000;
    const end = Date.now() + duration;

    const frame = () => {
      confetti({
        particleCount: 3,
        angle: 60,
        spread: 55,
        origin: { x: 0, y: 0.7 },
        colors: ['#6366f1', '#a855f7', '#eab308', '#22c55e'],
      });
      confetti({
        particleCount: 3,
        angle: 120,
        spread: 55,
        origin: { x: 1, y: 0.7 },
        colors: ['#6366f1', '#a855f7', '#eab308', '#22c55e'],
      });

      if (Date.now() < end) requestAnimationFrame(frame);
    };
    frame();
  }, []);

  useEffect(() => {
    if (!current) return;

    if (current.type === 'leader-change') {
      fireConfetti();
    }

    const timer = setTimeout(() => {
      shiftCelebration();
    }, 4000);

    return () => clearTimeout(timer);
  }, [current, fireConfetti, shiftCelebration]);

  const currentPlayer = current
    ? players.find((p) => p.id === current.playerId)
    : null;

  return (
    <AnimatePresence>
      {current && current.type === 'leader-change' && currentPlayer && (
        <motion.div
          key={current.playerId}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] pointer-events-none flex items-center justify-center"
        >
          {/* Flash overlay */}
          <motion.div
            className="absolute inset-0 bg-amber-400/10"
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 0.3, 0] }}
            transition={{ duration: 1 }}
          />

          {/* New leader announcement */}
          <motion.div
            initial={{ scale: 0, rotate: -10 }}
            animate={{ scale: 1, rotate: 0 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 200, damping: 15 }}
            className="relative"
          >
            <div className="text-center">
              <motion.div
                initial={{ y: -20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.2 }}
                className="text-amber-400 text-sm font-bold uppercase tracking-[0.3em] mb-2"
              >
                Nouveau Leader
              </motion.div>
              <motion.div
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 0.4, type: 'spring' }}
                className="font-rajdhani text-6xl font-bold text-white mb-2"
                style={{
                  textShadow: `0 0 40px ${currentPlayer.color}80, 0 0 80px ${currentPlayer.color}40`,
                }}
              >
                {currentPlayer.name}
              </motion.div>
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: '100%' }}
                transition={{ delay: 0.6, duration: 0.5 }}
                className="h-0.5 bg-gradient-to-r from-transparent via-amber-400 to-transparent mx-auto"
              />
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
