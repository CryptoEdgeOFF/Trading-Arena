const API_IMAGE_PREFIXES = ['/api/avatars/', '/api/roster/avatars/', '/api/prize-images/'];

/** Ajoute `?w=` pour demander une miniature légère côté serveur. */
export function withDisplayWidth(src: string | null | undefined, widthPx: number): string | undefined {
  if (!src) return undefined;
  if (src.startsWith('data:') || src.startsWith('blob:')) return src;
  const normalized = src.startsWith('http') ? src : src;
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
