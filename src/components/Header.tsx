import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useGameStore } from '../stores/useGameStore';
import { formatTime } from '../utils/formatters';

const BTF_LOGO_SRC = '/assets/pictures/btf-dashboard.webp';
const KRAKEN_LOGO_SRC = '/assets/pictures/kraken-logo-white.webp';

export default function Header() {
  const { eventStarted, eventStartTime, eventEndTime, players, platformMode } = useGameStore();
  const [now, setNow] = useState(Date.now());
  const [isFullscreen, setIsFullscreen] = useState(
    typeof document !== 'undefined' && Boolean(document.fullscreenElement),
  );

  useEffect(() => {
    if (!eventStarted) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [eventStarted]);

  useEffect(() => {
    const handleChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', handleChange);
    return () => document.removeEventListener('fullscreenchange', handleChange);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch (err) {
      console.warn('Fullscreen toggle failed:', err);
    }
  }, []);

  const activePlayers = players.filter((p) => p.connected).length;
  const countdownMode = eventStarted && eventEndTime != null;
  const remainingMs = countdownMode ? Math.max(0, eventEndTime - now) : 0;
  const elapsedMs = eventStarted && eventStartTime ? now - eventStartTime : 0;
  const timerMs = countdownMode ? remainingMs : elapsedMs;
  const timerLabel = countdownMode ? 'Temps restant' : 'Temps écoulé';
  const isWarn = countdownMode && remainingMs <= 60_000;

  return (
    <header className="command-bar relative z-10">
      {/* Brand */}
      <motion.div
        className="relative flex items-center gap-4"
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
      >
        <div className="brand-mark">
          <img src="/assets/pictures/logoBTF.webp" alt="BTF" />
        </div>
        <div>
          <div className="micro mb-0.5 text-red-300/70">Breakout Trading Fight</div>
          <h1 className="display text-3xl font-bold tracking-[0.05em] text-white leading-none">
            ARENA <span className="text-red-500">·</span> LIVE
          </h1>
          <div className="mt-1.5 flex items-center gap-2">
            <span className={`live-pill ${eventStarted ? 'is-live' : 'is-idle'}`}>
              {eventStarted ? <span className="live-dot" /> : <span className="h-1.5 w-1.5 rounded-full bg-zinc-600" />}
              {eventStarted ? 'On Air' : 'Standby'}
            </span>
            <span className="live-pill is-idle text-zinc-400">{platformMode}</span>
          </div>
        </div>
      </motion.div>

      {/* Timer + logos partenaires */}
      <motion.div
        className="flex items-center gap-3 xl:gap-4"
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <img
          src={BTF_LOGO_SRC}
          alt=""
          aria-hidden
          className="h-10 w-10 shrink-0 object-contain opacity-90 drop-shadow-[0_0_20px_rgba(220,38,38,0.4)] xl:h-11 xl:w-11"
        />
        <div className={`timer-frame ${isWarn ? 'is-warn' : ''}`}>
          <div className="timer-label mb-0.5">{timerLabel}</div>
          <div className="timer-value tabular-nums">{formatTime(timerMs)}</div>
        </div>
        <img
          src={KRAKEN_LOGO_SRC}
          alt=""
          aria-hidden
          className="max-h-7 w-[4.5rem] shrink-0 object-contain opacity-85 xl:max-h-8 xl:w-20"
        />
      </motion.div>

      {/* Player count */}
      <motion.div
        className="relative flex items-center gap-4"
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
      >
        <div className="text-right">
          <div className="micro text-zinc-500">Traders en arène</div>
          <div className="display text-3xl font-bold text-white leading-none">
            {activePlayers}
            <span className="text-zinc-600">/{players.length}</span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-1 rounded-xl border border-red-500/25 bg-black/40 p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
          {[...Array(4)].map((_, i) => (
            <div
              key={i}
              className={`w-2.5 h-2.5 rounded-sm transition-colors ${
                i < Math.min(activePlayers, 4)
                  ? 'bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.7)]'
                  : 'bg-zinc-800'
              }`}
            />
          ))}
        </div>

        <button
          type="button"
          onClick={toggleFullscreen}
          aria-label={isFullscreen ? 'Quitter le plein écran' : 'Activer le plein écran'}
          title={isFullscreen ? 'Quitter le plein écran' : 'Plein écran'}
          className="group relative flex h-11 w-11 items-center justify-center rounded-xl border border-red-500/25 bg-black/40 text-zinc-300 transition-colors hover:border-red-500/55 hover:text-white hover:bg-red-500/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
        >
          {isFullscreen ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 3v3a2 2 0 0 1-2 2H3" />
              <path d="M21 8h-3a2 2 0 0 1-2-2V3" />
              <path d="M3 16h3a2 2 0 0 1 2 2v3" />
              <path d="M16 21v-3a2 2 0 0 1 2-2h3" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 8V5a2 2 0 0 1 2-2h3" />
              <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
              <path d="M3 16v3a2 2 0 0 0 2 2h3" />
              <path d="M21 16v3a2 2 0 0 1-2 2h-3" />
            </svg>
          )}
        </button>
      </motion.div>
    </header>
  );
}
