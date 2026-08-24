import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react';

const TEMPLATE_SRC = '/assets/Payouts/emptyPayout.png';
const SIZE = 1254;
const RED = '#ee4326';

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$',
  EUR: '€',
  GBP: '£',
};

export interface PayoutCertificateData {
  name: string;
  amount: number;
  currency: string;
  paidAt: number;
}

export interface PayoutCertificateHandle {
  /** Déclenche le téléchargement de l'image composée en PNG. */
  download: (filename?: string) => void;
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '—';
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = d.getUTCFullYear();
  return `${dd} / ${mm} / ${yyyy}`;
}

// Tailles dérivées du design (exprimées proportionnellement à la largeur 1254).
function nameFontPx(len: number): number {
  if (len <= 5) return 119;
  if (len <= 7) return 100;
  if (len <= 10) return 78;
  if (len <= 14) return 60;
  return 48;
}

function amountFontPx(len: number): number {
  if (len <= 3) return 150;
  if (len <= 5) return 123;
  if (len <= 7) return 98;
  return 75;
}

let templatePromise: Promise<HTMLImageElement | null> | null = null;
function loadTemplate(): Promise<HTMLImageElement | null> {
  if (!templatePromise) {
    templatePromise = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => {
        templatePromise = null;
        resolve(null);
      };
      img.src = TEMPLATE_SRC;
    });
  }
  return templatePromise;
}

async function ensureFonts(): Promise<void> {
  const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
  if (!fonts) return;
  try {
    await Promise.all([fonts.load('700 120px Rajdhani'), fonts.load('700 40px Rajdhani')]);
    await fonts.ready;
  } catch {
    /* on peint avec les fallbacks */
  }
}

/**
 * Certificat de payout dessiné dans un <canvas> à pleine résolution (1254²).
 * Le texte (nom / montant / date) est gravé dans l'image : un clic droit
 * « Enregistrer l'image sous… » ou le bouton de téléchargement exporte la
 * vraie image composée (pas seulement le template vide).
 */
const PayoutCertificate = forwardRef<PayoutCertificateHandle, { data: PayoutCertificateData; className?: string }>(
  function PayoutCertificate({ data, className = '' }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    const displayName = (data.name || '').trim().toUpperCase();
    const amountStr = useMemo(() => {
      const n = Number(data.amount) || 0;
      return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(n);
    }, [data.amount]);
    const symbol = CURRENCY_SYMBOLS[(data.currency || 'USD').toUpperCase()] || (data.currency || '').toUpperCase();
    const dateStr = formatDate(data.paidAt);

    useImperativeHandle(
      ref,
      () => ({
        download: (filename?: string) => {
          const canvas = canvasRef.current;
          if (!canvas) return;
          canvas.toBlob((blob) => {
            if (!blob) return;
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename || `payout-${displayName || 'btf'}.png`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          }, 'image/png');
        },
      }),
      [displayName],
    );

    useEffect(() => {
      let cancelled = false;
      (async () => {
        const [template] = await Promise.all([loadTemplate(), ensureFonts()]);
        if (cancelled) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.clearRect(0, 0, SIZE, SIZE);
        if (template) {
          ctx.drawImage(template, 0, 0, SIZE, SIZE);
        } else {
          ctx.fillStyle = '#0a0a0d';
          ctx.fillRect(0, 0, SIZE, SIZE);
        }

        // --- Nom ---
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `700 ${nameFontPx(displayName.length)}px Rajdhani, "Space Grotesk", sans-serif`;
        ctx.letterSpacing = '4px';
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = 'rgba(0,0,0,0.45)';
        ctx.shadowBlur = 22;
        ctx.fillText(displayName || '—', SIZE / 2, SIZE * 0.492);
        ctx.restore();

        // --- Montant (nombre blanc + symbole rouge, centrés comme un groupe) ---
        ctx.save();
        const apx = amountFontPx(amountStr.length);
        ctx.font = `700 ${apx}px Rajdhani, "Space Grotesk", sans-serif`;
        ctx.letterSpacing = '0px';
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        const gap = SIZE * 0.02;
        const numW = ctx.measureText(amountStr).width;
        const symW = ctx.measureText(symbol).width;
        const totalW = numW + (symbol ? gap + symW : 0);
        const startX = SIZE / 2 - totalW / 2;
        const amountY = SIZE * 0.686;
        ctx.shadowColor = 'rgba(0,0,0,0.45)';
        ctx.shadowBlur = 22;
        ctx.fillStyle = '#ffffff';
        ctx.fillText(amountStr, startX, amountY);
        if (symbol) {
          ctx.shadowColor = 'rgba(238,67,38,0.5)';
          ctx.shadowBlur = 26;
          ctx.fillStyle = RED;
          ctx.fillText(symbol, startX + numW + gap, amountY);
        }
        ctx.restore();

        // --- Date ---
        ctx.save();
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.font = '700 40px Rajdhani, "Space Grotesk", sans-serif';
        ctx.letterSpacing = '3px';
        ctx.fillStyle = RED;
        ctx.fillText(dateStr, SIZE * 0.145, SIZE * 0.844);
        ctx.restore();
      })();
      return () => {
        cancelled = true;
      };
    }, [displayName, amountStr, symbol, dateStr]);

    return (
      <canvas
        ref={canvasRef}
        width={SIZE}
        height={SIZE}
        className={`block h-auto w-full select-none ${className}`}
        aria-label={displayName ? `Payout ${displayName} ${amountStr} ${symbol}` : 'Payout'}
      />
    );
  },
);

export default PayoutCertificate;
