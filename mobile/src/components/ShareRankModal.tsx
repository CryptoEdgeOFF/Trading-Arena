import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { apiAssetUrl } from '../lib/api'
import { drawShareAvatar, drawShareLogo, roundedRectPath } from '../lib/shareCanvas'
import './SharePnlModal.css'

export type RankShareRow = {
  rank: number
  name: string
  pnlUsd: number
  pnlPercent?: number
  avatarUrl?: string | null
}

async function generateRankCard(row: RankShareRow, competition: string, participants: number): Promise<{ blob: Blob; url: string }> {
  const canvas = document.createElement('canvas')
  canvas.width = 1080
  canvas.height = 1350
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas indisponible')
  const gradient = ctx.createLinearGradient(0, 0, 1080, 1350)
  gradient.addColorStop(0, '#07070b')
  gradient.addColorStop(.6, '#15090d')
  gradient.addColorStop(1, '#28070d')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, 1080, 1350)
  const glow = ctx.createRadialGradient(850, 180, 30, 850, 180, 680)
  glow.addColorStop(0, 'rgba(238,36,60,.32)')
  glow.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, 1080, 900)
  ctx.strokeStyle = 'rgba(255,255,255,.12)'
  ctx.lineWidth = 2
  roundedRectPath(ctx, 30, 30, 1020, 1290, 40)
  ctx.stroke()
  await drawShareLogo(ctx)
  await drawShareAvatar(ctx, {
    url: row.avatarUrl ? apiAssetUrl(row.avatarUrl) : null,
    name: row.name,
    x: 760,
    y: 260,
    size: 240,
  })
  ctx.fillStyle = '#8d8791'
  ctx.font = '700 25px Arial'
  ctx.fillText('MON CLASSEMENT', 80, 305)
  ctx.fillStyle = '#ffffff'
  ctx.font = '900 280px Arial'
  ctx.fillText(`#${row.rank}`, 65, 590)
  ctx.fillStyle = '#b1abb4'
  ctx.font = '600 31px Arial'
  ctx.fillText(`SUR ${participants || '—'} PARTICIPANTS`, 85, 665)
  ctx.fillStyle = '#fff'
  ctx.font = '800 54px Arial'
  ctx.fillText(row.name.toUpperCase(), 80, 790)
  ctx.fillStyle = '#9a949d'
  ctx.font = '600 29px Arial'
  ctx.fillText(competition, 80, 850)
  const positive = row.pnlUsd >= 0
  ctx.fillStyle = positive ? '#32df83' : '#ff536b'
  ctx.font = '900 85px Arial'
  ctx.fillText(`${positive ? '+' : '−'}$${Math.abs(row.pnlUsd).toLocaleString('en-US', { maximumFractionDigits: 2 })}`, 80, 1035)
  if (row.pnlPercent != null) {
    ctx.font = '700 35px Arial'
    ctx.fillText(`${row.pnlPercent >= 0 ? '+' : ''}${row.pnlPercent.toFixed(2)}%`, 84, 1092)
  }
  ctx.fillStyle = '#ee243c'
  ctx.fillRect(80, 1210, 90, 5)
  ctx.fillStyle = '#fff'
  ctx.font = '700 24px Arial'
  ctx.fillText('ENTRE DANS L’ARÈNE', 80, 1260)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('Image impossible à générer')
  return { blob, url: URL.createObjectURL(blob) }
}

export function ShareRankModal({
  row,
  competition,
  participants,
  spectatorUrl,
  onClose,
}: {
  row: RankShareRow | null
  competition: string
  participants: number
  spectatorUrl?: string
  onClose: () => void
}) {
  const [result, setResult] = useState<{ blob: Blob; url: string } | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!row) return
    let active = true
    setResult(null)
    setError('')
    void generateRankCard(row, competition, participants).then((next) => {
      if (active) setResult(next)
      else URL.revokeObjectURL(next.url)
    }).catch(() => active && setError('La carte n’a pas pu être générée.'))
    return () => { active = false }
  }, [competition, participants, row])
  useEffect(() => () => { if (result) URL.revokeObjectURL(result.url) }, [result])
  if (!row) return null

  function download() {
    if (!result) return
    const link = document.createElement('a')
    link.href = result.url
    link.download = `btf-rang-${row!.rank}.png`
    link.click()
  }
  async function share() {
    if (!result) return
    const file = new File([result.blob], `btf-rang-${row!.rank}.png`, { type: 'image/png' })
    try {
      if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
        await navigator.share({ title: 'BTF Arena', text: `Je suis #${row!.rank} sur ${competition}`, ...(spectatorUrl ? { url: spectatorUrl } : {}), files: [file] })
        return
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
    }
    download()
  }

  return createPortal(
    <div className="share-pnl-layer" role="dialog" aria-modal="true">
      <button className="share-pnl-backdrop" type="button" onClick={onClose} aria-label="Fermer" />
      <section className="share-pnl-modal">
        <header><div><span>PARTAGE</span><strong>Mon classement</strong></div><button type="button" onClick={onClose}>×</button></header>
        <div className="share-pnl-preview">
          {result ? <img src={result.url} alt="Carte de partage du classement" /> : error || <i />}
        </div>
        <footer>
          <button className="is-primary" type="button" disabled={!result} onClick={() => void share()}>Partager</button>
        </footer>
      </section>
    </div>,
    document.body,
  )
}
