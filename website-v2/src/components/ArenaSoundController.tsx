import { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../stores/useGameStore';
import {
  getSafeCountdownEndLeadMs,
  isArenaAudioReady,
  markArenaAudioReady,
  playCountdownEndSound,
  playSpotlightTradeSound,
  preloadArenaSounds,
  unlockArenaSounds,
} from '../utils/arenaSounds';

/**
 * Hub central des sons du dashboard LIVE :
 * - déverrouillage autoplay (+ bouton explicite si aucun geste sur la page)
 * - Countdown END (T − durée fichier)
 * - FX trade spotlight (dédoublonnés, file séquentielle)
 */
export default function ArenaSoundController() {
  const eventStarted = useGameStore((s) => s.eventStarted);
  const eventStartTime = useGameStore((s) => s.eventStartTime);
  const eventEndTime = useGameStore((s) => s.eventEndTime);
  const spotlightTrade = useGameStore((s) => s.spotlightTrade);

  const playedEndForRef = useRef<number | null>(null);
  const lastSpotlightSoundIdRef = useRef<string | null>(null);
  const [audioReady, setAudioReady] = useState<boolean>(() => isArenaAudioReady());

  useEffect(() => {
    preloadArenaSounds();
    // Tout geste sur la page débloque l'autoplay. En 5v5 le dashboard n'a aucun
    // panneau cliquable : le bouton « Activer le son » garantit ce geste.
    const onUnlock = () => {
      unlockArenaSounds();
      markArenaAudioReady();
      setAudioReady(true);
    };
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
      const elapsed = typeof eventStartTime === 'number' ? Date.now() - eventStartTime : 0;
      // Ne jamais lancer la musique de fin pendant l'intro ou juste après le GO.
      if (elapsed < 20_000) return;
      if (remaining > getSafeCountdownEndLeadMs(eventStartTime, eventEndTime)) return;
      if (playedEndForRef.current === eventEndTime) return;

      const started = playCountdownEndSound(eventEndTime);
      if (started) {
        playedEndForRef.current = eventEndTime;
      }
    };

    tick();
    const id = window.setInterval(tick, 400);
    return () => window.clearInterval(id);
  }, [eventStarted, eventStartTime, eventEndTime]);

  useEffect(() => {
    if (!spotlightTrade) {
      lastSpotlightSoundIdRef.current = null;
      return;
    }
    if (lastSpotlightSoundIdRef.current === spotlightTrade.id) return;
    lastSpotlightSoundIdRef.current = spotlightTrade.id;
    playSpotlightTradeSound(spotlightTrade);
  }, [spotlightTrade]);

  if (audioReady) return null;

  return (
    <button
      type="button"
      onClick={() => {
        unlockArenaSounds();
        markArenaAudioReady();
        setAudioReady(true);
      }}
      className="fixed bottom-6 right-6 z-[130] flex items-center gap-2.5 rounded-full border border-red-500/40 bg-black/80 px-5 py-3 text-sm font-bold uppercase tracking-[0.18em] text-white shadow-[0_18px_50px_-12px_rgba(220,38,38,0.7)] backdrop-blur transition-transform hover:scale-[1.03]"
      aria-label="Activer le son"
    >
      <span className="relative flex h-2.5 w-2.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
      </span>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M11 5 6 9H2v6h4l5 4V5z" />
        <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
        <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
      </svg>
      Activer le son
    </button>
  );
}
