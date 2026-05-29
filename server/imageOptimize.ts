import sharp from 'sharp';

export type OptimizedImage = {
  buffer: Buffer;
  mime: 'image/webp';
};

/** Normalise les uploads (resize + WebP) avant stockage Postgres. */
export async function optimizeUploadedImage(
  buffer: Buffer,
  options: { maxSide: number; quality?: number } = { maxSide: 1024 },
): Promise<OptimizedImage> {
  const quality = options.quality ?? 82;
  const maxSide = options.maxSide;
  const out = await sharp(buffer, { failOn: 'none' })
    .rotate()
    .resize(maxSide, maxSide, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality, effort: 4 })
    .toBuffer();
  return { buffer: out, mime: 'image/webp' };
}

/** Miniature carrée pour avatars / vignettes de lot. */
export async function buildImageThumbnail(
  buffer: Buffer,
  width: number,
): Promise<OptimizedImage> {
  const side = Math.max(32, Math.min(512, Math.round(width)));
  const out = await sharp(buffer, { failOn: 'none' })
    .rotate()
    .resize(side, side, { fit: 'cover', position: 'center' })
    .webp({ quality: 78, effort: 3 })
    .toBuffer();
  return { buffer: out, mime: 'image/webp' };
}
