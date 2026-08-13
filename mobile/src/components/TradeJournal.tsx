import { useEffect, useMemo, useState } from 'react'
import { getMyTrades, type JournalTrade, type SessionUser } from '../lib/api'
import { SharePnlModal } from './SharePnlModal'
import './TradeJournal.css'

function netPnl(trade: JournalTrade) {
  return trade.pnl - trade.fee
}

function computeStats(trades: JournalTrade[]) {
  let grossProfit = 0
  let grossLoss = 0
  let openFees = 0
  let totalFees = 0
  let wins = 0
  let losses = 0
  let winStreak = 0
  let lossStreak = 0
  let maxWinStreak = 0
  let maxLossStreak = 0
  for (const trade of trades) {
    totalFees += trade.fee
    if (trade.action === 'open') {
      openFees += trade.fee
      continue
    }
    const pnl = netPnl(trade)
    if (pnl > 0) {
      wins += 1
      grossProfit += pnl
      winStreak += 1
      lossStreak = 0
      maxWinStreak = Math.max(maxWinStreak, winStreak)
    } else if (pnl < 0) {
      losses += 1
      grossLoss += -pnl
      lossStreak += 1
      winStreak = 0
      maxLossStreak = Math.max(maxLossStreak, lossStreak)
    }
  }
  const decided = wins + losses
  return {
    count: decided,
    wins,
    losses,
    netPnl: grossProfit - grossLoss - openFees,
    totalFees,
    winRate: decided ? wins / decided : null,
    avgRR: wins && losses ? (grossProfit / wins) / (grossLoss / losses) : null,
    profitFactor: grossLoss ? grossProfit / grossLoss : grossProfit ? Infinity : null,
    maxWinStreak,
    maxLossStreak,
  }
}

function EquityCurve({ trades }: { trades: JournalTrade[] }) {
  const geometry = useMemo(() => {
    const values = [0]
    let value = 0
    for (const trade of trades) {
      value += trade.action === 'close' ? netPnl(trade) : -trade.fee
      values.push(value)
    }
    const min = Math.min(0, ...values)
    const max = Math.max(0, ...values)
    const range = max - min || 1
    const points = values.map((item, index) => {
      const x = 8 + index * (344 / Math.max(1, values.length - 1))
      const y = 10 + ((max - item) / range) * 120
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    return { path: `M${points.join(' L')}`, last: value, zeroY: 10 + ((max - 0) / range) * 120 }
  }, [trades])
  return (
    <section className="journal-curve">
      <div><span>COURBE D’ÉQUITÉ</span><strong className={geometry.last >= 0 ? 'positive' : 'negative'}>{geometry.last >= 0 ? '+' : ''}{geometry.last.toFixed(2)} $</strong></div>
      <svg viewBox="0 0 360 140" preserveAspectRatio="none">
        <line x1="0" x2="360" y1={geometry.zeroY} y2={geometry.zeroY} />
        <path d={geometry.path} className={geometry.last >= 0 ? 'positive' : 'negative'} />
      </svg>
    </section>
  )
}

export function TradeJournal({
  token,
  user,
  onBack,
}: {
  token: string
  user: SessionUser
  onBack: () => void
}) {
  const [trades, setTrades] = useState<JournalTrade[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [arena, setArena] = useState('all')
  const [shareTrade, setShareTrade] = useState<JournalTrade | null>(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    void getMyTrades(token).then((next) => active && setTrades(next))
      .catch((nextError) => active && setError(nextError instanceof Error ? nextError.message : 'Journal indisponible'))
      .finally(() => active && setLoading(false))
    return () => { active = false }
  }, [token])

  const arenas = useMemo(() => [...new Map(trades.map((trade) => [trade.competitionId, trade.competitionTitle])).entries()], [trades])
  const filtered = useMemo(() => arena === 'all' ? trades : trades.filter((trade) => trade.competitionId === arena), [arena, trades])
  const closed = useMemo(() => filtered.filter((trade) => trade.action === 'close').slice().reverse(), [filtered])
  const stats = useMemo(() => computeStats(filtered), [filtered])
  const highlights = useMemo(() => filtered.filter((trade) => trade.action === 'close').slice().sort((a, b) => netPnl(b) - netPnl(a)), [filtered])
  const bestTrades = highlights.filter((trade) => netPnl(trade) > 0).slice(0, 3)
  const worstTrades = highlights.filter((trade) => netPnl(trade) < 0).slice(-3).reverse()

  return (
    <div className="journal-page">
      <header className="subpage-head">
        <button type="button" onClick={onBack} aria-label="Retour">‹</button>
        <div><span>PERFORMANCE</span><h2>Journal</h2></div>
      </header>
      <p className="journal-intro">Retrouve tous tes trades, tes statistiques nettes de frais et partage tes performances.</p>

      {loading ? <div className="journal-state">Chargement du journal…</div> : error ? <div className="journal-state is-error">{error}</div> : !trades.length ? (
        <div className="journal-state">Ton journal est encore vide. Tes prochains trades apparaîtront ici.</div>
      ) : (
        <>
          <div className="journal-filters">
            <button type="button" className={arena === 'all' ? 'is-active' : ''} onClick={() => setArena('all')}>Toutes</button>
            {arenas.map(([id, title]) => <button key={id} type="button" className={arena === id ? 'is-active' : ''} onClick={() => setArena(id)}>{title}</button>)}
          </div>
          <EquityCurve trades={filtered} />
          <section className="journal-stats">
            <div><strong className={stats.netPnl >= 0 ? 'positive' : 'negative'}>{stats.netPnl >= 0 ? '+' : ''}{stats.netPnl.toFixed(2)} $</strong><small>PnL réalisé</small></div>
            <div><strong>{stats.winRate == null ? '—' : `${(stats.winRate * 100).toFixed(1)}%`}</strong><small>Win rate</small></div>
            <div><strong>{stats.profitFactor === Infinity ? '∞' : stats.profitFactor?.toFixed(2) || '—'}</strong><small>Profit factor</small></div>
            <div><strong>{stats.avgRR?.toFixed(2) || '—'}</strong><small>R/R moyen</small></div>
            <div><strong className="positive">{stats.wins}</strong><small>Gagnants</small></div>
            <div><strong className="negative">{stats.losses}</strong><small>Perdants</small></div>
            <div><strong>{stats.maxWinStreak}</strong><small>Série gains</small></div>
            <div><strong>{stats.maxLossStreak}</strong><small>Série pertes</small></div>
            <div><strong className="negative">−{stats.totalFees.toFixed(2)} $</strong><small>Frais</small></div>
          </section>

          {(bestTrades.length > 0 || worstTrades.length > 0) && (
            <section className="journal-highlights">
              {[...bestTrades.map((trade) => ({ trade, kind: 'MEILLEUR TRADE' })), ...worstTrades.map((trade) => ({ trade, kind: 'PLUS FORTE PERTE' }))].map(({ trade, kind }) => (
                <article key={trade.id}>
                  <div><small>{kind}</small><strong>{trade.pair}</strong><span>{trade.side.toUpperCase()} · ×{trade.leverage}</span></div>
                  <div><strong className={netPnl(trade) >= 0 ? 'positive' : 'negative'}>{netPnl(trade) >= 0 ? '+' : ''}{netPnl(trade).toFixed(2)} $</strong><button type="button" onClick={() => setShareTrade(trade)}>Partager</button></div>
                </article>
              ))}
            </section>
          )}

          <section className="journal-trades">
            <header><span>TOUS LES TRADES</span><strong>{stats.count}</strong></header>
            {closed.map((trade) => (
              <article key={trade.id}>
                <div><strong>{trade.pair}</strong><span>{trade.side.toUpperCase()} · ×{trade.leverage}</span><small>{trade.competitionTitle} · {new Date(trade.time).toLocaleString('fr-FR')}</small></div>
                <div><strong className={netPnl(trade) >= 0 ? 'positive' : 'negative'}>{netPnl(trade) >= 0 ? '+' : ''}{netPnl(trade).toFixed(2)} $</strong><small>Frais −{trade.fee.toFixed(2)} $</small><button type="button" onClick={() => setShareTrade(trade)}>Partager</button></div>
              </article>
            ))}
          </section>
        </>
      )}
      <SharePnlModal trade={shareTrade} playerName={user.name} onClose={() => setShareTrade(null)} />
    </div>
  )
}
