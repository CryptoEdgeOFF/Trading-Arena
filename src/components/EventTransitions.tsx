import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import confetti from 'canvas-confetti';
import { useGameStore, type EventMode, type Player, type TeamInfo } from '../stores/useGameStore';
import { EVENT_INTRO_COUNTDOWN_SEC } from '../utils/liveEvent';
import {
  isIntroCountdownPlaying,
  resetArenaRoundSounds,
  startIntroCountdownMusic,
  unlockArenaSounds,
} from '../utils/arenaSounds';
import EventEndOverlay from './EventEndOverlay';

type Phase = 'idle' | 'countdown' | 'fight-start' | 'event-end';

const COUNTDOWN_FROM = EVENT_INTRO_COUNTDOWN_SEC;
const FIGHT_START_DURATION = 1800;
const BTF_LOGO_SRC = '/assets/pictures/btf-dashboard.webp';
const KRAKEN_LOGO_SRC = '/assets/pictures/kraken-logo-white.webp';

function TransitionBrandAbove({ variant = 'countdown' }: { variant?: 'countdown' | 'fight-start' }) {
  const btfClass = variant === 'fight-start'
    ? 'h-16 w-16 xl:h-20 xl:w-20'
    : 'h-20 w-20 xl:h-24 xl:w-24';
  const krakenClass = variant === 'fight-start'
    ? 'max-h-8 w-24 xl:max-h-9 xl:w-28'
    : 'max-h-10 w-28 xl:max-h-11 xl:w-32';

  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
      className="mb-6 flex items-center justify-center gap-10 sm:gap-14 xl:gap-20"
    >
      <img
        src={BTF_LOGO_SRC}
        alt=""
        aria-hidden
        className={`object-contain drop-shadow-[0_0_36px_rgba(220,38,38,0.55)] ${btfClass}`}
      />
      <img
        src={KRAKEN_LOGO_SRC}
        alt=""
        aria-hidden
        className={`object-contain opacity-90 drop-shadow-[0_0_24px_rgba(255,255,255,0.14)] ${krakenClass}`}
      />
    </motion.div>
  );
}

/**
 * Orchestre les transitions cinématiques du dashboard live :
 * - début d'événement → countdown 15→0 → flash "LE FIGHT COMMENCE !"
 * - fin d'événement → annonce du gagnant + podium/stats (individuel ou équipe)
 */
export default function EventTransitions() {
  const eventStarted = useGameStore((s) => s.eventStarted);
  const eventMode = useGameStore((s) => s.eventMode);
  const teams = useGameStore((s) => s.teams);
  const liveStateSynced = useGameStore((s) => s.liveStateSynced);
  const players = useGameStore((s) => s.players);
  const resetClientLiveState = useGameStore((s) => s.resetClientLiveState);

  const [phase, setPhase] = useState<Phase>('idle');
  const [countdownValue, setCountdownValue] = useState(COUNTDOWN_FROM);
  const [snapshotPlayers, setSnapshotPlayers] = useState<Player[] | null>(null);
  const [snapshotTeams, setSnapshotTeams] = useState<[TeamInfo, TeamInfo] | null>(null);
  const [snapshotEventMode, setSnapshotEventMode] = useState<EventMode>('1v1');
  // null = état serveur pas encore reçu. Après le 1er state:init, on
  // synchronise sans animer pour ne pas rejouer le countdown au refresh.
  const previousStartedRef = useRef<boolean | null>(null);
  // Dernier snapshot des joueurs PENDANT que l'event tournait, avec stats
  // non vides. Utilisé pour le podium/stats : le serveur purge les PnL
  // dans le même patch que `eventStarted=false`, donc on ne peut pas se
  // baser sur le state courant au moment de la transition.
  const liveSnapshotRef = useRef<Player[]>([]);
  const liveTeamsSnapshotRef = useRef<[TeamInfo, TeamInfo] | null>(null);
  const liveEventModeSnapshotRef = useRef<EventMode>('1v1');

  useEffect(() => {
    if (!eventStarted) return;
    const hasMeaningfulStats = players.some(
      (p) => p.tradeCount > 0 || p.pnl !== 0 || (p.openPositions?.length ?? 0) > 0,
    );
    if (hasMeaningfulStats || liveSnapshotRef.current.length === 0) {
      liveSnapshotRef.current = players;
    }
    if (teams) liveTeamsSnapshotRef.current = teams;
    liveEventModeSnapshotRef.current = eventMode;
  }, [eventStarted, players, teams, eventMode]);

  useEffect(() => {
    if (!liveStateSynced) return;

    const wasStarted = previousStartedRef.current;

    if (wasStarted === null) {
      previousStartedRef.current = eventStarted;
      return;
    }

    previousStartedRef.current = eventStarted;

    if (!wasStarted && eventStarted) {
      // Nouveau round : on vide les files locales pour repartir propre.
      resetClientLiveState();
      resetArenaRoundSounds();
      liveSnapshotRef.current = [];
      setSnapshotPlayers(null);
      setSnapshotTeams(null);
      setSnapshotEventMode('1v1');
      setPhase('countdown');
      setCountdownValue(COUNTDOWN_FROM);
      return;
    }

    if (wasStarted && !eventStarted) {
      const endedMode = liveEventModeSnapshotRef.current ?? eventMode;
      const endedTeams = liveTeamsSnapshotRef.current ?? teams ?? null;
      // Fin d'événement : on prend le DERNIER snapshot capturé pendant que
      // l'event tournait (avant le reset serveur). Si pour une raison
      // quelconque on n'en a pas, fallback sur l'état courant.
      const source = liveSnapshotRef.current.length > 0
        ? liveSnapshotRef.current
        : players;
      const snapshot = [...source].sort((a, b) => b.pnl - a.pnl);
      if (snapshot.length === 0) {
        setPhase('idle');
        return;
      }

      setSnapshotPlayers(snapshot);
      setSnapshotTeams(endedTeams);
      setSnapshotEventMode(endedMode);
      setPhase('event-end');
    }
  }, [liveStateSynced, eventStarted, eventMode, teams, players, resetClientLiveState]);

  // Musique du décompte 15s — retries tant que l'autoplay n'est pas débloqué.
  useEffect(() => {
    if (phase !== 'countdown') return;

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const tryStartCountdownMusic = () => {
      if (cancelled || isIntroCountdownPlaying()) return;
      unlockArenaSounds();
      void startIntroCountdownMusic().then((started) => {
        if (cancelled || started || isIntroCountdownPlaying()) return;
        retryTimer = setTimeout(tryStartCountdownMusic, 400);
      });
    };

    tryStartCountdownMusic();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [phase]);

  // Tick du countdown
  useEffect(() => {
    if (phase !== 'countdown') return;
    const id = setInterval(() => {
      setCountdownValue((value) => {
        if (value <= 1) {
          clearInterval(id);
          setPhase('fight-start');
          return 0;
        }
        return value - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [phase]);

  // Auto-transition fight-start → idle
  useEffect(() => {
    if (phase !== 'fight-start') return;
    const id = setTimeout(() => setPhase('idle'), FIGHT_START_DURATION);
    return () => clearTimeout(id);
  }, [phase]);

  return (
    <AnimatePresence mode="wait">
      {phase === 'countdown' && (
        <CountdownOverlay key="countdown" value={countdownValue} />
      )}
      {phase === 'fight-start' && (
        <FightStartOverlay key="fight-start" />
      )}
      {phase === 'event-end' && snapshotPlayers && (
        <EventEndOverlay
          key="event-end"
          players={snapshotPlayers}
          teams={snapshotTeams}
          eventMode={snapshotEventMode}
          onClose={() => setPhase('idle')}
        />
      )}
    </AnimatePresence>
  );
}

/* ---------------- Countdown 15 → 0 ---------------- */

function CountdownOverlay({ value }: { value: number }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35 }}
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/85 backdrop-blur-md"
    >
      {/* Halo radial */}
      <div className="absolute inset-0 pointer-events-none" style={{
        background: 'radial-gradient(circle at 50% 50%, rgba(220,38,38,0.25), transparent 60%)',
      }} />

      {/* Stripes diagonales */}
      <div
        className="absolute top-0 left-0 right-0 h-1.5 pointer-events-none"
        style={{ background: 'linear-gradient(90deg, transparent, #ef4444, transparent)' }}
      />
      <div
        className="absolute bottom-0 left-0 right-0 h-1.5 pointer-events-none"
        style={{ background: 'linear-gradient(90deg, transparent, #ef4444, transparent)' }}
      />

      <div className="relative text-center">
        <TransitionBrandAbove variant="countdown" />

        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="micro mb-8 text-base tracking-[0.42em] text-red-300"
        >
          LE FIGHT DÉMARRE DANS
        </motion.div>

        <AnimatePresence mode="wait">
          <motion.div
            key={value}
            initial={{ scale: 0.4, opacity: 0, rotateX: -90 }}
            animate={{ scale: 1, opacity: 1, rotateX: 0 }}
            exit={{ scale: 1.6, opacity: 0, rotateX: 90 }}
            transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
            className="display tabular-nums"
            style={{
              fontSize: 'clamp(180px, 28vw, 320px)',
              fontWeight: 700,
              lineHeight: 0.85,
              background: 'linear-gradient(180deg, #ffffff 0%, #fca5a5 35%, #dc2626 70%, #7f1d1d 100%)',
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              color: 'transparent',
              filter: 'drop-shadow(0 30px 60px rgba(220,38,38,0.7))',
            }}
          >
            {value}
          </motion.div>
        </AnimatePresence>

        <motion.div
          className="mx-auto mt-10 h-1 w-72 overflow-hidden rounded-full bg-white/10"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          <motion.div
            className="h-full bg-gradient-to-r from-red-700 via-red-500 to-red-700"
            animate={{ width: `${((COUNTDOWN_FROM - value) / COUNTDOWN_FROM) * 100}%` }}
            transition={{ duration: 0.5, ease: 'linear' }}
          />
        </motion.div>
      </div>
    </motion.div>
  );
}

/* ---------------- "LE FIGHT COMMENCE !" ---------------- */

function FightStartOverlay() {
  useEffect(() => {
    const fire = () => {
      confetti({
        particleCount: 60,
        spread: 90,
        startVelocity: 55,
        origin: { y: 0.55 },
        colors: ['#dc2626', '#ef4444', '#fca5a5', '#ffffff'],
      });
    };
    fire();
    const id = setTimeout(fire, 350);
    return () => clearTimeout(id);
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/90 backdrop-blur-lg"
    >
      <motion.div
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 1.3, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 16 }}
        className="relative overflow-visible text-center px-4"
      >
        <div className="micro mb-6 text-lg tracking-[0.42em] text-red-300">
          BREAKOUT TRADING FIGHT
        </div>
        <TransitionBrandAbove variant="fight-start" />
        <div
          className="display inline-block overflow-visible px-[0.08em]"
          style={{
            fontSize: 'clamp(72px, 10vw, 140px)',
            fontWeight: 700,
            letterSpacing: '0.04em',
            lineHeight: 0.95,
            background: 'linear-gradient(180deg, #ffffff 0%, #fecaca 50%, #ef4444 100%)',
            WebkitBackgroundClip: 'text',
            backgroundClip: 'text',
            color: 'transparent',
            filter: 'drop-shadow(0 20px 60px rgba(220,38,38,0.8))',
            WebkitBoxDecorationBreak: 'clone',
            boxDecorationBreak: 'clone',
          }}
        >
          LE FIGHT COMMENCE&nbsp;!
        </div>
        <motion.div
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: '100%', opacity: 1 }}
          transition={{ delay: 0.3, duration: 0.6 }}
          className="mx-auto mt-8 h-[3px] max-w-[480px] bg-gradient-to-r from-transparent via-red-500 to-transparent"
        />
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="mt-4 text-sm text-zinc-400 tracking-[0.32em] uppercase"
        >
          Que la guerre des PNL commence
        </motion.div>
      </motion.div>
    </motion.div>
  );
}
