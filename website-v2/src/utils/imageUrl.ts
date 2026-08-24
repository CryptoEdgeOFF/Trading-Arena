import { API_BASE_URL } from '../lib/runtimeApi';

const API_IMAGE_PREFIXES = ['/api/avatars/', '/api/roster/avatars/', '/api/prize-images/', '/api/team-images/'];

/** Résout un média API (`/api/avatars`, `/uploads`, …) vers le backend courant. */
export function resolveMediaUrl(src: string | null | undefined): string | undefined {
  if (!src) return undefined;
  if (src.startsWith('data:') || src.startsWith('blob:')) return src;
  if (src.startsWith('http://') || src.startsWith('https://')) return src;
  if (API_BASE_URL && (src.startsWith('/api/') || src.startsWith('/uploads/'))) {
    return `${API_BASE_URL}${src}`;
  }
  return src;
}

/** Ajoute `?w=` pour demander une miniature légère côté serveur. */
export function withDisplayWidth(src: string | null | undefined, widthPx: number): string | undefined {
  const resolved = resolveMediaUrl(src);
  if (!resolved) return undefined;
  if (resolved.startsWith('data:') || resolved.startsWith('blob:')) return resolved;
  const isApiImage = API_IMAGE_PREFIXES.some((prefix) => resolved.includes(prefix));
  if (!isApiImage) return resolved;

  try {
    const base = typeof window !== 'undefined' ? window.location.origin : 'http://local';
    const url = new URL(resolved, base);
    url.searchParams.set('w', String(Math.max(32, Math.min(512, Math.round(widthPx)))));
    return url.toString();
  } catch {
    return resolved;
  }
}
