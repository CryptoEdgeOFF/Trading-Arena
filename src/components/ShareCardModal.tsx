import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  generateShareCard,
  downloadBlob,
  shareBlob,
  type ShareCardData,
} from '../lib/shareCard';

/**
 * Modal de prévisualisation + partage d'une carte BTF (trade ou classement).
 * Génère l'image via le canvas, l'affiche, et propose téléchargement / partage
 * natif (navigator.share sur mobile).
 */
export default function ShareCardModal({
  open,
  data,
  onClose,
}: {
  open: boolean;
  data: ShareCardData | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [shared, setShared] = useState(false);
  const reqId = useRef(0);

  useEffect(() => {
    if (!open || !data) return;
    const id = ++reqId.current;
    setStatus('loading');
    setDataUrl(null);
    setBlob(null);
    setShared(false);
    generateShareCard(data)
      .then((result) => {
        if (id !== reqId.current) return;
        setDataUrl(result.dataUrl);
        setBlob(result.blob);
        setStatus('ready');
      })
      .catch(() => {
        if (id !== reqId.current) return;
        setStatus('error');
      });
  }, [open, data]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open || !data) return null;

  const filename =
    data.kind === 'rank'
      ? `btf-rang-${data.rank}.png`
      : `btf-trade-${data.pair.replace(/\W+/g, '')}.png`;

  const shareTitle = t('share.appName');
  const shareText =
    data.kind === 'rank'
      ? t('share.shareTextRank', { rank: data.rank, context: data.contextLabel })
      : t('share.shareTextTrade', { pair: data.pair });

  async function handleShare() {
    if (!blob) return;
    const ok = await shareBlob(blob, filename, shareTitle, shareText);
    if (ok) setShared(true);
    else downloadBlob(blob, filename);
  }

  function handleDownload() {
    if (blob) downloadBlob(blob, filename);
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
    >
      <button
        type="button"
        aria-label={t('common.close')}
        onClick={onClose}
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
      />
      <div className="relative z-10 flex max-h-[92vh] w-full max-w-md flex-col overflow-hidden rounded-3xl border border-[#232329] bg-[#0a0a0d] shadow-[0_40px_120px_-40px_rgba(220,38,38,0.6)]">
        <div className="flex items-center justify-between gap-3 border-b border-[#1a1a20] px-5 py-4">
          <div>
            <div className="micro text-[10px] text-[#dc2626]">{t('share.eyebrow')}</div>
            <h3 className="display text-lg font-bold text-white">
              {data.kind === 'rank' ? t('share.titleRank') : t('share.titleTrade')}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#232329] text-[#9a9aa6] transition-colors hover:border-[#dc2626]/40 hover:text-white"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          <div className="relative mx-auto aspect-[4/5] w-full max-w-[320px] overflow-hidden rounded-2xl border border-[#1a1a20] bg-[#07070b]">
            {status === 'ready' && dataUrl ? (
              <img src={dataUrl} alt={t('share.previewAlt')} className="h-full w-full object-contain" />
            ) : status === 'error' ? (
              <div className="flex h-full w-full items-center justify-center px-6 text-center text-sm text-[#fca5a5]">
                {t('share.error')}
              </div>
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-[#71717a]">
                <span className="h-8 w-8 animate-spin rounded-full border-2 border-[#dc2626]/30 border-t-[#dc2626]" />
                <span className="text-xs">{t('share.generating')}</span>
              </div>
            )}
          </div>

          {shared && (
            <div className="mt-3 text-center text-xs font-semibold text-emerald-400">{t('share.shared')}</div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2.5 border-t border-[#1a1a20] px-5 py-4">
          <button
            type="button"
            onClick={handleDownload}
            disabled={status !== 'ready'}
            className="flex h-12 items-center justify-center gap-2 rounded-xl border border-[#232329] bg-[#0c0c10] text-sm font-bold uppercase tracking-[0.12em] text-white transition-colors hover:border-[#3a3a44] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
            </svg>
            {t('share.download')}
          </button>
          <button
            type="button"
            onClick={handleShare}
            disabled={status !== 'ready'}
            className="flex h-12 items-center justify-center gap-2 rounded-xl bg-[#dc2626] text-sm font-bold uppercase tracking-[0.12em] text-white shadow-[0_14px_40px_-18px_rgba(220,38,38,0.95)] transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13" />
            </svg>
            {t('share.shareBtn')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
