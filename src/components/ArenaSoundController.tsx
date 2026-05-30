import { useEffect, useRef } from 'react';
import { useGameStore } from '../stores/useGameStore';
import {
  getCountdownEndLeadMs,
  playCountdownEndSound,
  playSpotlightTradeSound,
  preloadArenaSounds,
  unlockArenaSounds,
} from '../utils/arenaSounds';

/**
 * Hub central des sons du dashboard LIVE :
 * - déverrouillage autoplay
 * - Countdown END (T − durée fichier)
 * - FX trade spotlight (dédoublonnés, file séquentielle)
 */
export default function ArenaSoundController() {
  const eventStarted = useGameStore((s) => s.eventStarted);
  const eventEndTime = useGameStore((s) => s.eventEndTime);
  const spotlightTrade = useGameStore((s) => s.spotlightTrade);

  const playedEndForRef = useRef<number | null>(null);
  const lastSpotlightSoundIdRef = useRef<string | null>(null);

  useEffect(() => {
    preloadArenaSounds();
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
      playedEndForRef.current = null;
    }
  }, [eventStarted]);

  useEffect(() => {
    if (!eventStarted || eventEndTime == null) return;

    const tick = () => {
      const remaining = eventEndTime - Date.now();
      if (remaining > getCountdownEndLeadMs()) return;
      if (playedEndForRef.current === eventEndTime) return;

      const started = playCountdownEndSound(eventEndTime);
      if (started) {
        playedEndForRef.current = eventEndTime;
      }
    };

    tick();
    const id = window.setInterval(tick, 400);
    return () => window.clearInterval(id);
  }, [eventStarted, eventEndTime]);

  useEffect(() => {
    if (!spotlightTrade) {
      lastSpotlightSoundIdRef.current = null;
      return;
    }
    if (lastSpotlightSoundIdRef.current === spotlightTrade.id) return;
    lastSpotlightSoundIdRef.current = spotlightTrade.id;
    playSpotlightTradeSound(spotlightTrade);
  }, [spotlightTrade]);

  return null;
}
