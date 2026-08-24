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

/**
 * Datafeed minimal branché sur le feed iTick (via le proxy backend
 * /api/itick). Utilisé uniquement par la page /feed-test pour valider
 * le feed alternatif sans toucher au pipeline competition.
 */
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
  '1D': 1440,
  D: 1440,
};

const SUPPORTED_RESOLUTIONS = ['1', '5', '15', '30', '60', '1D'] as ResolutionString[];

interface Subscription {
  code: string;
  intervalMin: number;
  onTick: SubscribeBarsCallback;
  lastBar: Bar | null;
}

export type ItickAsset = 'forex' | 'indices' | 'crypto' | 'stock';

export interface ItickDatafeedConfig {
  asset: ItickAsset;
  pricescale: number;
  /** Si défini, le datafeed lit le store local Postgres `itick_candles`
   *  via `?pair=...` (avec fallback OANDA automatique). Sinon il appelle
   *  iTick REST direct via `?code=...&asset=...`. */
  pair?: string;
}

function buildSymbolInfo(code: string, config: ItickDatafeedConfig): LibrarySymbolInfo {
  return {
    name: code,
    description: code,
    ticker: code,
    type: config.asset === 'forex' ? 'forex' : (config.asset === 'indices' ? 'index' : config.asset),
    session: '24x7',
    timezone: 'Etc/UTC',
    exchange: 'iTick',
    listed_exchange: 'iTick',
    format: 'price',
    pricescale: config.pricescale,
    minmov: 1,
    has_intraday: true,
    has_daily: true,
    has_weekly_and_monthly: false,
    supported_resolutions: SUPPORTED_RESOLUTIONS,
    volume_precision: 2,
    data_status: 'streaming',
  };
}

export class ItickDatafeed implements IBasicDataFeed {
  private config: ItickDatafeedConfig;
  private subscriptions = new Map<string, Subscription>();
  private lastBarByKey = new Map<string, Bar>();

  constructor(config: ItickDatafeedConfig) {
    this.config = config;
  }

  onReady(callback: (config: DatafeedConfiguration) => void): void {
    setTimeout(() => {
      callback({
        supported_resolutions: SUPPORTED_RESOLUTIONS,
        supports_marks: false,
        supports_timescale_marks: false,
        supports_time: true,
        exchanges: [{ value: 'iTick', name: 'iTick', desc: 'iTick forex feed' }],
        symbols_types: [{ name: 'Forex', value: 'forex' }],
      });
    }, 0);
  }

  searchSymbols(
    _userInput: string,
    _exchange: string,
    _symbolType: string,
    onResult: SearchSymbolsCallback,
  ): void {
    const matches: SearchSymbolResultItem[] = [];
    onResult(matches);
  }

  resolveSymbol(symbolName: string, onResolve: ResolveCallback): void {
    setTimeout(() => onResolve(buildSymbolInfo(symbolName, this.config)), 0);
  }

  async getBars(
    symbolInfo: LibrarySymbolInfo,
    resolution: ResolutionString,
    periodParams: PeriodParams,
    onResult: HistoryCallback,
    onError: (reason: string) => void,
  ): Promise<void> {
    const code = symbolInfo.ticker || symbolInfo.name;
    const intervalMin = RESOLUTION_TO_INTERVAL[String(resolution)] ?? 1;
    const { to, firstDataRequest, countBack } = periodParams;
    // iTick free plan = limit 1000. On en demande 500 par fenêtre.
    const limit = Math.min(1000, Math.max(countBack || 0, firstDataRequest ? 500 : 200));

    try {
      const params = new URLSearchParams({
        interval: String(intervalMin),
        limit: String(limit),
      });
      if (this.config.pair) {
        params.set('pair', this.config.pair);
      } else {
        params.set('code', code);
        params.set('asset', this.config.asset);
      }
      if (Number.isFinite(to) && to > 0) params.set('to', String(Math.floor(to)));

      const response = await fetch(`/api/itick/candles?${params.toString()}`);
      if (!response.ok) {
        onError(`Historique iTick indisponible (${response.status})`);
        return;
      }
      const payload = (await response.json()) as { candles?: ApiCandle[]; error?: string };
      if (payload.error) {
        onError(payload.error);
        return;
      }
      const bars: Bar[] = (payload.candles || [])
        .map((c) => ({
          time: c.time * 1000,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume,
        }))
        .sort((a, b) => a.time - b.time);

      if (bars.length === 0) {
        onResult([], { noData: true });
        return;
      }

      if (firstDataRequest) {
        const key = `${code}@${intervalMin}`;
        this.lastBarByKey.set(key, bars[bars.length - 1]);
        for (const sub of this.subscriptions.values()) {
          if (sub.code === code && sub.intervalMin === intervalMin) {
            sub.lastBar = bars[bars.length - 1];
          }
        }
      }

      onResult(bars, { noData: bars.length < limit });
    } catch (error) {
      onError(error instanceof Error ? error.message : 'iTick error');
    }
  }

  subscribeBars(
    symbolInfo: LibrarySymbolInfo,
    resolution: ResolutionString,
    onTick: SubscribeBarsCallback,
    listenerGuid: string,
  ): void {
    const code = symbolInfo.ticker || symbolInfo.name;
    const intervalMin = RESOLUTION_TO_INTERVAL[String(resolution)] ?? 1;
    const key = `${code}@${intervalMin}`;
    this.subscriptions.set(listenerGuid, {
      code,
      intervalMin,
      onTick,
      lastBar: this.lastBarByKey.get(key) || null,
    });
  }

  unsubscribeBars(listenerGuid: string): void {
    this.subscriptions.delete(listenerGuid);
  }

  pushTick(code: string, price: number, timestampMs: number = Date.now()): void {
    if (!Number.isFinite(price) || price <= 0) return;
    for (const sub of this.subscriptions.values()) {
      if (sub.code !== code) continue;
      const intervalMs = sub.intervalMin * 60 * 1000;
      const bucket = Math.floor(timestampMs / intervalMs) * intervalMs;
      const last = sub.lastBar;
      let next: Bar;
      if (!last || last.time !== bucket) {
        const open = last?.close ?? price;
        next = { time: bucket, open, high: Math.max(open, price), low: Math.min(open, price), close: price };
      } else {
        next = { ...last, high: Math.max(last.high, price), low: Math.min(last.low, price), close: price };
      }
      sub.lastBar = next;
      this.lastBarByKey.set(`${sub.code}@${sub.intervalMin}`, next);
      sub.onTick(next);
    }
  }
}
