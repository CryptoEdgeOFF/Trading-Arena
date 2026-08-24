import { useEffect, useMemo, useRef, useState } from 'react';
import type { IChartingLibraryWidget, ResolutionString } from '../charting_library/charting_library';
import { ItickDatafeed } from '../charting_library/itickDatafeed';

const TV_LIBRARY_PATH = '/charting_library/';

type AssetClass = 'forex' | 'indices' | 'crypto' | 'stock';

interface Instrument {
  pair: string;
  asset: AssetClass;
  code: string;
  category: 'forex' | 'commodity' | 'index';
  pricescale: number;
  label: string;
}

interface SeriesStatus {
  pair: string;
  asset: string;
  timeframe: number;
  count: number;
  oldestTime: number | null;
  newestTime: number | null;
  ageMs: number;
}

interface ClusterStatus {
  asset: AssetClass;
  connected: boolean;
  authenticated: boolean;
  symbols: string[];
  cooldownRemainingMs: number;
  lastError: string;
  latest: Array<{ symbol: string; price: number; ageMs: number }>;
}

function loadTradingViewScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.TradingView) {
      resolve();
      return;
    }
    const existing = document.querySelector('script[data-tv-loader="true"]');
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('TradingView load error')), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = `${TV_LIBRARY_PATH}charting_library.standalone.js`;
    script.async = true;
    script.dataset.tvLoader = 'true';
    script.addEventListener('load', () => resolve(), { once: true });
    script.addEventListener('error', () => reject(new Error('TradingView load error')), { once: true });
    document.head.appendChild(script);
  });
}

function digitsForPricescale(ps: number): number {
  if (ps >= 100_000) return 5;
  if (ps >= 10_000) return 4;
  if (ps >= 1_000) return 3;
  if (ps >= 100) return 2;
  return 2;
}

const CATEGORY_LABEL: Record<Instrument['category'], string> = {
  forex: 'Forex',
  commodity: 'Commodities',
  index: 'Indices',
};

export default function FeedTest() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetRef = useRef<IChartingLibraryWidget | null>(null);
  const datafeedRef = useRef<ItickDatafeed | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [lastPrice, setLastPrice] = useState<number | null>(null);
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);
  const [feedConfigured, setFeedConfigured] = useState<boolean | null>(null);
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [selectedPair, setSelectedPair] = useState<string>('');
  const [clusters, setClusters] = useState<ClusterStatus[]>([]);
  const [series, setSeries] = useState<SeriesStatus[]>([]);
  const [now, setNow] = useState<number>(Date.now());

  const instrument = useMemo(
    () => instruments.find((i) => i.pair === selectedPair) || instruments[0] || null,
    [instruments, selectedPair],
  );

  // Récupère la liste prod + l'état initial.
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch('/api/itick/status').then((r) => r.json()).catch(() => ({ configured: false })),
      fetch('/api/itick/instruments').then((r) => r.json()).catch(() => ({ instruments: [] })),
    ]).then(([s, ins]) => {
      if (cancelled) return;
      setFeedConfigured(Boolean(s?.configured));
      const list: Instrument[] = Array.isArray(ins?.instruments) ? ins.instruments : [];
      setInstruments(list);
      if (list.length > 0 && !selectedPair) setSelectedPair(list[0].pair);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poll status (clusters + séries) toutes les 3s.
  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      Promise.all([
        fetch('/api/itick/status').then((r) => r.json()).catch(() => null),
        fetch('/api/itick/series').then((r) => r.json()).catch(() => null),
      ]).then(([st, se]) => {
        if (cancelled) return;
        if (st?.feed?.clusters) setClusters(st.feed.clusters as ClusterStatus[]);
        if (Array.isArray(se?.series)) setSeries(se.series as SeriesStatus[]);
        setNow(Date.now());
      });
    };
    tick();
    const id = setInterval(tick, 3000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // (Ré)initialise le widget TradingView à chaque changement d'instrument.
  useEffect(() => {
    if (!instrument) return;
    let cancelled = false;
    let widget: IChartingLibraryWidget | null = null;
    setStatus('loading');
    setErrorMsg('');
    setLastPrice(null);
    setLastUpdate(null);

    const init = async () => {
      try {
        await loadTradingViewScript();
        if (cancelled || !containerRef.current) return;
        const tv = window.TradingView;
        if (!tv) throw new Error('TradingView library introuvable');
        const datafeed = new ItickDatafeed({
          asset: instrument.asset,
          pricescale: instrument.pricescale,
          pair: instrument.pair,
        });
        datafeedRef.current = datafeed;
        widget = new tv.widget({
          symbol: instrument.code,
          interval: '1' as ResolutionString,
          container: containerRef.current,
          datafeed,
          library_path: TV_LIBRARY_PATH,
          locale: 'fr',
          fullscreen: false,
          autosize: true,
          theme: 'dark',
          disabled_features: ['use_localstorage_for_settings', 'header_symbol_search', 'symbol_search_hot_key'],
          enabled_features: ['hide_left_toolbar_by_default'],
        });
        widgetRef.current = widget;
        widget.onChartReady(() => {
          if (!cancelled) setStatus('ready');
        });
      } catch (err) {
        if (!cancelled) {
          setStatus('error');
          setErrorMsg((err as Error).message || 'Initialisation chart impossible');
        }
      }
    };

    init();
    return () => {
      cancelled = true;
      try { widget?.remove(); } catch { /* noop */ }
      widgetRef.current = null;
      datafeedRef.current = null;
    };
  }, [instrument?.pair, instrument?.asset, instrument?.code, instrument?.pricescale]);

  // Live tick via /ws/itick → push dans le datafeed du chart courant.
  useEffect(() => {
    if (feedConfigured === false || !instrument) return;
    let cancelled = false;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    const expectedSymbol = instrument.code;

    const connect = () => {
      if (cancelled) return;
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(`${proto}//${window.location.host}/ws/itick`);
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg?.type !== 'itick:tick') return;
          const tick = msg.data || {};
          const symbol = String(tick.symbol || '').toUpperCase();
          const price = Number(tick.price);
          if (symbol !== expectedSymbol || !Number.isFinite(price) || price <= 0) return;
          const ts = Number(tick.ts) || Date.now();
          setLastPrice(price);
          setLastUpdate(ts);
          datafeedRef.current?.pushTick(symbol, price, ts);
        } catch {
          // ignore
        }
      };
      ws.onclose = () => {
        if (cancelled) return;
        reconnectTimer = setTimeout(connect, 1500);
      };
      ws.onerror = () => {
        try { ws?.close(); } catch { /* noop */ }
      };
    };

    connect();
    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      try { ws?.close(); } catch { /* noop */ }
    };
  }, [feedConfigured, instrument?.code]);

  const ageSeconds = lastUpdate ? Math.max(0, Math.round((Date.now() - lastUpdate) / 1000)) : null;
  const formattedPrice = lastPrice !== null && instrument
    ? lastPrice.toFixed(digitsForPricescale(instrument.pricescale))
    : '—';

  const grouped = useMemo(() => {
    const map = new Map<Instrument['category'], Instrument[]>();
    for (const inst of instruments) {
      if (!map.has(inst.category)) map.set(inst.category, []);
      map.get(inst.category)!.push(inst);
    }
    return [...map.entries()];
  }, [instruments]);

  return (
    <div className="flex min-h-screen flex-col bg-neutral-950 text-neutral-100">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/5 bg-neutral-900/80 px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="text-lg font-semibold">Feed Test — iTick Pro</span>
          <select
            value={selectedPair}
            onChange={(e) => setSelectedPair(e.target.value)}
            className="rounded-md bg-white/10 px-2 py-1 text-sm text-white outline-none hover:bg-white/15"
          >
            {grouped.map(([cat, list]) => (
              <optgroup key={cat} label={CATEGORY_LABEL[cat]}>
                {list.map((inst) => (
                  <option key={inst.pair} value={inst.pair}>
                    {inst.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-4 text-sm">
          {feedConfigured === false && (
            <span className="rounded-md bg-red-500/20 px-2 py-1 text-xs text-red-300">
              ITICK_TOKEN absent
            </span>
          )}
          <div className="font-mono">
            {formattedPrice}
            {ageSeconds !== null && (
              <span className="ml-2 text-xs text-neutral-400">il y a {ageSeconds}s</span>
            )}
          </div>
        </div>
      </header>

      {status === 'error' && errorMsg && (
        <div className="border-b border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-200">
          Erreur : {errorMsg}
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Chart */}
        <div className="relative flex-1">
          <div ref={containerRef} className="absolute inset-0" />
          {status === 'loading' && (
            <div className="absolute inset-0 flex items-center justify-center bg-neutral-950/70 text-sm text-neutral-400">
              Chargement TradingView…
            </div>
          )}
        </div>

        {/* Diagnostic panel */}
        <aside className="hidden w-[340px] shrink-0 overflow-y-auto border-l border-white/5 bg-neutral-900/60 p-4 md:block">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-400">
            Clusters WS upstream
          </h3>
          <div className="space-y-2">
            {clusters.length === 0 && (
              <div className="rounded-md border border-white/5 bg-black/20 p-3 text-xs text-neutral-500">
                Aucun cluster actif
              </div>
            )}
            {clusters.map((c) => (
              <div key={c.asset} className="rounded-md border border-white/5 bg-black/30 p-3 text-xs">
                <div className="mb-1 flex items-center justify-between">
                  <span className="font-mono uppercase tracking-wider text-white">{c.asset}</span>
                  <span className={c.authenticated ? 'text-emerald-400' : c.connected ? 'text-amber-300' : 'text-red-400'}>
                    {c.authenticated ? '● auth' : c.connected ? '○ connecting' : '✕ down'}
                  </span>
                </div>
                <div className="text-neutral-400">syms : {c.symbols.length > 0 ? c.symbols.join(', ') : '—'}</div>
                {c.cooldownRemainingMs > 0 && (
                  <div className="text-amber-300">cooldown : {Math.ceil(c.cooldownRemainingMs / 1000)}s</div>
                )}
                {c.lastError && (
                  <div className="truncate text-red-300" title={c.lastError}>err : {c.lastError}</div>
                )}
              </div>
            ))}
          </div>

          <h3 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wider text-neutral-400">
            Store candles ({series.length} séries)
          </h3>
          <div className="space-y-1 font-mono text-[11px]">
            {series.length === 0 && (
              <div className="rounded-md border border-white/5 bg-black/20 p-3 text-neutral-500">
                Aucune série persistée
              </div>
            )}
            {series.map((s) => {
              const ageSec = s.newestTime
                ? Math.max(0, Math.floor((now / 1000) - s.newestTime))
                : null;
              const stale = ageSec != null && ageSec > 120 && s.timeframe === 1;
              return (
                <div key={`${s.pair}:${s.timeframe}`} className="flex items-center justify-between gap-2 rounded bg-black/20 px-2 py-1">
                  <span className="text-neutral-300">{s.pair}</span>
                  <span className="text-neutral-500">{s.timeframe}m</span>
                  <span className="text-neutral-400">{s.count.toLocaleString()} bars</span>
                  {ageSec != null && (
                    <span className={stale ? 'text-red-300' : 'text-emerald-400'}>
                      {ageSec < 60 ? `${ageSec}s` : `${Math.floor(ageSec / 60)}m`}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </aside>
      </div>
    </div>
  );
}
