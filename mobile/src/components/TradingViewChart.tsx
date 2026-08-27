import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  API_BASE_URL,
  type MarketTicker,
  type PaperMeta,
  type PaperOrder,
  type PaperTrade,
  type Position,
} from '../lib/api'
import { chartTradeMarkers, timeSecToPlotX } from '../lib/chartTradeMarkers'

type TvBar = {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume?: number
}

type Subscription = {
  pair: string
  resolution: string
  callback: (bar: TvBar) => void
  lastBar: TvBar | null
}

type TvWidget = {
  onChartReady: (callback: () => void) => void
  applyOverrides?: (overrides: Record<string, unknown>) => void
  activeChart: () => {
    setSymbol: (symbol: string, callback?: () => void) => void
    setResolution: (resolution: string, callback?: () => void) => void
    resetData?: () => void
    createOrderLine?: () => Promise<TvOrderLine>
    createPositionLine?: () => Promise<TvPositionLine>
    createShape?: (
      points: { time: number; price: number } | Array<{ time: number; price: number }>,
      options: Record<string, unknown>,
    ) => Promise<string | number>
    getTimeScale?: () => {
      width: () => number
      barSpacing: () => number
      rightOffset: () => number
      coordinateToTime: (x: number) => number | null
    }
    resolution?: () => string
    getVisibleBarsRange?: () => { from: number; to: number } | null
    getVisibleRange?: () => { from: number; to: number }
    getShapeById?: (id: string | number) => {
      getPoints: () => Array<{ price?: number }>
    }
    removeEntity?: (id: string | number) => void
    getPanes?: () => Array<{
      getHeight: () => number
      getMainSourcePriceScale: () => {
        getVisiblePriceRange: () => { from: number; to: number } | null
      } | null
    }>
    onSymbolChanged?: () => { subscribe: (ctx: unknown, callback: () => void) => void }
    symbol?: () => string
  }
  subscribe?: (event: string, callback: (id: string | number, eventType: string) => void) => void
  remove: () => void
}

type TvOrderLine = {
  remove: () => void
  getPrice: () => number
  setPrice: (value: number) => TvOrderLine
  setText: (value: string) => TvOrderLine
  setQuantity: (value: string) => TvOrderLine
  setEditable: (value: boolean) => TvOrderLine
  setCancellable: (value: boolean) => TvOrderLine
  setLineColor: (value: string) => TvOrderLine
  setBodyBorderColor: (value: string) => TvOrderLine
  setBodyBackgroundColor: (value: string) => TvOrderLine
  setBodyTextColor: (value: string) => TvOrderLine
  setQuantityBackgroundColor: (value: string) => TvOrderLine
  setQuantityTextColor: (value: string) => TvOrderLine
  onMove: (callback: () => void) => TvOrderLine
  onCancel: (callback: () => void) => TvOrderLine
}

type TvPositionLine = {
  remove: () => void
  setPrice: (value: number) => TvPositionLine
  setText: (value: string) => TvPositionLine
  setQuantity: (value: string) => TvPositionLine
  setLineColor: (value: string) => TvPositionLine
  setBodyBorderColor: (value: string) => TvPositionLine
  setBodyBackgroundColor: (value: string) => TvPositionLine
  setBodyTextColor: (value: string) => TvPositionLine
  setQuantityBackgroundColor: (value: string) => TvPositionLine
  setQuantityTextColor: (value: string) => TvPositionLine
  setCloseTooltip: (value: string) => TvPositionLine
  onClose: (callback: () => void) => TvPositionLine
}

type ManagedLine = { remove: () => void }

export type MobileOrderPreview = {
  pair: string
  side: 'long' | 'short'
  orderType: 'market' | 'limit'
  entryPrice: number
  size: number
  stopLoss: number | null
  takeProfit: number | null
}

type OverlayKind = 'pe' | 'sl' | 'tp' | 'order'

type MobileOverlayLine = {
  key: string
  kind: OverlayKind
  price: number
  label: string
  draggable: boolean
  side: 'long' | 'short'
  referencePrice: number
  positionId?: string
  orderId?: string
  preview?: boolean
  entryPrice?: number
  riskSize?: number
}

const OVERLAY_COLORS: Record<OverlayKind, string> = {
  pe: '#409cff',
  order: '#409cff',
  sl: '#ff5066',
  tp: '#38df8a',
}

function potentialRiskPnl(line: MobileOverlayLine, targetPrice: number, pair: string): number | null {
  if ((line.kind !== 'sl' && line.kind !== 'tp') || !line.entryPrice || !line.riskSize) return null
  const rawPnl = (line.side === 'long'
    ? targetPrice - line.entryPrice
    : line.entryPrice - targetPrice) * line.riskSize
  return pair === 'USD/JPY' || pair === 'USD/CHF'
    ? rawPnl / Math.max(targetPrice, 1e-9)
    : rawPnl
}

function rectInTopViewport(element: Element): DOMRect {
  const base = element.getBoundingClientRect()
  let left = base.left
  let top = base.top
  let currentWindow: Window | null = element.ownerDocument.defaultView
  while (currentWindow?.frameElement) {
    const frameRect = currentWindow.frameElement.getBoundingClientRect()
    left += frameRect.left
    top += frameRect.top
    currentWindow = currentWindow.parent
  }
  return new DOMRect(left, top, base.width, base.height)
}

declare global {
  interface Window {
    TradingView?: {
      widget: new (options: Record<string, unknown>) => TvWidget
    }
  }
}

const RESOLUTION_MINUTES: Record<string, number> = {
  '1': 1,
  '5': 5,
  '15': 15,
  '30': 30,
  '60': 60,
  '240': 240,
  '1D': 1440,
  D: 1440,
}

const SUPPORTED_RESOLUTIONS = ['1', '5', '15', '30', '60', '240', '1D']
const TIMEFRAME_OPTIONS = [
  { value: '1', label: '1 min', short: '1m' },
  { value: '5', label: '5 min', short: '5m' },
  { value: '15', label: '15 min', short: '15m' },
  { value: '30', label: '30 min', short: '30m' },
  { value: '60', label: '1 heure', short: '1h' },
  { value: '240', label: '4 heures', short: '4h' },
  { value: '1D', label: '1 jour', short: '1D' },
]
const SCRIPT_PATH = '/charting_library/charting_library.standalone.js'
let scriptPromise: Promise<void> | null = null
const INITIAL_CANDLE_BARS = 700
const SCROLL_CANDLE_BARS = 2_000
const CANDLE_CACHE_TTL_MS = 15 * 60_000
const CANDLE_REFRESH_AFTER_MS = 20_000
const CANDLE_STORAGE_PREFIX = 'btf.mobile.candles.'
const candleMemoryCache = new Map<string, { bars: TvBar[]; savedAt: number }>()
const candleRequests = new Map<string, Promise<TvBar[]>>()

async function fetchJsonWithTimeout(url: string, timeoutMs: number) {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return await response.json()
  } finally {
    window.clearTimeout(timeout)
  }
}

function candleCacheKey(pair: string, interval: number) {
  return `${pair}@${interval}`
}

function readCachedCandles(pair: string, interval: number) {
  const key = candleCacheKey(pair, interval)
  const memory = candleMemoryCache.get(key)
  if (memory && Date.now() - memory.savedAt < CANDLE_CACHE_TTL_MS) return memory
  try {
    const stored = JSON.parse(window.localStorage.getItem(`${CANDLE_STORAGE_PREFIX}${key}`) || 'null') as {
      bars?: TvBar[]
      savedAt?: number
    } | null
    if (!stored?.savedAt || !Array.isArray(stored.bars) || Date.now() - stored.savedAt >= CANDLE_CACHE_TTL_MS) return null
    const cached = { bars: stored.bars, savedAt: stored.savedAt }
    candleMemoryCache.set(key, cached)
    return cached
  } catch {
    return null
  }
}

function cacheCandles(pair: string, interval: number, bars: TvBar[]) {
  if (!bars.length) return
  const key = candleCacheKey(pair, interval)
  const cached = { bars: bars.slice(-INITIAL_CANDLE_BARS), savedAt: Date.now() }
  candleMemoryCache.set(key, cached)
  try {
    window.localStorage.setItem(`${CANDLE_STORAGE_PREFIX}${key}`, JSON.stringify(cached))
  } catch {
    // Le cache mémoire reste disponible si le stockage WebView est plein.
  }
}

async function fetchInitialCandles(pair: string, interval: number) {
  const key = candleCacheKey(pair, interval)
  const pending = candleRequests.get(key)
  if (pending) return pending
  const request = (async () => {
    const params = new URLSearchParams({
      pair,
      interval: String(interval),
      countBack: String(INITIAL_CANDLE_BARS),
    })
    const payload = await fetchJsonWithTimeout(`${API_BASE_URL}/api/paper/candles?${params.toString()}`, 12_000)
    const bars = (Array.isArray(payload.candles) ? payload.candles : [])
      .filter((item: TvBar) => Number.isFinite(item.time) && Number.isFinite(item.close))
      .map((item: TvBar) => ({ ...item, time: item.time * 1000 }))
      .sort((a: TvBar, b: TvBar) => a.time - b.time)
    cacheCandles(pair, interval, bars)
    return bars
  })()
  candleRequests.set(key, request)
  try {
    return await request
  } finally {
    candleRequests.delete(key)
  }
}

function loadTradingView() {
  if (window.TradingView?.widget) return Promise.resolve()
  if (scriptPromise) return scriptPromise
  scriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_PATH}"]`)
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener('error', () => reject(new Error('TradingView indisponible')), { once: true })
      return
    }
    const script = document.createElement('script')
    script.src = SCRIPT_PATH
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('TradingView indisponible'))
    document.head.appendChild(script)
  })
  return scriptPromise
}

function symbolType(category?: string) {
  if (category === 'forex') return 'forex'
  if (category === 'indices') return 'index'
  if (category === 'commodities') return 'commodity'
  if (category === 'actions') return 'stock'
  return 'crypto'
}

function priceScale(category?: string, samplePrice?: number) {
  if (category === 'forex') return 100_000
  if (category === 'indices' || category === 'commodities' || category === 'actions') return 100
  if (!samplePrice || samplePrice >= 1000) return 100
  if (samplePrice >= 10) return 1000
  if (samplePrice >= 1) return 10_000
  return 100_000
}

class MobileBtfDatafeed {
  private pairs: string[]
  private metadata: PaperMeta['marketMetadata']
  private market: Record<string, MarketTicker>
  private subscriptions = new Map<string, Subscription>()
  private latestBars = new Map<string, TvBar>()
  private onBarsReady: (pair: string) => void
  private onBarsError: (pair: string, message: string) => void

  constructor(
    pairs: string[],
    metadata: PaperMeta['marketMetadata'],
    market: Record<string, MarketTicker>,
    onBarsReady: (pair: string) => void,
    onBarsError: (pair: string, message: string) => void,
  ) {
    this.pairs = pairs
    this.metadata = metadata
    this.market = market
    this.onBarsReady = onBarsReady
    this.onBarsError = onBarsError
  }

  update(pairs: string[], metadata: PaperMeta['marketMetadata'], market: Record<string, MarketTicker>) {
    this.pairs = pairs
    this.metadata = metadata
    this.market = market
  }

  onReady(callback: (config: Record<string, unknown>) => void) {
    setTimeout(() => callback({
      supported_resolutions: SUPPORTED_RESOLUTIONS,
      supports_marks: false,
      supports_timescale_marks: false,
      supports_time: true,
      exchanges: [{ value: 'BTF', name: 'BTF Arena', desc: 'BTF Arena' }],
      symbols_types: [
        { name: 'Crypto', value: 'crypto' },
        { name: 'Forex', value: 'forex' },
        { name: 'Indices', value: 'index' },
        { name: 'Commodities', value: 'commodity' },
      ],
    }), 0)
  }

  searchSymbols(
    query: string,
    _exchange: string,
    _type: string,
    callback: (items: Array<Record<string, string>>) => void,
  ) {
    const clean = query.replace(/\s+/g, '').toUpperCase()
    callback(this.pairs
      .filter((pair) => pair.replace('/', '').includes(clean))
      .map((pair) => ({
        symbol: pair,
        full_name: pair,
        description: this.metadata?.[pair]?.name || pair,
        exchange: 'BTF',
        ticker: pair,
        type: symbolType(this.metadata?.[pair]?.category),
      })))
  }

  resolveSymbol(
    symbol: string,
    onResolve: (info: Record<string, unknown>) => void,
    _onError: (reason: string) => void,
  ) {
    const category = this.metadata?.[symbol]?.category
    const ticker = this.market[symbol]
    setTimeout(() => onResolve({
      name: symbol,
      ticker: symbol,
      description: this.metadata?.[symbol]?.name || symbol,
      type: symbolType(category),
      session: '24x7',
      timezone: 'Etc/UTC',
      exchange: 'BTF',
      listed_exchange: 'BTF',
      format: 'price',
      pricescale: priceScale(category, ticker?.markPrice),
      minmov: 1,
      has_intraday: true,
      has_daily: true,
      has_weekly_and_monthly: false,
      supported_resolutions: SUPPORTED_RESOLUTIONS,
      volume_precision: 2,
      data_status: 'streaming',
    }), 0)
  }

  async getBars(
    symbolInfo: { ticker?: string; name: string },
    resolution: string,
    period: { from: number; to: number; firstDataRequest: boolean; countBack: number },
    onResult: (bars: TvBar[], meta: { noData: boolean }) => void,
    onError: (reason: string) => void,
  ) {
    const pair = symbolInfo.ticker || symbolInfo.name
    const interval = RESOLUTION_MINUTES[resolution] || 1
    if (period.firstDataRequest) {
      const cached = readCachedCandles(pair, interval)
      if (cached?.bars.length) {
        const bars = cached.bars
        this.latestBars.set(`${pair}@${interval}`, bars[bars.length - 1])
        this.onBarsReady(pair)
        onResult(bars, { noData: false })
        if (Date.now() - cached.savedAt > CANDLE_REFRESH_AFTER_MS) {
          void fetchInitialCandles(pair, interval).catch(() => undefined)
        }
        return
      }
      try {
        const bars = await fetchInitialCandles(pair, interval)
        if (bars.length) this.latestBars.set(`${pair}@${interval}`, bars[bars.length - 1])
        if (bars.length) this.onBarsReady(pair)
        else this.onBarsError(pair, 'Aucune bougie disponible')
        onResult(bars, { noData: bars.length === 0 })
      } catch (error) {
        const message = error instanceof Error && error.name !== 'AbortError'
          ? error.message
          : 'Le serveur de bougies ne répond pas'
        this.onBarsError(pair, message)
        onError(message)
      }
      return
    }
    const params = new URLSearchParams({
      pair,
      interval: String(interval),
      to: String(Math.floor(period.to)),
      countBack: String(Math.max(period.countBack || 0, SCROLL_CANDLE_BARS)),
    })
    if (period.from > 0) params.set('from', String(Math.floor(period.from)))
    try {
      const payload = await fetchJsonWithTimeout(
        `${API_BASE_URL}/api/paper/candles?${params.toString()}`,
        20_000,
      )
      const bars = (Array.isArray(payload.candles) ? payload.candles : [])
        .filter((item: TvBar) => Number.isFinite(item.time) && Number.isFinite(item.close))
        .map((item: TvBar) => ({ ...item, time: item.time * 1000 }))
        .sort((a: TvBar, b: TvBar) => a.time - b.time)
      if (bars.length) this.latestBars.set(`${pair}@${interval}`, bars[bars.length - 1])
      if (bars.length) this.onBarsReady(pair)
      else this.onBarsError(pair, 'Aucune bougie disponible')
      onResult(bars, { noData: bars.length === 0 })
    } catch (error) {
      const message = error instanceof Error && error.name !== 'AbortError'
        ? error.message
        : 'Le serveur de bougies ne répond pas'
      this.onBarsError(pair, message)
      onError(message)
    }
  }

  subscribeBars(
    symbolInfo: { ticker?: string; name: string },
    resolution: string,
    callback: (bar: TvBar) => void,
    uid: string,
  ) {
    const pair = symbolInfo.ticker || symbolInfo.name
    const interval = RESOLUTION_MINUTES[resolution] || 1
    this.subscriptions.set(uid, {
      pair,
      resolution,
      callback,
      lastBar: this.latestBars.get(`${pair}@${interval}`) || null,
    })
  }

  unsubscribeBars(uid: string) {
    this.subscriptions.delete(uid)
  }

  getServerTime(callback: (time: number) => void) {
    callback(Math.floor(Date.now() / 1000))
  }

  pushTick(pair: string, nextPrice: number, timestampMs: number) {
    for (const subscription of this.subscriptions.values()) {
      if (subscription.pair !== pair) continue
      const intervalMs = (RESOLUTION_MINUTES[subscription.resolution] || 1) * 60_000
      const bucket = Math.floor(timestampMs / intervalMs) * intervalMs
      const previous = subscription.lastBar
      const bar: TvBar = !previous || previous.time < bucket
        ? { time: bucket, open: nextPrice, high: nextPrice, low: nextPrice, close: nextPrice }
        : {
            ...previous,
            high: Math.max(previous.high, nextPrice),
            low: Math.min(previous.low, nextPrice),
            close: nextPrice,
          }
      subscription.lastBar = bar
      this.latestBars.set(`${pair}@${RESOLUTION_MINUTES[subscription.resolution] || 1}`, bar)
      subscription.callback(bar)
    }
  }
}

export function TradingViewChart({
  pair,
  pairs,
  market,
  metadata,
  positions,
  orders,
  trades,
  orderPreview,
  onPairChange,
  onUpdatePositionRisk,
  onUpdateOrderRisk,
  onUpdateOrderLimit,
  onCancelOrder,
  onClosePosition,
  onPreviewEntryChange,
  onPreviewRiskChange,
  toolbarLeading,
}: {
  pair: string
  pairs: string[]
  market: Record<string, MarketTicker>
  metadata: PaperMeta['marketMetadata']
  positions: Position[]
  orders: PaperOrder[]
  trades?: PaperTrade[]
  orderPreview: MobileOrderPreview | null
  onPairChange: (pair: string) => void
  onUpdatePositionRisk: (
    positionId: string,
    stopLoss: number | null,
    takeProfit: number | null,
    sizes?: { stopLossSize?: number | null; takeProfitSize?: number | null },
  ) => void
  onUpdateOrderRisk: (orderId: string, stopLoss: number | null, takeProfit: number | null) => void
  onUpdateOrderLimit: (orderId: string, limitPrice: number) => void
  onCancelOrder: (orderId: string) => void
  onClosePosition: (positionId: string) => void
  onPreviewEntryChange: (price: number) => void
  onPreviewRiskChange: (patch: { stopLoss?: number | null; takeProfit?: number | null }) => void
  toolbarLeading?: ReactNode
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const paneRef = useRef<HTMLDivElement | null>(null)
  const containerId = useRef(`tv-mobile-${Math.random().toString(36).slice(2)}`)
  const widgetRef = useRef<TvWidget | null>(null)
  const datafeedRef = useRef<MobileBtfDatafeed | null>(null)
  const managedLinesRef = useRef<ManagedLine[]>([])
  const fillMarkElementsRef = useRef(new Map<string, HTMLDivElement>())
  const fallbackLineHandlersRef = useRef(new Map<string | number, () => void>())
  const fallbackLineTimersRef = useRef(new Map<string | number, ReturnType<typeof setTimeout>>())
  const overlayElementRefs = useRef(new Map<string, HTMLDivElement>())
  const overlayDragPricesRef = useRef(new Map<string, number>())
  const overlayInvalidRef = useRef(new Set<string>())
  const riskDragGuideRef = useRef<HTMLDivElement | null>(null)
  const riskDragGuideLabelRef = useRef<HTMLSpanElement | null>(null)
  const riskDragGuidePriceRef = useRef<HTMLElement | null>(null)
  const [, forceOverlayRender] = useState(0)
  const pairRef = useRef(pair)
  const [chartReady, setChartReady] = useState(false)
  const [candlesReady, setCandlesReady] = useState(false)
  const [candlesError, setCandlesError] = useState('')
  const [resolution, setResolution] = useState('5')
  const [timeframeOpen, setTimeframeOpen] = useState(false)
  const [expandedPeKey, setExpandedPeKey] = useState<string | null>(null)
  const timeframeMenuRef = useRef<HTMLDivElement>(null)
  const propsRef = useRef({
    pair,
    pairs,
    market,
    metadata,
    positions,
    orders,
    orderPreview,
    onPairChange,
    onUpdatePositionRisk,
    onUpdateOrderRisk,
    onUpdateOrderLimit,
    onCancelOrder,
    onClosePosition,
    onPreviewEntryChange,
    onPreviewRiskChange,
  })
  propsRef.current = {
    pair,
    pairs,
    market,
    metadata,
    positions,
    orders,
    orderPreview,
    onPairChange,
    onUpdatePositionRisk,
    onUpdateOrderRisk,
    onUpdateOrderLimit,
    onCancelOrder,
    onClosePosition,
    onPreviewEntryChange,
    onPreviewRiskChange,
  }

  useEffect(() => {
    let disposed = false
    const fallbackHandlers = fallbackLineHandlersRef.current
    const fallbackTimers = fallbackLineTimersRef.current
    const initial = propsRef.current
    const datafeed = new MobileBtfDatafeed(
      initial.pairs,
      initial.metadata,
      initial.market,
      (loadedPair) => {
        if (!disposed && loadedPair === pairRef.current) {
          setCandlesError('')
          setCandlesReady(true)
        }
      },
      (failedPair, message) => {
        if (!disposed && failedPair === pairRef.current) setCandlesError(message)
      },
    )
    datafeedRef.current = datafeed
    // Lance le réseau bougies immédiatement, en parallèle du chargement du
    // bundle TradingView, pour supprimer le waterfall du premier affichage.
    void fetchInitialCandles(initial.pair, 5).catch(() => undefined)
    void loadTradingView().then(() => {
      if (disposed || !window.TradingView?.widget) return
      const widget = new window.TradingView.widget({
        container: containerId.current,
        library_path: '/charting_library/',
        datafeed,
        symbol: initial.pair,
        interval: '5',
        locale: 'fr',
        timezone: 'Etc/UTC',
        theme: 'dark',
        autosize: true,
        fullscreen: false,
        toolbar_bg: '#0b0a0d',
        custom_css_url: '',
        enabled_features: [
          'show_symbol_logos',
        ],
        disabled_features: [
          'left_toolbar',
          'header_widget',
          'header_symbol_search',
          'header_compare',
          'header_screenshot',
          'symbol_search_hot_key',
          'timeframes_toolbar',
          'go_to_date',
          'popup_hints',
        ],
        handleScroll: {
          mouseWheel: true,
          pressedMouseMove: true,
          horzTouchDrag: true,
          vertTouchDrag: false,
        },
        overrides: {
          'paneProperties.background': '#0b0a0d',
          'paneProperties.backgroundType': 'solid',
          'paneProperties.vertGridProperties.color': 'rgba(255,255,255,0.04)',
          'paneProperties.horzGridProperties.color': 'rgba(255,255,255,0.04)',
          'scalesProperties.textColor': '#8d8791',
          'mainSeriesProperties.candleStyle.upColor': '#38df8a',
          'mainSeriesProperties.candleStyle.downColor': '#ff5066',
          'mainSeriesProperties.candleStyle.borderUpColor': '#38df8a',
          'mainSeriesProperties.candleStyle.borderDownColor': '#ff5066',
          'mainSeriesProperties.candleStyle.wickUpColor': '#38df8a',
          'mainSeriesProperties.candleStyle.wickDownColor': '#ff5066',
          'mainSeriesProperties.bidAsk.visible': false,
          'mainSeriesProperties.highLowAvgPrice.highLowPriceLinesVisible': false,
          'mainSeriesProperties.highLowAvgPrice.averagePriceLineVisible': false,
        },
      })
      widgetRef.current = widget
      widget.onChartReady(() => {
        if (disposed) return
        widget.applyOverrides?.({
          'mainSeriesProperties.bidAsk.visible': false,
          'mainSeriesProperties.highLowAvgPrice.highLowPriceLinesVisible': false,
          'mainSeriesProperties.highLowAvgPrice.averagePriceLineVisible': false,
        })
        setChartReady(true)
        const chart = widget.activeChart()
        chart.onSymbolChanged?.().subscribe(null, () => {
          const next = chart.symbol?.()
          const current = propsRef.current
          if (next && next !== pairRef.current && current.pairs.includes(next)) current.onPairChange(next)
        })
        widget.subscribe?.('drawing_event', (id, eventType) => {
          if (eventType !== 'points_changed' && eventType !== 'move') return
          const handler = fallbackHandlers.get(id)
          if (!handler) return
          const previous = fallbackTimers.get(id)
          if (previous) clearTimeout(previous)
          fallbackTimers.set(id, setTimeout(() => {
            fallbackTimers.delete(id)
            handler()
          }, 180))
        })
      })
    })
    return () => {
      disposed = true
      setChartReady(false)
      for (const line of managedLinesRef.current) {
        try { line.remove() } catch { /* déjà supprimée */ }
      }
      managedLinesRef.current = []
      fallbackHandlers.clear()
      for (const timer of fallbackTimers.values()) clearTimeout(timer)
      fallbackTimers.clear()
      widgetRef.current?.remove()
      widgetRef.current = null
      datafeedRef.current = null
    }
  }, [])

  useEffect(() => {
    datafeedRef.current?.update(pairs, metadata, market)
  }, [market, metadata, pairs])

  useEffect(() => {
    if (!pair) return
    setCandlesReady(false)
    setCandlesError('')
    pairRef.current = pair
    widgetRef.current?.activeChart().setSymbol(pair)
  }, [pair])

  useEffect(() => {
    const ticker = market[pair]
    if (ticker?.markPrice > 0) datafeedRef.current?.pushTick(pair, ticker.markPrice, ticker.updatedAt || Date.now())
  }, [market, pair])

  const tradingLinesSignature = JSON.stringify({
    positions: positions.map((item) => [
      item.id, item.pair, item.side, item.size, item.entryPrice, item.stopLoss, item.takeProfit,
    ]),
    orders: orders.map((item) => [
      item.id, item.pair, item.side, item.size, item.filledSize, item.limitPrice, item.stopLoss, item.takeProfit, item.status,
    ]),
    preview: orderPreview && [
      orderPreview.pair,
      orderPreview.side,
      orderPreview.orderType,
      orderPreview.entryPrice,
      orderPreview.size,
      orderPreview.stopLoss,
      orderPreview.takeProfit,
    ],
  })

  const overlayLines = useMemo<MobileOverlayLine[]>(() => {
    const next: MobileOverlayLine[] = []
    if (orderPreview?.pair === pair) {
      if (orderPreview.orderType === 'limit') {
        next.push({
          key: 'preview:pe',
          kind: 'pe',
          price: orderPreview.entryPrice,
          label: `LIMITE ${orderPreview.side === 'long' ? 'ACHAT' : 'VENTE'}`,
          draggable: true,
          side: orderPreview.side,
          referencePrice: orderPreview.entryPrice,
          preview: true,
          entryPrice: orderPreview.entryPrice,
          riskSize: orderPreview.size,
        })
      }
      if (orderPreview.stopLoss != null) {
        next.push({
          key: 'preview:sl',
          kind: 'sl',
          price: orderPreview.stopLoss,
          label: 'STOP LOSS',
          draggable: true,
          side: orderPreview.side,
          referencePrice: orderPreview.entryPrice,
          preview: true,
          entryPrice: orderPreview.entryPrice,
          riskSize: orderPreview.size,
        })
      }
      if (orderPreview.takeProfit != null) {
        next.push({
          key: 'preview:tp',
          kind: 'tp',
          price: orderPreview.takeProfit,
          label: 'TAKE PROFIT',
          draggable: true,
          side: orderPreview.side,
          referencePrice: orderPreview.entryPrice,
          preview: true,
        })
      }
    }

    for (const position of positions) {
      if (position.pair !== pair) continue
      next.push({
        key: `position:pe:${position.id}`,
        kind: 'pe',
        price: position.entryPrice,
        label: `PE ${position.side === 'long' ? 'LONG' : 'SHORT'}`,
        draggable: false,
        side: position.side,
        referencePrice: position.markPrice || position.entryPrice,
        positionId: position.id,
      })
      if (position.stopLoss != null) {
        next.push({
          key: `position:sl:${position.id}`,
          kind: 'sl',
          price: position.stopLoss,
          label: 'STOP LOSS',
          draggable: true,
          side: position.side,
          referencePrice: position.markPrice || position.entryPrice,
          positionId: position.id,
          entryPrice: position.entryPrice,
          riskSize: position.stopLossSize ?? position.size,
        })
      }
      if (position.takeProfit != null) {
        next.push({
          key: `position:tp:${position.id}`,
          kind: 'tp',
          price: position.takeProfit,
          label: 'TAKE PROFIT',
          draggable: true,
          side: position.side,
          referencePrice: position.markPrice || position.entryPrice,
          positionId: position.id,
          entryPrice: position.entryPrice,
          riskSize: position.takeProfitSize ?? position.size,
        })
      }
    }

    for (const order of orders) {
      if (order.pair !== pair || order.status !== 'open' || order.limitPrice == null) continue
      const remainingSize = Math.max(0, order.size - (order.filledSize ?? 0))
      next.push({
        key: `order:pe:${order.id}`,
        kind: 'order',
        price: order.limitPrice,
        label: `LIMITE ${order.side === 'long' ? 'ACHAT' : 'VENTE'}`,
        draggable: true,
        side: order.side,
        referencePrice: order.limitPrice,
        orderId: order.id,
        riskSize: remainingSize,
      })
      if (order.stopLoss != null) {
        next.push({
          key: `order:sl:${order.id}`,
          kind: 'sl',
          price: order.stopLoss,
          label: 'STOP LOSS',
          draggable: true,
          side: order.side,
          referencePrice: order.limitPrice,
          orderId: order.id,
          entryPrice: order.limitPrice,
          riskSize: remainingSize,
        })
      }
      if (order.takeProfit != null) {
        next.push({
          key: `order:tp:${order.id}`,
          kind: 'tp',
          price: order.takeProfit,
          label: 'TAKE PROFIT',
          draggable: true,
          side: order.side,
          referencePrice: order.limitPrice,
          orderId: order.id,
          entryPrice: order.limitPrice,
          riskSize: remainingSize,
        })
      }
    }
    return next
  }, [orderPreview, orders, pair, positions])

  useEffect(() => {
    if (!chartReady) return
    const chart = widgetRef.current?.activeChart()
    for (const line of managedLinesRef.current) {
      try { line.remove() } catch { /* déjà supprimée */ }
    }
    managedLinesRef.current = []
    try {
      const shapes = (chart as { getAllShapes?: () => Array<{ id: string | number; name?: string }> })?.getAllShapes?.() || []
      for (const shape of shapes) {
        if (shape.name === 'horizontal_line' || shape.name === 'arrow_up' || shape.name === 'arrow_down') {
          try { chart?.removeEntity?.(shape.id) } catch { /* déjà supprimée */ }
        }
      }
    } catch {
      // Pas bloquant si l'API dessins n'est pas dispo.
    }
  }, [candlesReady, chartReady, pair, tradingLinesSignature])

  const fillMarkers = useMemo(
    () => chartTradeMarkers(trades, pair, RESOLUTION_MINUTES[resolution] || 1),
    [pair, resolution, trades],
  )

  const collectCanvases = useCallback((root: ParentNode) => {
    const canvases: HTMLCanvasElement[] = []
    try {
      canvases.push(...Array.from(root.querySelectorAll('canvas')) as HTMLCanvasElement[])
      for (const iframe of Array.from(root.querySelectorAll('iframe')) as HTMLIFrameElement[]) {
        const document = iframe.contentDocument
        if (document) canvases.push(...Array.from(document.querySelectorAll('canvas')) as HTMLCanvasElement[])
      }
    } catch {
      // Same-origin est attendu, sinon la plage TradingView reste le fallback.
    }
    return canvases
  }, [])

  const getPaneRect = useCallback(() => {
    const container = paneRef.current
    if (!container) return null
    const containerRect = container.getBoundingClientRect()
    let chart
    try {
      chart = widgetRef.current?.activeChart()
    } catch {
      chart = undefined
    }
    const tsWidth = chart?.getTimeScale?.()?.width() || 0
    const canvases = collectCanvases(container)
    let plotCanvas: HTMLCanvasElement | null = null
    let bestWidthDiff = Infinity
    let largest: HTMLCanvasElement | null = null
    let largestArea = 0
    for (const canvas of canvases) {
      const rect = rectInTopViewport(canvas)
      if (rect.width <= 40 || rect.height <= 40) continue
      const area = rect.width * rect.height
      if (area > largestArea) {
        largest = canvas
        largestArea = area
      }
      if (tsWidth > 40) {
        const diff = Math.abs(rect.width - tsWidth)
        if (diff < bestWidthDiff && rect.width > tsWidth * 0.75) {
          bestWidthDiff = diff
          plotCanvas = canvas
        }
      }
    }
    const plotRect = plotCanvas && bestWidthDiff < 48 ? rectInTopViewport(plotCanvas) : null
    let hostRect = plotRect || (largest ? rectInTopViewport(largest) : null)
    if (!hostRect) {
      const iframe = container.querySelector('iframe')
      if (iframe) hostRect = rectInTopViewport(iframe)
      else hostRect = containerRect
    }
    if (hostRect.width < 40 || hostRect.height < 40) return null
    let height = hostRect.height
    let width = tsWidth > 40 ? Math.min(tsWidth, hostRect.width) : hostRect.width
    let topPad = 0
    try {
      const panes = chart?.getPanes?.() ?? []
      const paneHeight = panes[0]?.getHeight()
      if (paneHeight && paneHeight > 40) height = Math.min(height, paneHeight)
      if (!plotRect) {
        let panesHeight = 0
        for (const pane of panes) panesHeight += pane.getHeight() || 0
        const leftover = hostRect.height - panesHeight
        if (leftover > 20 && leftover < hostRect.height * 0.5) topPad = Math.max(0, leftover - 28)
      }
    } catch {
      // dimensions iframe / canvas déjà mesurées
    }
    const top = hostRect.top - containerRect.top + topPad
    const matchedPlot = Boolean(plotRect)
    const priceScaleWidth = matchedPlot ? 0 : Math.min(86, Math.max(0, hostRect.width - width))
    const left = matchedPlot
      ? hostRect.left - containerRect.left
      : hostRect.left - containerRect.left + Math.max(0, hostRect.width - width - priceScaleWidth)
    return {
      top,
      bottom: top + height,
      left,
      right: left + width,
      width,
      height,
    }
  }, [collectCanvases])

  const getPriceRange = useCallback(() => {
    try {
      const scale = widgetRef.current?.activeChart().getPanes?.()[0]?.getMainSourcePriceScale()
      const range = scale?.getVisiblePriceRange()
      if (!range) return null
      const top = Math.max(range.from, range.to)
      const bottom = Math.min(range.from, range.to)
      return top - bottom > 1e-12 ? { top, bottom } : null
    } catch {
      return null
    }
  }, [])

  const priceToY = useCallback((value: number) => {
    const pane = getPaneRect()
    const range = getPriceRange()
    if (!pane || !range || !Number.isFinite(value)) return null
    return pane.top + ((range.top - value) / (range.top - range.bottom)) * pane.height
  }, [getPaneRect, getPriceRange])

  const timeToX = useCallback((timeSec: number) => {
    const pane = getPaneRect()
    if (!pane) return null
    const chart = widgetRef.current?.activeChart()
    if (!chart) return null
    const xLocal = timeSecToPlotX(chart, timeSec, RESOLUTION_MINUTES[resolution] || 1)
    return xLocal == null ? null : pane.left + xLocal
  }, [getPaneRect, resolution])

  const yToPrice = useCallback((value: number) => {
    const pane = getPaneRect()
    const range = getPriceRange()
    if (!pane || !range) return null
    return range.top - ((value - pane.top) / pane.height) * (range.top - range.bottom)
  }, [getPaneRect, getPriceRange])

  useEffect(() => {
    let frame = 0
    let stopped = false
    const position = () => {
      if (stopped) return
      const pane = getPaneRect()
      const container = paneRef.current
      if (container) {
        let fallbackIndex = 0
        for (const line of overlayLines) {
          const element = overlayElementRefs.current.get(line.key)
          if (!element) continue
          const currentPrice = overlayDragPricesRef.current.get(line.key) ?? line.price
          const exactY = priceToY(currentPrice)
          const fallbackY = container.clientHeight / 2 + fallbackIndex * 34
          const offscreen = exactY == null || !pane || exactY < pane.top - 10 || exactY > pane.bottom + 10
          const y = exactY == null || !pane ? fallbackY : exactY
          element.style.left = `${pane ? Math.max(8, pane.left + 8) : 8}px`
          element.style.transform = `translate3d(0, ${y}px, 0) translateY(-50%)`
          element.style.opacity = offscreen ? '0' : '1'
          element.style.pointerEvents = offscreen ? 'none' : 'auto'
          fallbackIndex += 1
        }
        for (const marker of fillMarkers) {
          const element = fillMarkElementsRef.current.get(marker.key)
          if (!element) continue
          const x = timeToX(marker.timeSec)
          const y = priceToY(marker.price)
          if (x == null || y == null || !pane) {
            element.style.opacity = '0'
            continue
          }
          const left = x + marker.stack * 10
          const top = y + (marker.direction === 'buy' ? 11 : -11)
          const hidden = left < pane.left - 8 || left > pane.right + 8
            || top < pane.top - 8 || top > pane.bottom + 8
          element.style.left = `${left}px`
          element.style.top = `${top}px`
          element.style.opacity = hidden ? '0' : '1'
        }
      }
      frame = requestAnimationFrame(position)
    }
    frame = requestAnimationFrame(position)
    return () => {
      stopped = true
      cancelAnimationFrame(frame)
    }
  }, [fillMarkers, getPaneRect, overlayLines, priceToY, timeToX])

  const isValidOverlayPrice = useCallback((line: MobileOverlayLine, value: number) => {
    if (line.kind !== 'sl' && line.kind !== 'tp') return true
    if (line.side === 'long') return line.kind === 'sl' ? value < line.referencePrice : value > line.referencePrice
    return line.kind === 'sl' ? value > line.referencePrice : value < line.referencePrice
  }, [])

  const roundedOverlayPrice = useCallback((value: number) => {
    const category = metadata?.[pair]?.category
    const digits = category === 'forex' ? 5 : value >= 100 ? 2 : value >= 1 ? 4 : 6
    return Number(value.toFixed(digits))
  }, [metadata, pair])

  const commitOverlayPrice = useCallback((line: MobileOverlayLine, value: number) => {
    const current = propsRef.current
    if (line.preview) {
      if (line.kind === 'pe' || line.kind === 'order') current.onPreviewEntryChange(value)
      else current.onPreviewRiskChange({ [line.kind === 'sl' ? 'stopLoss' : 'takeProfit']: value })
      return
    }
    if (line.orderId) {
      const order = current.orders.find((item) => item.id === line.orderId)
      if (line.kind === 'pe' || line.kind === 'order') current.onUpdateOrderLimit(line.orderId, value)
      else if (line.kind === 'sl') current.onUpdateOrderRisk(line.orderId, value, order?.takeProfit ?? null)
      else current.onUpdateOrderRisk(line.orderId, order?.stopLoss ?? null, value)
      return
    }
    if (line.positionId) {
      const position = current.positions.find((item) => item.id === line.positionId)
      const sizes = {
        stopLossSize: position?.stopLossSize ?? null,
        takeProfitSize: position?.takeProfitSize ?? null,
      }
      if (line.kind === 'sl') current.onUpdatePositionRisk(line.positionId, value, position?.takeProfit ?? null, sizes)
      else if (line.kind === 'tp') current.onUpdatePositionRisk(line.positionId, position?.stopLoss ?? null, value, sizes)
    }
  }, [])

  const beginOverlayDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>, line: MobileOverlayLine) => {
    if (!line.draggable) return
    event.preventDefault()
    event.stopPropagation()
    const element = event.currentTarget
    const pointerId = event.pointerId
    const startPrice = line.price
    let lastPrice = startPrice
    let invalid = false
    try { element.setPointerCapture(pointerId) } catch { /* support WebView variable */ }
    overlayDragPricesRef.current.set(line.key, startPrice)

    const move = (nextEvent: globalThis.PointerEvent) => {
      const container = paneRef.current
      if (!container) return
      nextEvent.preventDefault()
      const nextPrice = yToPrice(nextEvent.clientY - container.getBoundingClientRect().top)
      if (nextPrice == null || !Number.isFinite(nextPrice) || nextPrice <= 0) return
      lastPrice = nextPrice
      invalid = !isValidOverlayPrice(line, nextPrice)
      if (invalid) overlayInvalidRef.current.add(line.key)
      else overlayInvalidRef.current.delete(line.key)
      overlayDragPricesRef.current.set(line.key, nextPrice)
      forceOverlayRender((value) => value + 1)
    }

    const finish = () => {
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', finish)
      document.removeEventListener('pointercancel', finish)
      overlayInvalidRef.current.delete(line.key)
      if (!invalid && Number.isFinite(lastPrice) && lastPrice > 0) {
        const finalPrice = roundedOverlayPrice(lastPrice)
        overlayDragPricesRef.current.set(line.key, finalPrice)
        commitOverlayPrice(line, finalPrice)
        window.setTimeout(() => {
          overlayDragPricesRef.current.delete(line.key)
          forceOverlayRender((value) => value + 1)
        }, 1800)
      } else {
        overlayDragPricesRef.current.delete(line.key)
      }
      forceOverlayRender((value) => value + 1)
    }

    document.addEventListener('pointermove', move, { passive: false })
    document.addEventListener('pointerup', finish)
    document.addEventListener('pointercancel', finish)
  }, [commitOverlayPrice, isValidOverlayPrice, roundedOverlayPrice, yToPrice])

  const removeOverlayLine = useCallback((line: MobileOverlayLine) => {
    const current = propsRef.current
    if (line.preview) {
      if (line.kind === 'sl' || line.kind === 'tp') {
        current.onPreviewRiskChange({ [line.kind === 'sl' ? 'stopLoss' : 'takeProfit']: null })
      }
      return
    }
    if (line.orderId) {
      const order = current.orders.find((item) => item.id === line.orderId)
      if (line.kind === 'sl') current.onUpdateOrderRisk(line.orderId, null, order?.takeProfit ?? null)
      else if (line.kind === 'tp') current.onUpdateOrderRisk(line.orderId, order?.stopLoss ?? null, null)
      else current.onCancelOrder(line.orderId)
      return
    }
    if (line.positionId) {
      const position = current.positions.find((item) => item.id === line.positionId)
      if (line.kind === 'sl') {
        current.onUpdatePositionRisk(line.positionId, null, position?.takeProfit ?? null, {
          stopLossSize: null,
          takeProfitSize: position?.takeProfitSize ?? null,
        })
      } else if (line.kind === 'tp') {
        current.onUpdatePositionRisk(line.positionId, position?.stopLoss ?? null, null, {
          stopLossSize: position?.stopLossSize ?? null,
          takeProfitSize: null,
        })
      } else if (line.kind === 'pe') current.onClosePosition(line.positionId)
    }
  }, [])

  const beginRiskButtonDrag = useCallback((
    event: ReactPointerEvent<HTMLButtonElement>,
    line: MobileOverlayLine,
    kind: 'sl' | 'tp',
  ) => {
    event.preventDefault()
    event.stopPropagation()
    const element = event.currentTarget
    const pointerId = event.pointerId
    const startY = event.clientY
    const draftLine: MobileOverlayLine = {
      ...line,
      key: `draft:${kind}:${line.key}`,
      kind,
      label: kind === 'sl' ? 'STOP LOSS' : 'TAKE PROFIT',
      draggable: true,
    }
    let lastPrice: number | null = null
    let moved = false
    let invalid = false

    try { element.setPointerCapture(pointerId) } catch { /* support WebView variable */ }
    element.classList.add('is-dragging')
    const guide = riskDragGuideRef.current
    if (guide) guide.style.setProperty('--risk-color', kind === 'sl' ? '#ff6377' : '#4ce69a')
    if (riskDragGuideLabelRef.current) riskDragGuideLabelRef.current.textContent = kind.toUpperCase()

    const move = (nextEvent: globalThis.PointerEvent) => {
      const container = paneRef.current
      if (!container) return
      nextEvent.preventDefault()
      const deltaY = nextEvent.clientY - startY
      if (Math.abs(deltaY) > 4) {
        moved = true
        guide?.classList.add('is-visible')
      }
      element.style.transform = `translate3d(0, ${deltaY}px, 0)`
      const guideY = nextEvent.clientY - container.getBoundingClientRect().top
      if (guide) guide.style.transform = `translate3d(0, ${guideY}px, 0)`
      const nextPrice = yToPrice(guideY)
      if (nextPrice == null || !Number.isFinite(nextPrice) || nextPrice <= 0) return
      lastPrice = nextPrice
      invalid = !isValidOverlayPrice(draftLine, nextPrice)
      element.classList.toggle('is-invalid', invalid)
      if (riskDragGuidePriceRef.current) {
        riskDragGuidePriceRef.current.textContent = roundedOverlayPrice(nextPrice).toLocaleString('en-US', { maximumFractionDigits: 6 })
      }
    }

    const finish = (nextEvent: globalThis.PointerEvent) => {
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', finish)
      document.removeEventListener('pointercancel', finish)
      element.classList.remove('is-dragging', 'is-invalid')
      element.style.removeProperty('transform')
      const cancelled = nextEvent.type === 'pointercancel'
      if (!cancelled && moved && !invalid && lastPrice != null) {
        commitOverlayPrice(draftLine, roundedOverlayPrice(lastPrice))
        setExpandedPeKey(null)
        const expectedKey = draftLine.preview
          ? `preview:${kind}`
          : draftLine.orderId
            ? `order:${kind}:${draftLine.orderId}`
            : draftLine.positionId
              ? `position:${kind}:${draftLine.positionId}`
              : ''
        const startedAt = performance.now()
        const hideWhenCommitted = () => {
          if (!expectedKey || overlayElementRefs.current.has(expectedKey) || performance.now() - startedAt > 12_000) {
            guide?.classList.remove('is-visible')
            guide?.style.removeProperty('transform')
            return
          }
          requestAnimationFrame(hideWhenCommitted)
        }
        requestAnimationFrame(hideWhenCommitted)
      } else {
        guide?.classList.remove('is-visible')
        guide?.style.removeProperty('transform')
      }
    }

    document.addEventListener('pointermove', move, { passive: false })
    document.addEventListener('pointerup', finish)
    document.addEventListener('pointercancel', finish)
  }, [commitOverlayPrice, isValidOverlayPrice, roundedOverlayPrice, yToPrice])

  const changeResolution = useCallback((nextResolution: string) => {
    setResolution(nextResolution)
    setTimeframeOpen(false)
    widgetRef.current?.activeChart().setResolution(nextResolution)
  }, [])

  useEffect(() => {
    if (!timeframeOpen) return
    const close = (event: PointerEvent) => {
      if (!timeframeMenuRef.current?.contains(event.target as Node)) setTimeframeOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [timeframeOpen])

  return (
    <div ref={wrapRef} className="tradingview-mobile-wrap">
      <div className="tradingview-mobile-toolbar">
        <div className="tradingview-mobile-toolbar__leading">{toolbarLeading}</div>
        <div className="timeframe-selector" ref={timeframeMenuRef}>
          <button className="timeframe-selector-trigger" type="button" onClick={() => setTimeframeOpen((current) => !current)}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" />
            </svg>
            <span>{TIMEFRAME_OPTIONS.find((option) => option.value === resolution)?.short || resolution}</span>
            <i>{timeframeOpen ? '⌃' : '⌄'}</i>
          </button>
          {timeframeOpen && <div className="timeframe-selector-dropdown" role="listbox" aria-label="Choisir le timeframe">
            {TIMEFRAME_OPTIONS.map((option) => (
              <button key={option.value} type="button" role="option" aria-selected={resolution === option.value}
                className={resolution === option.value ? 'is-active' : ''} onClick={() => changeResolution(option.value)}>
                <strong>{option.short}</strong><span>{option.label}</span>{resolution === option.value && <b>✓</b>}
              </button>
            ))}
          </div>}
        </div>
      </div>
      <div ref={paneRef} className="tradingview-mobile-pane">
      <div id={containerId.current} className="tradingview-mobile-chart" />
      <div className="chart-trade-overlay">
        {fillMarkers.map((marker) => (
          <div
            key={marker.key}
            ref={(element) => {
              if (element) fillMarkElementsRef.current.set(marker.key, element)
              else fillMarkElementsRef.current.delete(marker.key)
            }}
            title={marker.tooltip}
            className={`tv-fill-mark is-${marker.direction}`}
            style={{ background: marker.color }}
          >
            {marker.text}
          </div>
        ))}
        <div ref={riskDragGuideRef} className="chart-risk-drag-guide">
          <span ref={riskDragGuideLabelRef} />
          <strong ref={riskDragGuidePriceRef} />
        </div>
        {candlesReady && overlayLines.map((line) => {
          const displayedPrice = overlayDragPricesRef.current.get(line.key) ?? line.price
          const potentialPnl = potentialRiskPnl(line, displayedPrice, pair)
          const invalid = overlayInvalidRef.current.has(line.key)
          const color = invalid ? '#ffb020' : OVERLAY_COLORS[line.kind]
          const hasStop = overlayLines.some((item) => item.kind === 'sl' && item.positionId === line.positionId && item.orderId === line.orderId && item.preview === line.preview)
          const hasTakeProfit = overlayLines.some((item) => item.kind === 'tp' && item.positionId === line.positionId && item.orderId === line.orderId && item.preview === line.preview)
          return (
            <div
              key={line.key}
              ref={(element) => {
                if (element) overlayElementRefs.current.set(line.key, element)
                else overlayElementRefs.current.delete(line.key)
              }}
              className={`chart-trade-chip ${line.draggable ? 'is-draggable' : ''} ${invalid ? 'is-invalid' : ''}`}
              style={{ '--line-color': color } as CSSProperties}
              onPointerDown={(event) => {
                if (line.kind === 'pe' || line.kind === 'order') {
                  setExpandedPeKey((current) => current === line.key ? null : line.key)
                }
                beginOverlayDrag(event, line)
              }}
            >
              {line.draggable && line.kind !== 'sl' && line.kind !== 'tp' && <span className="chart-trade-chip__grip">⋮⋮</span>}
              <strong>{line.label}</strong>
              <span className="chart-trade-chip__price">
                {potentialPnl == null
                  ? displayedPrice.toLocaleString('en-US', { maximumFractionDigits: 6 })
                  : `${potentialPnl >= 0 ? '+' : ''}${potentialPnl.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`}
              </span>
              {(line.kind === 'pe' || line.kind === 'order') && expandedPeKey === line.key && (
                <span className="chart-trade-chip__risk-stack">
                  {!hasStop && <button className={line.side === 'long' ? 'is-below is-sl' : 'is-above is-sl'} type="button"
                    onPointerDown={(event) => beginRiskButtonDrag(event, line, 'sl')}
                    onClick={(event) => event.preventDefault()}>SL</button>}
                  {!hasTakeProfit && <button className={line.side === 'long' ? 'is-above is-tp' : 'is-below is-tp'} type="button"
                    onPointerDown={(event) => beginRiskButtonDrag(event, line, 'tp')}
                    onClick={(event) => event.preventDefault()}>TP</button>}
                </span>
              )}
              {(line.kind === 'sl' || line.kind === 'tp' || (!line.preview && line.kind === 'order') || (line.kind === 'pe' && Boolean(line.positionId))) && (
                <button className="chart-trade-chip__close" type="button"
                  aria-label={line.kind === 'pe' ? 'Fermer la position' : 'Supprimer'}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => removeOverlayLine(line)}>×</button>
              )}
            </div>
          )
        })}
      </div>
      </div>
      {!candlesReady && (
        <div className={`chart-candles-loading ${candlesError ? 'is-error' : ''}`}>
          {!candlesError && <i />}
          <span>{candlesError || 'Chargement des bougies…'}</span>
          {candlesError && (
            <button type="button" onClick={() => {
              setCandlesError('')
              widgetRef.current?.activeChart().resetData?.()
            }}>Réessayer</button>
          )}
        </div>
      )}
    </div>
  )
}
