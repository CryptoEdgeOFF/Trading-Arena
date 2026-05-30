import type { SpotlightTrade } from '../stores/useGameStore';

/** Sons servis depuis `public/assets/Sounds/` (même origine que le dashboard). */
export const ARENA_SOUND_URLS = {
  countdownStart: '/assets/Sounds/Countdown Start.wav',
  countdownEnd: '/assets/Sounds/Countdown END.mp3',
  winner: '/assets/Sounds/Winner.wav',
  newOrder: '/assets/Sounds/New Order.mp3',
  stopLoss: '/assets/Sounds/Stoploss.wav',
  takeProfit: '/assets/Sounds/Take Profit.wav',
  wheel: '/assets/Sounds/wheel.mp3',
} as const;

const SPOTLIGHT_COOLDOWN_MS = 5000;
const COUNTDOWN_END_DURATION_FALLBACK_MS = 73_837;
const MAX_PLAYED_KEYS = 500;
const COUNTDOWN_END_STORAGE_PREFIX = 'btf-countdown-end:';

function resolveAudioSrc(src: string): string {
  return encodeURI(src);
}

/** Sons longs : un seul élément, pas de superposition. */
const longFormBySrc = new Map<string, HTMLAudioElement>();
/** FX courts : nouvelle instance à chaque lecture (évite les coupures / doubles reset). */
let countdownEndDurationMs: number | null = null;

let unlockSucceeded = false;
let unlockInFlight = false;
/**
 * Vrai dès qu'un son a réellement pu démarrer (= autoplay débloqué par un
 * geste utilisateur). Sert à afficher le bouton « Activer le son » tant que
 * le navigateur bloque la lecture — notamment en 5v5 où le dashboard n'a aucun
 * panneau cliquable pour produire ce geste.
 */
let arenaAudioReady = false;

let lastSpotlightAt = 0;
let spotlightActive = false;
const shownSpotlightIds = new Set<string>();

let countdownEndPlayedFor: number | null = null;
let winnerSoundLaunched = false;
let malusWheelPlayedFor: string | null = null;

/** File FX séquentielle — aucun son court perdu, pas de chevauchement du même key. */
type FxJob = { src: string; key: string; volume: number };
const fxQueue: FxJob[] = [];
const fxQueuedOrPlayedKeys = new Set<string>();
let fxDrainRunning = false;

function trimPlayedKeys(set: Set<string>): void {
  if (set.size <= MAX_PLAYED_KEYS) return;
  const drop = set.size - MAX_PLAYED_KEYS;
  const iter = set.values();
  for (let i = 0; i < drop; i += 1) {
    const next = iter.next();
    if (next.done) break;
    set.delete(next.value);
  }
}

function rememberKey(set: Set<string>, key: string): void {
  set.add(key);
  trimPlayedKeys(set);
}

function getLongFormAudio(src: string): HTMLAudioElement | null {
  if (typeof window === 'undefined') return null;
  const resolved = resolveAudioSrc(src);
  let audio = longFormBySrc.get(src);
  if (!audio) {
    audio = new Audio(resolved);
    audio.preload = 'auto';
    longFormBySrc.set(src, audio);
    if (src === ARENA_SOUND_URLS.countdownEnd) {
      const captureDuration = () => {
        if (Number.isFinite(audio!.duration) && audio!.duration > 0) {
          countdownEndDurationMs = Math.ceil(audio!.duration * 1000);
        }
      };
      audio.addEventListener('loadedmetadata', captureDuration, { once: true });
      audio.addEventListener('durationchange', captureDuration);
    }
  }
  return audio;
}

function createFxAudio(src: string): HTMLAudioElement | null {
  if (typeof window === 'undefined') return null;
  const audio = new Audio(resolveAudioSrc(src));
  audio.preload = 'auto';
  return audio;
}

async function playAudioElement(audio: HTMLAudioElement, volume: number): Promise<boolean> {
  try {
    audio.volume = volume;
    audio.currentTime = 0;
    await audio.play();
    unlockSucceeded = true;
    arenaAudioReady = true;
    return true;
  } catch {
    return false;
  }
}

async function drainFxQueue(): Promise<void> {
  if (fxDrainRunning) return;
  fxDrainRunning = true;
  try {
    while (fxQueue.length > 0) {
      const job = fxQueue.shift();
      if (!job) continue;
      if (fxQueuedOrPlayedKeys.has(job.key)) continue;

      const audio = createFxAudio(job.src);
      if (!audio) continue;

      const played = await new Promise<boolean>((resolve) => {
        const finish = (ok: boolean) => {
          audio.removeEventListener('ended', onEnded);
          audio.removeEventListener('error', onError);
          resolve(ok);
        };
        const onEnded = () => finish(true);
        const onError = () => finish(false);

        audio.addEventListener('ended', onEnded, { once: true });
        audio.addEventListener('error', onError, { once: true });

        void playAudioElement(audio, job.volume).then((ok) => {
          if (!ok) finish(false);
        });
      });

      if (played) rememberKey(fxQueuedOrPlayedKeys, job.key);
    }
  } finally {
    fxDrainRunning = false;
  }
}

function enqueueFx(src: string, key: string, volume = 0.88): void {
  if (fxQueuedOrPlayedKeys.has(key)) return;
  if (fxQueue.some((job) => job.key === key)) return;
  fxQueue.push({ src, key, volume });
  void drainFxQueue();
}

export function getCountdownEndLeadMs(): number {
  const audio = getLongFormAudio(ARENA_SOUND_URLS.countdownEnd);
  if (audio && Number.isFinite(audio.duration) && audio.duration > 0) {
    return Math.ceil(audio.duration * 1000);
  }
  return countdownEndDurationMs ?? COUNTDOWN_END_DURATION_FALLBACK_MS;
}

export function preloadArenaSounds(): void {
  for (const src of Object.values(ARENA_SOUND_URLS)) {
    getLongFormAudio(src);
    const probe = createFxAudio(src);
    if (probe) probe.load();
  }
}

/**
 * Déverrouille l'autoplay après un geste utilisateur.
 * Reste ré-essayable tant qu'aucun play() n'a réussi.
 */
export function unlockArenaSounds(): void {
  if (unlockSucceeded || unlockInFlight) return;
  unlockInFlight = true;

  const attempts = Object.values(ARENA_SOUND_URLS).map(async (src) => {
    const audio = createFxAudio(src);
    if (!audio) return false;
    const wasMuted = audio.muted;
    audio.muted = true;
    audio.volume = 0;
    try {
      await audio.play();
      audio.pause();
      audio.currentTime = 0;
      unlockSucceeded = true;
      return true;
    } catch {
      return false;
    } finally {
      audio.muted = wasMuted;
      audio.volume = 0.92;
    }
  });

  void Promise.all(attempts).finally(() => {
    unlockInFlight = false;
  });
}

function stopLongFormSound(src: string): void {
  const audio = longFormBySrc.get(src);
  if (!audio) return;
  audio.pause();
  audio.currentTime = 0;
}

export function resetArenaRoundSounds(): void {
  countdownEndPlayedFor = null;
  winnerSoundLaunched = false;
  shownSpotlightIds.clear();
  fxQueuedOrPlayedKeys.clear();
  fxQueue.length = 0;
  stopIntroCountdownMusic();
  // Fin 5v5 : Countdown END (~73s) peut encore tourner quand l'admin relance.
  stopLongFormSound(ARENA_SOUND_URLS.countdownEnd);
  stopMalusWheelSound();
  malusWheelPlayedFor = null;
}

export function isArenaAudioReady(): boolean {
  return arenaAudioReady;
}

/** Marque l'audio comme débloqué après un geste utilisateur explicite. */
export function markArenaAudioReady(): void {
  arenaAudioReady = true;
}

export function isIntroCountdownPlaying(): boolean {
  const audio = longFormBySrc.get(ARENA_SOUND_URLS.countdownStart);
  return Boolean(audio && !audio.paused && audio.currentTime > 0.05);
}

/** Lance « Countdown Start » (~21s) — joue jusqu'à la fin du fichier, pas coupé au timer 15s. */
export async function startIntroCountdownMusic(): Promise<boolean> {
  unlockArenaSounds();
  stopLongFormSound(ARENA_SOUND_URLS.countdownEnd);

  const audio = getLongFormAudio(ARENA_SOUND_URLS.countdownStart);
  if (!audio) return false;
  if (!audio.paused && audio.currentTime > 0.05) return true;

  audio.loop = false;
  return playAudioElement(audio, 0.92);
}

export function stopIntroCountdownMusic(): void {
  stopLongFormSound(ARENA_SOUND_URLS.countdownStart);
}

export function resetSpotlightNotifications(): void {
  lastSpotlightAt = 0;
  spotlightActive = false;
  shownSpotlightIds.clear();
}

export function releaseSpotlightSlot(): void {
  spotlightActive = false;
}

/** Une seule lecture par eventStartTime (anti Strict Mode / double patch). */
export function playCountdownStartSound(_eventStartTime?: number | null): void {
  startIntroCountdownMusic();
}

function launchWinnerSound(eventEndTime: number): void {
  const key = `winner:${eventEndTime}`;
  if (winnerSoundLaunched || fxQueuedOrPlayedKeys.has(key)) return;
  winnerSoundLaunched = true;
  enqueueFx(ARENA_SOUND_URLS.winner, key, 0.95);
}

export function playCountdownEndSound(eventEndTime: number): boolean {
  if (!Number.isFinite(eventEndTime) || eventEndTime <= 0) return false;
  if (countdownEndPlayedFor === eventEndTime) return false;

  const storageKey = `${COUNTDOWN_END_STORAGE_PREFIX}${eventEndTime}`;
  try {
    if (sessionStorage.getItem(storageKey)) {
      countdownEndPlayedFor = eventEndTime;
      return false;
    }
  } catch {
    // storage indisponible
  }

  const audio = getLongFormAudio(ARENA_SOUND_URLS.countdownEnd);
  if (!audio) return false;

  if (!audio.paused && audio.currentTime > 0.3) {
    countdownEndPlayedFor = eventEndTime;
    try {
      sessionStorage.setItem(storageKey, '1');
    } catch {
      // ignore
    }
    return false;
  }

  const onEnded = () => {
    audio.removeEventListener('ended', onEnded);
    launchWinnerSound(eventEndTime);
  };
  audio.addEventListener('ended', onEnded, { once: true });

  void playAudioElement(audio, 0.92).then((ok) => {
    if (!ok) {
      audio.removeEventListener('ended', onEnded);
      return;
    }
    countdownEndPlayedFor = eventEndTime;
    try {
      sessionStorage.setItem(storageKey, '1');
    } catch {
      // ignore
    }
  });

  return true;
}

export function playWinnerSound(eventEndTime?: number | null): void {
  if (eventEndTime != null && Number.isFinite(eventEndTime)) {
    launchWinnerSound(eventEndTime);
    return;
  }
  enqueueFx(ARENA_SOUND_URLS.winner, `winner:fallback:${Date.now()}`, 0.95);
}

export function isMalusWheelPlaying(): boolean {
  const audio = longFormBySrc.get(ARENA_SOUND_URLS.wheel);
  return Boolean(audio && !audio.paused && audio.currentTime > 0.05);
}

/** Son du carousel malus (~5s) au lancement du tirage. */
export async function playMalusWheelSound(malusId: string): Promise<boolean> {
  if (malusWheelPlayedFor === malusId && isMalusWheelPlaying()) return true;
  unlockArenaSounds();
  const audio = getLongFormAudio(ARENA_SOUND_URLS.wheel);
  if (!audio) return false;
  const ok = await playAudioElement(audio, 0.92);
  if (ok) malusWheelPlayedFor = malusId;
  return ok;
}

export function stopMalusWheelSound(): void {
  stopLongFormSound(ARENA_SOUND_URLS.wheel);
}

function spotlightSoundSrc(trade: SpotlightTrade): string | null {
  if (trade.action === 'open') return ARENA_SOUND_URLS.newOrder;
  if (trade.action === 'close') {
    // Stop loss suiveur : un SL qui se déclenche en gain (le trader a remonté
    // son stop au-dessus de l'entrée) → son de Take Profit, pas de Stop Loss.
    if (trade.reason === 'stop-loss') {
      return trade.pnl > 0 ? ARENA_SOUND_URLS.takeProfit : ARENA_SOUND_URLS.stopLoss;
    }
    if (trade.reason === 'take-profit') return ARENA_SOUND_URLS.takeProfit;
    return trade.pnl >= 0 ? ARENA_SOUND_URLS.takeProfit : ARENA_SOUND_URLS.stopLoss;
  }
  return null;
}

/**
 * Admission UI spotlight (sans lecture audio — le son part de ArenaSoundController).
 */
export function tryAcceptSpotlight(trade: SpotlightTrade): boolean {
  if (shownSpotlightIds.has(trade.id)) return false;
  if (spotlightActive) return false;
  const now = Date.now();
  if (now - lastSpotlightAt < SPOTLIGHT_COOLDOWN_MS) return false;

  shownSpotlightIds.add(trade.id);
  lastSpotlightAt = now;
  spotlightActive = true;
  return true;
}

/** Lecture FX liée à un trade spotlight (dédoublonnée par trade.id). */
export function playSpotlightTradeSound(trade: SpotlightTrade): void {
  const src = spotlightSoundSrc(trade);
  if (!src) return;
  enqueueFx(src, `spotlight:${trade.id}`, 0.88);
}
