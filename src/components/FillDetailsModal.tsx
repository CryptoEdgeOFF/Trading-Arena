import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { Trade } from '../stores/useGameStore';

function formatLocaleNumber(
  value: number,
  locale: string,
  options: Intl.NumberFormatOptions,
): string {
  if (!Number.isFinite(value)) return '—';
  return value
    .toLocaleString(locale, options)
    .replace(/\u202f|\u00a0/g, ' ');
}

function formatPrice(value: number, locale: string): string {
  const digits = value >= 1_000 ? 2 : value >= 1 ? 5 : 8;
  return formatLocaleNumber(value, locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatSize(value: number, locale: string): string {
  return formatLocaleNumber(value, locale, { maximumFractionDigits: 6 });
}

export default function FillDetailsModal({
  trade,
  onClose,
}: {
  trade: Trade | null;
  onClose: () => void;
}) {
  const { i18n } = useTranslation();
  if (!trade || typeof document === 'undefined') return null;

  const fr = i18n.language.toLowerCase().startsWith('fr');
  const locale = fr ? 'fr-FR' : 'en-US';
  const bookFills = (trade.fillDetails || []).filter((fill) => fill.source === 'book' && fill.size > 0);
  const hasEstimatedLiquidity = (trade.fillDetails || []).some((fill) => fill.source === 'estimated');
  const sourceLabel = trade.slippageSource === 'binance-depth'
    ? (fr ? 'Carnet Binance' : 'Binance order book')
    : trade.slippageSource === 'itick-l5'
      ? 'iTick L5'
      : trade.slippageSource === 'model'
        ? (fr ? 'Estimation de marché' : 'Market estimate')
        : (fr ? 'Exécution standard' : 'Standard execution');

  return createPortal(
    <div
      className="fixed inset-0 z-[10000] flex items-end justify-center bg-black/80 p-3 sm:items-center"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="flex max-h-[min(88dvh,680px)] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#100b17] shadow-2xl shadow-black/60">
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-white/10 px-5 py-4">
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#a78bfa]">
              {fr ? 'Ordre exécuté' : 'Order filled'}
            </div>
            <div className="mt-1 truncate text-lg font-bold text-white">
              {trade.pair} · {trade.side === 'long' ? 'Long' : 'Short'}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-[#aaa4b3] hover:bg-white/5 hover:text-white"
          >
            {fr ? 'Fermer' : 'Close'}
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-5">
          <div className="grid grid-cols-2 gap-2">
            <Metric
              label={fr ? 'Prix demandé' : 'Requested price'}
              value={formatPrice(trade.requestedPrice ?? trade.price, locale)}
            />
            <Metric
              label={fr ? 'Prix moyen exécuté' : 'Average fill'}
              value={formatPrice(trade.price, locale)}
              emphasized
            />
            <Metric
              label="Slippage"
              value={`${Number(trade.slippageBps || 0).toFixed(2)} bps`}
            />
            <Metric
              label={fr ? 'Frais' : 'Fees'}
              value={`${formatLocaleNumber(trade.fee, locale, { minimumFractionDigits: 2, maximumFractionDigits: 4 })} USD`}
            />
          </div>

          <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
            <span className="shrink-0 text-[10px] uppercase tracking-[0.14em] text-[#777181]">
              {fr ? 'Source du prix' : 'Price source'}
            </span>
            <span className="truncate text-right text-xs font-semibold text-[#ddd7e5]">{sourceLabel}</span>
          </div>

          {bookFills.length > 0 && (
            <div>
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#777181]">
                {fr ? 'Niveaux visibles exécutés' : 'Visible filled levels'}
              </div>
              <div className="overflow-hidden rounded-xl border border-white/10">
                {bookFills.map((fill, index) => (
                  <div
                    key={`${fill.price}-${index}`}
                    className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-3 py-2.5 text-xs last:border-b-0"
                  >
                    <span className="min-w-0 truncate font-mono tabular-nums text-[#aaa4b3]">{formatSize(fill.size, locale)}</span>
                    <span className="shrink-0 font-mono font-semibold tabular-nums text-white">
                      @ {formatPrice(fill.price, locale)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {hasEstimatedLiquidity && (
            <p className="rounded-xl border border-amber-400/15 bg-amber-400/[0.06] px-3 py-2.5 text-[11px] leading-relaxed text-amber-100/75">
              {fr
                ? 'Le prix moyen final tient compte de la liquidité disponible au-delà des niveaux visibles.'
                : 'The final average price accounts for liquidity beyond the visible levels.'}
            </p>
          )}
        </div>
      </section>
    </div>,
    document.body,
  );
}

function Metric({
  label,
  value,
  emphasized = false,
}: {
  label: string;
  value: string;
  emphasized?: boolean;
}) {
  return (
    <div className={`min-w-0 rounded-xl border px-3 py-3 ${
      emphasized ? 'border-violet-400/25 bg-violet-400/[0.08]' : 'border-white/10 bg-white/[0.03]'
    }`}>
      <div className="truncate text-[9px] uppercase tracking-[0.14em] text-[#777181]">{label}</div>
      <div className={`mt-1 truncate font-mono text-sm font-semibold tabular-nums whitespace-nowrap ${emphasized ? 'text-violet-200' : 'text-white'}`}>
        {value}
      </div>
    </div>
  );
}
