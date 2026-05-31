import type { Response } from 'express';
import { getCachedBlob, setCachedBlob } from './blobCache.js';
import { buildImageThumbnail } from './imageOptimize.js';

/**
 * Cache navigateur (Cache-Control) ET cache CDN.
 *
 * IMPORTANT Netlify : pour qu'une réponse de FONCTION soit stockée dans le
 * cache *durable* (global, persistant entre invocations et déploiements), il
 * faut explicitement la directive `durable` dans `Netlify-CDN-Cache-Control`.
 * Sans elle, Netlify bypass le cache (`cache-status: fwd=bypass`) et chaque
 * hit re-invoque la Lambda (cold start) + SELECT bytea Postgres + resize Sharp.
 *
 * Avec `durable`, l'image est servie depuis le CDN mondial après le 1er hit,
 * sans toucher la fonction ni la base. Les URLs portent un `?v=<upload-ts>`
 * stable, donc `immutable` est sûr (un nouvel upload change l'URL).
 */
function setImageCacheHeaders(res: Response, mime: string, length: number): void {
  res.setHeader('Content-Type', mime);
  // Navigateur : cache local long.
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  // CDN générique (standard).
  res.setHeader('CDN-Cache-Control', 'public, max-age=31536000, immutable');
  // CDN Netlify : `durable` = stockage global persistant (prioritaire).
  res.setHeader('Netlify-CDN-Cache-Control', 'public, durable, max-age=31536000, immutable');
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
