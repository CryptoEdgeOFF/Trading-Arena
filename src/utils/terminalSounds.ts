const TERMINAL_SOUND_URLS = {
  newPosition: '/assets/Sounds/Sounds btfarena/New Position.wav',
  win: '/assets/Sounds/Sounds btfarena/Win.wav',
  loss: '/assets/Sounds/Sounds btfarena/Lose.wav',
} as const;

const preloaded = new Map<string, HTMLAudioElement>();
let unlocked = false;

function resolveSrc(src: string): string {
  return encodeURI(src);
}

function getPrototype(src: string): HTMLAudioElement | null {
  if (typeof window === 'undefined') return null;
  let audio = preloaded.get(src);
  if (!audio) {
    audio = new Audio(resolveSrc(src));
    audio.preload = 'auto';
    preloaded.set(src, audio);
  }
  return audio;
}

function playFx(src: string, volume = 0.88): void {
  const proto = getPrototype(src);
  if (!proto) return;
  const audio = proto.cloneNode(true) as HTMLAudioElement;
  audio.volume = volume;
  void audio.play().then(() => {
    unlocked = true;
  }).catch(() => undefined);
}

export function preloadTerminalSounds(): void {
  for (const src of Object.values(TERMINAL_SOUND_URLS)) {
    getPrototype(src)?.load();
  }
}

export function unlockTerminalSounds(): void {
  if (unlocked || typeof window === 'undefined') return;
  for (const src of Object.values(TERMINAL_SOUND_URLS)) {
    const audio = getPrototype(src);
    if (!audio) continue;
    const wasMuted = audio.muted;
    audio.muted = true;
    audio.volume = 0;
    void audio.play().then(() => {
      audio.pause();
      audio.currentTime = 0;
      unlocked = true;
    }).catch(() => undefined).finally(() => {
      audio.muted = wasMuted;
      audio.volume = 0.88;
    });
  }
}

/** Market, limit, SL ou TP que le trader vient de poser. */
export function playNewPositionSound(): void {
  unlockTerminalSounds();
  playFx(TERMINAL_SOUND_URLS.newPosition);
}

/** Clôture manuelle, SL ou TP — uniquement selon le PnL. */
export function playTradeCloseSound(pnl: number): void {
  unlockTerminalSounds();
  playFx(Number(pnl) > 0 ? TERMINAL_SOUND_URLS.win : TERMINAL_SOUND_URLS.loss);
}
