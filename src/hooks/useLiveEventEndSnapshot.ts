import { useCallback, useEffect, useRef, useState } from 'react';
import { useGameStore, type EventMode, type Player, type TeamInfo } from '../stores/useGameStore';

export type LiveEventEndResult = {
  players: Player[];
  teams: [TeamInfo, TeamInfo] | null;
  eventMode: EventMode;
};

/**
 * Détecte la fin d'un round LIVE et fige le dernier snapshot exploitable.
 *
 * Le serveur purge les PnL dans le même patch que `eventStarted=false`, donc on
 * ne peut pas se baser sur l'état courant au moment de la transition : on
 * conserve le dernier snapshot capturé PENDANT que l'event tournait.
 *
 * Partagé entre le dashboard et les terminaux trader pour rejouer la même
 * animation de fin (podium / stats).
 */
export function useLiveEventEndSnapshot(): {
  result: LiveEventEndResult | null;
  dismiss: () => void;
} {
  const eventStarted = useGameStore((s) => s.eventStarted);
  const eventMode = useGameStore((s) => s.eventMode);
  const teams = useGameStore((s) => s.teams);
  const players = useGameStore((s) => s.players);
  const liveStateSynced = useGameStore((s) => s.liveStateSynced);

  const [result, setResult] = useState<LiveEventEndResult | null>(null);

  const previousStartedRef = useRef<boolean | null>(null);
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
      liveSnapshotRef.current = [];
      setResult(null);
      return;
    }

    if (wasStarted && !eventStarted) {
      const source = liveSnapshotRef.current.length > 0 ? liveSnapshotRef.current : players;
      const snapshot = [...source].sort((a, b) => b.pnl - a.pnl);
      if (snapshot.length === 0) {
        setResult(null);
        return;
      }
      setResult({
        players: snapshot,
        teams: liveTeamsSnapshotRef.current ?? teams ?? null,
        eventMode: liveEventModeSnapshotRef.current ?? eventMode,
      });
    }
  }, [liveStateSynced, eventStarted, players, teams, eventMode]);

  const dismiss = useCallback(() => setResult(null), []);

  return { result, dismiss };
}
