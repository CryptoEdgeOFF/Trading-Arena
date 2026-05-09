import { useEffect, useRef } from 'react';
import { useGameStore } from '../stores/useGameStore';

export function useWebSocket(enabled = true) {
  const wsRef = useRef<WebSocket | null>(null);
  const updateState = useGameStore((s) => s.updateState);

  useEffect(() => {
    if (!enabled) return;

    function connect() {
      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const wsUrl = `${protocol}://${window.location.host}/ws`;
      const ws = new WebSocket(wsUrl);
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
