import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import confetti from 'canvas-confetti';
import { useGameStore, type Player } from '../stores/useGameStore';
import { formatPnl, formatPercent, formatUSD } from '../utils/formatters';
import { playCountdownStartSound, resetArenaRoundSounds } from '../utils/arenaSounds';

type Phase = 'idle' | 'countdown' | 'fight-start' | 'event-end';

const COUNTDOWN_FROM = 15;
const FIGHT_START_DURATION = 1800;
const WINNER_SCREEN_DURATION_MS = 4500;
const PODIUM_DURATION_MS = 5000;

/**
 * Orchestre les transitions cinématiques du dashboard live :
 * - début d'événement → countdown 15→0 → flash "LE FIGHT COMMENCE !"
 * - fin d'événement → annonce du gagnant + podium avec stats détaillées
 */
export default function EventTransitions() {
  const eventStarted = useGameStore((s) => s.eventStarted);
  const players = useGameStore((s) => s.players);
  const resetClientLiveState = useGameStore((s) => s.resetClientLiveState);

  const [phase, setPhase] = useState<Phase>('idle');
  const [countdownValue, setCountdownValue] = useState(COUNTDOWN_FROM);
  const [snapshotPlayers, setSnapshotPlayers] = useState<Player[] | null>(null);
  // null = avant le tout premier render avec un état WS connu. Permet de
  // distinguer un vrai démarrage (false → true) d'un simple refresh de la
  // page pendant un round déjà actif (où on ne doit PAS rejouer le
  // countdown). Voir #refresh-no-countdown.
  const previousStartedRef = useRef<boolean | null>(null);

  // Détection du démarrage : false → true
  useEffect(() => {
    const wasStarted = previousStartedRef.current;
    previousStartedRef.current = eventStarted;

    // Premier passage du hook après mount : on initialise simplement la
    // référence sans déclencher d'animation. Si l'événement est déjà en
    // cours quand le dashboard se charge (refresh), on reste en `idle`.
    if (wasStarted === null) return;

    if (!wasStarted && eventStarted) {
      // Nouveau round : on vide les files locales pour repartir propre.
      resetClientLiveState();
      resetArenaRoundSounds();
      setSnapshotPlayers(null);
      setPhase('countdown');
      setCountdownValue(COUNTDOWN_FROM);
      playCountdownStartSound();
      return;
    }

    if (wasStarted && !eventStarted) {
      // Fin d'événement : on capture le snapshot final pour le podium.
      const snapshot = [...players].sort((a, b) => b.pnl - a.pnl);
      if (snapshot.length > 0) {
        setSnapshotPlayers(snapshot);
        setPhase('event-end');
      } else {
        setPhase('idle');
      }
    }
  }, [eventStarted, players, resetClientLiveState]);

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
