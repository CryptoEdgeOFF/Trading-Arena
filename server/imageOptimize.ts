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

/**
 * Détoure le fond blanc d'une image (typiquement un visuel de lot exporté
 * avec un fond blanc au lieu de transparent). Approche : flood-fill depuis
 * les bords — on rend transparents uniquement les pixels blancs *connectés
 * au bord*. Le blanc à l'intérieur (texte, logo) est préservé.
 *
 * Ne s'applique que si les 4 coins sont blancs (sinon on considère que
 * l'image est un visuel plein cadre et on n'y touche pas).
 */
export async function transparentizeWhiteBackground(
  buffer: Buffer,
  options: { maxSide?: number; threshold?: number } = {},
): Promise<OptimizedImage> {
  const threshold = options.threshold ?? 236;
  let pipeline = sharp(buffer, { failOn: 'none' }).rotate();
  if (options.maxSide) {
    pipeline = pipeline.resize(options.maxSide, options.maxSide, { fit: 'inside', withoutEnlargement: true });
  }
  const { data, info } = await pipeline.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const total = width * height;

  const isWhite = (p: number): boolean => {
    const idx = p * channels;
    return data[idx] >= threshold && data[idx + 1] >= threshold && data[idx + 2] >= threshold && data[idx + 3] > 0;
  };

  // Heuristique : on ne détoure que si le fond (les 4 coins) est blanc.
  const corners = [0, width - 1, (height - 1) * width, height * width - 1];
  const cornersWhite = corners.every((p) => isWhite(p));
  if (!cornersWhite) {
    const out = await sharp(data, { raw: { width, height, channels } }).webp({ quality: 82, effort: 4 }).toBuffer();
    return { buffer: out, mime: 'image/webp' };
  }

  const visited = new Uint8Array(total);
  const stack: number[] = [];
  const seed = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const p = y * width + x;
    if (visited[p] || !isWhite(p)) return;
    visited[p] = 1;
    stack.push(p);
  };
  for (let x = 0; x < width; x++) {
    seed(x, 0);
    seed(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    seed(0, y);
    seed(width - 1, y);
  }
  while (stack.length > 0) {
    const p = stack.pop() as number;
    data[p * channels + 3] = 0; // rend transparent
    const x = p % width;
    const y = (p - x) / width;
    seed(x + 1, y);
    seed(x - 1, y);
    seed(x, y + 1);
    seed(x, y - 1);
  }

  const out = await sharp(data, { raw: { width, height, channels } }).webp({ quality: 82, effort: 4 }).toBuffer();
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
