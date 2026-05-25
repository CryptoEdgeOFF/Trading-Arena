import type {
  Bar,
  DatafeedConfiguration,
  HistoryCallback,
  IBasicDataFeed,
  LibrarySymbolInfo,
  PeriodParams,
  ResolutionString,
  ResolveCallback,
  SearchSymbolResultItem,
  SearchSymbolsCallback,
  SubscribeBarsCallback,
} from './charting_library';

export interface BtfDatafeedConfig {
  pairs: string[];
  description?: Record<string, string>;
  marketDataSource?: 'kraken' | 'binance';
}

interface ApiCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

const RESOLUTION_TO_INTERVAL: Record<string, number> = {
  '1': 1,
  '5': 5,
  '15': 15,
  '30': 30,
  '60': 60,
  '240': 240,
  '1D': 1440,
  D: 1440,
};

const SUPPORTED_RESOLUTIONS = ['1', '5', '15', '30', '60', '240', '1D'] as ResolutionString[];

interface Subscription {
  pair: string;
  intervalMin: number;
  resolution: ResolutionString;
  onTick: SubscribeBarsCallback;
  lastBar: Bar | null;
}

function buildSymbolInfo(pair: string, description: string): LibrarySymbolInfo {
  return {
    name: pair,
    description,
    ticker: pair,
    type: pair.includes('USD') && !pair.includes('/USD') ? 'forex' : 'crypto',
    session: '24x7',
    timezone: 'Etc/UTC',
    exchange: 'BTF',
    listed_exchange: 'BTF',
    format: 'price',
    pricescale: 100,
    minmov: 1,
    has_intraday: true,
    has_daily: true,
    has_weekly_and_monthly: false,
    supported_resolutions: SUPPORTED_RESOLUTIONS,
    volume_precision: 2,
    data_status: 'streaming',
  };
}

function inferPriceScale(samplePrice: number): number {
  if (!Number.isFinite(samplePrice) || samplePrice <= 0) return 100;
  if (samplePrice >= 1000) return 100;
  if (samplePrice >= 10) return 1000;
  if (samplePrice >= 1) return 10000;
  if (samplePrice >= 0.01) return 100000;
  return 10000000;
}

export class BtfDatafeed implements IBasicDataFeed {
  private config: BtfDatafeedConfig;
  private subscriptions = new Map<string, Subscription>();
  private symbolCache = new Map<string, LibrarySymbolInfo>();

  constructor(config: BtfDatafeedConfig) {
    this.config = config;
  }

  updatePairs(pairs: string[]) {
    this.config = { ...this.config, pairs };
  }

  onReady(callback: (config: DatafeedConfiguration) => void): void {
    setTimeout(() => {
      callback({
        supported_resolutions: SUPPORTED_RESOLUTIONS,
        supports_marks: false,
        supports_timescale_marks: false,
        supports_time: true,
        exchanges: [{ value: 'BTF', name: 'BTF Arena', desc: 'BTF Arena' }],
        symbols_types: [
          { name: 'Crypto', value: 'crypto' },
          { name: 'Forex', value: 'forex' },
          { name: 'Indices', value: 'index' },
          { name: 'Stocks', value: 'stock' },
          { name: 'Commodities', value: 'commodity' },
        ],
      });
    }, 0);
  }

  searchSymbols(
    userInput: string,
    _exchange: string,
    _symbolType: string,
    onResult: SearchSymbolsCallback,
  ): void {
    const query = userInput.replace(/\s+/g, '').toUpperCase();
    const description = this.config.description ?? {};
    const matches: SearchSymbolResultItem[] = this.config.pairs
      .filter((pair) => pair.replace('/', '').toUpperCase().includes(query))
      .slice(0, 30)
      .map((pair) => ({
        symbol: pair,
        full_name: pair,
        description: description[pair] ?? pair,
        exchange: 'BTF',
        ticker: pair,
        type: pair.includes('/USD') ? 'crypto' : 'forex',
      }));
    onResult(matches);
  }

  resolveSymbol(
    symbolName: string,
    onResolve: ResolveCallback,
    onError: (reason: string) => void,
  ): void {
    const description = this.config.description?.[symbolName] ?? symbolName;
    const cached = this.symbolCache.get(symbolName);
    if (cached) {
      setTimeout(() => onResolve(cached), 0);
      return;
    }

    const info = buildSymbolInfo(symbolName, description);
    this.symbolCache.set(symbolName, info);
    setTimeout(() => onResolve(info), 0);
    void onError;
  }

  async getBars(
    symbolInfo: LibrarySymbolInfo,
    resolution: ResolutionString,
    periodParams: PeriodParams,
    onResult: HistoryCallback,
    onError: (reason: string) => void,
  ): Promise<void> {
    const pair = symbolInfo.ticker || symbolInfo.name;
    const intervalMin = RESOLUTION_TO_INTERVAL[String(resolution)] ?? 1;
    const { from, to, firstDataRequest } = periodParams;

    try {
      const response = await fetch(`/api/paper/candles?pair=${encodeURIComponent(pair)}&interval=${intervalMin}`);
      if (!response.ok) {
        onResult([], { noData: true });
        return;
      }
      const payload = (await response.json()) as { candles?: ApiCandle[] };
      const raw = Array.isArray(payload.candles) ? payload.candles : [];

      const bars: Bar[] = raw
        .filter((candle) =>
          Number.isFinite(candle.time) &&
          Number.isFinite(candle.open) &&
          Number.isFinite(candle.high) &&
          Number.isFinite(candle.low) &&
          Number.isFinite(candle.close),
        )
        .map((candle) => ({
          time: candle.time * 1000,
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
          volume: candle.volume,
        }))
        .filter((bar) => {
          const timeSec = bar.time / 1000;
          return timeSec >= from && timeSec < to;
        })
        .sort((a, b) => a.time - b.time);

      if (bars.length === 0) {
        onResult([], { noData: true });
        return;
      }

      if (firstDataRequest && bars.length > 0) {
        const sampleClose = bars[bars.length - 1].close;
        const cached = this.symbolCache.get(pair);
        if (cached) {
          const next: LibrarySymbolInfo = {
            ...cached,
            pricescale: inferPriceScale(sampleClose),
          };
          this.symbolCache.set(pair, next);
        }
      }

      onResult(bars, { noData: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Historique indisponible';
      onError(message);
    }
  }

  subscribeBars(
    symbolInfo: LibrarySymbolInfo,
    resolution: ResolutionString,
    onTick: SubscribeBarsCallback,
    listenerGuid: string,
    _onResetCacheNeededCallback: () => void,
  ): void {
    const pair = symbolInfo.ticker || symbolInfo.name;
    const intervalMin = RESOLUTION_TO_INTERVAL[String(resolution)] ?? 1;
    this.subscriptions.set(listenerGuid, {
      pair,
      intervalMin,
      resolution,
      onTick,
      lastBar: null,
    });
  }

  unsubscribeBars(listenerGuid: string): void {
    this.subscriptions.delete(listenerGuid);
  }

  pushTick(pair: string, price: number, timestampMs: number = Date.now()): void {
    if (!Number.isFinite(price) || price <= 0) return;
    for (const sub of this.subscriptions.values()) {
      if (sub.pair !== pair) continue;
      const intervalMs = sub.intervalMin * 60 * 1000;
      const bucket = Math.floor(timestampMs / intervalMs) * intervalMs;
      const last = sub.lastBar;
      if (!last || last.time !== bucket) {
        const open = last?.close ?? price;
        const next: Bar = {
          time: bucket,
          open,
          high: Math.max(open, price),
          low: Math.min(open, price),
          close: price,
        };
        sub.lastBar = next;
        sub.onTick(next);
      } else {
        const next: Bar = {
          ...last,
          high: Math.max(last.high, price),
          low: Math.min(last.low, price),
          close: price,
        };
        sub.lastBar = next;
        sub.onTick(next);
      }
    }
  }

  primeLastBar(pair: string, bar: Bar): void {
    for (const sub of this.subscriptions.values()) {
      if (sub.pair === pair) sub.lastBar = bar;
    }
  }
}
