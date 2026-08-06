/**
 * Fenêtre « leaderboard grand écran » pour le mode replay.
 *
 * Overlay ancré en haut-centre de l'écran, forme hexagonale collée au bord
 * supérieur, en glassmorphism rouge translucide. Les joueurs sont affichés
 * en cartes horizontales côte à côte. Lit le même store que le replay
 * (piloté seconde par seconde par ReplayViewer), donc le classement s'anime
 * en direct. Le reste de l'écran laisse voir l'arène derrière le verre.
 */

import { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useGameStore } from '../stores/useGameStore';
import type { Player } from '../stores/useGameStore';
import { formatPnl, formatPercent } from '../utils/formatters';
import PlayerAvatar from './PlayerAvatar';

function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function RankBadge({ rank }: { rank: number }) {
  const palette =
    rank === 1
      ? 'from-amber-300 to-amber-500 text-black'
      : rank === 2
        ? 'from-slate-200 to-slate-400 text-black'
        : rank === 3
          ? 'from-orange-400 to-orange-600 text-black'
          : 'from-red-500/30 to-red-800/30 text-red-100';
  return (
    <span
      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br ${palette} text-2xl font-black tabular-nums shadow-lg`}
    >
      {rank}
    </span>
  );
}

function RankDelta({ current, previous }: { current: number; previous: number }) {
  const diff = previous - current;
  if (diff === 0 || !previous) return null;
  return (
    <span className={`text-xs font-bold tabular-nums ${diff > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
      {diff > 0 ? `▲${diff}` : `▼${Math.abs(diff)}`}
    </span>
  );
}

function PlayerColumn({ player, index }: { player: Player; index: number }) {
  const isPositive = player.pnl >= 0;
  const intensity = Math.min(Math.abs(player.pnlPercent) * 5, 100);

  return (
    <motion.div
      layout
      layoutId={player.id}
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        layout: { type: 'spring', stiffness: 180, damping: 26, mass: 0.9 },
        delay: index * 0.05,
      }}
      className={`relative flex min-w-0 items-center gap-3 overflow-hidden rounded-2xl border px-4 py-3 backdrop-blur-md ${
        player.rank === 1
          ? 'border-amber-400/40 bg-gradient-to-r from-amber-500/15 via-red-500/10 to-transparent'
          : 'border-white/10 bg-white/[0.04]'
      }`}
    >
      <RankBadge rank={player.rank} />

      <PlayerAvatar name={player.name} color={player.color} avatar={player.avatar} size="md" glow />

      <div className="min-w-0 flex-1">
        <div className="truncate text-lg font-bold leading-tight text-white">{player.name}</div>
        <div className="mt-0.5 flex items-center gap-2">
          <RankDelta current={player.rank} previous={player.previousRank} />
          <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-red-200/60">
            {player.tradeCount} trd
          </span>
          {player.badges.slice(0, 2).map((badge) => (
            <span key={badge.type} className="text-base leading-none" title={badge.label}>
              {badge.icon}
            </span>
          ))}
        </div>
      </div>

      <div className="shrink-0 text-right">
        <motion.div
          key={player.pnl}
          initial={{ scale: 1.12 }}
          animate={{ scale: 1 }}
          className={`text-xl font-black leading-none tabular-nums ${isPositive ? 'text-emerald-400' : 'text-red-400'}`}
        >
          {formatPnl(player.pnl)}
        </motion.div>
        <div className={`mt-0.5 text-xs font-semibold tabular-nums ${isPositive ? 'text-emerald-500/80' : 'text-red-500/80'}`}>
          {formatPercent(player.pnlPercent)}
        </div>
      </div>

      {/* Barre PnL en bas de carte. */}
      <div className="absolute bottom-0 left-3 right-3 h-[3px] overflow-hidden rounded-full">
        <motion.div
          className={`h-full ${
            isPositive
              ? 'bg-gradient-to-r from-emerald-500/0 via-emerald-400 to-emerald-500/0'
              : 'bg-gradient-to-r from-red-500/0 via-red-500 to-red-500/0'
          }`}
          initial={{ width: 0 }}
          animate={{ width: `${intensity}%` }}
          transition={{ type: 'spring', stiffness: 90 }}
        />
      </div>
    </motion.div>
  );
}

export default function ReplayLeaderboardWindow({
  onClose,
  remainingMs = null,
}: {
  onClose: () => void;
  remainingMs?: number | null;
}) {
  const players = useGameStore((s) => s.players);
  const sorted = [...players].sort((a, b) => a.rank - b.rank);

  // Fermeture au clavier (Échap) — la barre de contrôle du replay gère aussi
  // le masquage, donc pas de croix dans la fenêtre.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Forme hexagonale « collée » au haut de l'écran : bord supérieur plat et
  // pleine largeur, coins inférieurs biseautés (6 côtés).
  const hexClip = 'polygon(0 0, 100% 0, 100% 88%, 97% 100%, 3% 100%, 0 88%)';

  const lowTime = remainingMs != null && remainingMs <= 60_000;

  return (
    <div className="pointer-events-none fixed inset-0 z-[280] flex items-start justify-center">
      <div className="pointer-events-auto relative flex w-[98%] max-w-[1600px] flex-col">
        {/* Halo rouge derrière le verre. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            background: 'radial-gradient(60% 60% at 50% 0%, rgba(220,38,38,0.35), transparent 70%)',
          }}
        />

        {/* Contour rouge (couche externe) — l'hexagone intérieur crée le liseré. */}
        <div
          className="flex max-h-[calc(100dvh-24px)] min-h-0 flex-col bg-gradient-to-b from-red-500/70 via-red-700/50 to-red-900/50 p-[2px] shadow-[0_30px_120px_-30px_rgba(220,38,38,0.65)]"
          style={{ clipPath: hexClip }}
        >
          <div
            className="flex min-h-0 flex-1 flex-col bg-gradient-to-br from-red-950/55 via-black/50 to-red-900/35 backdrop-blur-2xl"
            style={{ clipPath: hexClip }}
          >
            {/* En-tête : Standings — Timer — Logos. */}
            <div className="flex shrink-0 items-center justify-between gap-4 border-b border-white/10 px-8 py-3.5">
              <div className="min-w-0">
                <div className="text-[11px] font-semibold uppercase tracking-[0.3em] text-red-300/70">
                  Classement en direct
                </div>
                <h2 className="mt-1 text-3xl font-black uppercase tracking-wide text-white">Standings</h2>
              </div>

              {remainingMs != null && (
                <div
                  className={`flex shrink-0 flex-col items-center rounded-xl border px-6 py-1.5 ${
                    lowTime ? 'border-red-500/50 bg-red-500/15' : 'border-white/12 bg-white/[0.05]'
                  }`}
                >
                  <span className="text-[9px] font-semibold uppercase tracking-[0.25em] text-red-200/60">
                    Temps restant
                  </span>
                  <span className={`num text-2xl font-black tabular-nums ${lowTime ? 'text-red-300' : 'text-white'}`}>
                    {formatClock(remainingMs)}
                  </span>
                </div>
              )}

              <div className="flex shrink-0 items-center gap-3.5">
                <img src="/assets/pictures/logoBTF.webp" alt="BTF Arena" className="h-10 w-auto object-contain" />
                <span className="h-7 w-px bg-white/15" />
                <img src="/assets/pictures/kraken-logo-white.webp" alt="Kraken" className="h-5 w-auto object-contain opacity-90" />
              </div>
            </div>

            {/* Joueurs en colonnes horizontales. */}
            <div className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden px-6 pb-6 pt-4">
              {sorted.length > 0 ? (
                <div
                  className="grid gap-4"
                  style={{ gridTemplateColumns: `repeat(${sorted.length}, minmax(0, 1fr))` }}
                >
                  <AnimatePresence mode="popLayout">
                    {sorted.map((player, i) => (
                      <PlayerColumn key={player.id} player={player} index={i} />
                    ))}
                  </AnimatePresence>
                </div>
              ) : (
                <div className="py-20 text-center text-red-200/50">
                  <div className="mb-3 text-5xl">🩸</div>
                  <p className="text-base">En attente des combattants…</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
