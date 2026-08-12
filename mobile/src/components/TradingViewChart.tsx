import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
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
  type Position,
} from '../lib/api'

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
  activeChart: () => {
    setSymbol: (symbol: string, callback?: () => void) => void
    setResolution: (resolution: string, callback?: () => void) => void
    resetData?: () => void
    createOrderLine?: () => Promise<TvOrderLine>
    createPositionLine?: () => Promise<TvPositionLine>
    createShape?: (
      points: Array<{ time: number; price: number }>,
      options: Record<string, unknown>,
    ) => Promise<string | number>
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
}

const OVERLAY_COLORS: Record<OverlayKind, string> = {
  pe: '#409cff',
  order: '#409cff',
  sl: '#ff5066',
  tp: '#38df8a',
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
const SCRIPT_PATH = '/charting_library/charting_library.standalone.js'
let scriptPromise: Promise<void> | null = null

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
    const params = new URLSearchParams({
      pair,
      interval: String(interval),
      to: String(Math.floor(period.to)),
      countBack: String(Math.max(period.countBack || 0, period.firstDataRequest ? 2000 : 4000)),
    })
    if (!period.firstDataRequest && period.from > 0) params.set('from', String(Math.floor(period.from)))
    try {
      const payload = await fetchJsonWithTimeout(
        `${API_BASE_URL}/api/paper/candles?${params.toString()}`,
        period.firstDataRequest ? 12_000 : 20_000,
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
  orderPreview,
  onPairChange,
  onUpdatePositionRisk,
  onUpdateOrderRisk,
  onUpdateOrderLimit,
  onCancelOrder,
  onClosePosition,
  onPreviewEntryChange,
  onPreviewRiskChange,
}: {
  pair: string
  pairs: string[]
  market: Record<string, MarketTicker>
  metadata: PaperMeta['marketMetadata']
  positions: Position[]
  orders: PaperOrder[]
  orderPreview: MobileOrderPreview | null
  onPairChange: (pair: string) => void
  onUpdatePositionRisk: (positionId: string, stopLoss: number | null, takeProfit: number | null) => void
  onUpdateOrderRisk: (orderId: string, stopLoss: number | null, takeProfit: number | null) => void
  onUpdateOrderLimit: (orderId: string, limitPrice: number) => void
  onCancelOrder: (orderId: string) => void
  onClosePosition: (positionId: string) => void
  onPreviewEntryChange: (price: number) => void
  onPreviewRiskChange: (patch: { stopLoss?: number | null; takeProfit?: number | null }) => void
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const containerId = useRef(`tv-mobile-${Math.random().toString(36).slice(2)}`)
  const widgetRef = useRef<TvWidget | null>(null)
  const datafeedRef = useRef<MobileBtfDatafeed | null>(null)
  const managedLinesRef = useRef<ManagedLine[]>([])
  const fallbackLineHandlersRef = useRef(new Map<string | number, () => void>())
  const fallbackLineTimersRef = useRef(new Map<string | number, ReturnType<typeof setTimeout>>())
  const overlayElementRefs = useRef(new Map<string, HTMLDivElement>())
  const overlayDragPricesRef = useRef(new Map<string, number>())
  const overlayInvalidRef = useRef(new Set<string>())
  const [, forceOverlayRender] = useState(0)
  const pairRef = useRef(pair)
  const [chartReady, setChartReady] = useState(false)
  const [candlesReady, setCandlesReady] = useState(false)
  const [candlesError, setCandlesError] = useState('')
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
          'use_localstorage_for_settings',
          'show_symbol_logos',
        ],
        disabled_features: [
          'left_toolbar',
          'header_compare',
          'header_screenshot',
          'go_to_date',
          'popup_hints',
        ],
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
        },
      })
      widgetRef.current = widget
      widget.onChartReady(() => {
        if (disposed) return
        setChartReady(true)
        const chart = widget.activeChart() as unknown as {
          onSymbolChanged?: () => { subscribe: (ctx: unknown, callback: () => void) => void }
          symbol?: () => string
        }
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
      item.id, item.pair, item.side, item.size, item.limitPrice, item.stopLoss, item.takeProfit, item.status,
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
          label: `NOUVEL ORDRE ${orderPreview.side === 'long' ? 'ACHAT' : 'VENTE'}`,
          draggable: true,
          side: orderPreview.side,
          referencePrice: orderPreview.entryPrice,
          preview: true,
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
        })
      }
    }

    for (const order of orders) {
      if (order.pair !== pair || order.status !== 'open' || order.limitPrice == null) continue
      next.push({
        key: `order:pe:${order.id}`,
        kind: 'order',
        price: order.limitPrice,
        label: `LIMITE ${order.side === 'long' ? 'ACHAT' : 'VENTE'}`,
        draggable: true,
        side: order.side,
        referencePrice: order.limitPrice,
        orderId: order.id,
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
        })
      }
    }
    return next
  }, [orderPreview, orders, pair, positions])

  useEffect(() => {
    if (!chartReady || !candlesReady || !pair) return
    const chart = widgetRef.current?.activeChart()
    if (!chart) return

    // Même stratégie que le terminal web : les dessins TradingView restent
    // verrouillés et toute l'interaction tactile passe par nos chips HTML.
    const useTradingPrimitives = false
    let disposed = false
    for (const line of managedLinesRef.current) {
      try { line.remove() } catch { /* déjà supprimée */ }
    }
    managedLinesRef.current = []

    const register = (line: ManagedLine) => {
      if (disposed) {
        try { line.remove() } catch { /* déjà supprimée */ }
        return false
      }
      managedLinesRef.current.push(line)
      return true
    }

    const styleOrderLine = (line: TvOrderLine, color: string) => line
      .setLineColor(color)
      .setBodyBorderColor(color)
      .setBodyBackgroundColor('#111015')
      .setBodyTextColor('#ffffff')
      .setQuantityBackgroundColor(color)
      .setQuantityTextColor('#08080a')

    const stylePositionLine = (line: TvPositionLine, color: string) => line
      .setLineColor(color)
      .setBodyBorderColor(color)
      .setBodyBackgroundColor('#111015')
      .setBodyTextColor('#ffffff')
      .setQuantityBackgroundColor(color)
      .setQuantityTextColor('#08080a')

    const addFallbackLine = async (
      priceValue: number,
      color: string,
      draggable: boolean,
      onPriceChange?: (price: number) => void,
    ) => {
      if (!chart.createShape) return
      try {
        const id = await chart.createShape(
          [{ time: Math.floor(Date.now() / 1000), price: priceValue }],
          {
            shape: 'horizontal_line',
            lock: true,
            disableSelection: true,
            disableSave: true,
            disableUndo: true,
            overrides: {
              linecolor: color,
              linewidth: draggable ? 2 : 1,
              linestyle: draggable ? 2 : 0,
              showPrice: false,
            },
          },
        )
        const fallback = {
          remove: () => {
            fallbackLineHandlersRef.current.delete(id)
            const timer = fallbackLineTimersRef.current.get(id)
            if (timer) clearTimeout(timer)
            fallbackLineTimersRef.current.delete(id)
            try { chart.removeEntity?.(id) } catch { /* déjà supprimée */ }
          },
        }
        if (!register(fallback)) return
        if (draggable && onPriceChange) {
          fallbackLineHandlersRef.current.set(id, () => {
            const nextPrice = chart.getShapeById?.(id).getPoints()[0]?.price
            if (nextPrice != null && Number.isFinite(nextPrice) && nextPrice > 0) onPriceChange(nextPrice)
          })
        }
      } catch {
        // Le reste du terminal continue de fonctionner sans primitive graphique.
      }
    }

    const addRiskLine = async (
      kind: 'sl' | 'tp',
      priceValue: number,
      sizeValue: number,
      position?: Position,
      order?: PaperOrder,
    ) => {
      const commitPrice = (nextPrice: number) => {
        const current = propsRef.current
        if (position) {
          current.onUpdatePositionRisk(
            position.id,
            kind === 'sl' ? nextPrice : position.stopLoss,
            kind === 'tp' ? nextPrice : position.takeProfit,
          )
        } else if (order) {
          current.onUpdateOrderRisk(
            order.id,
            kind === 'sl' ? nextPrice : order.stopLoss ?? null,
            kind === 'tp' ? nextPrice : order.takeProfit ?? null,
          )
        }
      }
      const color = kind === 'sl' ? '#ff5066' : '#38df8a'
      if (!useTradingPrimitives || !chart.createOrderLine) {
        await addFallbackLine(priceValue, color, true, commitPrice)
        return
      }
      try {
        const line = await chart.createOrderLine()
        if (!register(line)) return
        styleOrderLine(line, color)
          .setPrice(priceValue)
          .setText(kind === 'sl' ? 'STOP LOSS' : 'TAKE PROFIT')
          .setQuantity(String(sizeValue))
          .setEditable(true)
          .setCancellable(true)
          .onMove(() => {
            const nextPrice = line.getPrice()
            if (!Number.isFinite(nextPrice) || nextPrice <= 0) return
            commitPrice(nextPrice)
          })
          .onCancel(() => {
            const current = propsRef.current
            if (position) {
              current.onUpdatePositionRisk(
                position.id,
                kind === 'sl' ? null : position.stopLoss,
                kind === 'tp' ? null : position.takeProfit,
              )
            } else if (order) {
              current.onUpdateOrderRisk(
                order.id,
                kind === 'sl' ? null : order.stopLoss ?? null,
                kind === 'tp' ? null : order.takeProfit ?? null,
              )
            }
          })
      } catch {
        await addFallbackLine(priceValue, color, true, commitPrice)
      }
    }

    const addPreviewRiskLine = async (
      kind: 'sl' | 'tp',
      priceValue: number,
      preview: MobileOrderPreview,
    ) => {
      const color = kind === 'sl' ? '#ff5066' : '#38df8a'
      const commitPrice = (nextPrice: number) => {
        propsRef.current.onPreviewRiskChange({
          [kind === 'sl' ? 'stopLoss' : 'takeProfit']: nextPrice,
        })
      }
      if (!useTradingPrimitives || !chart.createOrderLine) {
        await addFallbackLine(priceValue, color, true, commitPrice)
        return
      }
      try {
        const line = await chart.createOrderLine()
        if (!register(line)) return
        styleOrderLine(line, color)
          .setPrice(priceValue)
          .setText(kind === 'sl' ? 'NOUVEAU SL' : 'NOUVEAU TP')
          .setQuantity(String(preview.size))
          .setEditable(true)
          .setCancellable(true)
          .onMove(() => commitPrice(line.getPrice()))
          .onCancel(() => propsRef.current.onPreviewRiskChange({
            [kind === 'sl' ? 'stopLoss' : 'takeProfit']: null,
          }))
      } catch {
        await addFallbackLine(priceValue, color, true, commitPrice)
      }
    }

    const buildLines = async () => {
      const current = propsRef.current
      const visiblePositions = current.positions.filter((item) => item.pair === pair)
      const visibleOrders = current.orders.filter((item) => item.pair === pair && item.status === 'open')
      const preview = current.orderPreview?.pair === pair ? current.orderPreview : null

      if (preview) {
        if (preview.orderType === 'limit') {
          const commitEntryPrice = (nextPrice: number) => propsRef.current.onPreviewEntryChange(nextPrice)
          let previewEntryCreated = false
          if (useTradingPrimitives && chart.createOrderLine) {
            try {
              const line = await chart.createOrderLine()
              if (register(line)) {
                previewEntryCreated = true
                styleOrderLine(line, '#52a8ff')
                  .setPrice(preview.entryPrice)
                  .setText(`NOUVEL ORDRE ${preview.side === 'long' ? 'ACHAT' : 'VENTE'}`)
                  .setQuantity(String(preview.size))
                  .setEditable(true)
                  .setCancellable(false)
                  .onMove(() => commitEntryPrice(line.getPrice()))
              }
            } catch {
              // Une ligne horizontale simple est créée juste après.
            }
          }
          if (!previewEntryCreated) {
            await addFallbackLine(preview.entryPrice, '#52a8ff', true, commitEntryPrice)
          }
        }
        if (preview.stopLoss != null) await addPreviewRiskLine('sl', preview.stopLoss, preview)
        if (preview.takeProfit != null) await addPreviewRiskLine('tp', preview.takeProfit, preview)
      }

      for (const position of visiblePositions) {
        let positionPrimitiveCreated = false
        if (useTradingPrimitives && chart.createPositionLine) {
          try {
            const line = await chart.createPositionLine()
            if (register(line)) {
              positionPrimitiveCreated = true
              const color = position.side === 'long' ? '#38df8a' : '#ff5066'
              stylePositionLine(line, color)
                .setPrice(position.entryPrice)
                .setText(`PE ${position.side === 'long' ? 'LONG' : 'SHORT'}`)
                .setQuantity(String(position.size))
                .setCloseTooltip('Fermer la position')
                .onClose(() => propsRef.current.onClosePosition(position.id))
            }
          } catch {
            // Une ligne horizontale simple est créée juste après.
          }
        }
        if (!positionPrimitiveCreated) {
          await addFallbackLine(position.entryPrice, '#f2f2f5', false)
        }
        if (position.stopLoss != null) {
          await addRiskLine('sl', position.stopLoss, position.stopLossSize || position.size, position)
        }
        if (position.takeProfit != null) {
          await addRiskLine('tp', position.takeProfit, position.takeProfitSize || position.size, position)
        }
      }

      for (const order of visibleOrders) {
        if (order.limitPrice != null) {
          const commitLimitPrice = (nextPrice: number) => {
            propsRef.current.onUpdateOrderLimit(order.id, nextPrice)
          }
          let orderPrimitiveCreated = false
          if (useTradingPrimitives && chart.createOrderLine) {
          try {
            const line = await chart.createOrderLine()
            if (register(line)) {
              orderPrimitiveCreated = true
              const color = order.side === 'long' ? '#38df8a' : '#ff5066'
              styleOrderLine(line, color)
                .setPrice(order.limitPrice)
                .setText(`LIMITE ${order.side === 'long' ? 'ACHAT' : 'VENTE'}`)
                .setQuantity(String(order.size))
                .setEditable(true)
                .setCancellable(true)
                .onMove(() => {
                  const nextPrice = line.getPrice()
                  if (Number.isFinite(nextPrice) && nextPrice > 0) {
                    commitLimitPrice(nextPrice)
                  }
                })
                .onCancel(() => propsRef.current.onCancelOrder(order.id))
            }
          } catch {
            // Une ligne horizontale simple est créée juste après.
          }
          }
          if (!orderPrimitiveCreated) {
            await addFallbackLine(
              order.limitPrice,
              order.side === 'long' ? '#38df8a' : '#ff5066',
              true,
              commitLimitPrice,
            )
          }
        }
        if (order.stopLoss != null) await addRiskLine('sl', order.stopLoss, order.size, undefined, order)
        if (order.takeProfit != null) await addRiskLine('tp', order.takeProfit, order.size, undefined, order)
      }
    }

    void buildLines()
    return () => {
      disposed = true
      for (const line of managedLinesRef.current) {
        try { line.remove() } catch { /* déjà supprimée */ }
      }
      managedLinesRef.current = []
    }
  }, [candlesReady, chartReady, pair, tradingLinesSignature])

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
    const container = wrapRef.current
    if (!container) return null
    const canvases = collectCanvases(container)
    let largest: HTMLCanvasElement | null = null
    let largestArea = 0
    for (const canvas of canvases) {
      const rect = rectInTopViewport(canvas)
      const area = rect.width * rect.height
      if (rect.width > 40 && rect.height > 40 && area > largestArea) {
        largest = canvas
        largestArea = area
      }
    }
    if (!largest) return null
    const containerRect = container.getBoundingClientRect()
    const canvasRect = rectInTopViewport(largest)
    let height = canvasRect.height
    try {
      const paneHeight = widgetRef.current?.activeChart().getPanes?.()[0]?.getHeight()
      if (paneHeight && paneHeight > 40) height = Math.min(height, paneHeight)
    } catch {
      // Hauteur du canvas utilisée.
    }
    const top = canvasRect.top - containerRect.top
    return {
      top,
      bottom: top + height,
      left: canvasRect.left - containerRect.left,
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
    if (!pane || !range) return null
    return pane.top + ((range.top - value) / (range.top - range.bottom)) * pane.height
  }, [getPaneRect, getPriceRange])

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
      const container = wrapRef.current
      if (container) {
        let fallbackIndex = 0
        for (const line of overlayLines) {
          const element = overlayElementRefs.current.get(line.key)
          if (!element) continue
          const currentPrice = overlayDragPricesRef.current.get(line.key) ?? line.price
          const exactY = priceToY(currentPrice)
          const fallbackY = container.clientHeight / 2 + fallbackIndex * 34
          const y = exactY == null || !pane
            ? fallbackY
            : Math.max(pane.top + 4, Math.min(pane.bottom - 4, exactY))
          element.style.left = `${pane ? Math.max(8, pane.left + 8) : 8}px`
          element.style.transform = `translate3d(0, ${y}px, 0) translateY(-50%)`
          element.style.opacity = exactY != null && pane && (exactY < pane.top - 20 || exactY > pane.bottom + 20) ? '.4' : '1'
          fallbackIndex += 1
        }
      }
      frame = requestAnimationFrame(position)
    }
    frame = requestAnimationFrame(position)
    return () => {
      stopped = true
      cancelAnimationFrame(frame)
    }
  }, [getPaneRect, overlayLines, priceToY])

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
      if (line.kind === 'sl') current.onUpdatePositionRisk(line.positionId, value, position?.takeProfit ?? null)
      else if (line.kind === 'tp') current.onUpdatePositionRisk(line.positionId, position?.stopLoss ?? null, value)
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
      const container = wrapRef.current
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
      if (line.kind === 'sl') current.onUpdatePositionRisk(line.positionId, null, position?.takeProfit ?? null)
      else if (line.kind === 'tp') current.onUpdatePositionRisk(line.positionId, position?.stopLoss ?? null, null)
      else if (line.kind === 'pe') current.onClosePosition(line.positionId)
    }
  }, [])

  const addRiskFromEntry = useCallback((line: MobileOverlayLine, kind: 'sl' | 'tp') => {
    const current = propsRef.current
    const reference = line.referencePrice > 0 ? line.referencePrice : line.price
    const offset = Math.max(reference * 0.005, 1e-6)
    const nextPrice = roundedOverlayPrice(
      line.side === 'long'
        ? reference + (kind === 'tp' ? offset : -offset)
        : reference + (kind === 'sl' ? offset : -offset),
    )
    if (line.preview) {
      current.onPreviewRiskChange({ [kind === 'sl' ? 'stopLoss' : 'takeProfit']: nextPrice })
      return
    }
    if (line.orderId) {
      const order = current.orders.find((item) => item.id === line.orderId)
      current.onUpdateOrderRisk(
        line.orderId,
        kind === 'sl' ? nextPrice : order?.stopLoss ?? null,
        kind === 'tp' ? nextPrice : order?.takeProfit ?? null,
      )
      return
    }
    if (line.positionId) {
      const position = current.positions.find((item) => item.id === line.positionId)
      current.onUpdatePositionRisk(
        line.positionId,
        kind === 'sl' ? nextPrice : position?.stopLoss ?? null,
        kind === 'tp' ? nextPrice : position?.takeProfit ?? null,
      )
    }
  }, [roundedOverlayPrice])

  return (
    <div ref={wrapRef} className="tradingview-mobile-wrap">
      <div id={containerId.current} className="tradingview-mobile-chart" />
      <div className="chart-trade-overlay">
        {candlesReady && overlayLines.map((line) => {
          const displayedPrice = overlayDragPricesRef.current.get(line.key) ?? line.price
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
              onPointerDown={(event) => beginOverlayDrag(event, line)}
            >
              {line.draggable && <span className="chart-trade-chip__grip">⋮⋮</span>}
              <strong>{line.label}</strong>
              <span className="chart-trade-chip__price">{displayedPrice.toLocaleString('en-US', { maximumFractionDigits: 6 })}</span>
              {(line.kind === 'pe' || line.kind === 'order') && (
                <span className="chart-trade-chip__risk">
                  {!hasStop && <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={() => addRiskFromEntry(line, 'sl')}>+ SL</button>}
                  {!hasTakeProfit && <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={() => addRiskFromEntry(line, 'tp')}>+ TP</button>}
                </span>
              )}
              {(line.kind === 'sl' || line.kind === 'tp' || (!line.preview && line.kind === 'order')) && (
                <button className="chart-trade-chip__close" type="button"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => removeOverlayLine(line)}>×</button>
              )}
            </div>
          )
        })}
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
      {candlesReady && (
        <div className="chart-lines-legend">
          <span className="entry">PE</span><span className="profit">TP</span><span className="loss">SL</span>
          <small>Maintiens puis déplace TP/SL</small>
        </div>
      )}
    </div>
  )
}
