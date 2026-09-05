import { useEffect, useRef } from 'react';
import { useGameStore } from '../stores/useGameStore';
import { getWebSocketUrl } from '../lib/runtimeApi';

export function useWebSocket(
  enabled = true,
  options: {
    paperToken?: string | null;
    arenaId?: string | null;
    onPaperUpdate?: (payload: any) => void;
    onPaperPatch?: (payload: any) => void;
    onMarketTick?: (payload: { ticks?: Array<{ pair: string; markPrice: number; bidPrice?: number; askPrice?: number; updatedAt?: number }> }) => void;
    onArenaInit?: (payload: any) => void;
    onArenaPatch?: (payload: any) => void;
    onOpen?: () => void;
    onClose?: () => void;
  } = {},
) {
  const wsRef = useRef<WebSocket | null>(null);
  const updateState = useGameStore((s) => s.updateState);
  const applyStatePatch = useGameStore((s) => s.applyStatePatch);
  const onPaperUpdateRef = useRef(options.onPaperUpdate);
  const onPaperPatchRef = useRef(options.onPaperPatch);
  const onMarketTickRef = useRef(options.onMarketTick);
  const onArenaInitRef = useRef(options.onArenaInit);
  const onArenaPatchRef = useRef(options.onArenaPatch);
  const onOpenRef = useRef(options.onOpen);
  const onCloseRef = useRef(options.onClose);

  useEffect(() => {
    onPaperUpdateRef.current = options.onPaperUpdate;
  }, [options.onPaperUpdate]);

  useEffect(() => {
    onPaperPatchRef.current = options.onPaperPatch;
  }, [options.onPaperPatch]);

  useEffect(() => {
    onMarketTickRef.current = options.onMarketTick;
  }, [options.onMarketTick]);

  useEffect(() => {
    onArenaInitRef.current = options.onArenaInit;
  }, [options.onArenaInit]);

  useEffect(() => {
    onArenaPatchRef.current = options.onArenaPatch;
  }, [options.onArenaPatch]);

  useEffect(() => {
    onOpenRef.current = options.onOpen;
  }, [options.onOpen]);

  useEffect(() => {
    onCloseRef.current = options.onClose;
  }, [options.onClose]);

  useEffect(() => {
    if (!enabled) return;
    let closedByEffect = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      const query = new URLSearchParams();
      if (options.paperToken) query.set('paperToken', options.paperToken);
      if (options.arenaId) query.set('arenaId', options.arenaId);
      const path = `/ws${query.size > 0 ? `?${query.toString()}` : ''}`;
      const ws = new WebSocket(getWebSocketUrl(path));
      wsRef.current = ws;

      ws.onopen = () => onOpenRef.current?.();

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'state:init' || msg.type === 'state') {
            // Full snapshot delivered on connect / fallback for legacy clients.
            updateState(msg.data);
          } else if (msg.type === 'state:patch') {
            // Incremental diff: only changed players, market pairs and trades.
            applyStatePatch(msg.data);
          } else if (msg.type === 'paper:init' || msg.type === 'paper:update') {
            onPaperUpdateRef.current?.(msg.data);
          } else if (msg.type === 'paper:patch') {
            onPaperPatchRef.current?.(msg.data);
          } else if (msg.type === 'market:tick') {
            onMarketTickRef.current?.(msg.data);
          } else if (msg.type === 'arena:init') {
            // Full leaderboard snapshot for the trader's competition shard.
            onArenaInitRef.current?.(msg.data);
          } else if (msg.type === 'arena:patch') {
            // Incremental leaderboard diff scoped to the trader's arena.
            onArenaPatchRef.current?.(msg.data);
          }
        } catch {
          // ignore parse errors
        }
      };

      ws.onclose = () => {
        onCloseRef.current?.();
        if (!closedByEffect) reconnectTimer = setTimeout(connect, 1000);
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      closedByEffect = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, [enabled, updateState, applyStatePatch, options.paperToken, options.arenaId]);
}
