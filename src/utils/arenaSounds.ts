import type { SpotlightTrade } from '../stores/useGameStore';

/** Sons servis depuis `public/assets/Sounds/` (même origine que le dashboard). */
export const ARENA_SOUND_URLS = {
  countdownStart: '/assets/Sounds/Countdown Start.wav',
  countdownEnd: '/assets/Sounds/Countdown END.mp3',
  winner: '/assets/Sounds/Winner.wav',
  newOrder: '/assets/Sounds/New Order.mp3',
  stopLoss: '/assets/Sounds/Stoploss.wav',
  takeProfit: '/assets/Sounds/Take Profit.wav',
} as const;

const SPOTLIGHT_COOLDOWN_MS = 5000;
/** Durée mesurée de Countdown END.mp3 (~73,84 s) — fallback si metadata pas encore chargée. */
const COUNTDOWN_END_DURATION_FALLBACK_MS = 73_837;

const audioBySrc = new Map<string, HTMLAudioElement>();
let countdownEndDurationMs: number | null = null;
let lastSpotlightAt = 0;
let spotlightActive = false;
/** eventEndTime du round pour lequel Countdown END a déjà été joué. */
let countdownEndPlayedFor: number | null = null;
/** Garantit qu'on joue Winner.wav une seule fois par round. */
let winnerSoundLaunched = false;
let unlocked = false;

const COUNTDOWN_END_STORAGE_PREFIX = 'btf-countdown-end:';

function getAudio(src: string): HTMLAudioElement | null {
  if (typeof window === 'undefined') return null;
  let audio = audioBySrc.get(src);
  if (!audio) {
    audio = new Audio(src);
    audio.preload = 'auto';
    audioBySrc.set(src, audio);
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

/**
 * Délai avant la fin du round auquel Countdown END doit démarrer pour
 * terminer pile sur le 0 du timer (= durée exacte du fichier audio).
 */
export function getCountdownEndLeadMs(): number {
  const audio = getAudio(ARENA_SOUND_URLS.countdownEnd);
  if (audio && Number.isFinite(audio.duration) && audio.duration > 0) {
    return Math.ceil(audio.duration * 1000);
  }
  return countdownEndDurationMs ?? COUNTDOWN_END_DURATION_FALLBACK_MS;
}

async function playSrc(src: string, volume = 0.92): Promise<void> {
  const audio = getAudio(src);
  if (!audio) return;
  try {
    audio.volume = volume;
    audio.currentTime = 0;
    await audio.play();
    unlocked = true;
  } catch {
    // Autoplay bloqué tant qu'il n'y a pas eu d'interaction utilisateur.
  }
}

/** Précharge les fichiers (utile après le premier clic sur la page). */
export function preloadArenaSounds(): void {
  for (const src of Object.values(ARENA_SOUND_URLS)) {
    getAudio(src);
  }
}

/**
 * Déverrouille l'audio après un geste utilisateur.
 *
 * Les navigateurs bloquent `audio.play()` tant qu'aucune interaction
 * n'a eu lieu sur la page. Pour que le « Countdown Start » puisse
 * partir quand l'admin clique « Démarrer » depuis un AUTRE onglet,
 * on doit avoir déjà appelé `.play()` au moins une fois sur chaque
 * élément Audio pendant un user gesture sur la page dashboard.
 *
 * On lance donc un play+pause silencieux sur chaque son à la première
 * interaction utilisateur (clic, touche, focus). Ça « débloque » le
 * pipeline pour les futurs `.play()` non liés à un geste.
 */
export function unlockArenaSounds(): void {
  if (unlocked) return;
  unlocked = true;
  for (const src of Object.values(ARENA_SOUND_URLS)) {
    const audio = getAudio(src);
    if (!audio) continue;
    const wasMuted = audio.muted;
    audio.muted = true;
    audio.volume = 0;
    audio
      .play()
      .then(() => {
        audio.pause();
        audio.currentTime = 0;
        audio.muted = wasMuted;
        audio.volume = 0.92;
      })
      .catch(() => {
        audio.muted = wasMuted;
        audio.volume = 0.92;
      });
  }
}

export function resetArenaRoundSounds(): void {
  countdownEndPlayedFor = null;
  winnerSoundLaunched = false;
}

export function resetSpotlightNotifications(): void {
  lastSpotlightAt = 0;
  spotlightActive = false;
}

/** Appelé quand l'overlay spotlight se ferme. */
export function releaseSpotlightSlot(): void {
  spotlightActive = false;
}

/** Au lancement du countdown d'ouverture (bouton « Commencer l'événement »). */
export function playCountdownStartSound(): void {
  void playSrc(ARENA_SOUND_URLS.countdownStart);
}

/**
 * Une seule fois par round (clé = eventEndTime).
 * sessionStorage évite les doubles lectures au refresh ou multi-onglets.
 */
function launchWinnerSound(): void {
  if (winnerSoundLaunched) return;
  winnerSoundLaunched = true;
  void playSrc(ARENA_SOUND_URLS.winner, 0.95);
}

export function playCountdownEndSound(eventEndTime: number): void {
  if (!Number.isFinite(eventEndTime) || eventEndTime <= 0) return;
  if (countdownEndPlayedFor === eventEndTime) return;

  const storageKey = `${COUNTDOWN_END_STORAGE_PREFIX}${eventEndTime}`;
  try {
    if (sessionStorage.getItem(storageKey)) {
      countdownEndPlayedFor = eventEndTime;
      return;
    }
    sessionStorage.setItem(storageKey, '1');
  } catch {
    // Mode privé / storage indisponible — on garde le garde-fou mémoire.
  }

  countdownEndPlayedFor = eventEndTime;

  const audio = getAudio(ARENA_SOUND_URLS.countdownEnd);
  if (!audio) return;
  // Déjà en lecture → ne pas relancer par-dessus.
  if (!audio.paused && audio.currentTime > 0.3) return;

  // Chaîne directement Winner.wav sur l'événement `ended` du Countdown END :
  // Winner doit partir EXACTEMENT à la fin de l'avant-dernière musique,
  // pas à l'apparition de l'overlay champion.
  audio.addEventListener('ended', launchWinnerSound, { once: true });

  audio.volume = 0.92;
  audio.currentTime = 0;
  void audio.play().catch(() => {
    // Autoplay bloqué tant qu'il n'y a pas eu d'interaction utilisateur.
  });
}

/**
 * Fallback uniquement (stop manuel, refresh…) — le cas normal est le
 * chaînage `ended` → Winner depuis playCountdownEndSound.
 */
export function playWinnerSound(): void {
  launchWinnerSound();
}

function spotlightSoundSrc(trade: SpotlightTrade): string | null {
  if (trade.action === 'open') return ARENA_SOUND_URLS.newOrder;
  if (trade.action === 'close') {
    if (trade.reason === 'stop-loss') return ARENA_SOUND_URLS.stopLoss;
    if (trade.reason === 'take-profit') return ARENA_SOUND_URLS.takeProfit;
    // Fermeture manuelle : TP si gain, SL si perte.
    return trade.pnl >= 0 ? ARENA_SOUND_URLS.takeProfit : ARENA_SOUND_URLS.stopLoss;
  }
  return null;
}

/**
 * Affiche + son trade si le cooldown de 5 s est passé et qu'aucun spotlight
 * n'est déjà à l'écran. Sinon ignore — pas de file d'attente.
 */
export function tryAcceptSpotlight(trade: SpotlightTrade): boolean {
  if (spotlightActive) return false;
  const now = Date.now();
  if (now - lastSpotlightAt < SPOTLIGHT_COOLDOWN_MS) return false;

  const src = spotlightSoundSrc(trade);
  if (!src) return false;

  lastSpotlightAt = now;
  spotlightActive = true;
  void playSrc(src, 0.88);
  return true;
}
