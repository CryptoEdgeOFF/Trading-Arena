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
  type PaperTrade,
  type Position,
} from '../lib/api'
import {
  clearPaperSessionToken,
  readPaperSessionToken,
  writePaperSessionToken,
} from '../lib/session'
import { TradingViewChart, type MobileOrderPreview } from './TradingViewChart'
import { ArenaPickerList, ArenaPickerSheet } from './ArenaPicker'
import ExecutionFillSheet from './ExecutionFillSheet'
import { useI18n } from '../i18n'
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

function formatLimitInput(value: number, category?: string) {
  if (!Number.isFinite(value) || value <= 0) return ''
  if (category === 'forex') return value.toFixed(5)
  if (value >= 1000) return value.toFixed(2)
  if (value >= 1) return value.toFixed(4)
  return Number(value.toPrecision(6)).toString()
}

function formatQtyInput(value: number, contract: number) {
  if (!Number.isFinite(value) || value <= 0) return ''
  return Number(value.toFixed(contract > 1 ? 2 : 5)).toString()
}

function mirrorAround(value: string, entry: number, category?: string) {
  const current = Number(value)
  if (!(current > 0) || !(entry > 0)) return value
  const next = entry * 2 - current
  return next > 0 ? formatLimitInput(next, category) : ''
}

function sideFromLimit(limit: number, mark: number, fallback: 'long' | 'short'): 'long' | 'short' {
  if (!(limit > 0) || !(mark > 0) || limit === mark) return fallback
  return limit < mark ? 'long' : 'short'
}

function projectedRiskUsd(side: 'long' | 'short', entry: number, exit: number, engineSize: number) {
  if (!(entry > 0) || !(exit > 0) || !(engineSize > 0)) return 0
  return (side === 'long' ? exit - entry : entry - exit) * engineSize
}

function priceFromProjectedUsd(side: 'long' | 'short', kind: 'sl' | 'tp', entry: number, usd: number, engineSize: number) {
  if (!(entry > 0) || !(usd > 0) || !(engineSize > 0)) return 0
  const delta = usd / engineSize
  if (side === 'long') return kind === 'tp' ? entry + delta : entry - delta
  return kind === 'tp' ? entry - delta : entry + delta
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

function drawdownRule(context: PaperState['competition'], fallback?: MyCompetition) {
  const nested = context && 'competition' in context ? context.competition : context
  const percent = nested?.dailyDrawdownPercent ?? fallback?.dailyDrawdownPercent ?? null
  const limitEquity = context && 'competition' in context ? context.dailyLimitEquity ?? null : null
  return {
    percent: percent != null && percent > 0 ? percent : null,
    limitEquity,
  }
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
  const { t } = useI18n()
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
  const [sizeMode, setSizeMode] = useState<'percent' | 'qty' | 'usd'>('percent')
  const [qtyDraft, setQtyDraft] = useState('')
  const [usdDraft, setUsdDraft] = useState('')
  const [qtyFocused, setQtyFocused] = useState(false)
  const [usdFocused, setUsdFocused] = useState(false)
  const [limitPrice, setLimitPrice] = useState('')
  const [stopLoss, setStopLoss] = useState('')
  const [takeProfit, setTakeProfit] = useState('')
  const [slUsdDraft, setSlUsdDraft] = useState('')
  const [tpUsdDraft, setTpUsdDraft] = useState('')
  const [slUsdFocused, setSlUsdFocused] = useState(false)
  const [tpUsdFocused, setTpUsdFocused] = useState(false)
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
  const [pickerOpen, setPickerOpen] = useState(false)
  const [fillDetailsTrade, setFillDetailsTrade] = useState<PaperTrade | null>(null)
  const pendingClosedPositions = useRef(new Map<string, number>())
  const pendingCancelledOrders = useRef(new Map<string, number>())
  const socketRef = useRef<WebSocket | null>(null)
  const subscribePairsRef = useRef<string[]>([])

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

  const showFillDetails = useCallback((trade: PaperTrade) => {
    setFillDetailsTrade(trade)
  }, [])

  const closeFillDetails = useCallback(() => {
    setFillDetailsTrade(null)
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
    const activePaperToken = paperToken
    let timer: ReturnType<typeof setTimeout> | undefined
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined
    let socket: WebSocket | null = null
    let socketOpen = false
    let stopped = false
    socketRef.current = null
    async function poll() {
      try { if (!stopped) await refresh(activePaperToken) } catch { /* reconnexion WS/poll suivante */ }
      if (!stopped) timer = setTimeout(poll, socketOpen ? 30_000 : 5000)
    }
    void poll()

    function connect() {
      socket = new WebSocket(`${API_WS_URL}/ws?paperToken=${encodeURIComponent(activePaperToken)}`)
      socketRef.current = socket
      socket.onopen = () => {
        socketOpen = true
        if (subscribePairsRef.current.length > 0) {
          socket?.send(JSON.stringify({ type: 'market:subscribe', pairs: subscribePairsRef.current }))
        }
      }
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
          if (message?.type === 'paper:patch' && message.data) {
            setState((current) => {
              if (!current) return current
              const playerPatch = message.data.player || {}
              const currentTrades = current.player.trades || []
              const trades = Array.isArray(playerPatch.trades)
                ? playerPatch.trades
                : Array.isArray(playerPatch.tradesAdded)
                  ? [...currentTrades, ...playerPatch.tradesAdded.filter((trade: PaperTrade) => !currentTrades.some((item) => item.id === trade.id))]
                  : currentTrades
              return reconcilePending({
                ...current,
                ...message.data,
                player: {
                  ...current.player,
                  ...playerPatch,
                  trades,
                  openPositions: playerPatch.openPositions ?? current.player.openPositions,
                  openOrders: playerPatch.openOrders ?? current.player.openOrders,
                },
                market: current.market,
                competition: message.data.competition ?? current.competition,
              } as PaperState)
            })
            return
          }
          if (
            (message?.type === 'market:tick' && Array.isArray(message.data?.ticks))
            || (message?.type === 'market:watch' && Array.isArray(message.data?.quotes))
          ) {
            const ticks = message.type === 'market:watch' ? message.data.quotes : message.data.ticks
            setState((current) => {
              if (!current) return current
              const market = { ...current.market }
              for (const tick of ticks) {
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
      socket.onclose = () => {
        socketOpen = false
        if (socketRef.current === socket) socketRef.current = null
        if (!stopped) reconnectTimer = setTimeout(connect, 1000)
      }
      socket.onerror = () => socket?.close()
    }
    connect()
    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
      if (reconnectTimer) clearTimeout(reconnectTimer)
      socketRef.current = null
      socket?.close()
    }
  }, [paperToken, reconcilePending, refresh])

  const liveSubscribeKey = [
    selectedPair,
    ...(state?.player.openPositions || []).map((position) => position.pair),
    ...(state?.player.openOrders || []).map((order) => order.pair),
  ].filter(Boolean).sort().join('|')
  const liveSubscribePairs = useMemo(
    () => (liveSubscribeKey ? liveSubscribeKey.split('|') : []),
    [liveSubscribeKey],
  )

  useEffect(() => {
    subscribePairsRef.current = liveSubscribePairs
    const socket = socketRef.current
    if (!socket || socket.readyState !== WebSocket.OPEN || liveSubscribePairs.length === 0) return
    socket.send(JSON.stringify({ type: 'market:subscribe', pairs: liveSubscribePairs }))
  }, [liveSubscribePairs])

  const ticker = state?.market[selectedPair] || meta?.market[selectedPair]
  const selectedCategory = meta?.marketMetadata?.[selectedPair]?.category
  const contract = CONTRACT_SIZE[selectedPair] || 1
  const limitEntry = Number(limitPrice)
  const markPrice = ticker?.markPrice || 0
  const ticketSide = orderType === 'limit' ? sideFromLimit(limitEntry, markPrice, side) : side
  const buyLocked = orderType === 'limit' && limitEntry > 0 && markPrice > 0 && limitEntry > markPrice
  const sellLocked = orderType === 'limit' && limitEntry > 0 && markPrice > 0 && limitEntry < markPrice
  const referencePrice = orderType === 'limit'
    ? (limitEntry > 0 ? limitEntry : markPrice)
    : markPrice
  const availableMargin = state?.player.availableMargin || 0
  const percentEngine = referencePrice > 0 ? (availableMargin * (sizePercent / 100) * leverage) / referencePrice : 0
  const qtyEngine = Number(qtyDraft) > 0 ? Number(qtyDraft) * contract : 0
  const usdEngine = Number(usdDraft) > 0 && referencePrice > 0 ? Number(usdDraft) / referencePrice : 0
  const engineSize = sizeMode === 'qty' ? qtyEngine : sizeMode === 'usd' ? usdEngine : percentEngine
  const inputQty = contract > 0 ? engineSize / contract : 0
  const notional = engineSize * referencePrice
  const marginEstimate = leverage > 0 ? notional / leverage : 0
  const selectedMargin = sizeMode === 'percent' ? availableMargin * (sizePercent / 100) : marginEstimate
  const sliderPercent = availableMargin > 0
    ? Math.max(1, Math.min(100, sizeMode === 'percent' ? sizePercent : Math.round((marginEstimate / availableMargin) * 100) || 1))
    : sizePercent
  const showLimitPreview = orderType === 'limit' && selectedPair && referencePrice > 0
  const showMarketPreview = orderType === 'market' && selectedPair && engineSize > 0 && referencePrice > 0
  const orderPreview: MobileOrderPreview | null = showLimitPreview || showMarketPreview
    ? {
        pair: selectedPair,
        side: ticketSide,
        orderType,
        entryPrice: referencePrice,
        size: engineSize,
        stopLoss: stopLoss && Number(stopLoss) > 0 ? Number(stopLoss) : null,
        takeProfit: takeProfit && Number(takeProfit) > 0 ? Number(takeProfit) : null,
      }
    : null

  useEffect(() => {
    if (ticketSide === side) return
    setSide(ticketSide)
    if (!(referencePrice > 0)) return
    setStopLoss((current) => mirrorAround(current, referencePrice, selectedCategory))
    setTakeProfit((current) => mirrorAround(current, referencePrice, selectedCategory))
  }, [referencePrice, selectedCategory, side, ticketSide])

  useEffect(() => {
    if (orderType !== 'limit' || !ticker?.markPrice) return
    setLimitPrice(formatLimitInput(ticker.markPrice, selectedCategory))
    // Seed only when switching to limit or changing pair — not on every tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderType, selectedPair])

  useEffect(() => {
    if (orderType !== 'limit' || limitPrice || !ticker?.markPrice) return
    setLimitPrice(formatLimitInput(ticker.markPrice, selectedCategory))
  }, [orderType, limitPrice, ticker?.markPrice, selectedCategory])

  useEffect(() => {
    if (qtyFocused || sizeMode === 'qty') return
    const next = formatQtyInput(inputQty, contract)
    if (next !== qtyDraft) setQtyDraft(next)
  }, [inputQty, contract, qtyDraft, qtyFocused, sizeMode])

  useEffect(() => {
    if (usdFocused || sizeMode === 'usd') return
    const next = notional > 0 ? notional.toFixed(2) : ''
    if (next !== usdDraft) setUsdDraft(next)
  }, [notional, usdDraft, usdFocused, sizeMode])

  useEffect(() => {
    if (!(engineSize > 0) || !(referencePrice > 0)) {
      if (!slUsdFocused && slUsdDraft) setSlUsdDraft('')
      if (!tpUsdFocused && tpUsdDraft) setTpUsdDraft('')
      return
    }
    if (slUsdFocused) {
      const target = Number(slUsdDraft)
      if (!Number.isFinite(target) || target <= 0) return
      const next = formatLimitInput(priceFromProjectedUsd(ticketSide, 'sl', referencePrice, target, engineSize), selectedCategory)
      if (next && next !== stopLoss) setStopLoss(next)
    } else {
      const sl = Number(stopLoss)
      const raw = projectedRiskUsd(ticketSide, referencePrice, sl, engineSize)
      const next = sl > 0 && raw < 0 ? Math.abs(raw).toFixed(2) : ''
      if (next !== slUsdDraft) setSlUsdDraft(next)
    }
  }, [engineSize, referencePrice, selectedCategory, slUsdDraft, slUsdFocused, stopLoss, ticketSide])

  useEffect(() => {
    if (!(engineSize > 0) || !(referencePrice > 0)) return
    if (tpUsdFocused) {
      const target = Number(tpUsdDraft)
      if (!Number.isFinite(target) || target <= 0) return
      const next = formatLimitInput(priceFromProjectedUsd(ticketSide, 'tp', referencePrice, target, engineSize), selectedCategory)
      if (next && next !== takeProfit) setTakeProfit(next)
    } else {
      const tp = Number(takeProfit)
      const raw = projectedRiskUsd(ticketSide, referencePrice, tp, engineSize)
      const next = tp > 0 && raw > 0 ? raw.toFixed(2) : ''
      if (next !== tpUsdDraft) setTpUsdDraft(next)
    }
  }, [engineSize, referencePrice, selectedCategory, takeProfit, ticketSide, tpUsdDraft, tpUsdFocused])
  const activeCompetition = competitionSummary(state?.competition ?? null)
  const competitionRank = state?.competition && 'competition' in state.competition
    ? state.competition.rank
    : competitions.find((competition) => competition.id === activeCompetition?.id)?.rank
  const playerRank = state?.player.rank
  const displayedRank = competitionRank ?? (playerRank != null && playerRank > 0 ? playerRank : null)
  const accountBreached = isBreached(state?.competition ?? null)
  const canTradeNow = Boolean(state?.canTrade) && !accountBreached && ticker?.marketOpen !== false
  const selectedCompetition = competitions.find((item) => item.id === (activeCompetition?.id || competitionId))
  const { percent: dailyDrawdownPercent, limitEquity: dailyLimitEquity } = drawdownRule(state?.competition ?? null, selectedCompetition)

  function applyQty(value: string) {
    setSizeMode('qty')
    setQtyDraft(value)
    const qty = Number(value)
    if (!Number.isFinite(qty) || qty <= 0 || referencePrice <= 0 || availableMargin <= 0) return
    const margin = (qty * contract * referencePrice) / leverage
    setSizePercent(Math.max(1, Math.min(100, Math.round((margin / availableMargin) * 100))))
  }

  function applyUsdAmount(value: string) {
    setSizeMode('usd')
    setUsdDraft(value)
    const usd = Number(value)
    if (!Number.isFinite(usd) || usd <= 0 || availableMargin <= 0) return
    const margin = usd / leverage
    setSizePercent(Math.max(1, Math.min(100, Math.round((margin / availableMargin) * 100))))
  }

  async function openCompetition(nextId = competitionId) {
    if (!nextId) return
    setCompetitionId(nextId)
    setBusy(true)
    setError('')
    try {
      const session = await createPaperSession(accountToken, nextId)
      setFillDetailsTrade(null)
      await writePaperSessionToken(session.token)
      setPaperToken(session.token)
      setPickerOpen(false)
      await refresh(session.token)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Terminal indisponible')
    } finally {
      setBusy(false)
    }
  }

  async function submitOrder(nextSide: 'long' | 'short' = side) {
    if (!paperToken || !selectedPair || engineSize <= 0) return
    setSide(nextSide)
    const nextStopLoss = stopLoss ? Number(stopLoss) : null
    const nextTakeProfit = takeProfit ? Number(takeProfit) : null
    const validationError = riskValidationError(nextSide, referencePrice, nextStopLoss, nextTakeProfit)
    if (validationError) {
      setError(validationError)
      return
    }
    setBusy(true)
    setError('')
    try {
      await placePaperOrder(paperToken, {
        pair: selectedPair,
        side: nextSide,
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

  if (loading) return <div className="terminal-loader"><i /><span>Synchronisation du terminal</span></div>

  if (!paperToken || !state) {
    return (
      <div className="terminal-gate">
        <span>SESSION DE TRADING</span>
        <h2>{t('terminal.pickArena')}</h2>
        <p>{t('terminal.pickArenaLead')}</p>
        {competitions.length ? (
          <>
            <ArenaPickerList
              competitions={competitions}
              currentId={competitionId}
              busyId={busy ? competitionId : ''}
              onSelect={(id) => void openCompetition(id)}
            />
            {error && <div className="terminal-error">{error}</div>}
          </>
        ) : <div className="terminal-empty">{t('terminal.arenaEmpty')}</div>}
      </div>
    )
  }

  const historyTrades = (state.player.trades || []).filter((trade) => trade.action === 'close')

  return (
    <div className="mobile-terminal">
      <header className="terminal-head">
        <button className="terminal-head__arena" type="button" onClick={() => setPickerOpen(true)}>
          <span>{activeCompetition?.title || 'BTF ARENA'}</span>
          <strong>{state.player.name}</strong>
        </button>
        <div className="terminal-head__stats">
          <div className="terminal-head__metric">
            <small>Équité</small>
            <strong>{money(state.player.currentBalance)}</strong>
          </div>
          <div className={`terminal-head__metric ${state.player.pnl >= 0 ? 'is-profit' : 'is-loss'}`}>
            <small>PnL</small>
            <strong>{state.player.pnl >= 0 ? '+' : ''}{money(state.player.pnl)}</strong>
          </div>
        </div>
        <button className="terminal-rank" type="button" disabled={!activeCompetition?.id}
          onClick={() => activeCompetition?.id && onOpenLeaderboard(activeCompetition.id)}>
          <small>Rang</small>
          <strong>#{displayedRank ?? '—'}</strong>
        </button>
      </header>
      <ArenaPickerSheet
        open={pickerOpen}
        competitions={competitions}
        currentId={activeCompetition?.id || competitionId}
        busyId={busy ? competitionId : ''}
        onSelect={(id) => void openCompetition(id)}
        onClose={() => setPickerOpen(false)}
      />
      <ExecutionFillSheet trade={fillDetailsTrade} onClose={closeFillDetails} />

      <section className="quote-card tradingview-card">
        <TradingViewChart
          pair={selectedPair}
          pairs={state.pairs}
          market={state.market}
          metadata={meta?.marketMetadata}
          positions={state.player.openPositions}
          orders={state.player.openOrders}
          trades={state.player.trades}
          orderPreview={orderPreview}
          onPairChange={setSelectedPair}
          onUpdatePositionRisk={(positionId, nextStopLoss, nextTakeProfit, sizes) => {
            void updatePositionRisk(positionId, nextStopLoss, nextTakeProfit, sizes)
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
          onPreviewEntryChange={(nextPrice) => setLimitPrice(formatLimitInput(nextPrice, selectedCategory))}
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
        <div className="order-type">
          <button type="button" className={orderType === 'market' ? 'is-active' : ''} onClick={() => setOrderType('market')}>Marché</button>
          <button type="button" className={orderType === 'limit' ? 'is-active' : ''} onClick={() => setOrderType('limit')}>Limite</button>
        </div>
        {orderType === 'limit' && (
          <div className="ticket-grid">
            <label className="is-wide">Prix limite
              <input value={limitPrice} onChange={(event) => setLimitPrice(event.target.value)} inputMode="decimal" placeholder={price(ticker?.markPrice)} />
            </label>
          </div>
        )}
        <div className="position-size-slider">
          <div><span>Taille de position</span><strong>{sliderPercent}%</strong></div>
          <input type="range" min="1" max="100" step="1" value={sliderPercent}
            onChange={(event) => {
              setSizeMode('percent')
              setSizePercent(Number(event.target.value))
            }} />
          <div>
            <span>Marge {money(selectedMargin)} $</span>
            <span>Levier ×10</span>
          </div>
        </div>
        <div className="ticket-grid">
          <label>Taille
            <span>
              <input value={qtyDraft} inputMode="decimal" placeholder="0"
                onFocus={() => setQtyFocused(true)}
                onBlur={() => setQtyFocused(false)}
                onChange={(event) => applyQty(event.target.value)} />
              <em>{contract > 1 ? 'lots' : selectedPair.split('/')[0] || 'qty'}</em>
            </span>
          </label>
          <label>Montant
            <span>
              <input value={usdDraft} inputMode="decimal" placeholder="0"
                onFocus={() => setUsdFocused(true)}
                onBlur={() => setUsdFocused(false)}
                onChange={(event) => applyUsdAmount(event.target.value)} />
              <em>USD</em>
            </span>
          </label>
        </div>
        <div className="ticket-actions">
          <button className={`place-order buy${buyLocked ? ' is-locked' : ''}`} type="button"
            disabled={busy || buyLocked || !canTradeNow || engineSize <= 0 || (orderType === 'limit' && !Number(limitPrice))}
            onClick={() => void submitOrder('long')}>
            {busy && ticketSide === 'long' ? '…' : 'ACHETER'}
          </button>
          <button className={`place-order sell${sellLocked ? ' is-locked' : ''}`} type="button"
            disabled={busy || sellLocked || !canTradeNow || engineSize <= 0 || (orderType === 'limit' && !Number(limitPrice))}
            onClick={() => void submitOrder('short')}>
            {busy && ticketSide === 'short' ? '…' : 'VENDRE'}
          </button>
        </div>
        <div className="ticket-grid">
          <label>Stop loss
            <input value={stopLoss} onChange={(event) => setStopLoss(event.target.value)} inputMode="decimal" placeholder="Prix" />
          </label>
          <label className="is-loss">Perte $
            <span>
              <input value={slUsdDraft} inputMode="decimal" placeholder="0"
                onFocus={() => setSlUsdFocused(true)}
                onBlur={() => setSlUsdFocused(false)}
                onChange={(event) => setSlUsdDraft(event.target.value)} />
              <em>USD</em>
            </span>
          </label>
          <label>Take profit
            <input value={takeProfit} onChange={(event) => setTakeProfit(event.target.value)} inputMode="decimal" placeholder="Prix" />
          </label>
          <label className="is-profit">Gain $
            <span>
              <input value={tpUsdDraft} inputMode="decimal" placeholder="0"
                onFocus={() => setTpUsdFocused(true)}
                onBlur={() => setTpUsdFocused(false)}
                onChange={(event) => setTpUsdDraft(event.target.value)} />
              <em>USD</em>
            </span>
          </label>
        </div>
        <div className="order-summary">
          <span>Notionnel <strong>{money(notional)} $</strong></span>
          <span>Marge estimée <strong>{money(marginEstimate)} $</strong></span>
          <span>Disponible <strong>{money(state.player.availableMargin)} $</strong></span>
          <span>Utilisée <strong>{money(state.player.usedMargin)} $</strong></span>
        </div>
        {dailyDrawdownPercent != null && (
          <div className="terminal-drawdown">
            <div>
              <strong>{t('terminal.dailyDrawdownLabel', { percent: dailyDrawdownPercent })}</strong>
              {dailyLimitEquity != null && <span>{t('terminal.dailyDrawdownValue', { amount: money(dailyLimitEquity) })}</span>}
            </div>
            <p>{t('terminal.dailyDrawdownHint')}</p>
          </div>
        )}
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
      </section>

      <section className="portfolio-panel">
        <div className="portfolio-tabs">
          <button type="button" className={panel === 'positions' ? 'is-active' : ''} onClick={() => setPanel('positions')}>Positions <i>{state.player.openPositions.length}</i></button>
          <button type="button" className={panel === 'orders' ? 'is-active' : ''} onClick={() => setPanel('orders')}>Ordres <i>{state.player.openOrders.length}</i></button>
          <button type="button" className={panel === 'history' ? 'is-active' : ''} onClick={() => setPanel('history')}>Historique <i>{historyTrades.length}</i></button>
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
              state.player.openOrders.length ? state.player.openOrders.map((order) => {
                const filledSize = Math.max(0, Math.min(order.size, order.filledSize ?? 0))
                const remainingSize = Math.max(0, order.size - filledSize)
                const isPartial = filledSize > 0 && filledSize < order.size
                const latestFill = (state.player.trades || [])
                  .filter((trade) => trade.orderId === order.id && trade.fillDetails?.length)
                  .sort((a, b) => b.time - a.time)[0]
                return (
                <article className="position-card" key={order.id}>
                  <div className="position-row">
                    <button className="position-main" type="button" onClick={() => setSelectedPair(order.pair)}>
                      <span className={order.side === 'long' ? 'is-profit' : 'is-loss'}>
                        {order.side === 'long' ? 'ACHAT' : 'VENTE'} LIMITE
                        {isPartial && <i className="partial-fill-badge">Partiel</i>}
                      </span>
                      <strong>{order.pair}</strong>
                      <small>Exécuté {displaySize(order.pair, filledSize)} / {displaySize(order.pair, order.size)} · ×{order.leverage}</small>
                      <small>Restant {displaySize(order.pair, remainingSize)}</small>
                      <small>SL {price(order.stopLoss)} · TP {price(order.takeProfit)}</small>
                      <small>Marge {money(order.marginReserved)} $ · Frais estimés {money(order.feeEstimate || 0)} $</small>
                    </button>
                    <div>
                      <strong>{price(order.limitPrice)}</strong>
                      {latestFill && (
                        <button type="button" onClick={() => showFillDetails(latestFill)}>Détails du fill</button>
                      )}
                      <button type="button" disabled={busy} onClick={() => {
                        if (orderEditor?.orderId === order.id) setOrderEditor(null)
                        else editOrder(order)
                      }}>{orderEditor?.orderId === order.id ? 'Masquer' : 'Modifier'}</button>
                    </div>
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
                )
              }) : <div className="portfolio-empty">Aucun ordre en attente</div>
            ) : (
              historyTrades.length ? historyTrades.map((trade) => (
                <article className="history-row" key={trade.id}>
                  <div>
                    <span className={trade.side === 'long' ? 'is-profit' : 'is-loss'}>
                      TRADE · {trade.side === 'long' ? 'LONG' : 'SHORT'}
                    </span>
                    <strong>{trade.pair}</strong>
                    <small>{new Date(trade.time).toLocaleString('fr-FR')} · {displaySize(trade.pair, trade.size)}</small>
                  </div>
                  <div>
                    <strong className={trade.pnl >= 0 ? 'is-profit' : 'is-loss'}>{trade.pnl >= 0 ? '+' : ''}{money(trade.pnl)} $</strong>
                    <small>{price(trade.entryPrice)} → {price(trade.price)} · frais {money(trade.fee)} $</small>
                    {trade.requestedPrice != null && (
                      <button
                        className="history-fill-button"
                        type="button"
                        onClick={() => showFillDetails(trade)}
                      >
                        Détail · {Number(trade.slippageBps || 0).toFixed(2)} bps
                      </button>
                    )}
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
