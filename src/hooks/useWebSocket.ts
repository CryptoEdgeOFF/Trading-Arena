import { useEffect, useRef } from 'react';
import { useGameStore } from '../stores/useGameStore';
import { getWebSocketUrl } from '../lib/runtimeApi';

export function useWebSocket(enabled = true) {
  const wsRef = useRef<WebSocket | null>(null);
  const updateState = useGameStore((s) => s.updateState);

  useEffect(() => {
    if (!enabled) return;

    function connect() {
      const ws = new WebSocket(getWebSocketUrl());
      wsRef.current = ws;

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'state') {
            updateState(msg.data);
          }
        } catch {
          // ignore parse errors
        }
      };

      ws.onclose = () => {
        setTimeout(connect, 2000);
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      wsRef.current?.close();
    };
  }, [enabled, updateState]);
}
