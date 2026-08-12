import { useEffect, useRef } from 'react'
import { API_BASE_URL, type MarketTicker, type PaperMeta } from '../lib/api'

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
  }
  remove: () => void
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

  constructor(pairs: string[], metadata: PaperMeta['marketMetadata'], market: Record<string, MarketTicker>) {
    this.pairs = pairs
    this.metadata = metadata
    this.market = market
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
      countBack: String(Math.max(period.countBack || 0, period.firstDataRequest ? 1200 : 2500)),
    })
    if (!period.firstDataRequest && period.from > 0) params.set('from', String(Math.floor(period.from)))
    try {
      const response = await fetch(`${API_BASE_URL}/api/paper/candles?${params.toString()}`)
      const payload = await response.json()
      if (!response.ok) throw new Error(payload?.error || `Historique indisponible (${response.status})`)
      const bars = (Array.isArray(payload.candles) ? payload.candles : [])
        .filter((item: TvBar) => Number.isFinite(item.time) && Number.isFinite(item.close))
        .map((item: TvBar) => ({ ...item, time: item.time * 1000 }))
        .sort((a: TvBar, b: TvBar) => a.time - b.time)
      if (bars.length) this.latestBars.set(`${pair}@${interval}`, bars[bars.length - 1])
      onResult(bars, { noData: bars.length === 0 })
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Historique indisponible')
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
  onPairChange,
}: {
  pair: string
  pairs: string[]
  market: Record<string, MarketTicker>
  metadata: PaperMeta['marketMetadata']
  onPairChange: (pair: string) => void
}) {
  const containerId = useRef(`tv-mobile-${Math.random().toString(36).slice(2)}`)
  const widgetRef = useRef<TvWidget | null>(null)
  const datafeedRef = useRef<MobileBtfDatafeed | null>(null)
  const pairRef = useRef(pair)
  const propsRef = useRef({ pair, pairs, market, metadata, onPairChange })
  propsRef.current = { pair, pairs, market, metadata, onPairChange }

  useEffect(() => {
    let disposed = false
    const initial = propsRef.current
    const datafeed = new MobileBtfDatafeed(initial.pairs, initial.metadata, initial.market)
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
          'side_toolbar_in_fullscreen_mode',
        ],
        disabled_features: [
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
        const chart = widget.activeChart() as unknown as {
          onSymbolChanged?: () => { subscribe: (ctx: unknown, callback: () => void) => void }
          symbol?: () => string
        }
        chart.onSymbolChanged?.().subscribe(null, () => {
          const next = chart.symbol?.()
          const current = propsRef.current
          if (next && next !== pairRef.current && current.pairs.includes(next)) current.onPairChange(next)
        })
      })
    })
    return () => {
      disposed = true
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
    pairRef.current = pair
    widgetRef.current?.activeChart().setSymbol(pair)
  }, [pair])

  useEffect(() => {
    const ticker = market[pair]
    if (ticker?.markPrice > 0) datafeedRef.current?.pushTick(pair, ticker.markPrice, ticker.updatedAt || Date.now())
  }, [market, pair])

  return <div id={containerId.current} className="tradingview-mobile-chart" />
}
