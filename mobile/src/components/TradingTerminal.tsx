import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  API_WS_URL,
  cancelPaperOrder,
  closePaperPosition,
  createPaperSession,
  getPaperMeta,
  getPaperState,
  placePaperOrder,
  type MyCompetition,
  type PaperMeta,
  type PaperState,
} from '../lib/api'
import {
  clearPaperSessionToken,
  readPaperSessionToken,
  writePaperSessionToken,
} from '../lib/session'
import { TradingViewChart } from './TradingViewChart'
import './TradingTerminal.css'

const CONTRACT_SIZE: Record<string, number> = {
  'EUR/USD': 100_000, 'GBP/USD': 100_000, 'USD/JPY': 100_000, 'USD/CHF': 100_000,
  'GOLD/USD': 100, 'SILVER/USD': 5_000, 'WTI/USD': 1_000,
  'SP500/USD': 50, 'NAS100/USD': 20, 'US30/USD': 5,
}

function money(value: number) {
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function price(value?: number | null) {
  if (value == null || !Number.isFinite(value)) return '—'
  return value.toLocaleString('en-US', {
    minimumFractionDigits: value < 10 ? 4 : 2,
    maximumFractionDigits: value < 10 ? 5 : 2,
  })
}

function displaySize(pair: string, engineSize: number) {
  const contract = CONTRACT_SIZE[pair] || 1
  const value = engineSize / contract
  return `${value.toLocaleString('en-US', { maximumFractionDigits: contract > 1 ? 2 : 5 })} ${contract > 1 ? 'lots' : pair.split('/')[0]}`
}

function competitionSummary(context: PaperState['competition']) {
  if (!context) return null
  return 'competition' in context ? context.competition : context
}

function isBreached(context: PaperState['competition']) {
  return Boolean(context && 'competition' in context && context.breached)
}

function positionPnl(pair: string, side: 'long' | 'short', size: number, entry: number, mark: number) {
  const raw = (side === 'long' ? mark - entry : entry - mark) * size
  return pair === 'USD/JPY' || pair === 'USD/CHF' ? raw / Math.max(mark, 1e-9) : raw
}

export function TradingTerminal({
  accountToken,
  competitions,
}: {
  accountToken: string
  competitions: MyCompetition[]
}) {
  const [paperToken, setPaperToken] = useState<string | null>(null)
  const [state, setState] = useState<PaperState | null>(null)
  const [meta, setMeta] = useState<PaperMeta | null>(null)
  const [selectedPair, setSelectedPair] = useState('')
  const [competitionId, setCompetitionId] = useState(competitions.find((item) => item.canTrade)?.id || '')
  const [side, setSide] = useState<'long' | 'short'>('long')
  const [orderType, setOrderType] = useState<'market' | 'limit'>('market')
  const [size, setSize] = useState('')
  const [limitPrice, setLimitPrice] = useState('')
  const [stopLoss, setStopLoss] = useState('')
  const [takeProfit, setTakeProfit] = useState('')
  const [leverage, setLeverage] = useState(1)
  const [panel, setPanel] = useState<'positions' | 'orders'>('positions')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const pendingClosedPositions = useRef(new Map<string, number>())
  const pendingCancelledOrders = useRef(new Map<string, number>())

  const reconcilePending = useCallback((next: PaperState): PaperState => {
    const now = Date.now()
    for (const [id, expiresAt] of pendingClosedPositions.current) {
      if (expiresAt <= now) pendingClosedPositions.current.delete(id)
    }
    for (const [id, expiresAt] of pendingCancelledOrders.current) {
      if (expiresAt <= now) pendingCancelledOrders.current.delete(id)
    }
    return {
      ...next,
      canTrade: next.canTrade && !isBreached(next.competition),
      player: {
        ...next.player,
        openPositions: next.player.openPositions.filter((item) => !pendingClosedPositions.current.has(item.id)),
        openOrders: next.player.openOrders.filter((item) => !pendingCancelledOrders.current.has(item.id)),
      },
    }
  }, [])

  const refresh = useCallback(async (token: string) => {
    const next = reconcilePending(await getPaperState(token))
    setState(next)
    setSelectedPair((current) => current || next.pairs[0] || Object.keys(next.market)[0] || '')
    return next
  }, [reconcilePending])

  useEffect(() => {
    let cancelled = false
    void Promise.all([readPaperSessionToken(), getPaperMeta().catch(() => null)]).then(async ([stored, nextMeta]) => {
      if (cancelled) return
      setMeta(nextMeta)
      if (stored) {
        try {
          await refresh(stored)
          if (!cancelled) setPaperToken(stored)
        } catch {
          await clearPaperSessionToken()
        }
      }
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [refresh])

  useEffect(() => {
    if (!paperToken) return
    let timer: ReturnType<typeof setTimeout> | undefined
    let stopped = false
    async function poll() {
      try { if (!stopped) await refresh(paperToken!) } catch { /* reconnexion WS/poll suivante */ }
      if (!stopped) timer = setTimeout(poll, 5000)
    }
    void poll()

    const socket = new WebSocket(`${API_WS_URL}/ws?paperToken=${encodeURIComponent(paperToken)}`)
    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(String(event.data))
        if (message?.type === 'paper:update' && message.data) {
          setState((current) => {
            if (!current) return current
            const next = {
              ...current,
              ...message.data,
              player: message.data.player || current.player,
              market: message.data.market || current.market,
              competition: message.data.competition ?? current.competition,
            } as PaperState
            return reconcilePending(next)
          })
          return
        }
        if (message?.type === 'market:tick' && Array.isArray(message.data?.ticks)) {
          setState((current) => {
            if (!current) return current
            const market = { ...current.market }
            for (const tick of message.data.ticks) {
              if (!tick?.pair || !Number.isFinite(tick.markPrice)) continue
              market[tick.pair] = { ...market[tick.pair], ...tick }
            }
            const previousUnrealized = current.player.openPositions.reduce((sum, item) => sum + item.pnl, 0)
            const openPositions = current.player.openPositions.map((item) => {
              const mark = market[item.pair]?.markPrice
              if (!Number.isFinite(mark)) return item
              return {
                ...item,
                markPrice: mark,
                pnl: positionPnl(item.pair, item.side, item.size, item.entryPrice, mark),
              }
            })
            const nextUnrealized = openPositions.reduce((sum, item) => sum + item.pnl, 0)
            const delta = nextUnrealized - previousUnrealized
            return {
              ...current,
              market,
              player: {
                ...current.player,
                openPositions,
                pnl: current.player.pnl + delta,
                currentBalance: current.player.currentBalance + delta,
                availableMargin: Math.max(0, current.player.availableMargin + delta),
              },
            }
          })
        }
      } catch { /* message non JSON ignoré */ }
    }
    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
      socket.close()
    }
  }, [paperToken, reconcilePending, refresh])

  const ticker = state?.market[selectedPair] || meta?.market[selectedPair]
  const contract = CONTRACT_SIZE[selectedPair] || 1
  const inputQty = Number(size)
  const engineSize = Number.isFinite(inputQty) ? inputQty * contract : 0
  const referencePrice = orderType === 'limit' ? Number(limitPrice) : ticker?.markPrice || 0
  const notional = engineSize * referencePrice
  const marginEstimate = leverage > 0 ? notional / leverage : 0
  const activeCompetition = competitionSummary(state?.competition ?? null)
  const accountBreached = isBreached(state?.competition ?? null)
  const canTradeNow = Boolean(state?.canTrade) && !accountBreached && ticker?.marketOpen !== false

  async function openCompetition() {
    if (!competitionId) return
    setBusy(true)
    setError('')
    try {
      const session = await createPaperSession(accountToken, competitionId)
      await writePaperSessionToken(session.token)
      setPaperToken(session.token)
      await refresh(session.token)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Terminal indisponible')
    } finally {
      setBusy(false)
    }
  }

  async function submitOrder() {
    if (!paperToken || !selectedPair || engineSize <= 0) return
    setBusy(true)
    setError('')
    try {
      await placePaperOrder(paperToken, {
        pair: selectedPair,
        side,
        size: engineSize,
        orderType,
        limitPrice: orderType === 'limit' ? Number(limitPrice) : null,
        leverage,
        stopLoss: stopLoss ? Number(stopLoss) : null,
        takeProfit: takeProfit ? Number(takeProfit) : null,
      })
      setSize('')
      if (orderType === 'limit') setLimitPrice('')
      await refresh(paperToken)
      setPanel(orderType === 'limit' ? 'orders' : 'positions')
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Ordre refusé')
    } finally {
      setBusy(false)
    }
  }

  async function closePosition(positionId: string) {
    if (!paperToken) return
    setBusy(true)
    setError('')
    pendingClosedPositions.current.set(positionId, Date.now() + 4000)
    try {
      await closePaperPosition(paperToken, positionId)
      setState((current) => current ? {
        ...current,
        player: { ...current.player, openPositions: current.player.openPositions.filter((item) => item.id !== positionId) },
      } : current)
      await refresh(paperToken)
    } catch (nextError) {
      pendingClosedPositions.current.delete(positionId)
      setError(nextError instanceof Error ? nextError.message : 'Fermeture refusée')
    } finally {
      setBusy(false)
    }
  }

  async function cancelOrder(orderId: string) {
    if (!paperToken) return
    setBusy(true)
    setError('')
    pendingCancelledOrders.current.set(orderId, Date.now() + 4000)
    try {
      await cancelPaperOrder(paperToken, orderId)
      setState((current) => current ? {
        ...current,
        player: { ...current.player, openOrders: current.player.openOrders.filter((item) => item.id !== orderId) },
      } : current)
      await refresh(paperToken)
    } catch (nextError) {
      pendingCancelledOrders.current.delete(orderId)
      setError(nextError instanceof Error ? nextError.message : 'Annulation refusée')
    } finally {
      setBusy(false)
    }
  }

  async function leaveTerminal() {
    await clearPaperSessionToken()
    setPaperToken(null)
    setState(null)
    setError('')
  }

  if (loading) return <div className="terminal-loader"><i /><span>Synchronisation du terminal</span></div>

  if (!paperToken || !state) {
    return (
      <div className="terminal-gate">
        <span>SESSION DE TRADING</span>
        <h2>Choisis ton arène</h2>
        <p>Le terminal ouvrira la même session joueur et les mêmes positions que sur ordinateur.</p>
        {competitions.length ? (
          <>
            <label>Compétition
              <select value={competitionId} onChange={(event) => setCompetitionId(event.target.value)}>
                <option value="">Sélectionner</option>
                {competitions.map((item) => <option key={item.id} value={item.id}>{item.title} · {item.status}</option>)}
              </select>
            </label>
            {error && <div className="terminal-error">{error}</div>}
            <button type="button" disabled={!competitionId || busy} onClick={() => void openCompetition()}>
              {busy ? 'Connexion…' : 'Ouvrir le terminal'}
            </button>
          </>
        ) : <div className="terminal-empty">Inscris-toi d’abord à une arène.</div>}
      </div>
    )
  }

  return (
    <div className="mobile-terminal">
      <header className="terminal-head">
        <div><span>{activeCompetition?.title || 'BTF ARENA'}</span><strong>{state.player.name}</strong></div>
        <div className="terminal-head__right">
          <div className="terminal-rank"><small>RANG</small><strong>#{state.player.rank || '—'}</strong></div>
          <button type="button" onClick={() => void leaveTerminal()} aria-label="Changer d’arène">Changer</button>
        </div>
      </header>

      <section className="terminal-balance">
        <div><small>ÉQUITÉ</small><strong>{money(state.player.currentBalance)} <i>USD</i></strong></div>
        <div className={state.player.pnl >= 0 ? 'is-profit' : 'is-loss'}><small>PNL</small><strong>{state.player.pnl >= 0 ? '+' : ''}{money(state.player.pnl)} $</strong><span>{state.player.pnlPercent.toFixed(2)}%</span></div>
      </section>

      <div className="pair-strip">
        {(state.pairs.length ? state.pairs : Object.keys(state.market)).map((pairName) => (
          <button key={pairName} type="button" className={pairName === selectedPair ? 'is-active' : ''}
            onClick={() => setSelectedPair(pairName)}>
            <strong>{pairName.replace('/USD', '')}</strong>
            <small className={(state.market[pairName]?.change24h ?? 0) >= 0 ? 'is-profit' : 'is-loss'}>
              {(state.market[pairName]?.change24h ?? 0) >= 0 ? '+' : ''}{(state.market[pairName]?.change24h ?? 0).toFixed(2)}%
            </small>
          </button>
        ))}
      </div>

      <section className="quote-card tradingview-card">
        <TradingViewChart
          pair={selectedPair}
          pairs={state.pairs}
          market={state.market}
          metadata={meta?.marketMetadata}
          onPairChange={setSelectedPair}
        />
        <div className="quote-bidask"><span>BID <strong>{price(ticker?.bidPrice)}</strong></span><span>ASK <strong>{price(ticker?.askPrice)}</strong></span></div>
      </section>

      <section className="order-ticket">
        <div className="ticket-toggle">
          <button type="button" className={side === 'long' ? 'is-buy' : ''} onClick={() => setSide('long')}>ACHETER</button>
          <button type="button" className={side === 'short' ? 'is-sell' : ''} onClick={() => setSide('short')}>VENDRE</button>
        </div>
        <div className="order-type">
          <button type="button" className={orderType === 'market' ? 'is-active' : ''} onClick={() => setOrderType('market')}>Marché</button>
          <button type="button" className={orderType === 'limit' ? 'is-active' : ''} onClick={() => setOrderType('limit')}>Limite</button>
        </div>
        <div className="ticket-grid">
          <label>Quantité ({contract > 1 ? 'lots' : selectedPair.split('/')[0]})
            <input value={size} onChange={(event) => setSize(event.target.value)} inputMode="decimal" placeholder={contract > 1 ? '0.10' : '0.001'} />
          </label>
          {orderType === 'limit' && <label>Prix limite<input value={limitPrice} onChange={(event) => setLimitPrice(event.target.value)} inputMode="decimal" placeholder={price(ticker?.markPrice)} /></label>}
          <label>Stop loss<input value={stopLoss} onChange={(event) => setStopLoss(event.target.value)} inputMode="decimal" placeholder="Optionnel" /></label>
          <label>Take profit<input value={takeProfit} onChange={(event) => setTakeProfit(event.target.value)} inputMode="decimal" placeholder="Optionnel" /></label>
        </div>
        <div className="leverage-row"><span>Levier <strong>×{leverage}</strong></span><input type="range" min={meta?.fees.minLeverage || 1} max={meta?.fees.maxLeverage || 20} value={leverage} onChange={(event) => setLeverage(Number(event.target.value))} /></div>
        <div className="order-summary"><span>Notionnel <strong>{money(notional)} $</strong></span><span>Marge estimée <strong>{money(marginEstimate)} $</strong></span></div>
        {error && <div className="terminal-error">{error}</div>}
        {!canTradeNow && (
          <div className="terminal-warning">
            {accountBreached
              ? 'Compte hors classement : la limite de drawdown a été atteinte.'
              : ticker?.marketOpen === false
                ? ticker.marketClosedLabel || 'Ce marché est actuellement fermé.'
                : 'Le trading n’est pas ouvert pour cette arène.'}
          </div>
        )}
        <button className={`place-order ${side === 'long' ? 'buy' : 'sell'}`} type="button"
          disabled={busy || !canTradeNow || engineSize <= 0 || (orderType === 'limit' && !Number(limitPrice))}
          onClick={() => void submitOrder()}>
          {busy ? 'TRAITEMENT…' : `${side === 'long' ? 'ACHETER' : 'VENDRE'} ${selectedPair}`}
        </button>
      </section>

      <section className="portfolio-panel">
        <div className="portfolio-tabs">
          <button type="button" className={panel === 'positions' ? 'is-active' : ''} onClick={() => setPanel('positions')}>Positions <i>{state.player.openPositions.length}</i></button>
          <button type="button" className={panel === 'orders' ? 'is-active' : ''} onClick={() => setPanel('orders')}>Ordres <i>{state.player.openOrders.length}</i></button>
        </div>
        <AnimatePresence mode="wait">
          <motion.div key={panel} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            {panel === 'positions' ? (
              state.player.openPositions.length ? state.player.openPositions.map((position) => (
                <article className="position-row" key={position.id}>
                  <div><span className={position.side === 'long' ? 'is-profit' : 'is-loss'}>{position.side === 'long' ? 'LONG' : 'SHORT'} · ×{position.leverage}</span><strong>{position.pair}</strong><small>{displaySize(position.pair, position.size)} · entrée {price(position.entryPrice)}</small></div>
                  <div><strong className={position.pnl >= 0 ? 'is-profit' : 'is-loss'}>{position.pnl >= 0 ? '+' : ''}{money(position.pnl)} $</strong><small>{price(position.markPrice)}</small><button type="button" disabled={busy} onClick={() => void closePosition(position.id)}>Fermer</button></div>
                </article>
              )) : <div className="portfolio-empty">Aucune position ouverte</div>
            ) : (
              state.player.openOrders.length ? state.player.openOrders.map((order) => (
                <article className="position-row" key={order.id}>
                  <div><span className={order.side === 'long' ? 'is-profit' : 'is-loss'}>{order.side === 'long' ? 'ACHAT' : 'VENTE'} LIMITE</span><strong>{order.pair}</strong><small>{displaySize(order.pair, order.size)} · ×{order.leverage}</small></div>
                  <div><strong>{price(order.limitPrice)}</strong><button type="button" disabled={busy} onClick={() => void cancelOrder(order.id)}>Annuler</button></div>
                </article>
              )) : <div className="portfolio-empty">Aucun ordre en attente</div>
            )}
          </motion.div>
        </AnimatePresence>
      </section>
    </div>
  )
}
