/**
 * Lecteur de replay — rejoue une partie live passée sur le VRAI dashboard.
 *
 * Charge le package préparé par l'onglet admin Replay (localStorage), puis
 * pilote le store Zustand exactement comme le ferait le WebSocket live :
 * countdown d'intro, PnL seconde par seconde, classement, badges, spotlight
 * trades, et cérémonie de fin (podium). Contrôles : lecture/pause, vitesse,
 * timeline cliquable.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useGameStore, type StatePatch, type Badge, type Trade } from '../stores/useGameStore';
import Dashboard from './Dashboard';
import {
  buildTeams,
  computeFrame,
  PriceIndex,
  REPLAY_ENGINE_VERSION,
  REPLAY_PACKAGE_KEY,
  resolveTrades,
  tradeToSpotlight,
  type ReplayPackage,
  type ResolvedTrade,
} from '../lib/replay';
import { ADMIN_BASE } from '../lib/adminPath';

const TICK_MS = 250;
const SPEEDS = [1, 2, 5, 10, 30] as const;

function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString('fr-FR', { hour12: false });
}

function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function ReplayViewer() {
  const [pkg, setPkg] = useState<ReplayPackage | null>(null);
  const [loadError, setLoadError] = useState('');
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(1);
  const [simTime, setSimTime] = useState(0);
  const [started, setStarted] = useState(false);
  const [finished, setFinished] = useState(false);

  const updateState = useGameStore((s) => s.updateState);
  const applyStatePatch = useGameStore((s) => s.applyStatePatch);
  const resetClientLiveState = useGameStore((s) => s.resetClientLiveState);

  // Données dérivées du package (stables une fois chargées).
  const prepared = useMemo(() => {
    if (!pkg) return null;
    const prices = new PriceIndex(pkg.candles);
    const { resolved, skipped } = resolveTrades(pkg.config, prices);
    return { prices, resolved, skipped, teams: buildTeams(pkg.config) };
  }, [pkg]);

  // Événements déjà notifiés (pour n'émettre newTrades/newBadges qu'une fois).
  const seenTradesRef = useRef<Set<string>>(new Set());
  const seenBadgesRef = useRef<Set<string>>(new Set());
  const prevLeaderRef = useRef<string | null>(null);
  const prevRanksRef = useRef<Map<string, number>>(new Map());
  const simTimeRef = useRef(0);

  /* ----------------------------- Chargement ----------------------------- */

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(REPLAY_PACKAGE_KEY);
      if (!raw) {
        setLoadError("Aucun replay préparé. Retourne sur l'admin pour en configurer un.");
        return;
      }
      const parsed = JSON.parse(raw) as ReplayPackage;
      if (!parsed?.config?.players?.length || !parsed?.candles) {
        setLoadError('Package replay invalide.');
        return;
      }
      setPkg(parsed);
      setSimTime(parsed.config.startMs);
      simTimeRef.current = parsed.config.startMs;
    } catch {
      setLoadError('Impossible de lire le package replay.');
    }
  }, []);

  /* ------------------------- Application d'un frame --------------------- */

  const applyFrame = useCallback((tMs: number, withNotifs: boolean) => {
    if (!pkg || !prepared) return;
    const frame = computeFrame(pkg.config, prepared.resolved, prepared.prices, tMs);

    // previousRank : frame précédent (pour flèches/animations du leaderboard).
    const prevRanks = prevRanksRef.current;
    for (const player of frame.players) {
      player.previousRank = prevRanks.get(player.id) ?? player.rank;
    }

    const patch: StatePatch = {
      players: frame.players,
      market: frame.market,
      // Mapping temps simulé → horloge murale pour le timer du Header :
      // remaining affiché = endMs - simTime, quel que soit le multiplicateur.
      eventStartTime: Date.now() - (tMs - pkg.config.startMs),
      eventEndTime: Date.now() + (pkg.config.endMs - tMs),
    };

    if (withNotifs) {
      const newTrades: Trade[] = [];
      const spotlights = [];
      const newBadges: { playerId: string; badge: Badge }[] = [];

      for (const player of frame.players) {
        for (const trade of player.trades) {
          if (!seenTradesRef.current.has(trade.id)) {
            seenTradesRef.current.add(trade.id);
            newTrades.push(trade);
            const resolvedTrade = prepared.resolved.find((r) => trade.id.startsWith(`${r.input.id}:`));
            spotlights.push(tradeToSpotlight(trade, player, resolvedTrade?.entryPrice ?? trade.price));
          }
        }
        for (const badge of player.badges) {
          const key = `${player.id}:${badge.type}`;
          if (!seenBadgesRef.current.has(key)) {
            seenBadgesRef.current.add(key);
            newBadges.push({ playerId: player.id, badge });
          }
        }
      }

      if (newTrades.length) {
        patch.newTrades = newTrades.sort((a, b) => a.time - b.time);
        patch.spotlightTrades = spotlights;
      }
      if (newBadges.length) patch.newBadges = newBadges;

      const leader = frame.players.find((player) => player.rank === 1);
      if (leader && prevLeaderRef.current && leader.id !== prevLeaderRef.current) {
        const fromRank = prevRanks.get(leader.id) ?? 2;
        patch.leaderChanges = [{ playerId: leader.id, from: fromRank, to: 1 }];
      }
      if (leader) prevLeaderRef.current = leader.id;
    } else {
      // Seek : marque tout comme déjà vu, sans déclencher de notifications.
      for (const player of frame.players) {
        for (const trade of player.trades) seenTradesRef.current.add(trade.id);
        for (const badge of player.badges) seenBadgesRef.current.add(`${player.id}:${badge.type}`);
      }
      const leader = frame.players.find((player) => player.rank === 1);
      prevLeaderRef.current = leader?.id ?? null;
    }

    prevRanksRef.current = new Map(frame.players.map((player) => [player.id, player.rank]));
    applyStatePatch(patch);
  }, [pkg, prepared, applyStatePatch]);

  /* --------------------------- Init du store ---------------------------- */

  useEffect(() => {
    if (!pkg || !prepared) return;
    // Snapshot initial : joueurs à plat, event pas démarré (le standby reste
    // affiché jusqu'au clic "Lancer", comme une vraie room avant le start).
    resetClientLiveState();
    const initialFrame = computeFrame(pkg.config, prepared.resolved, prepared.prices, pkg.config.startMs);
    prevRanksRef.current = new Map(initialFrame.players.map((player) => [player.id, player.rank]));
    updateState({
      players: initialFrame.players,
      market: initialFrame.market,
      recentTrades: [],
      eventStarted: false,
      eventStartTime: null,
      eventEndTime: null,
      eventMode: pkg.config.eventMode,
      teams: prepared.teams ?? undefined,
      platformMode: 'paper',
      replayMode: true,
      paperStartingBalance: pkg.config.startingBalance,
      showcase: null,
      malus: null,
    });

    return () => {
      // Sortie du replay : on rend un store propre au dashboard live.
      resetClientLiveState();
      updateState({
        players: [],
        market: {},
        recentTrades: [],
        eventStarted: false,
        eventStartTime: null,
        eventEndTime: null,
        replayMode: false,
        teams: undefined,
        showcase: null,
        malus: null,
      });
    };
  }, [pkg, prepared, updateState, resetClientLiveState]);

  /* ----------------------------- Boucle sim ----------------------------- */

  useEffect(() => {
    if (!playing || !pkg) return;
    const id = window.setInterval(() => {
      const next = Math.min(simTimeRef.current + TICK_MS * speed, pkg.config.endMs);
      simTimeRef.current = next;
      setSimTime(next);
      applyFrame(next, true);
      if (next >= pkg.config.endMs) {
        setPlaying(false);
        setFinished(true);
        // Fin de partie : flip eventStarted=false → cérémonie podium
        // (EventTransitions capture le dernier snapshot pendant le live).
        window.setTimeout(() => applyStatePatch({ eventStarted: false }), 600);
      }
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [playing, speed, pkg, applyFrame, applyStatePatch]);

  /* ------------------------------ Contrôles ----------------------------- */

  const start = useCallback(() => {
    if (!pkg) return;
    setStarted(true);
    setFinished(false);
    // false → true : déclenche le countdown d'intro 15s d'EventTransitions.
    applyStatePatch({
      eventStarted: true,
      eventStartTime: Date.now(),
      eventEndTime: Date.now() + (pkg.config.endMs - pkg.config.startMs),
    });
    setPlaying(true);
  }, [pkg, applyStatePatch]);

  const seek = useCallback((tMs: number) => {
    if (!pkg) return;
    const clamped = Math.max(pkg.config.startMs, Math.min(tMs, pkg.config.endMs));
    simTimeRef.current = clamped;
    setSimTime(clamped);
    setFinished(false);
    if (!started) {
      setStarted(true);
      applyStatePatch({ eventStarted: true });
    }
    applyFrame(clamped, false);
  }, [pkg, started, applyFrame, applyStatePatch]);

  const restart = useCallback(() => {
    if (!pkg) return;
    seenTradesRef.current = new Set();
    seenBadgesRef.current = new Set();
    prevLeaderRef.current = null;
    setFinished(false);
    simTimeRef.current = pkg.config.startMs;
    setSimTime(pkg.config.startMs);
    resetClientLiveState();
    applyFrame(pkg.config.startMs, false);
    applyStatePatch({ eventStarted: true });
    setStarted(true);
    setPlaying(true);
  }, [pkg, applyFrame, applyStatePatch, resetClientLiveState]);

  /* -------------------------------- Rendu ------------------------------- */

  if (loadError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#020617] p-6 text-slate-100">
        <div className="max-w-md rounded-2xl border border-slate-800 bg-slate-900/80 p-7 text-center">
          <p className="mb-4 text-sm text-slate-300">{loadError}</p>
          <a href={ADMIN_BASE} className="text-sm font-semibold text-indigo-300 underline hover:text-indigo-200">
            Retour à l'admin
          </a>
        </div>
      </div>
    );
  }

  if (!pkg) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#020617] text-slate-400">
        Chargement du replay…
      </div>
    );
  }

  const progress = (simTime - pkg.config.startMs) / Math.max(1, pkg.config.endMs - pkg.config.startMs);

  const debugRows = prepared
    ? prepared.resolved.map((r) => {
        const t = simTime;
        const branch = r.exitPrice != null && r.exitTime != null ? 'GLIDE' : 'ANCRE';
        const open = r.input.entryTime <= t && !(r.exitTime != null && r.exitTime <= t);
        // Mark attendu (calculé ICI, indépendamment de computeFrame) pour comparer.
        let expectedMark: number | null = null;
        if (open && r.exitPrice != null && r.exitTime != null) {
          const span = r.exitTime - r.input.entryTime;
          const u = span > 0 ? Math.max(0, Math.min(1, (t - r.input.entryTime) / span)) : 1;
          expectedMark = r.entryPrice + (r.exitPrice - r.entryPrice) * u;
        }
        const expectedPnl = expectedMark != null
          ? (r.input.side === 'long' ? expectedMark - r.entryPrice : r.entryPrice - expectedMark) * r.engineSize
          : null;
        return {
          id: r.input.id,
          pair: r.input.pair,
          engineSize: r.engineSize,
          entryPrice: r.entryPrice,
          exitPrice: r.exitPrice,
          hasExitTime: r.exitTime != null,
          open,
          branch,
          expectedPnl,
        };
      })
    : [];

  return (
    <div className="relative">
      <Dashboard replay />

      {/* DEBUG TEMPORAIRE */}
      <div className="fixed left-2 top-2 z-[400] max-w-[460px] rounded-lg border border-emerald-500/40 bg-black/85 p-2 font-mono text-[10px] leading-tight text-emerald-200 backdrop-blur">
        <div className="mb-1 font-bold text-emerald-400">MOTEUR {REPLAY_ENGINE_VERSION} · t={formatClock(simTime)}</div>
        {debugRows.map((row) => (
          <div key={row.id} className={row.open ? 'text-amber-300' : 'text-slate-400'}>
            {row.pair} sz={row.engineSize} entry={row.entryPrice} exit={row.exitPrice ?? '—'} → {row.branch}
            {row.open && ` [OUVERT] PnL attendu=${row.expectedPnl != null ? row.expectedPnl.toFixed(1) : '?'}$`}
          </div>
        ))}
      </div>

      {/* Barre de contrôle replay */}
      <div className="fixed bottom-0 left-0 right-0 z-[300] border-t border-red-500/20 bg-black/90 px-4 py-2.5 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center gap-4">
          <span className="rounded-md border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.2em] text-red-300">
            Replay
          </span>

          {!started ? (
            <button
              type="button"
              onClick={start}
              className="rounded-lg bg-red-600 px-5 py-1.5 text-sm font-bold uppercase tracking-wider text-white hover:bg-red-500"
            >
              ▶ Lancer la partie
            </button>
          ) : (
            <button
              type="button"
              onClick={() => (finished ? restart() : setPlaying((value) => !value))}
              className="rounded-lg bg-red-600 px-4 py-1.5 text-sm font-bold text-white hover:bg-red-500"
            >
              {finished ? '↻ Rejouer' : playing ? '⏸ Pause' : '▶ Lecture'}
            </button>
          )}

          <div className="flex items-center gap-1">
            {SPEEDS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setSpeed(option)}
                className={`rounded-md px-2 py-1 text-xs font-semibold transition-colors ${
                  speed === option
                    ? 'bg-red-500/20 text-red-300 border border-red-500/40'
                    : 'text-zinc-500 hover:text-zinc-300 border border-transparent'
                }`}
              >
                ×{option}
              </button>
            ))}
          </div>

          {/* Timeline */}
          <input
            type="range"
            min={pkg.config.startMs}
            max={pkg.config.endMs}
            step={1000}
            value={simTime}
            onChange={(event) => seek(Number(event.target.value))}
            className="h-1.5 flex-1 cursor-pointer accent-red-500"
          />

          <div className="shrink-0 font-mono text-xs text-zinc-400 tabular-nums">
            {formatClock(simTime)}
            <span className="mx-1.5 text-zinc-600">·</span>
            <span className="text-zinc-500">{Math.round(progress * 100)}%</span>
            <span className="mx-1.5 text-zinc-600">·</span>
            <span className="text-red-300">-{formatDuration(pkg.config.endMs - simTime)}</span>
          </div>

          <a
            href={ADMIN_BASE}
            className="shrink-0 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-500 hover:text-white"
          >
            Quitter
          </a>
        </div>
      </div>
    </div>
  );
}
