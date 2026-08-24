/**
 * Générateur d'images de partage "BTF" (style réseaux sociaux).
 *
 * Tout est dessiné via l'API Canvas 2D — aucune dépendance externe — pour
 * produire une image nette à dimensions fixes (1080×1350, ratio portrait 4:5
 * adapté à Instagram / X). Deux types de cartes :
 *   - 'rank'  : la place d'un joueur dans un classement (arène ou global)
 *   - 'trade' : un trade marquant (PnL, paire, sens, levier)
 *
 * Le rendu renvoie un Blob PNG (pour navigator.share / téléchargement) et un
 * dataURL (pour la prévisualisation <img>).
 */

export type ShareCardBadge =
  | 'champion'
  | 'btf2026'
  | 'paris-champion'
  | 'summer-champion'
  | 'autumn-champion';

export interface ShareRankCard {
  kind: 'rank';
  playerName: string;
  rank: number;
  participants?: number | null;
  /** Titre affiché en sous-marque (nom d'arène ou "Classement global"). */
  contextLabel: string;
  pnlPercent?: number | null;
  pnlUsd?: number | null;
  avatarUrl?: string | null;
  badges?: ShareRankBadgeInput;
}

type ShareRankBadgeInput = ShareCardBadge[] | undefined;

export interface ShareTradeCard {
  kind: 'trade';
  playerName: string;
  pair: string;
  side: 'long' | 'short';
  /** PnL net du trade (USD). */
  pnlUsd: number;
  pnlPercent?: number | null;
  entryPrice?: number | null;
  exitPrice?: number | null;
  leverage: number;
  time: number;
  contextLabel?: string;
}

export type ShareCardData = ShareRankCard | ShareTradeCard;

export interface ShareCardResult {
  blob: Blob;
  dataUrl: string;
  width: number;
  height: number;
}

const W = 1080;
const H = 1350;

const COLORS = {
  bg: '#07070b',
  white: '#ffffff',
  muted: '#9a9aa6',
  faint: '#6f6f7a',
  red: '#dc2626',
  redSoft: '#fca5a5',
  redDeep: '#7f1d1d',
  pos: '#22c55e',
  posSoft: '#86efac',
  neg: '#f43f6e',
  negSoft: '#fda4af',
  cardFill: 'rgba(255,255,255,0.035)',
  cardBorder: 'rgba(255,255,255,0.10)',
};

const FONT_DISPLAY = 'Rajdhani, "Space Grotesk", sans-serif';
const FONT_MONO = '"JetBrains Mono", monospace';
const FONT_MICRO = '"Space Grotesk", Inter, sans-serif';
const FONT_BODY = 'Inter, sans-serif';

function loadImage(src: string, useCors: boolean): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    if (useCors) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** Garantit que les polices custom sont prêtes avant de peindre le canvas. */
async function ensureFonts(): Promise<void> {
  const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
  if (!fonts) return;
  try {
    await Promise.all([
      fonts.load('700 140px Rajdhani'),
      fonts.load('600 140px Rajdhani'),
      fonts.load('700 60px "JetBrains Mono"'),
      fonts.load('600 28px "Space Grotesk"'),
      fonts.load('600 36px Inter'),
    ]);
    await fonts.ready;
  } catch {
    /* on peint quand même avec les fallbacks */
  }
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function withLetterSpacing(ctx: CanvasRenderingContext2D, value: string, fn: () => void) {
  const c = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
  const prev = c.letterSpacing;
  try {
    c.letterSpacing = value;
  } catch {
    /* non supporté : on ignore */
  }
  fn();
  try {
    c.letterSpacing = prev ?? '0px';
  } catch {
    /* ignore */
  }
}

/** Réduit la taille de police jusqu'à ce que le texte tienne dans maxWidth. */
function fitFontSize(
  ctx: CanvasRenderingContext2D,
  text: string,
  fontTemplate: (size: number) => string,
  startSize: number,
  maxWidth: number,
  minSize = 24,
): number {
  let size = startSize;
  while (size > minSize) {
    ctx.font = fontTemplate(size);
    if (ctx.measureText(text).width <= maxWidth) break;
    size -= 4;
  }
  return size;
}

function fmtSignedUsd(value: number): string {
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  const abs = Math.abs(value);
  let body: string;
  if (abs >= 1_000_000) body = `${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  else if (abs >= 10_000) body = `${(abs / 1_000).toFixed(abs >= 100_000 ? 0 : 1)}K`;
  else body = abs.toLocaleString('en-US', { maximumFractionDigits: abs >= 100 ? 0 : 2 });
  return `${sign}$${body}`;
}

function fmtSignedPct(value: number): string {
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  const abs = Math.abs(value);
  if (abs >= 1000) return `${sign}${(abs / 1000).toFixed(1)}K%`;
  return `${sign}${abs.toFixed(2)}%`;
}

/** Prix marché : décimales adaptées à l'ordre de grandeur. */
function fmtPrice(value: number): string {
  const abs = Math.abs(value);
  const decimals = abs >= 100 ? 2 : abs >= 1 ? 4 : 6;
  return value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join('')
      .toUpperCase() || '?'
  );
}

function paintBackground(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, W, H);

  const glowTop = ctx.createRadialGradient(W * 0.78, 120, 40, W * 0.78, 120, 760);
  glowTop.addColorStop(0, 'rgba(220,38,38,0.28)');
  glowTop.addColorStop(1, 'rgba(220,38,38,0)');
  ctx.fillStyle = glowTop;
  ctx.fillRect(0, 0, W, H);

  const glowBottom = ctx.createRadialGradient(W * 0.15, H * 0.92, 40, W * 0.15, H * 0.92, 720);
  glowBottom.addColorStop(0, 'rgba(127,29,29,0.30)');
  glowBottom.addColorStop(1, 'rgba(127,29,29,0)');
  ctx.fillStyle = glowBottom;
  ctx.fillRect(0, 0, W, H);

  // Vignette pour resserrer le regard au centre.
  const vignette = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.75);
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, W, H);

  // Cadre fin lumineux.
  const inset = 30;
  roundRectPath(ctx, inset, inset, W - inset * 2, H - inset * 2, 40);
  ctx.fillStyle = 'rgba(255,255,255,0.012)';
  ctx.fill();
  const frame = ctx.createLinearGradient(0, inset, 0, H - inset);
  frame.addColorStop(0, 'rgba(220,38,38,0.55)');
  frame.addColorStop(0.5, 'rgba(255,255,255,0.08)');
  frame.addColorStop(1, 'rgba(220,38,38,0.30)');
  ctx.strokeStyle = frame;
  ctx.lineWidth = 2;
  ctx.stroke();
}

function paintHeader(ctx: CanvasRenderingContext2D, logo: HTMLImageElement | null, tag: string) {
  const x = 80;
  const y = 84;
  const box = 88;

  // Logo wordmark "BTF ARENA" (ratio préservé).
  if (logo) {
    const ratio = logo.width && logo.height ? logo.width / logo.height : 1015 / 446;
    const logoW = box * ratio;
    ctx.drawImage(logo, x, y, logoW, box);
  }

  ctx.textBaseline = 'alphabetic';

  // Tag à droite.
  if (tag) {
    ctx.font = '700 22px ' + FONT_MICRO;
    const tagText = tag.toUpperCase();
    let tw = 0;
    withLetterSpacing(ctx, '2px', () => {
      tw = ctx.measureText(tagText).width;
    });
    const padX = 22;
    const pillW = tw + padX * 2;
    const pillH = 46;
    const px = W - 80 - pillW;
    const py = y + (box - pillH) / 2;
    roundRectPath(ctx, px, py, pillW, pillH, pillH / 2);
    ctx.fillStyle = 'rgba(220,38,38,0.16)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(220,38,38,0.5)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = COLORS.redSoft;
    ctx.textAlign = 'left';
    withLetterSpacing(ctx, '2px', () => ctx.fillText(tagText, px + padX, py + 31));
  }
}

function paintFooter(ctx: CanvasRenderingContext2D) {
  const y = H - 92;
  ctx.textAlign = 'center';
  ctx.font = '700 30px ' + FONT_DISPLAY;
  ctx.fillStyle = COLORS.white;
  const a = 'BTFARENA';
  const b = '.COM';
  ctx.font = '700 30px ' + FONT_DISPLAY;
  const aw = ctx.measureText(a).width;
  const bw = ctx.measureText(b).width;
  const total = aw + bw;
  const startX = W / 2 - total / 2;
  ctx.textAlign = 'left';
  ctx.fillStyle = COLORS.white;
  ctx.fillText(a, startX, y);
  ctx.fillStyle = COLORS.red;
  ctx.fillText(b, startX + aw, y);

  ctx.textAlign = 'center';
  ctx.font = '600 22px ' + FONT_MICRO;
  ctx.fillStyle = COLORS.faint;
  withLetterSpacing(ctx, '3px', () => ctx.fillText('REJOINS LES ARÈNES — BTFARENA.COM', W / 2, y + 36));
}

function paintAvatar(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  avatar: HTMLImageElement | null,
  name: string,
) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  if (avatar) {
    ctx.drawImage(avatar, cx - r, cy - r, r * 2, r * 2);
  } else {
    const grad = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
    grad.addColorStop(0, COLORS.red);
    grad.addColorStop(1, COLORS.redDeep);
    ctx.fillStyle = grad;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    ctx.fillStyle = COLORS.white;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '700 ' + Math.round(r * 0.8) + 'px ' + FONT_DISPLAY;
    ctx.fillText(initials(name), cx, cy + 4);
    ctx.textBaseline = 'alphabetic';
  }
  ctx.restore();

  ctx.beginPath();
  ctx.arc(cx, cy, r + 2, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(220,38,38,0.85)';
  ctx.lineWidth = 4;
  ctx.stroke();
}

function paintEyebrow(ctx: CanvasRenderingContext2D, text: string, y: number, color: string) {
  ctx.textAlign = 'center';
  ctx.font = '600 26px ' + FONT_MICRO;
  ctx.fillStyle = color;
  withLetterSpacing(ctx, '5px', () => ctx.fillText(text.toUpperCase(), W / 2, y));
}

function paintName(ctx: CanvasRenderingContext2D, name: string, y: number) {
  const size = fitFontSize(ctx, name, (s) => `700 ${s}px ${FONT_DISPLAY}`, 76, W - 200, 40);
  ctx.font = `700 ${size}px ${FONT_DISPLAY}`;
  ctx.fillStyle = COLORS.white;
  ctx.textAlign = 'center';
  ctx.fillText(name, W / 2, y);
}

/** Carte "classement" : grosse position + PnL. */
function paintRankBody(ctx: CanvasRenderingContext2D, data: ShareRankCard, avatar: HTMLImageElement | null) {
  paintAvatar(ctx, W / 2, 320, 84, avatar, data.playerName);
  paintName(ctx, data.playerName, 470);
  paintEyebrow(ctx, data.contextLabel, 516, COLORS.redSoft);

  // Label RANK
  ctx.textAlign = 'center';
  ctx.font = '600 30px ' + FONT_MICRO;
  ctx.fillStyle = COLORS.faint;
  withLetterSpacing(ctx, '8px', () => ctx.fillText('CLASSEMENT', W / 2, 640));

  // Gros #rank
  const rankText = `#${data.rank}`;
  ctx.font = '700 280px ' + FONT_DISPLAY;
  const grad = ctx.createLinearGradient(0, 660, 0, 900);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(1, '#ff5a5a');
  ctx.fillStyle = grad;
  ctx.textAlign = 'center';
  ctx.fillText(rankText, W / 2, 880);

  if (data.participants && data.participants > 0) {
    ctx.font = '600 34px ' + FONT_BODY;
    ctx.fillStyle = COLORS.muted;
    ctx.fillText(`sur ${data.participants} traders`, W / 2, 940);
  }

  // Bloc PnL en bas.
  const hasPct = data.pnlPercent != null && Number.isFinite(data.pnlPercent);
  const hasUsd = data.pnlUsd != null && Number.isFinite(data.pnlUsd);
  if (hasPct || hasUsd) {
    const pnlValue = hasPct ? (data.pnlPercent as number) : (data.pnlUsd as number);
    const pos = pnlValue >= 0;
    const cardW = 760;
    const cardH = 150;
    const cx = (W - cardW) / 2;
    const cy = 1010;
    roundRectPath(ctx, cx, cy, cardW, cardH, 28);
    ctx.fillStyle = COLORS.cardFill;
    ctx.fill();
    ctx.strokeStyle = COLORS.cardBorder;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    if (hasPct && hasUsd) {
      paintStatCell(ctx, cx, cy, cardW / 2, cardH, 'PERFORMANCE', fmtSignedPct(data.pnlPercent as number), pos);
      paintStatCell(ctx, cx + cardW / 2, cy, cardW / 2, cardH, 'PNL', fmtSignedUsd(data.pnlUsd as number), (data.pnlUsd as number) >= 0);
      ctx.strokeStyle = COLORS.cardBorder;
      ctx.beginPath();
      ctx.moveTo(cx + cardW / 2, cy + 28);
      ctx.lineTo(cx + cardW / 2, cy + cardH - 28);
      ctx.stroke();
    } else {
      paintStatCell(ctx, cx, cy, cardW, cardH, hasPct ? 'PERFORMANCE' : 'PNL', hasPct ? fmtSignedPct(data.pnlPercent as number) : fmtSignedUsd(data.pnlUsd as number), pos);
    }
  }
}

function paintStatCell(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  value: string,
  pos: boolean,
) {
  const midX = x + w / 2;
  ctx.textAlign = 'center';
  ctx.font = '600 24px ' + FONT_MICRO;
  ctx.fillStyle = COLORS.faint;
  withLetterSpacing(ctx, '4px', () => ctx.fillText(label, midX, y + 54));
  const size = fitFontSize(ctx, value, (s) => `700 ${s}px ${FONT_MONO}`, 52, w - 60, 30);
  ctx.font = `700 ${size}px ${FONT_MONO}`;
  ctx.fillStyle = pos ? COLORS.posSoft : COLORS.negSoft;
  ctx.fillText(value, midX, y + 112);
}

/** Carte "trade" : grosse valeur de PnL + détails de la position. */
function paintTradeBody(ctx: CanvasRenderingContext2D, data: ShareTradeCard) {
  const isLong = data.side === 'long';
  const pos = data.pnlUsd >= 0;

  paintEyebrow(ctx, data.contextLabel || 'TRADE MARQUANT', 300, COLORS.redSoft);

  // Paire
  const pairSize = fitFontSize(ctx, data.pair, (s) => `700 ${s}px ${FONT_DISPLAY}`, 110, W - 220, 60);
  ctx.font = `700 ${pairSize}px ${FONT_DISPLAY}`;
  ctx.fillStyle = COLORS.white;
  ctx.textAlign = 'center';
  ctx.fillText(data.pair, W / 2, 430);

  // Pill LONG / SHORT
  const sideText = isLong ? 'LONG' : 'SHORT';
  ctx.font = '700 28px ' + FONT_MICRO;
  let sw = 0;
  withLetterSpacing(ctx, '3px', () => {
    sw = ctx.measureText(sideText).width;
  });
  const padX = 26;
  const pillW = sw + padX * 2;
  const pillH = 56;
  const px = (W - pillW) / 2;
  const py = 470;
  roundRectPath(ctx, px, py, pillW, pillH, pillH / 2);
  ctx.fillStyle = isLong ? 'rgba(34,197,94,0.16)' : 'rgba(244,63,94,0.16)';
  ctx.fill();
  ctx.strokeStyle = isLong ? 'rgba(34,197,94,0.55)' : 'rgba(244,63,94,0.55)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = isLong ? COLORS.posSoft : COLORS.negSoft;
  ctx.textAlign = 'left';
  withLetterSpacing(ctx, '3px', () => ctx.fillText(sideText, px + padX, py + 38));

  // Label PNL NET
  ctx.textAlign = 'center';
  ctx.font = '600 28px ' + FONT_MICRO;
  ctx.fillStyle = COLORS.faint;
  withLetterSpacing(ctx, '8px', () => ctx.fillText('PNL NET', W / 2, 612));

  // Grosse valeur de PnL
  const pnlText = fmtSignedUsd(data.pnlUsd);
  const pnlSize = fitFontSize(ctx, pnlText, (s) => `700 ${s}px ${FONT_MONO}`, 160, W - 180, 70);
  ctx.font = `700 ${pnlSize}px ${FONT_MONO}`;
  const grad = ctx.createLinearGradient(0, 630, 0, 770);
  if (pos) {
    grad.addColorStop(0, '#bbf7d0');
    grad.addColorStop(1, '#22c55e');
  } else {
    grad.addColorStop(0, '#fecdd3');
    grad.addColorStop(1, '#f43f6e');
  }
  ctx.fillStyle = grad;
  ctx.textAlign = 'center';
  ctx.fillText(pnlText, W / 2, 745);

  if (data.pnlPercent != null && Number.isFinite(data.pnlPercent)) {
    ctx.font = '700 42px ' + FONT_MONO;
    ctx.fillStyle = pos ? COLORS.posSoft : COLORS.negSoft;
    ctx.fillText(fmtSignedPct(data.pnlPercent), W / 2, 808);
  }

  // Bloc détails 2×2 : Entrée / Sortie (haut) + Levier / Date (bas).
  const cardW = 800;
  const cardH = 244;
  const cx = (W - cardW) / 2;
  const cy = 858;
  const halfW = cardW / 2;
  const halfH = cardH / 2;
  roundRectPath(ctx, cx, cy, cardW, cardH, 28);
  ctx.fillStyle = COLORS.cardFill;
  ctx.fill();
  ctx.strokeStyle = COLORS.cardBorder;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  const hasEntry = data.entryPrice != null && Number.isFinite(data.entryPrice);
  const hasExit = data.exitPrice != null && Number.isFinite(data.exitPrice);
  const dateStr = new Date(data.time).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });

  paintDetailCell(ctx, cx, cy, halfW, halfH, 'ENTRÉE', hasEntry ? fmtPrice(data.entryPrice as number) : '—');
  paintDetailCell(ctx, cx + halfW, cy, halfW, halfH, 'SORTIE', hasExit ? fmtPrice(data.exitPrice as number) : '—');
  paintDetailCell(ctx, cx, cy + halfH, halfW, halfH, 'LEVIER', `${data.leverage}x`);
  paintDetailCell(ctx, cx + halfW, cy + halfH, halfW, halfH, 'DATE', dateStr);

  // Séparateurs.
  ctx.strokeStyle = COLORS.cardBorder;
  ctx.beginPath();
  ctx.moveTo(cx + halfW, cy + 22);
  ctx.lineTo(cx + halfW, cy + cardH - 22);
  ctx.moveTo(cx + 30, cy + halfH);
  ctx.lineTo(cx + cardW - 30, cy + halfH);
  ctx.stroke();

  // Nom du joueur sous le bloc.
  ctx.textAlign = 'center';
  const nameLine = fitFontSize(ctx, data.playerName, (s) => `600 ${s}px ${FONT_BODY}`, 30, W - 200, 20);
  ctx.font = `600 ${nameLine}px ${FONT_BODY}`;
  ctx.fillStyle = COLORS.muted;
  ctx.fillText(data.playerName, W / 2, cy + cardH + 52);
}

function paintDetailCell(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  value: string,
) {
  const midX = x + w / 2;
  ctx.textAlign = 'center';
  ctx.font = '600 23px ' + FONT_MICRO;
  ctx.fillStyle = COLORS.faint;
  withLetterSpacing(ctx, '4px', () => ctx.fillText(label, midX, y + h * 0.4));
  const size = fitFontSize(ctx, value, (s) => `700 ${s}px ${FONT_MONO}`, 50, w - 44, 26);
  ctx.font = `700 ${size}px ${FONT_MONO}`;
  ctx.fillStyle = COLORS.white;
  ctx.fillText(value, midX, y + h * 0.78);
}

async function paint(ctx: CanvasRenderingContext2D, data: ShareCardData, allowAvatar: boolean) {
  const logo = await loadImage('/assets/pictures/BTF_ARENA_logo.png', false);

  paintBackground(ctx);
  paintHeader(ctx, logo, data.kind === 'rank' ? 'Classement' : 'Trade');

  if (data.kind === 'rank') {
    let avatar: HTMLImageElement | null = null;
    if (allowAvatar && data.avatarUrl) {
      avatar = await loadImage(data.avatarUrl, true);
    }
    paintRankBody(ctx, data, avatar);
  } else {
    paintTradeBody(ctx, data);
  }

  paintFooter(ctx);
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('toBlob a renvoyé null'))),
      'image/png',
      0.95,
    );
  });
}

/** Génère l'image de partage. Réessaie sans avatar si le canvas est "tainté". */
export async function generateShareCard(data: ShareCardData): Promise<ShareCardResult> {
  await ensureFonts();
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D non disponible');

  await paint(ctx, data, true);

  let blob: Blob;
  try {
    blob = await canvasToBlob(canvas);
  } catch {
    // Avatar cross-origin sans CORS → canvas tainté. On repeint sans avatar.
    ctx.clearRect(0, 0, W, H);
    await paint(ctx, data, false);
    blob = await canvasToBlob(canvas);
  }

  const dataUrl = canvas.toDataURL('image/png');
  return { blob, dataUrl, width: W, height: H };
}

/** Télécharge le blob avec un nom de fichier. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Partage natif si dispo (mobile), sinon false pour fallback download. */
export async function shareBlob(blob: Blob, filename: string, title: string, text: string): Promise<boolean> {
  const nav = navigator as Navigator & {
    canShare?: (data: ShareData) => boolean;
    share?: (data: ShareData) => Promise<void>;
  };
  try {
    const file = new File([blob], filename, { type: 'image/png' });
    if (nav.canShare && nav.share && nav.canShare({ files: [file] })) {
      await nav.share({ files: [file], title, text });
      return true;
    }
  } catch {
    /* annulé ou non supporté → fallback */
  }
  return false;
}
