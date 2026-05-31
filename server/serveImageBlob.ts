import type { Response } from 'express';
import { getCachedBlob, setCachedBlob } from './blobCache.js';
import { buildImageThumbnail } from './imageOptimize.js';

/**
 * Cache navigateur (Cache-Control) ET cache edge du CDN
 * (CDN-Cache-Control / Netlify-CDN-Cache-Control).
 *
 * Sans les headers CDN, les réponses des fonctions serverless Netlify ne
 * sont PAS mises en cache à l'edge : chaque hit « frais » re-invoque la
 * Lambda (cold start) + SELECT bytea Postgres + resize Sharp. Avec eux, après
 * le premier hit l'image est servie depuis le CDN mondial sans toucher la
 * fonction ni la base. Les URLs portent un `?v=<upload-ts>` stable, donc
 * `immutable` est sûr (un nouvel upload change l'URL).
 */
function setImageCacheHeaders(res: Response, mime: string, length: number): void {
  const cacheValue = 'public, max-age=31536000, immutable';
  res.setHeader('Content-Type', mime);
  res.setHeader('Cache-Control', cacheValue);
  res.setHeader('CDN-Cache-Control', cacheValue);
  res.setHeader('Netlify-CDN-Cache-Control', cacheValue);
  res.setHeader('Content-Length', String(length));
}

export async function sendImageBlob(
  res: Response,
  cacheKey: string,
  loader: () => Promise<{ mime: string; data: Buffer } | null>,
  widthParam?: string,
): Promise<void> {
  const width = widthParam ? Number.parseInt(widthParam, 10) : 0;
  const thumbKey = width > 0 && width <= 512 ? `${cacheKey}:w${width}` : cacheKey;

  const cached = getCachedBlob(thumbKey);
  if (cached) {
    setImageCacheHeaders(res, cached.mime, cached.data.length);
    res.end(cached.data);
    return;
  }

  const blob = await loader();
  if (!blob) {
    res.status(404).json({ error: 'Image introuvable' });
    return;
  }

  let outMime = blob.mime;
  let outData = blob.data;

  if (width > 0 && width <= 512) {
    try {
      const thumb = await buildImageThumbnail(blob.data, width);
      outMime = thumb.mime;
      outData = thumb.buffer;
    } catch {
      // Garde l'original si la miniature échoue.
    }
  }

  setCachedBlob(thumbKey, outMime, outData);
  setImageCacheHeaders(res, outMime, outData.length);
  res.end(outData);
}
