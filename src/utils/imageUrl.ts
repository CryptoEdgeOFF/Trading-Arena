import { API_BASE_URL } from '../lib/runtimeApi';

const API_IMAGE_PREFIXES = ['/api/avatars/', '/api/roster/avatars/', '/api/prize-images/', '/api/team-images/'];
const NEWS_COVER_RE = /^(\/news\/[a-z0-9-]+?)(?:-640|-og)?\.webp$/i;

export function newsCoverSlug(src: string | null | undefined): string | null {
  if (!src) return null;
  const match = src.split('?')[0].match(NEWS_COVER_RE);
  return match ? match[1].replace('/news/', '') : null;
}

export function newsCoverUrl(
  src: string | null | undefined,
  variant: 'full' | 'card' | 'og' = 'full',
): string | undefined {
  if (!src) return undefined;
  const slug = newsCoverSlug(src);
  if (!slug) return src;
  if (variant === 'card') return `/news/${slug}-640.webp`;
  if (variant === 'og') return `/news/${slug}-og.webp`;
  return `/news/${slug}.webp`;
}

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
  if (!src) return undefined;
  if (src.startsWith('data:') || src.startsWith('blob:')) return src;
  const normalized = src.startsWith('http') ? src : src;
  const newsVariant = newsCoverUrl(src, widthPx <= 720 ? 'card' : 'full');
  if (newsCoverSlug(src) && newsVariant) return newsVariant;

  const isApiImage = API_IMAGE_PREFIXES.some((prefix) => normalized.includes(prefix));
  if (!isApiImage) return src;

  try {
    const base = typeof window !== 'undefined' ? window.location.origin : 'http://local';
    const url = new URL(src, base);
    url.searchParams.set('w', String(Math.max(32, Math.min(512, Math.round(widthPx)))));
    if (src.startsWith('http')) return url.toString();
    return `${url.pathname}${url.search}`;
  } catch {
    return src;
  }
}
