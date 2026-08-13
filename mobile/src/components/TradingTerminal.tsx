import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  API_WS_URL,
  cancelPaperOrder,
  closePaperPosition,
  createPaperSession,
  getPaperMeta,
  getPaperState,
  placePaperOrder,
  updatePaperOrderLimit,
  updatePaperRisk,
  type MyCompetition,
  type PaperOrder,
  type PaperMeta,
  type PaperState,
  type Position,
} from '../lib/api'
import {
  clearPaperSessionToken,
  readPaperSessionToken,
  writePaperSessionToken,
} from '../lib/session'
import { TradingViewChart, type MobileOrderPreview } from './TradingViewChart'
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

function riskValidationError(
  side: 'long' | 'short',
  referencePrice: number,
  nextStopLoss: number | null,
  nextTakeProfit: number | null,
) {
  if (!Number.isFinite(referencePrice) || referencePrice <= 0) return ''
  if (nextStopLoss != null && (!Number.isFinite(nextStopLoss) || nextStopLoss <= 0)) return 'Stop loss invalide'
  if (nextTakeProfit != null && (!Number.isFinite(nextTakeProfit) || nextTakeProfit <= 0)) return 'Take profit invalide'
  if (side === 'long' && nextStopLoss != null && nextStopLoss >= referencePrice) return 'Le stop loss doit être sous le prix actuel'
  if (side === 'long' && nextTakeProfit != null && nextTakeProfit <= referencePrice) return 'Le take profit doit être au-dessus du prix actuel'
  if (side === 'short' && nextStopLoss != null && nextStopLoss <= referencePrice) return 'Le stop loss doit être au-dessus du prix actuel'
  if (side === 'short' && nextTakeProfit != null && nextTakeProfit >= referencePrice) return 'Le take profit doit être sous le prix actuel'
  return ''
}

type MarketCategory = 'crypto' | 'actions' | 'indices' | 'commodities' | 'forex'

const MARKET_CATEGORIES: Array<{ id: MarketCategory; label: string }> = [
  { id: 'crypto', label: 'Crypto' },
  { id: 'actions', label: 'Actions' },
  { id: 'indices', label: 'Indices' },
  { id: 'commodities', label: 'Matières premières' },
  { id: 'forex', label: 'Forex' },
]

const PAIR_COLORS: Record<string, string> = {
  'BTC/USD': '#f7931a',
  'ETH/USD': '#627eea',
  'SOL/USD': '#9945ff',
  'XRP/USD': '#23292f',
}

function PairIcon({
  pair,
  imageUrl,
  compact = false,
}: {
  pair: string
  imageUrl?: string | null
  compact?: boolean
}) {
  const base = pair.split('/')[0] || pair
  if (imageUrl) {
    return <img className={`market-pair-icon ${compact ? 'is-compact' : ''}`} src={imageUrl} alt={base} loading="lazy" />
  }
  return (
    <span className={`market-pair-icon market-pair-icon--fallback ${compact ? 'is-compact' : ''}`}
      style={{ background: PAIR_COLORS[pair] || '#2c2638' }}>
      {base.slice(0, 1)}
    </span>
  )
}

function PairSelectorMenu({
  selectedPair,
  pairs,
  metadata,
  market,
  onChange,
}: {
  selectedPair: string
  pairs: string[]
  metadata: PaperMeta['marketMetadata']
  market: PaperState['market']
  onChange: (pair: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const selectedCategory = (metadata?.[selectedPair]?.category || 'crypto') as MarketCategory
  const [activeCategory, setActiveCategory] = useState<MarketCategory>(selectedCategory)

  useEffect(() => setActiveCategory(selectedCategory), [selectedCategory])

  const availableCategories = useMemo(
    () => MARKET_CATEGORIES.filter((category) =>
      pairs.some((pairName) => (metadata?.[pairName]?.category || 'crypto') === category.id)),
    [metadata, pairs],
  )

  const filteredPairs = useMemo(() => {
    const query = search.trim().toLowerCase()
    const compactQuery = query.replace(/[\s/_-]/g, '')
    return pairs.filter((pairName) => {
      if ((metadata?.[pairName]?.category || 'crypto') !== activeCategory) return false
      if (!query) return true
      const base = pairName.split('/')[0] || pairName
      const fullName = metadata?.[pairName]?.name || ''
      return [pairName, pairName.replace('/', ''), base, fullName].some((value) => {
        const normalized = value.toLowerCase()
        return normalized.includes(query) || normalized.replace(/[\s/_-]/g, '').includes(compactQuery)
      })
    })
  }, [activeCategory, metadata, pairs, search])

  const selectedTicker = market[selectedPair]
  const trigger = (
    <button className="market-selector-trigger" type="button" onClick={() => {
      setOpen(true)
      setSearch('')
    }}>
      <PairIcon pair={selectedPair} imageUrl={metadata?.[selectedPair]?.imageUrl} compact />
      <span><strong>{selectedPair}</strong><small>{metadata?.[selectedPair]?.name || selectedPair}</small></span>
      <span className="market-selector-trigger__price">
        <strong>{price(selectedTicker?.markPrice)}</strong>
        <small className={(selectedTicker?.change24h ?? 0) >= 0 ? 'is-profit' : 'is-loss'}>
          {(selectedTicker?.change24h ?? 0) >= 0 ? '+' : ''}{(selectedTicker?.change24h ?? 0).toFixed(2)}%
        </small>
      </span>
      <span className="market-selector-chevron">⌄</span>
    </button>
  )

  const modal = open ? createPortal(
    <div className="market-selector-layer">
      <button className="market-selector-backdrop" type="button" aria-label="Fermer le menu des marchés"
        onClick={() => setOpen(false)} />
      <section className="market-selector-modal" role="dialog" aria-modal="true" aria-label="Sélectionner un marché">
        <button className="market-selector-close" type="button" onClick={() => setOpen(false)} aria-label="Fermer">×</button>
        <div className="market-category-tabs">
          {availableCategories.map((category) => (
            <button key={category.id} type="button"
              className={activeCategory === category.id ? 'is-active' : ''}
              onClick={() => setActiveCategory(category.id)}>
              {category.label}
            </button>
          ))}
        </div>
        <label className="market-search">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-4.3-4.3M10.8 18a7.2 7.2 0 1 1 0-14.4 7.2 7.2 0 0 1 0 14.4Z" />
          </svg>
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)}
            placeholder="Rechercher un marché…" autoFocus />
        </label>
        <div className="market-list-heading">
          <span>{MARKET_CATEGORIES.find((item) => item.id === activeCategory)?.label || 'Marchés'}</span>
          <span>Dernier prix</span>
        </div>
        <div className="market-list">
          {filteredPairs.map((pairName) => {
            const ticker = market[pairName]
            const pairMetadata = metadata?.[pairName]
            const base = pairName.split('/')[0] || pairName
            const quote = pairName.split('/')[1] || 'USD'
            const marketOpen = ticker?.marketOpen !== false
            const change = ticker?.change24h
            return (
              <button key={pairName} type="button"
                className={`${pairName === selectedPair ? 'is-active' : ''} ${!marketOpen ? 'is-closed' : ''}`}
                onClick={() => {
                  onChange(pairName)
                  setOpen(false)
                  setSearch('')
                }}>
                <span className="market-list__identity">
                  <PairIcon pair={pairName} imageUrl={pairMetadata?.imageUrl} />
                  <span>
                    <strong>{base}<i>/{quote}</i></strong>
                    <small>{pairMetadata?.name || pairName}</small>
                  </span>
                </span>
                <span className="market-list__quote">
                  <strong>{marketOpen ? `${price(ticker?.markPrice)} ${quote}` : '—'}</strong>
                  {!marketOpen
                    ? <small className="is-market-closed">Marché fermé</small>
                    : change != null && <small className={change >= 0 ? 'is-profit' : 'is-loss'}>{change >= 0 ? '+' : ''}{change.toFixed(2)}%</small>}
                </span>
              </button>
            )
          })}
          {!filteredPairs.length && <div className="market-list-empty">Aucun marché trouvé</div>}
        </div>
      </section>
    </div>,
    document.body,
  ) : null

  return <div className="market-selector">{trigger}{modal}</div>
}

export function TradingTerminal({
  accountToken,
  competitions,
  initialCompetitionId,
  onOpenLeaderboard,
}: {
  accountToken: string
  competitions: MyCompetition[]
  initialCompetitionId?: string
  onOpenLeaderboard: (competitionId: string) => void
}) {
  const [paperToken, setPaperToken] = useState<string | null>(null)
  const [state, setState] = useState<PaperState | null>(null)
  const [meta, setMeta] = useState<PaperMeta | null>(null)
  const [selectedPair, setSelectedPair] = useState('')
  const [competitionId, setCompetitionId] = useState(
    initialCompetitionId || competitions.find((item) => item.canTrade)?.id || '',
  )
  const [side, setSide] = useState<'long' | 'short'>('long')
  const [orderType, setOrderType] = useState<'market' | 'limit'>('market')
  const [sizePercent, setSizePercent] = useState(10)
  const [limitPrice, setLimitPrice] = useState('')
  const [stopLoss, setStopLoss] = useState('')
  const [takeProfit, setTakeProfit] = useState('')
  const leverage = 10
  const [panel, setPanel] = useState<'positions' | 'orders' | 'history'>('positions')
  const [riskEditor, setRiskEditor] = useState<{
    positionId: string
    stopLoss: string
    takeProfit: string
    stopLossPercent: number
    takeProfitPercent: number
  } | null>(null)
  const [orderEditor, setOrderEditor] = useState<{
    orderId: string
    limitPrice: string
    stopLoss: string
    takeProfit: string
  } | null>(null)
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
  const referencePrice = orderType === 'limit' ? Number(limitPrice) : ticker?.markPrice || 0
  const selectedMargin = (state?.player.availableMargin || 0) * (sizePercent / 100)
  const engineSize = referencePrice > 0 ? (selectedMargin * leverage) / referencePrice : 0
  const inputQty = engineSize / contract
  const notional = engineSize * referencePrice
  const marginEstimate = leverage > 0 ? notional / leverage : 0
  const orderPreview: MobileOrderPreview | null = selectedPair && engineSize > 0 && referencePrice > 0
    ? {
        pair: selectedPair,
        side,
        orderType,
        entryPrice: referencePrice,
        size: engineSize,
        stopLoss: stopLoss && Number(stopLoss) > 0 ? Number(stopLoss) : null,
        takeProfit: takeProfit && Number(takeProfit) > 0 ? Number(takeProfit) : null,
      }
    : null
  const activeCompetition = competitionSummary(state?.competition ?? null)
  const competitionRank = state?.competition && 'competition' in state.competition
    ? state.competition.rank
    : competitions.find((competition) => competition.id === activeCompetition?.id)?.rank
  const playerRank = state?.player.rank
  const displayedRank = competitionRank ?? (playerRank != null && playerRank > 0 ? playerRank : null)
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
    const nextStopLoss = stopLoss ? Number(stopLoss) : null
    const nextTakeProfit = takeProfit ? Number(takeProfit) : null
    const validationError = riskValidationError(side, referencePrice, nextStopLoss, nextTakeProfit)
    if (validationError) {
      setError(validationError)
      return
    }
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
        stopLoss: nextStopLoss,
        takeProfit: nextTakeProfit,
      })
      setSizePercent(10)
      if (orderType === 'limit') setLimitPrice('')
      await refresh(paperToken)
      setPanel(orderType === 'limit' ? 'orders' : 'positions')
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Ordre refusé')
    } finally {
      setBusy(false)
    }
  }

  async function closePosition(positionId: string, partialSize?: number) {
    if (!paperToken) return
    setBusy(true)
    setError('')
    const position = state?.player.openPositions.find((item) => item.id === positionId)
    const isPartial = Boolean(position && partialSize != null && partialSize < position.size)
    if (!isPartial) pendingClosedPositions.current.set(positionId, Date.now() + 4000)
    try {
      await closePaperPosition(paperToken, positionId, partialSize)
      if (!isPartial) {
        setState((current) => current ? {
          ...current,
          player: { ...current.player, openPositions: current.player.openPositions.filter((item) => item.id !== positionId) },
        } : current)
      }
      await refresh(paperToken)
    } catch (nextError) {
      pendingClosedPositions.current.delete(positionId)
      setError(nextError instanceof Error ? nextError.message : 'Fermeture refusée')
    } finally {
      setBusy(false)
    }
  }

  async function updatePositionRisk(
    positionId: string,
    nextStopLoss: number | null,
    nextTakeProfit: number | null,
    sizes?: { stopLossSize?: number | null; takeProfitSize?: number | null },
  ) {
    if (!paperToken) return false
    const position = state?.player.openPositions.find((item) => item.id === positionId)
    if (position) {
      const validationError = riskValidationError(position.side, position.markPrice, nextStopLoss, nextTakeProfit)
      if (validationError) {
        setError(validationError)
        return false
      }
    }
    setBusy(true)
    setError('')
    try {
      await updatePaperRisk(paperToken, {
        positionId,
        stopLoss: nextStopLoss,
        takeProfit: nextTakeProfit,
        ...sizes,
      })
      await refresh(paperToken)
      return true
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Modification SL/TP refusée')
      await refresh(paperToken).catch(() => undefined)
      return false
    } finally {
      setBusy(false)
    }
  }

  async function updateOrderRisk(
    orderId: string,
    nextStopLoss: number | null,
    nextTakeProfit: number | null,
    referencePriceOverride?: number,
  ) {
    if (!paperToken) return false
    const order = state?.player.openOrders.find((item) => item.id === orderId)
    const riskReference = referencePriceOverride || order?.limitPrice
    if (order && riskReference) {
      const validationError = riskValidationError(order.side, riskReference, nextStopLoss, nextTakeProfit)
      if (validationError) {
        setError(validationError)
        return false
      }
    }
    setBusy(true)
    setError('')
    try {
      await updatePaperRisk(paperToken, {
        orderId,
        stopLoss: nextStopLoss,
        takeProfit: nextTakeProfit,
      })
      await refresh(paperToken)
      return true
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Modification SL/TP refusée')
      await refresh(paperToken).catch(() => undefined)
      return false
    } finally {
      setBusy(false)
    }
  }

  async function updateOrderLimit(orderId: string, nextPrice: number) {
    if (!paperToken || !Number.isFinite(nextPrice) || nextPrice <= 0) return
    setBusy(true)
    setError('')
    try {
      await updatePaperOrderLimit(paperToken, orderId, nextPrice)
      await refresh(paperToken)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Modification du prix refusée')
      await refresh(paperToken).catch(() => undefined)
    } finally {
      setBusy(false)
    }
  }

  function editPosition(position: Position) {
    setRiskEditor({
      positionId: position.id,
      stopLoss: position.stopLoss == null ? '' : String(position.stopLoss),
      takeProfit: position.takeProfit == null ? '' : String(position.takeProfit),
      stopLossPercent: position.stopLossSize ? Math.round((position.stopLossSize / position.size) * 100) : 100,
      takeProfitPercent: position.takeProfitSize ? Math.round((position.takeProfitSize / position.size) * 100) : 100,
    })
  }

  async function savePositionRisk(position: Position) {
    if (!riskEditor || riskEditor.positionId !== position.id) return
    const nextStopLoss = riskEditor.stopLoss ? Number(riskEditor.stopLoss) : null
    const nextTakeProfit = riskEditor.takeProfit ? Number(riskEditor.takeProfit) : null
    const saved = await updatePositionRisk(position.id, nextStopLoss, nextTakeProfit, {
      stopLossSize: nextStopLoss == null ? null : position.size * (riskEditor.stopLossPercent / 100),
      takeProfitSize: nextTakeProfit == null ? null : position.size * (riskEditor.takeProfitPercent / 100),
    })
    if (saved) setRiskEditor(null)
  }

  function editOrder(order: PaperOrder) {
    setOrderEditor({
      orderId: order.id,
      limitPrice: order.limitPrice == null ? '' : String(order.limitPrice),
      stopLoss: order.stopLoss == null ? '' : String(order.stopLoss),
      takeProfit: order.takeProfit == null ? '' : String(order.takeProfit),
    })
  }

  async function saveOrder(order: PaperOrder) {
    if (!orderEditor || orderEditor.orderId !== order.id) return
    const nextLimit = Number(orderEditor.limitPrice)
    if (order.limitPrice != null && Number.isFinite(nextLimit) && nextLimit > 0 && nextLimit !== order.limitPrice) {
      await updateOrderLimit(order.id, nextLimit)
    }
    const saved = await updateOrderRisk(
      order.id,
      orderEditor.stopLoss ? Number(orderEditor.stopLoss) : null,
      orderEditor.takeProfit ? Number(orderEditor.takeProfit) : null,
      nextLimit,
    )
    if (saved) setOrderEditor(null)
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
        <div className="terminal-head__metric"><small>ÉQUITÉ</small><strong>{money(state.player.currentBalance)}</strong></div>
        <div className={`terminal-head__metric ${state.player.pnl >= 0 ? 'is-profit' : 'is-loss'}`}><small>PNL</small><strong>{state.player.pnl >= 0 ? '+' : ''}{money(state.player.pnl)} $</strong><span>{state.player.pnlPercent.toFixed(2)}%</span></div>
        <div className="terminal-head__right">
          <button className="terminal-rank" type="button" disabled={!activeCompetition?.id}
            onClick={() => activeCompetition?.id && onOpenLeaderboard(activeCompetition.id)}>
            <small>RANG</small><strong>#{displayedRank ?? '—'}</strong><span>Classement</span>
          </button>
          <button type="button" onClick={() => void leaveTerminal()} aria-label="Changer d’arène">↺</button>
        </div>
      </header>

      <section className="quote-card tradingview-card">
        <TradingViewChart
          pair={selectedPair}
          pairs={state.pairs}
          market={state.market}
          metadata={meta?.marketMetadata}
          positions={state.player.openPositions}
          orders={state.player.openOrders}
          orderPreview={orderPreview}
          onPairChange={setSelectedPair}
          onUpdatePositionRisk={(positionId, nextStopLoss, nextTakeProfit) => {
            void updatePositionRisk(positionId, nextStopLoss, nextTakeProfit)
          }}
          onUpdateOrderRisk={(orderId, nextStopLoss, nextTakeProfit) => {
            void updateOrderRisk(orderId, nextStopLoss, nextTakeProfit)
          }}
          onUpdateOrderLimit={(orderId, nextPrice) => {
            void updateOrderLimit(orderId, nextPrice)
          }}
          onCancelOrder={(orderId) => {
            void cancelOrder(orderId)
          }}
          onClosePosition={(positionId) => {
            void closePosition(positionId)
          }}
          onPreviewEntryChange={(nextPrice) => setLimitPrice(String(nextPrice))}
          onPreviewRiskChange={(patch) => {
            if ('stopLoss' in patch) setStopLoss(patch.stopLoss == null ? '' : String(patch.stopLoss))
            if ('takeProfit' in patch) setTakeProfit(patch.takeProfit == null ? '' : String(patch.takeProfit))
          }}
          toolbarLeading={(
            <PairSelectorMenu
              selectedPair={selectedPair}
              pairs={state.pairs.length ? state.pairs : Object.keys(state.market)}
              metadata={meta?.marketMetadata}
              market={state.market}
              onChange={setSelectedPair}
            />
          )}
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
          {orderType === 'limit' && <label>Prix limite<input value={limitPrice} onChange={(event) => setLimitPrice(event.target.value)} inputMode="decimal" placeholder={price(ticker?.markPrice)} /></label>}
          <label>Stop loss<input value={stopLoss} onChange={(event) => setStopLoss(event.target.value)} inputMode="decimal" placeholder="Optionnel" /></label>
          <label>Take profit<input value={takeProfit} onChange={(event) => setTakeProfit(event.target.value)} inputMode="decimal" placeholder="Optionnel" /></label>
        </div>
        <div className="position-size-slider">
          <div><span>Taille de position</span><strong>{sizePercent}%</strong></div>
          <input type="range" min="1" max="100" step="1" value={sizePercent}
            onChange={(event) => setSizePercent(Number(event.target.value))} />
          <div>
            <span>{inputQty.toLocaleString('fr-FR', { maximumFractionDigits: contract > 1 ? 2 : 5 })} {contract > 1 ? 'lots' : selectedPair.split('/')[0]}</span>
            <span>Marge {money(selectedMargin)} $</span>
            <span>Levier ×10</span>
          </div>
        </div>
        <div className="order-summary">
          <span>Notionnel <strong>{money(notional)} $</strong></span>
          <span>Marge estimée <strong>{money(marginEstimate)} $</strong></span>
          <span>Disponible <strong>{money(state.player.availableMargin)} $</strong></span>
          <span>Utilisée <strong>{money(state.player.usedMargin)} $</strong></span>
        </div>
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
          <button type="button" className={panel === 'history' ? 'is-active' : ''} onClick={() => setPanel('history')}>Historique <i>{state.player.trades?.length || 0}</i></button>
        </div>
        <AnimatePresence mode="wait">
          <motion.div key={panel} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            {panel === 'positions' ? (
              state.player.openPositions.length ? state.player.openPositions.map((position) => (
                <article className="position-card" key={position.id}>
                  <div className="position-row">
                    <button className="position-main" type="button" onClick={() => setSelectedPair(position.pair)}>
                      <span className={position.side === 'long' ? 'is-profit' : 'is-loss'}>{position.side === 'long' ? 'LONG' : 'SHORT'} · ×{position.leverage}</span>
                      <strong>{position.pair}</strong>
                      <small>{displaySize(position.pair, position.size)} · PE {price(position.entryPrice)}</small>
                      <small>SL {price(position.stopLoss)} · TP {price(position.takeProfit)}</small>
                      <small>Marge {money(position.margin)} $ · Liquidation {price(position.liquidationPrice)} · Frais {money(position.feesPaid || 0)} $</small>
                    </button>
                    <div>
                      <strong className={position.pnl >= 0 ? 'is-profit' : 'is-loss'}>{position.pnl >= 0 ? '+' : ''}{money(position.pnl)} $</strong>
                      <small>{price(position.markPrice)}</small>
                      <button type="button" disabled={busy} onClick={() => {
                        if (riskEditor?.positionId === position.id) setRiskEditor(null)
                        else editPosition(position)
                      }}>
                        {riskEditor?.positionId === position.id ? 'Masquer' : 'SL / TP'}
                      </button>
                    </div>
                  </div>
                  <div className="partial-actions">
                    <span>CLÔTURE PARTIELLE</span>
                    {[25, 50, 75, 100].map((percent) => (
                      <button key={percent} type="button" disabled={busy} onClick={() => {
                        const partialSize = percent === 100 ? undefined : position.size * (percent / 100)
                        void closePosition(position.id, partialSize)
                      }}>{percent}%</button>
                    ))}
                  </div>
                  {riskEditor?.positionId === position.id && (
                    <div className="risk-editor">
                      <label>Stop loss
                        <input inputMode="decimal" value={riskEditor.stopLoss} placeholder="Désactivé"
                          onChange={(event) => setRiskEditor({ ...riskEditor, stopLoss: event.target.value })} />
                      </label>
                      <label>Quantité SL
                        <select value={riskEditor.stopLossPercent}
                          onChange={(event) => setRiskEditor({ ...riskEditor, stopLossPercent: Number(event.target.value) })}>
                          {[25, 50, 75, 100].map((percent) => <option key={percent} value={percent}>{percent}%</option>)}
                        </select>
                      </label>
                      <label>Take profit
                        <input inputMode="decimal" value={riskEditor.takeProfit} placeholder="Désactivé"
                          onChange={(event) => setRiskEditor({ ...riskEditor, takeProfit: event.target.value })} />
                      </label>
                      <label>Quantité TP
                        <select value={riskEditor.takeProfitPercent}
                          onChange={(event) => setRiskEditor({ ...riskEditor, takeProfitPercent: Number(event.target.value) })}>
                          {[25, 50, 75, 100].map((percent) => <option key={percent} value={percent}>{percent}%</option>)}
                        </select>
                      </label>
                      <button type="button" disabled={busy} onClick={() => void savePositionRisk(position)}>Enregistrer</button>
                      <button className="danger" type="button" disabled={busy} onClick={() => void closePosition(position.id)}>Tout fermer</button>
                    </div>
                  )}
                </article>
              )) : <div className="portfolio-empty">Aucune position ouverte</div>
            ) : panel === 'orders' ? (
              state.player.openOrders.length ? state.player.openOrders.map((order) => (
                <article className="position-card" key={order.id}>
                  <div className="position-row">
                    <button className="position-main" type="button" onClick={() => setSelectedPair(order.pair)}>
                      <span className={order.side === 'long' ? 'is-profit' : 'is-loss'}>{order.side === 'long' ? 'ACHAT' : 'VENTE'} LIMITE</span>
                      <strong>{order.pair}</strong>
                      <small>{displaySize(order.pair, order.size)} · ×{order.leverage}</small>
                      <small>SL {price(order.stopLoss)} · TP {price(order.takeProfit)}</small>
                      <small>Marge {money(order.marginReserved)} $ · Frais estimés {money(order.feeEstimate || 0)} $</small>
                    </button>
                    <div><strong>{price(order.limitPrice)}</strong><button type="button" disabled={busy} onClick={() => {
                      if (orderEditor?.orderId === order.id) setOrderEditor(null)
                      else editOrder(order)
                    }}>{orderEditor?.orderId === order.id ? 'Masquer' : 'Modifier'}</button></div>
                  </div>
                  {orderEditor?.orderId === order.id && (
                    <div className="risk-editor order-editor">
                      <label>Prix limite<input inputMode="decimal" value={orderEditor.limitPrice}
                        onChange={(event) => setOrderEditor({ ...orderEditor, limitPrice: event.target.value })} /></label>
                      <label>Stop loss<input inputMode="decimal" value={orderEditor.stopLoss} placeholder="Désactivé"
                        onChange={(event) => setOrderEditor({ ...orderEditor, stopLoss: event.target.value })} /></label>
                      <label>Take profit<input inputMode="decimal" value={orderEditor.takeProfit} placeholder="Désactivé"
                        onChange={(event) => setOrderEditor({ ...orderEditor, takeProfit: event.target.value })} /></label>
                      <button type="button" disabled={busy} onClick={() => void saveOrder(order)}>Enregistrer</button>
                      <button className="danger" type="button" disabled={busy} onClick={() => void cancelOrder(order.id)}>Annuler l’ordre</button>
                    </div>
                  )}
                </article>
              )) : <div className="portfolio-empty">Aucun ordre en attente</div>
            ) : (
              state.player.trades?.length ? state.player.trades.map((trade) => (
                <article className="history-row" key={trade.id}>
                  <div>
                    <span className={trade.side === 'long' ? 'is-profit' : 'is-loss'}>
                      {trade.action === 'open' ? 'OUVERTURE' : trade.action === 'close' ? 'CLÔTURE' : 'MODIFICATION'} · {trade.side === 'long' ? 'LONG' : 'SHORT'}
                    </span>
                    <strong>{trade.pair}</strong>
                    <small>{new Date(trade.time).toLocaleString('fr-FR')} · {displaySize(trade.pair, trade.size)}</small>
                  </div>
                  <div>
                    <strong className={trade.pnl >= 0 ? 'is-profit' : 'is-loss'}>{trade.pnl >= 0 ? '+' : ''}{money(trade.pnl)} $</strong>
                    <small>{price(trade.price)} · frais {money(trade.fee)} $</small>
                  </div>
                </article>
              )) : <div className="portfolio-empty">Aucun trade dans l’historique</div>
            )}
          </motion.div>
        </AnimatePresence>
      </section>
    </div>
  )
}
