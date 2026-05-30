import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { EVENT_INTRO_COUNTDOWN_MS, EVENT_INTRO_COUNTDOWN_SEC } from '../utils/liveEvent';

const BTF_LOGO_SRC = '/assets/pictures/btf-dashboard.webp';
const KRAKEN_LOGO_SRC = '/assets/pictures/kraken-logo-white.webp';
const GO_SCREEN_DURATION_MS = 1800;

type TraderInfo = {
  name: string;
  avatar: string | null;
  color: string;
};

type Phase = 'standby' | 'countdown' | 'go' | 'done';

/**
 * Overlay plein écran sur le terminal LIVE d'un trader (sans son) :
 * - avant le départ : photo + nom + « LE FIGHT VA COMMENCER… »
 * - au lancement : décompte 15 → 0 synchronisé sur `eventStartTime`
 * - « LE FIGHT COMMENCE ! » puis libération du terminal
 */
export default function LiveEventTraderOverlay({
  trader,
  eventStarted,
  eventStartTime,
}: {
  trader: TraderInfo;
  eventStarted: boolean;
  eventStartTime: number | null;
}) {
  const [phase, setPhase] = useState<Phase>('standby');
  const [countdownValue, setCountdownValue] = useState(EVENT_INTRO_COUNTDOWN_SEC);
  const goTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Détermine la phase à partir de l'état serveur (synchronisé via WebSocket).
  useEffect(() => {
    if (!eventStarted || eventStartTime == null) {
      setPhase('standby');
      return;
    }

    const unlockAt = eventStartTime + EVENT_INTRO_COUNTDOWN_MS;

    const evaluate = () => {
      const remainingMs = unlockAt - Date.now();
      if (remainingMs <= 0) {
        // Le décompte est terminé : court flash "GO" si on vient de la phase
        // countdown, sinon (trader arrivé en retard) on libère directement.
        setPhase((prev) => (prev === 'countdown' ? 'go' : 'done'));
        setCountdownValue(0);
        return false;
      }
      setPhase('countdown');
      setCountdownValue(Math.max(1, Math.ceil(remainingMs / 1000)));
      return true;
    };

    if (!evaluate()) return;

    const id = setInterval(() => {
      if (!evaluate()) clearInterval(id);
    }, 250);
    return () => clearInterval(id);
  }, [eventStarted, eventStartTime]);

  // Flash "LE FIGHT COMMENCE !" puis libération du terminal.
  useEffect(() => {
    if (phase !== 'go') return;
    goTimerRef.current = setTimeout(() => setPhase('done'), GO_SCREEN_DURATION_MS);
    return () => {
      if (goTimerRef.current) clearTimeout(goTimerRef.current);
    };
  }, [phase]);

  if (phase === 'done') return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35 }}
      className="fixed inset-0 z-[200] flex items-center justify-center bg-[#05030a]/95 backdrop-blur-md"
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(circle at 50% 45%, rgba(220,38,38,0.22), transparent 60%)' }}
      />
      <div
        className="pointer-events-none absolute top-0 left-0 right-0 h-1.5"
        style={{ background: 'linear-gradient(90deg, transparent, #ef4444, transparent)' }}
      />
      <div
        className="pointer-events-none absolute bottom-0 left-0 right-0 h-1.5"
        style={{ background: 'linear-gradient(90deg, transparent, #ef4444, transparent)' }}
      />

      <div className="relative w-full max-w-md px-6 text-center">
        <motion.div
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="mb-7 flex items-center justify-center gap-8"
        >
          <img src={BTF_LOGO_SRC} alt="" aria-hidden className="h-14 w-14 object-contain drop-shadow-[0_0_28px_rgba(220,38,38,0.55)]" />
          <img src={KRAKEN_LOGO_SRC} alt="" aria-hidden className="max-h-7 w-20 object-contain opacity-90" />
        </motion.div>

        <AnimatePresence mode="wait">
          {phase === 'standby' && (
            <StandbyContent key="standby" trader={trader} />
          )}
          {phase === 'countdown' && (
            <CountdownContent key="countdown" value={countdownValue} />
          )}
          {phase === 'go' && <GoContent key="go" />}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

function TraderBadge({ trader, size = 132 }: { trader: TraderInfo; size?: number }) {
  return (
    <div className="relative mx-auto" style={{ width: size, height: size }}>
      <div
        className="absolute -inset-3 rounded-full opacity-70 blur-xl"
        style={{ background: `radial-gradient(circle, ${trader.color}88, transparent 70%)` }}
      />
      <div
        className="relative h-full w-full overflow-hidden rounded-2xl border-4"
        style={{ borderColor: trader.color, boxShadow: `0 20px 50px -12px ${trader.color}aa` }}
      >
        {trader.avatar ? (
          <img src={trader.avatar} alt={trader.name} className="h-full w-full object-cover" />
        ) : (
          <div
            className="flex h-full w-full items-center justify-center font-rajdhani text-5xl font-bold text-white"
            style={{ background: trader.color }}
          >
            {trader.name.charAt(0).toUpperCase()}
          </div>
        )}
      </div>
    </div>
  );
}

function StandbyContent({ trader }: { trader: TraderInfo }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
    >
      <motion.div
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.1, type: 'spring', stiffness: 220, damping: 16 }}
      >
        <TraderBadge trader={trader} />
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="mt-6 font-rajdhani text-3xl font-bold uppercase tracking-[0.04em] text-white"
      >
        {trader.name}
      </motion.div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.45 }}
        className="mx-auto my-6 h-px w-44 bg-gradient-to-r from-transparent via-red-500/70 to-transparent"
      />

      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.55 }}
        className="font-rajdhani text-2xl font-bold uppercase tracking-[0.12em]"
        style={{
          background: 'linear-gradient(180deg, #ffffff 0%, #fca5a5 55%, #dc2626 100%)',
          WebkitBackgroundClip: 'text',
          backgroundClip: 'text',
          color: 'transparent',
        }}
      >
        Le fight va commencer
      </motion.div>

      <motion.div
        className="mt-4 flex items-center justify-center gap-1.5"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.7 }}
      >
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="h-2 w-2 rounded-full bg-red-500"
            animate={{ opacity: [0.25, 1, 0.25] }}
            transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
          />
        ))}
      </motion.div>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.8 }}
        className="mt-7 text-[11px] uppercase tracking-[0.3em] text-zinc-500"
      >
        En attente du lancement par l’admin
      </motion.p>
    </motion.div>
  );
}

function CountdownContent({ value }: { value: number }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="font-rajdhani mb-6 text-sm font-semibold uppercase tracking-[0.42em] text-red-300">
        Le fight démarre dans
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={value}
          initial={{ scale: 0.4, opacity: 0, rotateX: -90 }}
          animate={{ scale: 1, opacity: 1, rotateX: 0 }}
          exit={{ scale: 1.6, opacity: 0, rotateX: 90 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          className="font-rajdhani tabular-nums"
          style={{
            fontSize: 'clamp(120px, 40vw, 220px)',
            fontWeight: 700,
            lineHeight: 0.85,
            background: 'linear-gradient(180deg, #ffffff 0%, #fca5a5 35%, #dc2626 70%, #7f1d1d 100%)',
            WebkitBackgroundClip: 'text',
            backgroundClip: 'text',
            color: 'transparent',
            filter: 'drop-shadow(0 24px 48px rgba(220,38,38,0.7))',
          }}
        >
          {value}
        </motion.div>
      </AnimatePresence>

      <div className="mx-auto mt-8 h-1 w-56 overflow-hidden rounded-full bg-white/10">
        <motion.div
          className="h-full bg-gradient-to-r from-red-700 via-red-500 to-red-700"
          animate={{ width: `${((EVENT_INTRO_COUNTDOWN_SEC - value) / EVENT_INTRO_COUNTDOWN_SEC) * 100}%` }}
          transition={{ duration: 0.4, ease: 'linear' }}
        />
      </div>
    </motion.div>
  );
}

function GoContent() {
  return (
    <motion.div
      initial={{ scale: 0.6, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ scale: 1.25, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 260, damping: 16 }}
    >
      <div className="font-rajdhani mb-4 text-sm font-semibold uppercase tracking-[0.42em] text-red-300">
        Breakout Trading Fight
      </div>
      <div
        className="font-rajdhani inline-block overflow-visible px-[0.08em] font-bold uppercase"
        style={{
          fontSize: 'clamp(44px, 12vw, 92px)',
          letterSpacing: '0.03em',
          lineHeight: 0.95,
          background: 'linear-gradient(180deg, #ffffff 0%, #fecaca 50%, #ef4444 100%)',
          WebkitBackgroundClip: 'text',
          backgroundClip: 'text',
          color: 'transparent',
          filter: 'drop-shadow(0 18px 50px rgba(220,38,38,0.8))',
          WebkitBoxDecorationBreak: 'clone',
          boxDecorationBreak: 'clone',
        }}
      >
        Le fight commence&nbsp;!
      </div>
      <div className="mt-5 text-[11px] uppercase tracking-[0.32em] text-zinc-400">
        Ton terminal est ouvert
      </div>
    </motion.div>
  );
}
