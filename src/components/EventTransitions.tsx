import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import confetti from 'canvas-confetti';
import { useGameStore, type EventMode, type Player, type TeamInfo } from '../stores/useGameStore';
import { formatPnl, formatPercent, formatUSD } from '../utils/formatters';
import {
  isIntroCountdownPlaying,
  resetArenaRoundSounds,
  startIntroCountdownMusic,
  unlockArenaSounds,
} from '../utils/arenaSounds';
import { EVENT_INTRO_COUNTDOWN_SEC } from '../utils/liveEvent';
import { buildTeamGroups, type TeamGroup, type TeamResultPlayer } from '../utils/teamResults';

type Phase = 'idle' | 'countdown' | 'fight-start' | 'event-end';

const COUNTDOWN_FROM = EVENT_INTRO_COUNTDOWN_SEC;
const FIGHT_START_DURATION = 1800;
const WINNER_SCREEN_DURATION_MS = 4500;
const PODIUM_DURATION_MS = 5000;
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
 * - fin d'événement → annonce du gagnant + podium avec stats détaillées
 */
export default function EventTransitions() {
  const eventStarted = useGameStore((s) => s.eventStarted);
  const eventMode = useGameStore((s) => s.eventMode);
  const teams = useGameStore((s) => s.teams);
  const showcase = useGameStore((s) => s.showcase);
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
      (p) => p.tradeCount > 0 || p.pnl !== 0 || p.openPositions.length > 0,
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

      // 5v5 : le serveur pousse le showcase (même vue que l'admin) — ne pas
      // recouvrir avec le podium individuel live.
      if (endedMode === '4v4' && showcase?.archive?.eventMode === '4v4') {
        setPhase('idle');
        return;
      }

      setSnapshotPlayers(snapshot);
      setSnapshotTeams(endedTeams);
      setSnapshotEventMode(endedMode);
      setPhase('event-end');
    }
  }, [liveStateSynced, eventStarted, eventMode, teams, showcase, players, resetClientLiveState]);

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
        className="relative text-center"
      >
        <div className="micro mb-6 text-lg tracking-[0.42em] text-red-300">
          BREAKOUT TRADING FIGHT
        </div>
        <TransitionBrandAbove variant="fight-start" />
        <div
          className="display"
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
          }}
        >
          LE FIGHT COMMENCE !
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

/* ---------------- Winner + Podium ---------------- */

function EventEndOverlay({
  players,
  teams,
  eventMode,
  onClose,
}: {
  players: Player[];
  teams: [TeamInfo, TeamInfo] | null;
  eventMode: EventMode;
  onClose: () => void;
}) {
  const teamGroups = useMemo(() => {
    if (!teams) return null;
    const groups = buildTeamGroups(teams, players);
    return groups.some((g) => g.players.length > 0) ? groups : null;
  }, [teams, players]);

  if (teamGroups) {
    return (
      <TeamEventEndOverlay groups={teamGroups} onClose={onClose} />
    );
  }

  return (
    <IndividualEventEndOverlay players={players} onClose={onClose} />
  );
}

function TeamEventEndOverlay({
  groups,
  onClose,
}: {
  groups: TeamGroup<Player>[];
  onClose: () => void;
}) {
  const [step, setStep] = useState<'winner' | 'roster' | 'stats'>('winner');
  const [winner, runnerUp] = groups;

  useEffect(() => {
    if (step !== 'winner') return;
    const end = Date.now() + 3500;
    const tick = () => {
      confetti({
        particleCount: 5,
        angle: 60,
        spread: 70,
        origin: { x: 0, y: 0.65 },
        colors: ['#fbbf24', '#f59e0b', '#fde68a', '#fff'],
      });
      confetti({
        particleCount: 5,
        angle: 120,
        spread: 70,
        origin: { x: 1, y: 0.65 },
        colors: ['#fbbf24', '#f59e0b', '#fde68a', '#fff'],
      });
      if (Date.now() < end) requestAnimationFrame(tick);
    };
    tick();
  }, [step]);

  useEffect(() => {
    if (step === 'winner') {
      const id = setTimeout(() => setStep('roster'), WINNER_SCREEN_DURATION_MS);
      return () => clearTimeout(id);
    }
    if (step === 'roster') {
      const id = setTimeout(() => setStep('stats'), PODIUM_DURATION_MS);
      return () => clearTimeout(id);
    }
    return undefined;
  }, [step]);

  if (!winner) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4 }}
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/92 backdrop-blur-xl overflow-y-auto py-10"
    >
      <div className="pointer-events-none absolute inset-0" style={{
        background:
          'radial-gradient(800px 500px at 50% 30%, rgba(245,179,0,0.18), transparent 60%),' +
          'radial-gradient(700px 400px at 50% 100%, rgba(220,38,38,0.18), transparent 65%)',
      }} />

      <button
        type="button"
        onClick={onClose}
        className="absolute top-6 right-6 z-10 flex h-10 w-10 items-center justify-center rounded-xl border border-white/15 bg-black/60 text-zinc-400 transition-colors hover:border-red-500/50 hover:text-white"
        aria-label="Fermer"
      >
        ✕
      </button>

      <AnimatePresence mode="wait">
        {step === 'winner' ? (
          <TeamWinnerScreen key="team-winner" group={winner} />
        ) : step === 'roster' ? (
          <TeamRosterScreen key="team-roster" winner={winner} runnerUp={runnerUp} />
        ) : (
          <TeamStatsScreen key="team-stats" groups={groups} />
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function TeamWinnerScreen({ group }: { group: TeamGroup<Player> }) {
  const isPositive = group.totalPnl >= 0;
  return (
    <motion.div
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ scale: 0.85, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 180, damping: 22 }}
      className="relative max-w-[900px] w-full px-8 text-center"
    >
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="micro mb-4 text-lg tracking-[0.42em]"
        style={{ color: group.team.color, textShadow: `0 0 24px ${group.team.color}aa` }}
      >
        ★ ÉQUIPE VICTORIEUSE ★
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="display font-bold uppercase tracking-[0.04em] text-white"
        style={{
          fontSize: 'clamp(56px, 7vw, 96px)',
          textShadow: `0 0 50px ${group.team.color}80`,
        }}
      >
        {group.team.name.trim() || 'Équipe 1'}
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.45 }}
        className="mt-8 inline-flex flex-col items-center gap-1 rounded-2xl border px-10 py-5 backdrop-blur"
        style={{
          borderColor: `${group.team.color}66`,
          background: `linear-gradient(180deg, ${group.team.color}22, ${group.team.color}08)`,
        }}
      >
        <div className="micro text-zinc-400">P&amp;L cumulé de l&apos;équipe</div>
        <div
          className={`display num font-bold tabular-nums leading-none ${
            isPositive ? 'text-emerald-400' : 'text-red-400'
          }`}
          style={{
            fontSize: 'clamp(48px, 6vw, 76px)',
            textShadow: isPositive
              ? '0 0 40px rgba(16,185,129,0.45)'
              : '0 0 40px rgba(239,68,68,0.45)',
          }}
        >
          {formatPnl(group.totalPnl)}
        </div>
        <div className={`num text-base ${group.avgPnlPercent >= 0 ? 'text-emerald-400/80' : 'text-red-400/80'}`}>
          {formatPercent(group.avgPnlPercent)} moy. · {group.players.length} traders
        </div>
      </motion.div>
    </motion.div>
  );
}

function TeamRosterScreen({
  winner,
  runnerUp,
}: {
  winner: TeamGroup<Player>;
  runnerUp?: TeamGroup<Player>;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.5 }}
      className="relative w-full max-w-[1280px] px-10"
    >
      <div className="mb-8 text-center">
        <div className="micro mb-2 text-base tracking-[0.42em] text-red-300/80">
          BREAKOUT TRADING FIGHT — RÉSULTATS
        </div>
        <h2 className="display text-5xl font-bold text-white tracking-[0.04em]">
          {winner.team.name.trim() || 'Équipe 1'}
          <span className="text-red-500"> · </span>
          VAINQUEURS
        </h2>
      </div>

      <div className="grid grid-cols-5 gap-3">
        {winner.players.map((player, idx) => (
          <TeamMemberCard key={player.id} player={player} color={winner.team.color} index={idx} highlight />
        ))}
      </div>

      {runnerUp && runnerUp.players.length > 0 && (
        <div className="mt-10">
          <div className="mb-3 flex items-center gap-3">
            <span className="h-3 w-3 rounded-full" style={{ background: runnerUp.team.color }} />
            <span className="display text-lg font-bold uppercase tracking-[0.12em] text-zinc-300">
              {runnerUp.team.name.trim() || 'Équipe 2'}
            </span>
            <span className={`num text-base font-bold ${runnerUp.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {formatPnl(runnerUp.totalPnl)}
            </span>
            <span className="num text-xs text-zinc-500">{formatPercent(runnerUp.avgPnlPercent)} moy.</span>
          </div>
          <div className="grid grid-cols-5 gap-3">
            {runnerUp.players.map((player, idx) => (
              <TeamMemberCard key={player.id} player={player} color={runnerUp.team.color} index={idx} />
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
}

function TeamMemberCard({
  player,
  color,
  index,
  highlight = false,
}: {
  player: TeamResultPlayer;
  color: string;
  index: number;
  highlight?: boolean;
}) {
  const isPositive = player.pnl >= 0;
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.15 + index * 0.08, type: 'spring', stiffness: 200, damping: 22 }}
      className="relative flex flex-col items-center rounded-2xl border bg-gradient-to-b from-white/[0.04] to-white/[0.01] p-4 text-center backdrop-blur"
      style={{
        borderColor: highlight ? `${color}66` : 'rgba(255,255,255,0.08)',
        boxShadow: highlight ? `0 18px 50px -22px ${color}aa` : 'none',
      }}
    >
      <div
        className="mb-3 overflow-hidden rounded-2xl border-2"
        style={{ width: 72, height: 72, borderColor: color }}
      >
        {player.avatar ? (
          <img src={player.avatar} alt={player.name} className="h-full w-full object-cover" />
        ) : (
          <div
            className="flex h-full w-full items-center justify-center display text-3xl font-bold text-white"
            style={{ background: player.color }}
          >
            {player.name.charAt(0).toUpperCase()}
          </div>
        )}
      </div>
      <div className="display w-full truncate text-base font-bold text-white">{player.name}</div>
      <div className="micro mt-0.5 text-[9px] text-zinc-500">
        {player.tradeCount} trade{player.tradeCount > 1 ? 's' : ''}
      </div>
      <div
        className={`num mt-2 text-2xl font-bold tabular-nums leading-none ${
          isPositive ? 'text-emerald-400' : 'text-red-400'
        }`}
      >
        {formatPnl(player.pnl)}
      </div>
      <div className={`num text-xs ${isPositive ? 'text-emerald-500/80' : 'text-red-500/80'}`}>
        {formatPercent(player.pnlPercent)}
      </div>
    </motion.div>
  );
}

function TeamStatsScreen({ groups }: { groups: TeamGroup<Player>[] }) {
  const allPlayers = groups.flatMap((g) => g.players);
  const totalTrades = allPlayers.reduce((sum, p) => sum + p.tradeCount, 0);
  const totalFees = allPlayers.reduce((sum, p) => sum + (p.feesPaid ?? 0), 0);
  const winners = allPlayers.filter((p) => p.pnl > 0).length;
  const totalPnl = allPlayers.reduce((sum, p) => sum + p.pnl, 0);

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -16 }}
      transition={{ duration: 0.45 }}
      className="relative w-full max-w-[1280px] px-10"
    >
      <div className="mb-8 text-center">
        <div className="micro mb-2 text-base tracking-[0.42em] text-red-300/80">
          BREAKOUT TRADING FIGHT — STATISTIQUES
        </div>
        <h2 className="display text-5xl font-bold text-white tracking-[0.04em]">
          RÉSULTATS <span className="text-red-500">·</span> PAR ÉQUIPE
        </h2>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-6 sm:grid-cols-4">
        <StatsAggregate label="P&L total" value={formatPnl(totalPnl)} accent={totalPnl >= 0 ? 'pos' : 'neg'} />
        <StatsAggregate label="Trades exécutés" value={totalTrades.toString()} />
        <StatsAggregate label="Frais cumulés" value={`$${formatUSD(totalFees)}`} />
        <StatsAggregate label="Traders gagnants" value={`${winners} / ${allPlayers.length}`} />
      </div>

      <div className="space-y-5">
        {groups.map((group, gIdx) => (
          <div
            key={group.team.name + gIdx}
            className="rounded-2xl border bg-black/40 backdrop-blur overflow-hidden"
            style={{ borderColor: `${group.team.color}55` }}
          >
            <div
              className="flex items-center gap-3 px-5 py-3"
              style={{ background: `linear-gradient(90deg, ${group.team.color}22, transparent 70%)` }}
            >
              <span className="h-3 w-3 rounded-full" style={{ background: group.team.color, boxShadow: `0 0 12px ${group.team.color}` }} />
              <span className="display text-lg font-bold uppercase tracking-[0.1em] text-white">
                {group.team.name.trim() || `Équipe ${gIdx + 1}`}
              </span>
              {gIdx === 0 && (
                <span
                  className="display rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.15em]"
                  style={{ background: group.team.color, color: '#0a0a0e' }}
                >
                  Vainqueur
                </span>
              )}
              <div className="ml-auto flex items-center gap-3">
                <span className={`num text-xl font-bold ${group.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {formatPnl(group.totalPnl)}
                </span>
                <span className={`num text-xs ${group.avgPnlPercent >= 0 ? 'text-emerald-500/70' : 'text-red-500/70'}`}>
                  {formatPercent(group.avgPnlPercent)} moy.
                </span>
              </div>
            </div>

            <div className="grid grid-cols-12 gap-3 px-5 py-2 border-y border-white/10 text-[10px] uppercase tracking-[0.32em] text-zinc-500">
              <div className="col-span-4">Trader</div>
              <div className="col-span-2 text-right">P&L</div>
              <div className="col-span-2 text-right">%</div>
              <div className="col-span-2 text-right">Trades</div>
              <div className="col-span-2 text-right">Frais</div>
            </div>

            {[...group.players]
              .sort((a, b) => b.pnl - a.pnl)
              .map((p, idx) => (
                <motion.div
                  key={p.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.03 }}
                  className="grid grid-cols-12 gap-3 px-5 py-3 items-center border-b border-white/5 last:border-b-0"
                >
                  <div className="col-span-4 flex items-center gap-3 min-w-0">
                    <PlayerThumb player={p} size={36} />
                    <div className="min-w-0">
                      <div className="display text-sm font-bold text-white truncate">{p.name}</div>
                      <div className="num text-[10px] text-zinc-500">
                        ${formatUSD(p.initialBalance ?? 0)} → ${formatUSD(p.currentBalance ?? 0)}
                      </div>
                    </div>
                  </div>
                  <div className={`col-span-2 num text-right font-bold ${p.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {formatPnl(p.pnl)}
                  </div>
                  <div className={`col-span-2 num text-right ${p.pnl >= 0 ? 'text-emerald-500/80' : 'text-red-500/80'}`}>
                    {formatPercent(p.pnlPercent)}
                  </div>
                  <div className="col-span-2 num text-right text-white">{p.tradeCount}</div>
                  <div className="col-span-2 num text-right text-zinc-500">${formatUSD(p.feesPaid ?? 0)}</div>
                </motion.div>
              ))}
          </div>
        ))}
      </div>
    </motion.div>
  );
}

function IndividualEventEndOverlay({
  players,
  onClose,
}: {
  players: Player[];
  onClose: () => void;
}) {
  const [step, setStep] = useState<'winner' | 'podium' | 'stats'>('winner');

  const podium = useMemo(() => players.slice(0, 3), [players]);
  const others = useMemo(() => players.slice(3), [players]);
  const winner = podium[0];

  // Confettis sur l'écran winner
  useEffect(() => {
    if (step !== 'winner') return;
    const end = Date.now() + 3500;
    const tick = () => {
      confetti({
        particleCount: 5,
        angle: 60,
        spread: 70,
        origin: { x: 0, y: 0.65 },
        colors: ['#fbbf24', '#f59e0b', '#fde68a', '#fff'],
      });
      confetti({
        particleCount: 5,
        angle: 120,
        spread: 70,
        origin: { x: 1, y: 0.65 },
        colors: ['#fbbf24', '#f59e0b', '#fde68a', '#fff'],
      });
      if (Date.now() < end) requestAnimationFrame(tick);
    };
    tick();
  }, [step]);

  // winner → podium → stats
  useEffect(() => {
    if (step === 'winner') {
      const id = setTimeout(() => setStep('podium'), WINNER_SCREEN_DURATION_MS);
      return () => clearTimeout(id);
    }
    if (step === 'podium') {
      const id = setTimeout(() => setStep('stats'), PODIUM_DURATION_MS);
      return () => clearTimeout(id);
    }
    return undefined;
  }, [step]);

  if (!winner) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4 }}
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/92 backdrop-blur-xl overflow-y-auto py-10"
    >
      {/* Background glow */}
      <div className="pointer-events-none absolute inset-0" style={{
        background:
          'radial-gradient(800px 500px at 50% 30%, rgba(245,179,0,0.18), transparent 60%),' +
          'radial-gradient(700px 400px at 50% 100%, rgba(220,38,38,0.18), transparent 65%)',
      }} />

      <button
        type="button"
        onClick={onClose}
        className="absolute top-6 right-6 z-10 flex h-10 w-10 items-center justify-center rounded-xl border border-white/15 bg-black/60 text-zinc-400 transition-colors hover:border-red-500/50 hover:text-white"
        aria-label="Fermer"
      >
        ✕
      </button>

      <AnimatePresence mode="wait">
        {step === 'winner' ? (
          <WinnerScreen key="winner" winner={winner} />
        ) : step === 'podium' ? (
          <PodiumScreen key="podium" podium={podium} others={others} />
        ) : (
          <EventEndStatsScreen key="stats" players={players} />
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function WinnerScreen({ winner }: { winner: Player }) {
  const isPositive = winner.pnl >= 0;
  return (
    <motion.div
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ scale: 0.85, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 180, damping: 22 }}
      className="relative max-w-[720px] w-full px-8 text-center"
    >
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="micro mb-4 text-lg tracking-[0.42em] text-amber-300"
      >
        🏆 CHAMPION 🏆
      </motion.div>

      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ delay: 0.15, type: 'spring', stiffness: 220, damping: 16 }}
        className="relative mx-auto mb-6"
      >
        <div className="absolute -inset-6 rounded-full opacity-70 blur-2xl"
          style={{ background: 'radial-gradient(circle, rgba(245,179,0,0.55), transparent 70%)' }} />
        <div
          className="relative mx-auto flex h-44 w-44 items-center justify-center overflow-hidden rounded-2xl border-4"
          style={{
            borderImage: 'linear-gradient(135deg, #fde68a, #b45309) 1',
            borderColor: '#fbbf24',
            boxShadow: '0 20px 60px -10px rgba(245,179,0,0.6), inset 0 1px 0 rgba(255,255,255,0.1)',
          }}
        >
          {winner.avatar ? (
            <img src={winner.avatar} alt={winner.name} className="h-full w-full object-cover" />
          ) : (
            <div
              className="flex h-full w-full items-center justify-center display text-7xl font-bold text-white"
              style={{ background: winner.color }}
            >
              {winner.name.charAt(0).toUpperCase()}
            </div>
          )}
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
        className="display"
        style={{
          fontSize: 'clamp(56px, 7vw, 96px)',
          fontWeight: 700,
          lineHeight: 1,
          background: 'linear-gradient(180deg, #fde68a 0%, #f59e0b 60%, #b45309 100%)',
          WebkitBackgroundClip: 'text',
          backgroundClip: 'text',
          color: 'transparent',
          filter: 'drop-shadow(0 12px 30px rgba(245,179,0,0.55))',
        }}
      >
        {winner.name}
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.55 }}
        className="mt-6 inline-flex flex-col items-center gap-1 rounded-2xl border border-amber-500/40 bg-gradient-to-b from-amber-500/15 to-amber-500/5 px-10 py-5 backdrop-blur"
      >
        <div className="micro text-amber-300/90">P&amp;L final</div>
        <div className={`display num font-bold tabular-nums leading-none ${
          isPositive ? 'text-emerald-400' : 'text-red-400'
        }`}
          style={{
            fontSize: 'clamp(48px, 6vw, 76px)',
            textShadow: isPositive
              ? '0 0 40px rgba(16,185,129,0.45)'
              : '0 0 40px rgba(239,68,68,0.45)',
          }}
        >
          {formatPnl(winner.pnl)}
        </div>
        <div className={`num text-base ${isPositive ? 'text-emerald-400/80' : 'text-red-400/80'}`}>
          {formatPercent(winner.pnlPercent)} sur {winner.tradeCount} trade{winner.tradeCount > 1 ? 's' : ''}
        </div>
      </motion.div>
    </motion.div>
  );
}

function PodiumScreen({
  podium,
  others,
}: {
  podium: Player[];
  others: Player[];
}) {
  const order: Array<{ player: Player | undefined; rank: 1 | 2 | 3 }> = [
    { player: podium[1], rank: 2 },
    { player: podium[0], rank: 1 },
    { player: podium[2], rank: 3 },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.5 }}
      className="relative w-full max-w-[1180px] px-10"
    >
      <div className="mb-10 text-center">
        <div className="micro mb-2 text-base tracking-[0.42em] text-red-300/80">
          BREAKOUT TRADING FIGHT — RÉSULTATS
        </div>
        <h2 className="display text-5xl font-bold text-white tracking-[0.04em]">
          PODIUM <span className="text-red-500">·</span> FINAL
        </h2>
      </div>

      <div className="grid grid-cols-3 gap-5 items-end">
        {order.map(({ player, rank }, idx) => {
          if (!player) return <div key={idx} />;
          return <PodiumCard key={player.id} player={player} rank={rank} index={idx} />;
        })}
      </div>

      {others.length > 0 && (
        <div className="mt-10">
          <div className="micro mb-3 text-sm text-zinc-500 tracking-[0.32em]">Suivants</div>
          <div className="rounded-2xl border border-white/10 bg-black/40 backdrop-blur divide-y divide-white/5">
            {others.map((p, i) => (
              <div key={p.id} className="flex items-center gap-4 px-5 py-3">
                <span className="display num text-2xl font-bold text-zinc-500 w-10 text-center">
                  {i + 4}
                </span>
                <PlayerThumb player={p} size={40} />
                <div className="flex-1 min-w-0">
                  <div className="display text-lg font-bold text-white truncate">{p.name}</div>
                  <div className="num text-[11px] text-zinc-500">
                    {p.tradeCount} trade{p.tradeCount > 1 ? 's' : ''} · ${formatUSD(p.currentBalance)}
                  </div>
                </div>
                <div className="text-right">
                  <div className={`num font-bold ${p.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {formatPnl(p.pnl)}
                  </div>
                  <div className={`num text-[11px] ${p.pnl >= 0 ? 'text-emerald-500/70' : 'text-red-500/70'}`}>
                    {formatPercent(p.pnlPercent)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
}

function PodiumCard({ player, rank, index }: { player: Player; rank: 1 | 2 | 3; index: number }) {
  const isPositive = player.pnl >= 0;
  const theme = {
    1: {
      label: 'CHAMPION',
      from: '#fde68a',
      to: '#b45309',
      border: 'rgba(245,179,0,0.55)',
      heightClass: 'min-h-[420px]',
      avatarSize: 132,
      glow: '0 30px 80px -10px rgba(245,179,0,0.55)',
      pnlSize: '54px',
    },
    2: {
      label: '2ND',
      from: '#e2e8f0',
      to: '#64748b',
      border: 'rgba(203,213,225,0.45)',
      heightClass: 'min-h-[360px]',
      avatarSize: 108,
      glow: '0 20px 60px -16px rgba(203,213,225,0.4)',
      pnlSize: '42px',
    },
    3: {
      label: '3RD',
      from: '#fbbf24',
      to: '#7c2d12',
      border: 'rgba(194,114,74,0.45)',
      heightClass: 'min-h-[340px]',
      avatarSize: 100,
      glow: '0 20px 60px -16px rgba(194,114,74,0.4)',
      pnlSize: '40px',
    },
  }[rank];

  return (
    <motion.div
      initial={{ opacity: 0, y: 40 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.15 + index * 0.12, type: 'spring', stiffness: 180, damping: 22 }}
      className={`relative flex flex-col items-center text-center rounded-3xl border bg-gradient-to-b from-white/[0.04] to-white/[0.01] backdrop-blur p-6 ${theme.heightClass}`}
      style={{ borderColor: theme.border, boxShadow: theme.glow }}
    >
      <span
        className="display absolute -top-5 left-1/2 -translate-x-1/2 flex h-10 min-w-[80px] items-center justify-center rounded-xl border px-4 text-sm font-bold tracking-[0.18em]"
        style={{
          background: `linear-gradient(180deg, ${theme.from} 0%, ${theme.to} 100%)`,
          color: '#1a0e00',
          borderColor: theme.border,
        }}
      >
        {theme.label}
      </span>

      <div
        className="my-6 overflow-hidden rounded-2xl border-4"
        style={{
          width: theme.avatarSize,
          height: theme.avatarSize,
          borderColor: theme.from,
        }}
      >
        {player.avatar ? (
          <img src={player.avatar} alt={player.name} className="h-full w-full object-cover" />
        ) : (
          <div
            className="flex h-full w-full items-center justify-center display font-bold text-white"
            style={{ background: player.color, fontSize: theme.avatarSize / 2.4 }}
          >
            {player.name.charAt(0).toUpperCase()}
          </div>
        )}
      </div>

      <div className="display text-2xl font-bold text-white truncate w-full">{player.name}</div>
      <div className="micro mt-1 text-zinc-500">
        {player.tradeCount} trade{player.tradeCount > 1 ? 's' : ''}
      </div>

      <div className="mt-5">
        <div
          className={`num font-bold tabular-nums leading-none ${
            isPositive ? 'text-emerald-400' : 'text-red-400'
          }`}
          style={{
            fontSize: theme.pnlSize,
            textShadow: isPositive
              ? '0 0 28px rgba(16,185,129,0.4)'
              : '0 0 28px rgba(239,68,68,0.4)',
          }}
        >
          {formatPnl(player.pnl)}
        </div>
        <div className={`num text-sm mt-1 ${isPositive ? 'text-emerald-500/80' : 'text-red-500/80'}`}>
          {formatPercent(player.pnlPercent)}
        </div>
      </div>

      <div className="mt-auto grid grid-cols-2 gap-2 w-full pt-5">
        <div className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-center">
          <div className="micro text-[8px] text-zinc-500">Balance</div>
          <div className="num text-sm font-bold text-white">${formatUSD(player.currentBalance)}</div>
        </div>
        <div className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-center">
          <div className="micro text-[8px] text-zinc-500">Best %</div>
          <div className="num text-sm font-bold text-white">
            {player.bestTradePercent > 0 ? `+${player.bestTradePercent.toFixed(1)}%` : '—'}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function PlayerThumb({ player, size }: { player: Player; size: number }) {
  if (player.avatar) {
    return (
      <img
        src={player.avatar}
        alt={player.name}
        className="rounded-lg border border-white/10 object-cover shrink-0"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <div
      className="flex items-center justify-center rounded-lg display font-bold text-white shrink-0"
      style={{ background: player.color, width: size, height: size, fontSize: size / 2.4 }}
    >
      {player.name.charAt(0).toUpperCase()}
    </div>
  );
}

function EventEndStatsScreen({ players }: { players: Player[] }) {
  const sorted = useMemo(
    () => [...players].sort((a, b) => b.pnl - a.pnl),
    [players],
  );
  const totalPnl = sorted.reduce((sum, p) => sum + p.pnl, 0);
  const totalTrades = sorted.reduce((sum, p) => sum + p.tradeCount, 0);
  const totalFees = sorted.reduce((sum, p) => sum + p.feesPaid, 0);
  const winners = sorted.filter((p) => p.pnl > 0).length;

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -16 }}
      transition={{ duration: 0.45 }}
      className="relative w-full max-w-[1280px] px-10"
    >
      <div className="mb-8 text-center">
        <div className="micro mb-2 text-base tracking-[0.42em] text-red-300/80">
          BREAKOUT TRADING FIGHT — STATISTIQUES
        </div>
        <h2 className="display text-5xl font-bold text-white tracking-[0.04em]">
          RÉSULTATS <span className="text-red-500">·</span> DÉTAILLÉS
        </h2>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-6 sm:grid-cols-4">
        <StatsAggregate label="P&L total" value={formatPnl(totalPnl)} accent={totalPnl >= 0 ? 'pos' : 'neg'} />
        <StatsAggregate label="Trades exécutés" value={totalTrades.toString()} />
        <StatsAggregate label="Frais cumulés" value={`$${formatUSD(totalFees)}`} />
        <StatsAggregate label="Traders gagnants" value={`${winners} / ${sorted.length}`} />
      </div>

      <div className="rounded-2xl border border-white/10 bg-black/40 backdrop-blur overflow-hidden">
        <div className="grid grid-cols-12 gap-3 px-5 py-3 border-b border-white/10 text-[10px] uppercase tracking-[0.32em] text-zinc-500">
          <div className="col-span-1">#</div>
          <div className="col-span-3">Trader</div>
          <div className="col-span-2 text-right">P&L</div>
          <div className="col-span-1 text-right">%</div>
          <div className="col-span-1 text-right">Trades</div>
          <div className="col-span-1 text-right">Best %</div>
          <div className="col-span-1 text-right">Whale</div>
          <div className="col-span-1 text-right">Streak</div>
          <div className="col-span-1 text-right">Frais</div>
        </div>

        {sorted.map((p, idx) => (
          <motion.div
            key={p.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.025 }}
            className="grid grid-cols-12 gap-3 px-5 py-3 items-center border-b border-white/5 last:border-b-0"
          >
            <div className="col-span-1">
              <StatsRankPill rank={idx + 1} />
            </div>
            <div className="col-span-3 flex items-center gap-3 min-w-0">
              <PlayerThumb player={p} size={36} />
              <div className="min-w-0">
                <div className="display text-sm font-bold text-white truncate">{p.name}</div>
                <div className="num text-[10px] text-zinc-500">
                  ${formatUSD(p.initialBalance ?? 0)} → ${formatUSD(p.currentBalance)}
                </div>
              </div>
            </div>
            <div className={`col-span-2 num text-right font-bold ${p.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {formatPnl(p.pnl)}
            </div>
            <div className={`col-span-1 num text-right ${p.pnl >= 0 ? 'text-emerald-500/80' : 'text-red-500/80'}`}>
              {formatPercent(p.pnlPercent)}
            </div>
            <div className="col-span-1 num text-right text-white">{p.tradeCount}</div>
            <div className="col-span-1 num text-right text-zinc-300">
              {p.bestTradePercent > 0 ? `+${p.bestTradePercent.toFixed(1)}%` : '—'}
            </div>
            <div className="col-span-1 num text-right text-zinc-300">
              {p.biggestTradePnl > 0 ? `$${formatUSD(p.biggestTradePnl)}` : '—'}
            </div>
            <div className="col-span-1 num text-right text-zinc-300">{p.winStreak}</div>
            <div className="col-span-1 num text-right text-zinc-500">${formatUSD(p.feesPaid)}</div>
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}

function StatsAggregate({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: 'pos' | 'neg';
}) {
  const valueColor =
    accent === 'pos' ? 'text-emerald-400' : accent === 'neg' ? 'text-red-400' : 'text-white';
  return (
    <div className="rounded-xl border border-white/10 bg-black/40 px-4 py-3">
      <div className="micro text-[9px] text-zinc-500">{label}</div>
      <div className={`display text-xl font-bold mt-1 num ${valueColor}`}>{value}</div>
    </div>
  );
}

function StatsRankPill({ rank }: { rank: number }) {
  const palette: Record<number, { bg: string; color: string }> = {
    1: { bg: 'linear-gradient(180deg, #fde68a, #b45309)', color: '#1a0e00' },
    2: { bg: 'linear-gradient(180deg, #e2e8f0, #64748b)', color: '#0f172a' },
    3: { bg: 'linear-gradient(180deg, #fbbf24, #7c2d12)', color: '#1a0e00' },
  };
  const style = palette[rank];
  return (
    <span
      className="display inline-flex h-7 min-w-[36px] items-center justify-center rounded-md px-2 text-xs font-bold tabular-nums"
      style={
        style
          ? { background: style.bg, color: style.color }
          : { background: 'rgba(255,255,255,0.06)', color: '#a1a1aa' }
      }
    >
      #{rank}
    </span>
  );
}
