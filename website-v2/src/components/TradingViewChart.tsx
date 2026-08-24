import { useEffect, useMemo, useRef } from 'react';

interface LegacyTradingViewWindow {
  TradingView?: {
    widget: new (config: Record<string, unknown>) => unknown;
  };
}

function toTradingViewSymbol(pair: string): string {
  const base = pair.split('/')[0]?.toUpperCase();
  return base ? `KRAKEN:${base}USD` : 'KRAKEN:BTCUSD';
}

let tradingViewLoader: Promise<void> | null = null;

function loadTradingViewScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  const legacyWindow = window as unknown as LegacyTradingViewWindow;
  if (legacyWindow.TradingView) return Promise.resolve();
  if (tradingViewLoader) return tradingViewLoader;

  tradingViewLoader = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/tv.js';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Impossible de charger TradingView'));
    document.head.appendChild(script);
  });

  return tradingViewLoader;
}

export default function TradingViewChart({
  pair,
  interval = '1',
  tradingViewSymbol,
}: {
  pair: string;
  interval?: string;
  tradingViewSymbol?: string | null;
  // Kept for API compatibility with parent component.
  marketDataSource?: 'kraken' | 'binance';
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const containerId = useMemo(() => `tv-chart-${pair.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()}`, [pair]);
  const symbol = tradingViewSymbol || toTradingViewSymbol(pair);

  useEffect(() => {
    let cancelled = false;

    loadTradingViewScript()
      .then(() => {
        const legacyWindow = window as unknown as LegacyTradingViewWindow;
        if (cancelled || !containerRef.current || !legacyWindow.TradingView) return;
        containerRef.current.innerHTML = '';
        new legacyWindow.TradingView.widget({
          autosize: true,
          symbol,
          interval,
          timezone: 'Etc/UTC',
          theme: 'dark',
          style: '1',
          locale: 'fr',
          enable_publishing: false,
          hide_legend: false,
          allow_symbol_change: false,
          details: false,
          save_image: false,
          studies: [],
          withdateranges: true,
          hide_top_toolbar: false,
          hide_side_toolbar: false,
          container_id: containerId,
          backgroundColor: '#0e0c0d',
          gridColor: 'rgba(148,152,164,0.08)',
          watchlist: [],
        });
      })
      .catch(() => {
        if (!containerRef.current) return;
        containerRef.current.innerHTML = '<div class="flex h-full items-center justify-center text-sm text-slate-500">Chart indisponible</div>';
      });

    return () => {
      cancelled = true;
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }
    };
  }, [containerId, interval, symbol]);

  return <div id={containerId} ref={containerRef} className="h-full w-full" />;
}
