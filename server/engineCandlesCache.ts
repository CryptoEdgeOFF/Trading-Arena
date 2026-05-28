import * as kraken from './kraken.js';
import * as cryptoCandles from './cryptoCandles.js';
import type { OhlcCandle, OhlcQueryOptions } from './kraken.js';

/**
 * In-memory candle cache for crypto pairs whose history is fetched from
 * Binance/Kraken Futures via paginated REST. The first cold fetch costs
 * ~7s for 40k M1 bars (paginated 1500 by 1500); subsequent reads are
 * served straight from RAM. Live ticks coming through
 * `paperEngine.applyTicker` keep the latest bucket up to date so the
 * cached series stays current without ever hitting upstream again.
 */

type Source = 'binance' | 'kraken';

interface CachedSeries {
  candles: OhlcCandle[]; // sorted ascending
  fetchedAt: number;
  source: Source;
}

const SUPPORTED_INTERVALS = [1, 5, 15, 30, 60, 240, 1440] as const;
const MAX_CACHE_BARS = 40_000;
/**
 * Nombre max de bougies-pont créées d'un coup pour combler un gap de ticks.
 * Au-delà (ex: serveur idle plusieurs heures), on n'ouvre que la bougie
 * courante — un backfill REST rétablira l'historique complet.
 */
const MAX_BRIDGE_BARS = 2_000;
/**
 * Fast path : nombre de bars retourné immédiatement au premier hit
 * (avant que le background fetch ne complète jusqu'à `MAX_CACHE_BARS`).
 * 1500 = 1 seul call Binance/Hyperliquid (~300 ms) — couvre largement le
 * premier rendu TradingView (typiquement 300-500 bars demandés).
 */
const FAST_PATH_BARS = 1500;
/** After this delay a background refresh is fired on the next read. */
const STALE_REFRESH_MS = 10 * 60 * 1000;

const cache = new Map<string, CachedSeries>();
const inflightFetches = new Map<string, Promise<CachedSeries>>();
/** Background fills en cours pour compléter une série jusqu'à MAX_CACHE_BARS. */
const inflightBackfills = new Map<string, Promise<void>>();

function key(pair: string, interval: number): string {
  return `${pair}:${interval}`;
}

async function fetchFromUpstream(
  pair: string,
  interval: number,
  source: Source,
  countBack: number,
): Promise<OhlcCandle[]> {
  if (source === 'binance') {
    // Pairs crypto : chaîne de fallback Binance → iTick → Bybit gérée de
    // façon centralisée dans cryptoCandles. Évite que le chart se vide
    // quand Binance Futures est géo-bloqué (451) sur l'IP du provider.
    const { candles } = await cryptoCandles.getCryptoOhlc(pair, interval, { countBack });
    return candles;
  }
  return kraken.getOhlcCandles(pair, interval);
}

/**
 * Cold start : un seul round-trip Binance pour les ~1500 dernières bars
 * (≈300 ms) afin que TradingView puisse rendre le premier viewport sans
 * attendre la pagination 40k. Si l'utilisateur scrolle vers le passé, le
 * background fill (déclenché juste après) aura déjà rempli le cache.
 */
function startFetch(
  pair: string,
  interval: number,
  source: Source,
  fastPath = true,
): Promise<CachedSeries> {
  const k = key(pair, interval);
  const target = fastPath ? FAST_PATH_BARS : MAX_CACHE_BARS;
  const pending = (async () => {
    try {
      const candles = await fetchFromUpstream(pair, interval, source, target);
      candles.sort((a, b) => a.time - b.time);
      const series: CachedSeries = {
        candles,
        fetchedAt: Date.now(),
        source,
      };
      cache.set(k, series);
      // Si on est sur le fast path, on lance un background fill pour
      // étendre la série jusqu'à MAX_CACHE_BARS (les futurs scrolls
      // historiques seront servis depuis le cache). Best effort.
      if (fastPath && candles.length >= FAST_PATH_BARS - 50) {
        scheduleBackgroundFill(pair, interval, source);
      }
      return series;
    } finally {
      // Always release the in-flight slot, success or failure, so the
      // next call can retry instead of awaiting a settled promise we
      // already consumed.
      inflightFetches.delete(k);
    }
  })();
  inflightFetches.set(k, pending);
  return pending;
}

function scheduleBackgroundFill(pair: string, interval: number, source: Source): Promise<void> {
  const k = key(pair, interval);
  const existing = inflightBackfills.get(k);
  if (existing) return existing;
  const p = (async () => {
    try {
      const full = await fetchFromUpstream(pair, interval, source, MAX_CACHE_BARS);
      full.sort((a, b) => a.time - b.time);
      const cached = cache.get(k);
      // Le live tick a pu déjà avancer la dernière bar pendant qu'on
      // paginait → on merge sur `time` en gardant la version la plus
      // récente (live > REST historique).
      const merged = new Map<number, OhlcCandle>();
      for (const c of full) merged.set(c.time, c);
      if (cached) {
        const lastTime = cached.candles[cached.candles.length - 1]?.time;
        for (const c of cached.candles) {
          if (c.time === lastTime) merged.set(c.time, c);
        }
      }
      const candles = [...merged.values()].sort((a, b) => a.time - b.time);
      cache.set(k, { candles, fetchedAt: Date.now(), source });
    } catch (err) {
      console.warn(
        `[candles cache] background fill ${pair} ${interval}m failed:`,
        (err as Error).message,
      );
    } finally {
      inflightBackfills.delete(k);
    }
  })();
  inflightBackfills.set(k, p);
  return p;
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
 * Returns cached candles, fetching from upstream on first miss. Concurrent
 * callers for the same (pair, interval) await a single in-flight fetch
 * to avoid hammering Binance during a chart-open thundering herd.
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
    if (!pending) pending = startFetch(pair, interval, source);
    series = await pending;
  } else if (Date.now() - series.fetchedAt > STALE_REFRESH_MS) {
    if (!inflightFetches.has(k)) {
      // Background refresh — never propagate failures to callers.
      startFetch(pair, interval, source).catch((err) => {
        console.warn(
          `[candles cache] refresh ${pair} ${interval}m failed:`,
          (err as Error).message,
        );
      });
    }
  }

  // Si l'utilisateur scrolle vers le passé pendant que le background fill
  // est encore en cours et qu'on n'a que le fast-path en RAM, on attend
  // le fill plutôt que de retourner un trou (TradingView pense alors qu'il
  // n'y a plus d'historique et arrête le scroll).
  const oldestCached = series.candles[0]?.time ?? Number.POSITIVE_INFINITY;
  const wantsOlder = (opts.from != null && opts.from > 0 && opts.from < oldestCached)
    || (opts.countBack != null && opts.countBack > series.candles.length);
  if (wantsOlder) {
    const fill = inflightBackfills.get(k);
    if (fill) {
      await fill;
      series = cache.get(k) ?? series;
    } else if (series.candles.length < MAX_CACHE_BARS) {
      // Fast path déjà servi mais background fill jamais lancé (ex: cache
      // hydraté par un autre code path) → on déclenche maintenant.
      await scheduleBackgroundFill(pair, interval, source);
      series = cache.get(k) ?? series;
    }
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

    if (!last) {
      series.candles.push({ time: bucket, open: price, high: price, low: price, close: price });
    } else if (bucket > last.time) {
      // Comble les buckets sautés entre la dernière bougie connue et le
      // bucket courant avec des bougies plates (open=close=dernier close).
      // Sans ça, un hoquet du flux (gap WS, transition de failover) laisse
      // un trou permanent dans la série jusqu'au prochain backfill REST.
      const bridgeClose = last.close;
      for (
        let t = last.time + intervalSec;
        t < bucket && (bucket - t) / intervalSec <= MAX_BRIDGE_BARS;
        t += intervalSec
      ) {
        series.candles.push({ time: t, open: bridgeClose, high: bridgeClose, low: bridgeClose, close: bridgeClose });
      }
      // Bougie courante : ouvre sur le dernier close pour la continuité.
      series.candles.push({
        time: bucket,
        open: bridgeClose,
        high: Math.max(bridgeClose, price),
        low: Math.min(bridgeClose, price),
        close: price,
      });
      while (series.candles.length > MAX_CACHE_BARS) series.candles.shift();
    } else if (bucket === last.time) {
      last.high = Math.max(last.high, price);
      last.low = Math.min(last.low, price);
      last.close = price;
    }
  }
}

/**
 * Fire-and-forget prewarm so the most-watched pairs are already cached
 * by the time a user opens the chart after a Railway redeploy. All
 * failures are swallowed — prewarm is best-effort.
 */
export function prewarm(
  targets: Array<{ pair: string; source: Source }>,
  intervals: number[] = [1],
): void {
  for (const { pair, source } of targets) {
    for (const interval of intervals) {
      const k = key(pair, interval);
      if (cache.has(k) || inflightFetches.has(k)) continue;
      startFetch(pair, interval, source).catch((err) => {
        console.warn(
          `[candles cache] prewarm ${pair} ${interval}m failed:`,
          (err as Error).message,
        );
      });
    }
  }
}

export function hasCached(pair: string, interval: number): boolean {
  return cache.has(key(pair, interval));
}
