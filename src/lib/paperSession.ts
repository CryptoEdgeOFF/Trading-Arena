export const LIVE_PAPER_SESSION_KEY = 'btf-paper-session-live';
export const COMPETE_PAPER_SESSION_KEY = 'btf-paper-session-compete';
export const LEGACY_PAPER_SESSION_KEY = 'btf-paper-session';
export const PAPER_BOOTSTRAP_KEY = 'btf-paper-bootstrap';

export type TerminalPlatform = 'live' | 'compete';

export function getTerminalPlatformFromUrl(search = typeof window !== 'undefined' ? window.location.search : ''): TerminalPlatform {
  const params = new URLSearchParams(search);
  if (params.get('live') === 'true') return 'live';
  return 'compete';
}

export function getPaperSessionStorageKey(platform: TerminalPlatform): string {
  return platform === 'live' ? LIVE_PAPER_SESSION_KEY : COMPETE_PAPER_SESSION_KEY;
}

export function readPaperSessionToken(platform: TerminalPlatform): string | null {
  const scoped = window.localStorage.getItem(getPaperSessionStorageKey(platform));
  if (scoped) return scoped;
  return window.localStorage.getItem(LEGACY_PAPER_SESSION_KEY);
}

export function writePaperSessionToken(platform: TerminalPlatform, token: string): void {
  window.localStorage.setItem(getPaperSessionStorageKey(platform), token);
  if (platform === 'live') {
    window.localStorage.removeItem(COMPETE_PAPER_SESSION_KEY);
  } else {
    window.localStorage.removeItem(LIVE_PAPER_SESSION_KEY);
  }
  window.localStorage.removeItem(LEGACY_PAPER_SESSION_KEY);
}

export function clearPaperSessionToken(platform?: TerminalPlatform): void {
  if (!platform) {
    window.localStorage.removeItem(LIVE_PAPER_SESSION_KEY);
    window.localStorage.removeItem(COMPETE_PAPER_SESSION_KEY);
    window.localStorage.removeItem(LEGACY_PAPER_SESSION_KEY);
    return;
  }
  window.localStorage.removeItem(getPaperSessionStorageKey(platform));
  window.localStorage.removeItem(LEGACY_PAPER_SESSION_KEY);
}

export function isCompetitionPaperSession(payload: { competition?: { id?: string } | null } | null | undefined): boolean {
  return Boolean(payload?.competition?.id);
}
