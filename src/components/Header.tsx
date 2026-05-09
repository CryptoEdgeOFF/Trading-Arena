import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useGameStore } from '../stores/useGameStore';
import { formatTime } from '../utils/formatters';

export default function Header() {
  const { eventStarted, eventStartTime, players, platformMode } = useGameStore();
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!eventStarted || !eventStartTime) return;
    const interval = setInterval(() => {
      setElapsed(Date.now() - eventStartTime);
    }, 1000);
    return () => clearInterval(interval);
  }, [eventStarted, eventStartTime]);

  const activePlayers = players.filter((p) => p.connected).length;

  return (
    <header className="relative flex items-center justify-between px-8 py-4 border-b border-gray-800/50 bg-gray-950/80 backdrop-blur-sm">
      {/* Background glow */}
      <div className="absolute inset-0 bg-gradient-to-r from-indigo-600/5 via-transparent to-purple-600/5 pointer-events-none" />

      {/* Logo */}
      <div className="relative flex items-center gap-4">
        <motion.div
          className="flex items-center gap-3"
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
        >
          <img src="/src/assets/pictures/logoBTF.png" alt="BTF" className="w-10 h-10 rounded-lg object-contain" />
          <div>
            <h1 className="font-rajdhani text-2xl font-bold tracking-wide text-white">
              TRADING ARENA
            </h1>
            <div className="flex items-center gap-2 text-xs text-gray-400">
              <span className="flex items-center gap-1">
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    eventStarted ? 'bg-green-400 animate-pulse' : 'bg-gray-600'
                  }`}
                />
                {eventStarted ? 'LIVE' : 'EN ATTENTE'}
              </span>
              <span className="rounded-full border border-gray-700 px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] text-gray-300">
                {platformMode}
              </span>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Timer */}
      <motion.div
        className="relative font-rajdhani text-4xl font-bold tracking-widest tabular-nums"
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
      >
        <span className="bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">
          {formatTime(elapsed)}
        </span>
      </motion.div>

      {/* Player count */}
      <motion.div
        className="relative flex items-center gap-3"
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
      >
        <div className="text-right">
          <div className="text-2xl font-bold font-rajdhani text-white">
            {activePlayers}
            <span className="text-gray-500">/{players.length}</span>
          </div>
          <div className="text-xs text-gray-400 uppercase tracking-wider">
            Joueurs actifs
          </div>
        </div>
        <div className="w-10 h-10 rounded-lg bg-gray-800 border border-gray-700 flex items-center justify-center">
          <div className="grid grid-cols-2 gap-0.5">
            {[...Array(4)].map((_, i) => (
              <div
                key={i}
                className={`w-2 h-2 rounded-sm ${
                  i < activePlayers ? 'bg-indigo-400' : 'bg-gray-700'
                }`}
              />
            ))}
          </div>
        </div>
      </motion.div>
    </header>
  );
}
