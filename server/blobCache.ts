type BlobEntry = {
  mime: string;
  data: Buffer;
  cachedAt: number;
};

const MAX_ENTRIES = 256;
const cache = new Map<string, BlobEntry>();

export function getCachedBlob(key: string): BlobEntry | null {
  const hit = cache.get(key);
  if (!hit) return null;
  cache.delete(key);
  cache.set(key, hit);
  return hit;
}

export function setCachedBlob(key: string, mime: string, data: Buffer): void {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, { mime, data, cachedAt: Date.now() });
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (!oldest) break;
    cache.delete(oldest);
  }
}

export function invalidateBlobCache(prefix: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}
