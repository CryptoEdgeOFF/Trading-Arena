import { createPortal } from 'react-dom'
import type { PaperTrade } from '../lib/api'
import './ExecutionFillSheet.css'

function formatPrice(value: number) {
  const digits = value >= 1_000 ? 2 : value >= 1 ? 5 : 8
  return value.toLocaleString('fr-FR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

function formatSize(value: number) {
  return value.toLocaleString('fr-FR', { maximumFractionDigits: 6 })
}

export default function ExecutionFillSheet({
  trade,
  onClose,
}: {
  trade: PaperTrade | null
  onClose: () => void
}) {
  if (!trade) return null

  const visibleFills = (trade.fillDetails || []).filter((fill) => fill.source === 'book' && fill.size > 0)
  const includesAdditionalLiquidity = (trade.fillDetails || []).some((fill) => fill.source === 'estimated')
  const source = trade.slippageSource === 'itick-l5'
    ? 'Carnet iTick L5'
    : trade.slippageSource === 'model'
      ? 'Estimation de marché'
      : 'Exécution standard'

  return createPortal(
    <div className="execution-fill-layer">
      <button className="execution-fill-backdrop" type="button" aria-label="Fermer" onClick={onClose} />
      <section className="execution-fill-sheet" role="dialog" aria-modal="true" aria-label="Détail du fill">
        <header>
          <div>
            <span>ORDRE EXÉCUTÉ</span>
            <strong>{trade.pair} · {trade.side === 'long' ? 'Long' : 'Short'}</strong>
          </div>
          <button type="button" onClick={onClose} aria-label="Fermer">×</button>
        </header>

        <div className="execution-fill-content">
          <div className="execution-fill-metrics">
            <Metric label="Prix demandé" value={formatPrice(trade.requestedPrice ?? trade.price)} />
            <Metric label="Fill moyen" value={formatPrice(trade.price)} highlight />
            <Metric label="Slippage" value={`${Number(trade.slippageBps || 0).toFixed(2)} bps`} />
            <Metric label="Frais" value={`${trade.fee.toLocaleString('fr-FR', { maximumFractionDigits: 4 })} $`} />
          </div>

          <div className="execution-fill-source">
            <span>Source du prix</span>
            <strong>{source}</strong>
          </div>

          {visibleFills.length > 0 && (
            <div className="execution-fill-levels">
              <span>NIVEAUX VISIBLES EXÉCUTÉS</span>
              <div>
                {visibleFills.map((fill, index) => (
                  <p key={`${fill.price}-${index}`}>
                    <span>{formatSize(fill.size)}</span>
                    <strong>@ {formatPrice(fill.price)}</strong>
                  </p>
                ))}
              </div>
            </div>
          )}

          {includesAdditionalLiquidity && (
            <p className="execution-fill-note">
              Le prix moyen final tient compte de la liquidité disponible au-delà des niveaux visibles.
            </p>
          )}
        </div>
      </section>
    </div>,
    document.body,
  )
}

function Metric({
  label,
  value,
  highlight = false,
}: {
  label: string
  value: string
  highlight?: boolean
}) {
  return (
    <div className={highlight ? 'is-highlight' : ''}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}
