import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { Trade } from '../stores/useGameStore';

function formatPrice(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const digits = value >= 1_000 ? 2 : value >= 1 ? 5 : 8;
  return value.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function formatSize(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 6 });
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
  const bookFills = (trade.fillDetails || []).filter((fill) => fill.source === 'book' && fill.size > 0);
  const hasEstimatedLiquidity = (trade.fillDetails || []).some((fill) => fill.source === 'estimated');
  const sourceLabel = trade.slippageSource === 'itick-l5'
    ? 'iTick L5'
    : trade.slippageSource === 'model'
      ? (fr ? 'Estimation de marché' : 'Market estimate')
      : (fr ? 'Exécution standard' : 'Standard execution');

  return createPortal(
    <div
      className="fixed inset-0 z-[10000] flex items-end justify-center bg-black/70 p-3 backdrop-blur-sm sm:items-center"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="w-full max-w-lg overflow-hidden rounded-2xl border border-white/10 bg-[#100b17] shadow-2xl shadow-black/60">
        <header className="flex items-start justify-between border-b border-white/10 px-5 py-4">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#a78bfa]">
              {fr ? 'Ordre exécuté' : 'Order filled'}
            </div>
            <div className="mt-1 text-lg font-bold text-white">
              {trade.pair} · {trade.side === 'long' ? 'Long' : 'Short'}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-[#aaa4b3] hover:bg-white/5 hover:text-white"
          >
            {fr ? 'Fermer' : 'Close'}
          </button>
        </header>

        <div className="space-y-4 p-5">
          <div className="grid grid-cols-2 gap-2">
            <Metric
              label={fr ? 'Prix demandé' : 'Requested price'}
              value={formatPrice(trade.requestedPrice ?? trade.price)}
            />
            <Metric
              label={fr ? 'Prix moyen exécuté' : 'Average fill'}
              value={formatPrice(trade.price)}
              emphasized
            />
            <Metric
              label="Slippage"
              value={`${Number(trade.slippageBps || 0).toFixed(2)} bps`}
            />
            <Metric
              label={fr ? 'Frais' : 'Fees'}
              value={`${trade.fee.toLocaleString(undefined, { maximumFractionDigits: 4 })} USD`}
            />
          </div>

          <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
            <span className="text-[10px] uppercase tracking-[0.14em] text-[#777181]">
              {fr ? 'Source du prix' : 'Price source'}
            </span>
            <span className="text-xs font-semibold text-[#ddd7e5]">{sourceLabel}</span>
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
                    className="flex items-center justify-between border-b border-white/[0.06] px-3 py-2.5 text-xs last:border-b-0"
                  >
                    <span className="text-[#aaa4b3]">{formatSize(fill.size)}</span>
                    <span className="font-mono font-semibold text-white">@ {formatPrice(fill.price)}</span>
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
    <div className={`rounded-xl border px-3 py-3 ${
      emphasized ? 'border-violet-400/25 bg-violet-400/[0.08]' : 'border-white/10 bg-white/[0.03]'
    }`}>
      <div className="text-[9px] uppercase tracking-[0.14em] text-[#777181]">{label}</div>
      <div className={`mt-1 font-mono text-sm font-semibold ${emphasized ? 'text-violet-200' : 'text-white'}`}>
        {value}
      </div>
    </div>
  );
}
