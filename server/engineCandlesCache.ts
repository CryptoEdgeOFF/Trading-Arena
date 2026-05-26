import * as binance from './binance.js';
import * as kraken from './kraken.js';
import type { OhlcCandle, OhlcQueryOptions } from './kraken.js';

/**
 * In-memory candle cache for crypto pairs whose history is fetched from
 * Binance/Kraken Futures via paginated REST. The first cold fetch costs
 * ~7s (27 paginated requests for 40k M1 bars); subsequent reads are
 * instant. Live ticks coming through `paperEngine.applyTicker` keep the
 * latest bucket up to date so the chart stays in sync without
 * re-fetching upstream.
 */

type Source = 'binance' | 'kraken';

interface CachedSeries {
  candles: OhlcCandle[]; // sorted ascending
  fetchedAt: number;
  source: Source;
}

const SUPPORTED_INTERVALS = [1, 5, 15, 30, 60, 240, 1440] as const;
const MAX_CACHE_BARS = 40_000;
/** After this delay we kick a background refresh on next read. */
const STALE_REFRESH_MS = 10 * 60 * 1000;

const cache = new Map<string, CachedSeries>();
const inflightFetches = new Map<string, Promise<CachedSeries>>();

function key(pair: string, interval: number): string {
  return `${pair}:${interval}`;
}

async function fetchFromUpstream(
  pair: string,
  interval: number,
  source: Source,
): Promise<OhlcCandle[]> {
  if (source === 'binance') {
    return binance.getOhlcCandles(pair, interval, { countBack: MAX_CACHE_BARS });
  }
  return kraken.getOhlcCandles(pair, interval);
}

async function fetchAndStore(
  pair: string,
  interval: number,
  source: Source,
): Promise<CachedSeries> {
  const candles = await fetchFromUpstream(pair, interval, source);
  candles.sort((a, b) => a.time - b.time);
  const series: CachedSeries = {
    candles,
    fetchedAt: Date.now(),
    source,
  };
  cache.set(key(pair, interval), series);
  return series;
}

function filterByOpts(candles: OhlcCandle[], opts: OhlcQueryOptions): OhlcCandle[] {
  const toSec = opts.to && opts.to > 0 ? Math.floor(opts.to) : Number.POSITIVE_INFINITY;
  const fromSec = opts.from && opts.from > 0 ? Math.floor(opts.from) : null;

  let result = candles;
  if (toSec !== Number.POSITIVE_INFINITY) {
    result = result.filter((candle) => candle.time < toSec);
  }
  if (fromSec != null) {
    result = result.filter((candle) => candle.time >= fromSec);
  }
  if (opts.countBack && opts.countBack > 0 && result.length > opts.countBack) {
    result = result.slice(result.length - Math.floor(opts.countBack));
  }
  return result;
}

/**
 * Returns cached candles, fetching from upstream on first miss. The
 * upstream fetch is deduped via `inflightFetches` so a thundering herd
 * of TradingView requests at chart open only triggers one Binance pull.
 */
export async function getCachedCandles(
  pair: string,
  interval: number,
  source: Source,
  opts: OhlcQueryOptions = {},
): Promise<OhlcCandle[]> {
  const k = key(pair, interval);
  let series = cache.get(k);

  if (!series) {
    let pending = inflightFetches.get(k);
    if (!pending) {
      pending = fetchAndStore(pair, interval, source);
      inflightFetches.set(k, pending);
      pending.finally(() => {
        inflightFetches.delete(k);
      });
    }
    series = await pending;
  } else if (Date.now() - series.fetchedAt > STALE_REFRESH_MS) {
    fetchAndStore(pair, interval, source).catch((err) => {
      console.warn(
        `[candles cache] refresh ${pair} ${interval}m failed:`,
        (err as Error).message,
      );
    });
  }

  return filterByOpts(series.candles, opts);
}

/**
 * Apply a tick to every cached interval for `pair`. Either appends a new
 * bucket or updates the running high/low/close. Called on every paper
 * engine tick so the cached series stays current to the millisecond.
 */
export function updateLastCandleFromTick(pair: string, price: number, tsMs: number): void {
  if (!Number.isFinite(price) || price <= 0) return;
  const tsSec = Math.floor(tsMs / 1000);
  if (!Number.isFinite(tsSec) || tsSec <= 0) return;

  for (const interval of SUPPORTED_INTERVALS) {
    const series = cache.get(key(pair, interval));
    if (!series) continue;
    const intervalSec = interval * 60;
    const bucket = Math.floor(tsSec / intervalSec) * intervalSec;
    const last = series.candles.length > 0 ? series.candles[series.candles.length - 1] : null;

    if (!last || bucket > last.time) {
      series.candles.push({
        time: bucket,
        open: price,
        high: price,
        low: price,
        close: price,
      });
      if (series.candles.length > MAX_CACHE_BARS) series.candles.shift();
    } else if (bucket === last.time) {
      last.high = Math.max(last.high, price);
      last.low = Math.min(last.low, price);
      last.close = price;
    }
  }
}

/**
 * Fire-and-forget prewarm so the most-watched pairs are already cached
 * by the time a user opens the chart after a Railway redeploy.
 */
export function prewarm(targets: Array<{ pair: string; source: Source }>, intervals: number[] = [1]): void {
  for (const { pair, source } of targets) {
    for (const interval of intervals) {
      const k = key(pair, interval);
      if (cache.has(k) || inflightFetches.has(k)) continue;
      const pending = fetchAndStore(pair, interval, source).catch((err) => {
        console.warn(
          `[candles cache] prewarm ${pair} ${interval}m failed:`,
          (err as Error).message,
        );
        throw err;
      });
      inflightFetches.set(k, pending as Promise<CachedSeries>);
      pending.finally(() => inflightFetches.delete(k));
    }
  }
}

export function hasCached(pair: string, interval: number): boolean {
  return cache.has(key(pair, interval));
}
