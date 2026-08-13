import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { JournalTrade } from '../lib/api'
import { drawShareLogo, roundedRectPath } from '../lib/shareCanvas'
import './SharePnlModal.css'

function netPnl(trade: JournalTrade) {
  return trade.pnl - trade.fee
}

async function generateCard(trade: JournalTrade, playerName: string): Promise<{ blob: Blob; url: string }> {
  const canvas = document.createElement('canvas')
  canvas.width = 1080
  canvas.height = 1350
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas indisponible')
  const pnl = netPnl(trade)
  const positive = pnl >= 0
  const accent = positive ? '#32df83' : '#ff536b'
  const gradient = ctx.createLinearGradient(0, 0, 1080, 1350)
  gradient.addColorStop(0, '#08080b')
  gradient.addColorStop(.55, '#10090e')
  gradient.addColorStop(1, positive ? '#071a12' : '#21070c')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, 1080, 1350)
  const glow = ctx.createRadialGradient(850, 180, 20, 850, 180, 620)
  glow.addColorStop(0, positive ? 'rgba(50,223,131,.24)' : 'rgba(255,50,80,.28)')
  glow.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, 1080, 900)
  ctx.strokeStyle = 'rgba(255,255,255,.12)'
  ctx.lineWidth = 2
  roundedRectPath(ctx, 30, 30, 1020, 1290, 40)
  ctx.stroke()

  await drawShareLogo(ctx)
  ctx.fillStyle = 'rgba(255,255,255,.55)'
  ctx.font = '700 23px Arial'
  ctx.textAlign = 'right'
  ctx.fillText('TRADE PERFORMANCE', 1000, 113)

  ctx.textAlign = 'left'
  ctx.fillStyle = '#85818a'
  ctx.font = '600 28px Arial'
  ctx.fillText(playerName.toUpperCase(), 80, 255)
  ctx.fillStyle = '#ffffff'
  ctx.font = '800 84px Arial'
  ctx.fillText(trade.pair, 80, 350)
  ctx.fillStyle = trade.side === 'long' ? '#79efaa' : '#ff8696'
  ctx.font = '800 27px Arial'
  ctx.fillText(`${trade.side === 'long' ? 'LONG' : 'SHORT'}  ·  LEVIER ×${trade.leverage}`, 84, 408)

  ctx.fillStyle = '#77727c'
  ctx.font = '700 25px Arial'
  ctx.fillText('PNL NET', 80, 570)
  ctx.fillStyle = accent
  ctx.font = '900 140px Arial'
  const sign = pnl >= 0 ? '+' : '−'
  ctx.fillText(`${sign}$${Math.abs(pnl).toLocaleString('en-US', { maximumFractionDigits: 2 })}`, 72, 735)

  const entry = trade.entryPrice && Number.isFinite(trade.entryPrice)
    ? trade.entryPrice
    : trade.size > 0
      ? trade.side === 'long' ? trade.price - trade.pnl / trade.size : trade.price + trade.pnl / trade.size
      : undefined
  const items = [
    ['ENTRÉE', entry && Number.isFinite(entry) ? entry.toLocaleString('en-US', { maximumFractionDigits: 6 }) : '—'],
    ['SORTIE', trade.price.toLocaleString('en-US', { maximumFractionDigits: 6 })],
    ['FRAIS', `$${trade.fee.toLocaleString('en-US', { maximumFractionDigits: 2 })}`],
  ]
  items.forEach(([label, value], index) => {
    const x = 80 + index * 320
    ctx.fillStyle = 'rgba(255,255,255,.04)'
    roundedRectPath(ctx, x, 835, 290, 145, 20)
    ctx.fill()
    ctx.fillStyle = '#77727c'
    ctx.font = '700 20px Arial'
    ctx.fillText(label, x + 24, 880)
    ctx.fillStyle = '#ffffff'
    ctx.font = '700 31px Arial'
    ctx.fillText(value, x + 24, 938)
  })

  ctx.fillStyle = '#aaa5ad'
  ctx.font = '600 27px Arial'
  ctx.fillText(trade.competitionTitle, 80, 1100)
  ctx.fillStyle = '#6e6972'
  ctx.font = '500 23px Arial'
  ctx.fillText(new Date(trade.time).toLocaleString('fr-FR'), 80, 1150)
  ctx.fillStyle = '#ee243c'
  ctx.fillRect(80, 1210, 90, 5)
  ctx.fillStyle = '#ffffff'
  ctx.font = '700 24px Arial'
  ctx.fillText('ENTRE DANS L’ARÈNE', 80, 1260)

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('Image impossible à générer')
  return { blob, url: URL.createObjectURL(blob) }
}

export function SharePnlModal({
  trade,
  playerName,
  onClose,
}: {
  trade: JournalTrade | null
  playerName: string
  onClose: () => void
}) {
  const [result, setResult] = useState<{ blob: Blob; url: string } | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!trade) return
    let active = true
    setResult(null)
    setError('')
    void generateCard(trade, playerName).then((next) => {
      if (active) setResult(next)
      else URL.revokeObjectURL(next.url)
    }).catch(() => active && setError('La carte n’a pas pu être générée.'))
    return () => {
      active = false
    }
  }, [playerName, trade])

  useEffect(() => () => {
    if (result) URL.revokeObjectURL(result.url)
  }, [result])

  if (!trade) return null

  async function share() {
    if (!result) return
    const file = new File([result.blob], `btf-${trade!.pair.replace(/\W/g, '')}-pnl.png`, { type: 'image/png' })
    try {
      if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
        await navigator.share({ title: 'BTF Arena', text: `Mon trade ${trade!.pair} sur BTF Arena`, files: [file] })
        return
      }
    } catch (shareError) {
      if (shareError instanceof DOMException && shareError.name === 'AbortError') return
    }
    download()
  }

  function download() {
    if (!result) return
    const link = document.createElement('a')
    link.href = result.url
    link.download = `btf-${trade!.pair.replace(/\W/g, '')}-pnl.png`
    link.click()
  }

  return createPortal(
    <div className="share-pnl-layer" role="dialog" aria-modal="true">
      <button className="share-pnl-backdrop" type="button" onClick={onClose} aria-label="Fermer" />
      <section className="share-pnl-modal">
        <header><div><span>PARTAGE</span><strong>Ma performance</strong></div><button type="button" onClick={onClose}>×</button></header>
        <div className="share-pnl-preview">
          {result ? <img src={result.url} alt="Carte de partage du PnL" /> : error || <i />}
        </div>
        <footer>
          <button type="button" disabled={!result} onClick={download}>Télécharger</button>
          <button className="is-primary" type="button" disabled={!result} onClick={() => void share()}>Partager</button>
        </footer>
      </section>
    </div>,
    document.body,
  )
}
