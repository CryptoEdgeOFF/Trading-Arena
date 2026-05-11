import { useEffect, useRef } from 'react';
import { useGameStore } from '../stores/useGameStore';
import { getWebSocketUrl } from '../lib/runtimeApi';

export function useWebSocket(
  enabled = true,
  options: {
    paperToken?: string | null;
    onPaperUpdate?: (payload: any) => void;
    onArenaInit?: (payload: any) => void;
    onArenaPatch?: (payload: any) => void;
  } = {},
) {
  const wsRef = useRef<WebSocket | null>(null);
  const updateState = useGameStore((s) => s.updateState);
  const applyStatePatch = useGameStore((s) => s.applyStatePatch);
  const onPaperUpdateRef = useRef(options.onPaperUpdate);
  const onArenaInitRef = useRef(options.onArenaInit);
  const onArenaPatchRef = useRef(options.onArenaPatch);

  useEffect(() => {
    onPaperUpdateRef.current = options.onPaperUpdate;
  }, [options.onPaperUpdate]);

  useEffect(() => {
    onArenaInitRef.current = options.onArenaInit;
  }, [options.onArenaInit]);

  useEffect(() => {
    onArenaPatchRef.current = options.onArenaPatch;
  }, [options.onArenaPatch]);

  useEffect(() => {
    if (!enabled) return;
    let closedByEffect = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      const path = options.paperToken ? `/ws?paperToken=${encodeURIComponent(options.paperToken)}` : '/ws';
      const ws = new WebSocket(getWebSocketUrl(path));
      wsRef.current = ws;

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'state:init' || msg.type === 'state') {
            // Full snapshot delivered on connect / fallback for legacy clients.
            updateState(msg.data);
          } else if (msg.type === 'state:patch') {
            // Incremental diff: only changed players, market pairs and trades.
            applyStatePatch(msg.data);
          } else if (msg.type === 'paper:update') {
            onPaperUpdateRef.current?.(msg.data);
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
  }, [enabled, updateState, applyStatePatch, options.paperToken]);
}
