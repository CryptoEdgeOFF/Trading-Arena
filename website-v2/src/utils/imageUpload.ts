/**
 * Compresse une image côté navigateur avant upload :
 *  - downsample à `maxSide` px sur le côté le plus long (default 1024)
 *  - re-encode en JPEG `quality` (default 0.85)
 *  - PNG/WebP/GIF transparents → JPEG sur fond blanc (acceptable pour
 *    avatars et photos de lots, jamais pour des UI sprites)
 *
 * Avantage : un upload typique smartphone (4-8 MB) descend à 100-200 KB,
 * ce qui rend l'upload + le re-render `<img src={data:…}>` quasi instantané
 * et garde la table Postgres légère.
 */
export async function compressImage(
  file: File,
  options: { maxSide?: number; quality?: number; mime?: string; preserveAlpha?: boolean } = {},
): Promise<Blob> {
  const maxSide = options.maxSide ?? 1024;
  const quality = options.quality ?? 0.85;
  // Pour les logos détourés, on conserve la transparence (WebP par défaut) au
  // lieu d'aplatir sur fond blanc + JPEG.
  const preserveAlpha = options.preserveAlpha ?? false;
  const mime = options.mime ?? (preserveAlpha ? 'image/webp' : 'image/jpeg');

  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();

    const ratio = Math.min(maxSide / img.width, maxSide / img.height, 1);
    const w = Math.max(1, Math.round(img.width * ratio));
    const h = Math.max(1, Math.round(img.height * ratio));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D non supporté');
    // Fond blanc pour les images avec alpha (sinon JPEG produirait du noir),
    // sauf si on veut préserver la transparence (logos détourés).
    if (!preserveAlpha) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
    }
    ctx.drawImage(img, 0, 0, w, h);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, mime, quality),
    );
    if (!blob) throw new Error('Conversion image impossible');
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}
