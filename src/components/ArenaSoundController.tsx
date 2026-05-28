import { useEffect, useRef } from 'react';
import { useGameStore } from '../stores/useGameStore';
import {
  getCountdownEndLeadMs,
  playCountdownEndSound,
  preloadArenaSounds,
  unlockArenaSounds,
} from '../utils/arenaSounds';

/**
 * Sons liés au timer du round.
 * Countdown END démarre à T − durée(audio) pour finir pile sur le 0,
 * puis Winner.wav s'enchaîne sur l'événement `ended`.
 */
export default function ArenaSoundController() {
  const eventStarted = useGameStore((s) => s.eventStarted);
  const eventEndTime = useGameStore((s) => s.eventEndTime);
  const playedForEndTimeRef = useRef<number | null>(null);

  useEffect(() => {
    preloadArenaSounds();
    // On tente de déverrouiller à chaque interaction tant que ce n'est
    // pas fait — `unlockArenaSounds` est idempotent (early return après
    // succès). Plus de `once: true` : si un premier clic se passe avant
    // que les Audio ne soient prêts, le suivant prendra le relais.
    const onUnlock = () => unlockArenaSounds();
    window.addEventListener('pointerdown', onUnlock);
    window.addEventListener('keydown', onUnlock);
    window.addEventListener('touchstart', onUnlock, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', onUnlock);
      window.removeEventListener('keydown', onUnlock);
      window.removeEventListener('touchstart', onUnlock);
    };
  }, []);

  useEffect(() => {
    if (!eventStarted) {
      playedForEndTimeRef.current = null;
    }
  }, [eventStarted]);

  useEffect(() => {
    if (!eventStarted || eventEndTime == null) return;

    const tick = () => {
      const remaining = eventEndTime - Date.now();
      if (remaining > getCountdownEndLeadMs()) return;
      if (playedForEndTimeRef.current === eventEndTime) return;
      playedForEndTimeRef.current = eventEndTime;
      playCountdownEndSound(eventEndTime);
    };

    tick();
    const id = window.setInterval(tick, 400);
    return () => window.clearInterval(id);
  }, [eventStarted, eventEndTime]);

  return null;
}
