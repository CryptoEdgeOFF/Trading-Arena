export const COMPETE_SESSION_KEY = 'btf-comp-session';
export const COMPETE_SESSION_USER_KEY = 'btf-comp-user';

export interface CompeteSessionUser {
  id: string;
  email: string;
  name: string;
  phone?: string | null;
  phoneVerifiedAt?: number | null;
  avatarUrl?: string | null;
  socials?: {
    x?: string;
    instagram?: string;
    discord?: string;
    website?: string;
  };
}

export function avatarVersion(avatarUrl?: string | null): number {
  if (!avatarUrl) return 0;
  try {
    const v = new URL(avatarUrl, 'http://local').searchParams.get('v');
    const parsed = v ? Number.parseInt(v, 10) : 0;
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    return 0;
  }
}

/** Garde l'avatar le plus récent quand plusieurs sources se chevauchent (cache, bootstrap, /me). */
export function mergeSessionUser(
  current: CompeteSessionUser | null,
  incoming: CompeteSessionUser,
): CompeteSessionUser {
  if (!current) return incoming;
  const currentV = avatarVersion(current.avatarUrl);
  const incomingV = avatarVersion(incoming.avatarUrl);
  if (currentV > incomingV) {
    return { ...incoming, avatarUrl: current.avatarUrl };
  }
  return incoming;
}

export function readCachedCompeteUser(): CompeteSessionUser | null {
  try {
    const raw = window.localStorage.getItem(COMPETE_SESSION_USER_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as CompeteSessionUser;
  } catch {
    return null;
  }
}

export function writeCachedCompeteUser(user: CompeteSessionUser | null): void {
  try {
    if (user) window.localStorage.setItem(COMPETE_SESSION_USER_KEY, JSON.stringify(user));
    else window.localStorage.removeItem(COMPETE_SESSION_USER_KEY);
  } catch {
    // ignore quota errors
  }
}
