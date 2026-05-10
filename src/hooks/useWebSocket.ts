import { useEffect, useRef } from 'react';
import { useGameStore } from '../stores/useGameStore';
import { getWebSocketUrl } from '../lib/runtimeApi';

export function useWebSocket(
  enabled = true,
  options: {
    paperToken?: string | null;
    onPaperUpdate?: (payload: any) => void;
  } = {},
) {
  const wsRef = useRef<WebSocket | null>(null);
  const updateState = useGameStore((s) => s.updateState);
  const onPaperUpdateRef = useRef(options.onPaperUpdate);

  useEffect(() => {
    onPaperUpdateRef.current = options.onPaperUpdate;
  }, [options.onPaperUpdate]);

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
          if (msg.type === 'state') {
            updateState(msg.data);
          } else if (msg.type === 'paper:update') {
            onPaperUpdateRef.current?.(msg.data);
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
  }, [enabled, updateState, options.paperToken]);
}
