import { useMemo } from 'react'
import { apiAssetUrl, type PnlHistorySample, type PnlHistoryTrader } from '../lib/api'
import { useI18n } from '../i18n'
import './PnlRaceChart.css'

const CHART_WIDTH = 340
const CHART_HEIGHT = 168
const PADDING = { top: 12, right: 40, bottom: 8, left: 6 }
const SERIES_COLORS = ['#ffd257', '#8fb7ff', '#ff7a5c', '#5cd596', '#c48bff', '#ff5a91']
const MAX_SERIES = 6

type Series = {
  trader: PnlHistoryTrader
  color: string
  points: Array<{ x: number; y: number }>
  path: string
  isLeader: boolean
}

function buildSeries(samples: PnlHistorySample[], traders: PnlHistoryTrader[]): Series[] {
  const ranked = traders
    .filter((trader) => trader.rank > 0)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, MAX_SERIES)
  if (ranked.length === 0 || samples.length < 2) return []

  const t0 = samples[0].t
  const t1 = samples[samples.length - 1].t
  const timeSpan = Math.max(1, t1 - t0)

  const values = new Map<string, Array<{ t: number; pnl: number }>>()
  for (const trader of ranked) values.set(trader.userId, [])
  for (const sample of samples) {
    for (const row of sample.rows) {
      values.get(row.userId)?.push({ t: sample.t, pnl: row.pnlPercent })
    }
  }

  let min = 0
  let max = 0
  for (const list of values.values()) {
    for (const point of list) {
      if (point.pnl < min) min = point.pnl
      if (point.pnl > max) max = point.pnl
    }
  }
  const span = Math.max(0.4, max - min)
  min -= span * 0.12
  max += span * 0.12

  const innerWidth = CHART_WIDTH - PADDING.left - PADDING.right
  const innerHeight = CHART_HEIGHT - PADDING.top - PADDING.bottom
  const xFor = (t: number) => PADDING.left + ((t - t0) / timeSpan) * innerWidth
  const yFor = (pnl: number) => PADDING.top + (1 - (pnl - min) / (max - min)) * innerHeight

  return ranked
    .map((trader, index) => {
      const list = values.get(trader.userId) || []
      if (list.length < 2) return null
      const points = list.map((point) => ({ x: xFor(point.t), y: yFor(point.pnl) }))
      const path = points
        .map((point, pointIndex) => `${pointIndex === 0 ? 'M' : 'L'}${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
        .join(' ')
      return {
        trader,
        color: SERIES_COLORS[index % SERIES_COLORS.length],
        points,
        path,
        isLeader: trader.rank === 1,
      }
    })
    .filter((series): series is Series => series !== null)
}

export function PnlRaceChart({
  samples,
  traders,
  currentUserId,
}: {
  samples: PnlHistorySample[]
  traders: PnlHistoryTrader[]
  currentUserId?: string
}) {
  const { t } = useI18n()
  const series = useMemo(() => buildSeries(samples, traders), [samples, traders])
  const leader = traders.filter((trader) => trader.rank > 0).sort((a, b) => a.rank - b.rank)[0]

  if (!series.length) {
    return (
      <section className="pnl-race">
        <header className="pnl-race__head">
          <div><span>{t('spectate.kicker')}</span><h3>{t('spectate.title')}</h3></div>
        </header>
        <div className="pnl-race__collecting"><i />{t('spectate.collecting')}</div>
      </section>
    )
  }

  // Le zéro n'est visible que s'il est dans la fenêtre affichée.
  const zeroY = (() => {
    const first = series[0]
    if (!first) return null
    // Recalcule la position du 0 à partir de deux points connus de la série.
    const sampleValues = samples.flatMap((sample) => sample.rows.map((row) => row.pnlPercent))
    const minPnl = Math.min(...sampleValues)
    const maxPnl = Math.max(...sampleValues)
    if (minPnl >= 0 || maxPnl <= 0) return null
    const span = Math.max(0.4, maxPnl - minPnl)
    const min = minPnl - span * 0.12
    const max = maxPnl + span * 0.12
    return PADDING.top + (1 - (0 - min) / (max - min)) * (CHART_HEIGHT - PADDING.top - PADDING.bottom)
  })()

  return (
    <section className="pnl-race">
      <header className="pnl-race__head">
        <div><span>{t('spectate.kicker')}</span><h3>{t('spectate.title')}</h3></div>
        {leader && <em className="pnl-race__leader">👑 {t('spectate.dominates', { name: leader.name })}</em>}
      </header>

      <div className="pnl-race__chart">
        <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
          {zeroY != null && <line className="pnl-race__zero" x1={PADDING.left} y1={zeroY} x2={CHART_WIDTH - PADDING.right} y2={zeroY} />}
          {[...series].reverse().map((item) => (
            <path key={item.trader.userId} d={item.path} fill="none" stroke={item.color}
              strokeWidth={item.isLeader ? 2.6 : 1.6}
              strokeLinecap="round" strokeLinejoin="round"
              opacity={item.trader.breached ? 0.35 : item.isLeader ? 1 : 0.82}
              style={item.isLeader ? { filter: `drop-shadow(0 0 5px ${item.color})` } : undefined} />
          ))}
        </svg>
        {series.map((item) => {
          const last = item.points[item.points.length - 1]
          return (
            <span key={item.trader.userId}
              className={`pnl-race__avatar ${item.isLeader ? 'is-leader' : ''} ${item.trader.userId === currentUserId ? 'is-me' : ''}`}
              style={{
                left: `${(last.x / CHART_WIDTH) * 100}%`,
                top: `${(last.y / CHART_HEIGHT) * 100}%`,
                borderColor: item.color,
                zIndex: 10 - item.trader.rank,
              }}>
              {item.trader.avatarUrl
                ? <img src={apiAssetUrl(item.trader.avatarUrl)} alt={item.trader.name} />
                : <i>{item.trader.name.slice(0, 2).toUpperCase()}</i>}
            </span>
          )
        })}
      </div>

      <div className="pnl-race__legend">
        {series.map((item) => (
          <span key={item.trader.userId} className="pnl-race__chip">
            <i style={{ background: item.color }} />
            <strong>#{item.trader.rank} {item.trader.name}</strong>
            <em className={item.trader.pnlPercent >= 0 ? 'positive' : 'negative'}>
              {item.trader.pnlPercent >= 0 ? '+' : ''}{item.trader.pnlPercent.toFixed(2)}%
            </em>
          </span>
        ))}
      </div>
    </section>
  )
}
