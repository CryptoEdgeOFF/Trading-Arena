/**
 * Route de prévisualisation TEMPORAIRE de la fenêtre « Classement grand écran »
 * du replay. Injecte des joueurs de démo dans le store puis affiche la fenêtre
 * par-dessus un fond sombre d'arène. Sert uniquement à valider le rendu en
 * local — à supprimer une fois le design validé.
 */

import { useEffect, useState } from 'react';
import { useGameStore, type Player } from '../stores/useGameStore';
import ReplayLeaderboardWindow from './ReplayLeaderboardWindow';

function mockPlayer(over: Partial<Player> & { id: string; name: string; color: string; rank: number }): Player {
  return {
    avatar: null,
    active: true,
    initialBalance: 100000,
    currentBalance: 100000,
    availableMargin: 100000,
    usedMargin: 0,
    feesPaid: 0,
    pnl: 0,
    pnlPercent: 0,
    tradeCount: 0,
    trades: [],
    openPositions: [],
    openOrders: [],
    previousRank: over.rank,
    badges: [],
    winStreak: 0,
    longestPositionMinutes: 0,
    biggestTradePnl: 0,
    bestTradePercent: 0,
    lastUpdate: Date.now(),
    connected: true,
    ...over,
  };
}

const DEMO_PLAYERS: Player[] = [
  mockPlayer({ id: 'p1', name: 'NadaFX', color: '#ff4b0f', rank: 1, previousRank: 2, pnl: 1844.49, pnlPercent: 1.84, tradeCount: 3, badges: [{ type: 'first-blood', label: 'First Blood', description: '', icon: '🩸', awardedAt: Date.now() }] }),
  mockPlayer({ id: 'p2', name: 'Benjamin Mauger', color: '#f90101', rank: 2, previousRank: 1, pnl: 986.13, pnlPercent: 0.98, tradeCount: 5, badges: [{ type: 'speed-demon', label: 'Speed Demon', description: '', icon: '⚡', awardedAt: Date.now() }] }),
  mockPlayer({ id: 'p3', name: 'Corentin Trading', color: '#22c55e', rank: 3, previousRank: 3, pnl: 132.40, pnlPercent: 0.13, tradeCount: 2 }),
  mockPlayer({ id: 'p4', name: 'Romain Bailleul', color: '#0011ff', rank: 4, previousRank: 4, pnl: -430.75, pnlPercent: -0.43, tradeCount: 4 }),
];

export default function ReplayLeaderboardPreview() {
  const updateState = useGameStore((s) => s.updateState);
  const resetClientLiveState = useGameStore((s) => s.resetClientLiveState);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    updateState({ players: DEMO_PLAYERS, replayMode: true });
    return () => {
      resetClientLiveState();
      updateState({ players: [], replayMode: false });
    };
  }, [updateState, resetClientLiveState]);

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#0a0305]">
      {/* Fond façon arène (dégradés rouges) pour juger la transparence du verre. */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(80%_60%_at_70%_30%,rgba(220,38,38,0.25),transparent_60%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(135deg,#140406_0%,#0a0305_50%,#1a0508_100%)]" />
        <div className="absolute right-10 top-1/3 text-right text-white/10">
          <div className="text-[120px] font-black leading-none">ARENA</div>
          <div className="text-2xl font-bold tracking-[0.4em]">LIVE REPLAY</div>
        </div>
      </div>

      {open && <ReplayLeaderboardWindow onClose={() => setOpen(false)} remainingMs={17 * 60_000 + 42_000} />}

      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-6 left-6 z-[300] rounded-lg border border-red-500/40 bg-red-500/15 px-4 py-2 text-sm font-semibold text-red-200"
        >
          Rouvrir le classement
        </button>
      )}
    </div>
  );
}
