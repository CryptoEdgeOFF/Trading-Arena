export const LIVE_PAPER_SESSION_KEY = 'btf-paper-session-live';
export const COMPETE_PAPER_SESSION_KEY = 'btf-paper-session-compete';
export const LEGACY_PAPER_SESSION_KEY = 'btf-paper-session';
export const PAPER_BOOTSTRAP_KEY = 'btf-paper-bootstrap';

export type TerminalPlatform = 'live' | 'compete';

export type PaperBootstrapCache = {
  token: string;
  player: unknown;
  platform: TerminalPlatform;
  competitionId?: string | null;
  competition?: unknown;
  market?: unknown;
  canTrade?: boolean | null;
  cachedAt: number;
};

export type PaperCompetitionContext = {
  id: string;
  title?: string;
  executionMode?: string;
  startAt?: number;
  endAt?: number;
  status?: string;
  participants?: number;
  userId?: string | null;
  rank?: number | null;
  pnlPercent?: number;
  dailyDrawdownPercent?: number | null;
  breached?: boolean;
  breachedAt?: number | null;
  dailyBaselineEquity?: number | null;
  dailyLimitEquity?: number | null;
};

/** Normalise les deux formes renvoyées par l'API (`/me` vs `/trade/session`). */
export function extractPaperCompetitionContext(
  payload: { competition?: unknown } | null | undefined,
): PaperCompetitionContext | null {
  if (!payload || typeof payload !== 'object') return null;

  const raw = payload.competition;
  if (!raw || typeof raw !== 'object') return null;

  const nested = (raw as { competition?: { id?: string; title?: string; executionMode?: string; startAt?: number; endAt?: number; status?: string; participants?: number; dailyDrawdownPercent?: number | null } }).competition;
  if (nested?.id) {
    const top = raw as {
      userId?: string | null;
      rank?: number | null;
      pnlPercent?: number;
      breached?: boolean;
      breachedAt?: number | null;
      dailyBaselineEquity?: number | null;
      dailyLimitEquity?: number | null;
    };
    return {
      id: nested.id,
      title: nested.title,
      executionMode: nested.executionMode,
      startAt: nested.startAt,
      endAt: nested.endAt,
      status: nested.status,
      participants: nested.participants,
      userId: top.userId ?? null,
      rank: top.rank ?? null,
      pnlPercent: top.pnlPercent,
      dailyDrawdownPercent: nested.dailyDrawdownPercent ?? null,
      breached: Boolean(top.breached),
      breachedAt: top.breachedAt ?? null,
      dailyBaselineEquity: top.dailyBaselineEquity ?? null,
      dailyLimitEquity: top.dailyLimitEquity ?? null,
    };
  }

  const flat = raw as { id?: string; title?: string; executionMode?: string; startAt?: number; endAt?: number; status?: string; participants?: number; userId?: string | null; rank?: number | null; pnlPercent?: number };
  if (flat.id) {
    return {
      id: flat.id,
      title: flat.title,
      executionMode: flat.executionMode,
      startAt: flat.startAt,
      endAt: flat.endAt,
      status: flat.status,
      participants: flat.participants,
      userId: flat.userId ?? null,
      rank: flat.rank ?? null,
      pnlPercent: flat.pnlPercent,
    };
  }

  return null;
}

export function isCompetitionPaperSession(
  payload: { competition?: unknown } | null | undefined,
): boolean {
  return Boolean(extractPaperCompetitionContext(payload)?.id);
}

export function getTerminalPlatformFromUrl(search = typeof window !== 'undefined' ? window.location.search : ''): TerminalPlatform {
  const params = new URLSearchParams(search);
  if (params.get('live') === 'true') return 'live';
  return 'compete';
}

export function getCompetitionIdFromUrl(search = typeof window !== 'undefined' ? window.location.search : ''): string | null {
  const id = new URLSearchParams(search).get('competitionId');
  return id?.trim() || null;
}

export function getPaperSessionStorageKey(platform: TerminalPlatform): string {
  return platform === 'live' ? LIVE_PAPER_SESSION_KEY : COMPETE_PAPER_SESSION_KEY;
}

export function readPaperSessionToken(platform: TerminalPlatform): string | null {
  const scoped = window.localStorage.getItem(getPaperSessionStorageKey(platform));
  if (scoped) return scoped;
  // Legacy : migrer vers LIVE uniquement (ne jamais réutiliser pour Compete).
  if (platform === 'live') {
    const legacy = window.localStorage.getItem(LEGACY_PAPER_SESSION_KEY);
    if (legacy) {
      window.localStorage.setItem(LIVE_PAPER_SESSION_KEY, legacy);
      window.localStorage.removeItem(LEGACY_PAPER_SESSION_KEY);
      return legacy;
    }
  }
  return null;
}

/** Vérifie que le payload `/me` correspond à la plateforme attendue par l'URL. */
export function paperSessionMatchesPlatform(
  payload: { competition?: unknown } | null | undefined,
  platform: TerminalPlatform,
  urlCompetitionId?: string | null,
): boolean {
  const isCompete = isCompetitionPaperSession(payload);
  if (platform === 'live') return !isCompete;
  if (!isCompete) return false;
  const competition = extractPaperCompetitionContext(payload);
  if (!competition?.id) return false;
  if (urlCompetitionId && competition.id !== urlCompetitionId) return false;
  return true;
}

export function readPaperBootstrapCache(): PaperBootstrapCache | null {
  try {
    const raw = window.localStorage.getItem(PAPER_BOOTSTRAP_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw) as PaperBootstrapCache;
    if (!cached?.token || !cached?.player || !cached?.platform) return null;
    return cached;
  } catch {
    return null;
  }
}

export function isPaperBootstrapCacheValid(
  cached: PaperBootstrapCache,
  platform: TerminalPlatform,
  token: string | null,
  urlCompetitionId?: string | null,
): boolean {
  if (!token || cached.token !== token) return false;
  if (cached.platform !== platform) return false;
  if (!cached.cachedAt || Date.now() - cached.cachedAt > 30_000) return false;
  if (platform === 'compete' && urlCompetitionId && cached.competitionId && cached.competitionId !== urlCompetitionId) {
    return false;
  }
  return true;
}

export function writePaperBootstrapCache(payload: Omit<PaperBootstrapCache, 'cachedAt'>): void {
  try {
    window.localStorage.setItem(
      PAPER_BOOTSTRAP_KEY,
      JSON.stringify({ ...payload, cachedAt: Date.now() }),
    );
  } catch {
    // localStorage indispo
  }
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
    window.localStorage.removeItem(PAPER_BOOTSTRAP_KEY);
    return;
  }
  window.localStorage.removeItem(getPaperSessionStorageKey(platform));
  window.localStorage.removeItem(LEGACY_PAPER_SESSION_KEY);
  window.localStorage.removeItem(PAPER_BOOTSTRAP_KEY);
}

/** Déconnexion complète du terminal paper (live + compete + cache bootstrap). */
export function clearAllPaperSessions(): void {
  clearPaperSessionToken();
}

export function buildCompeteTradeUrl(competition: {
  id: string;
  title?: string | null;
  executionMode?: string | null;
}): string {
  const params = new URLSearchParams();
  params.set('competitionId', competition.id);
  if (competition.title) params.set('competitionTitle', competition.title);
  params.set('competitionMode', competition.executionMode === 'real' ? 'real' : 'paper');
  return `/trade?${params.toString()}`;
}
