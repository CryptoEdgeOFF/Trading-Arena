import type { Response } from 'express';
import { getCachedBlob, setCachedBlob } from './blobCache.js';
import { buildImageThumbnail } from './imageOptimize.js';

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
    res.setHeader('Content-Type', cached.mime);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Content-Length', String(cached.data.length));
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
  res.setHeader('Content-Type', outMime);
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.setHeader('Content-Length', String(outData.length));
  res.end(outData);
}
