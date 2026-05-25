import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BtfDatafeed } from '../charting_library/datafeed';
import type {
  EntityId,
  IChartingLibraryWidget,
  ILineDataSourceApi,
  ResolutionString,
} from '../charting_library/charting_library';
import type { MarketTicker, Position, Trade } from '../stores/useGameStore';

const SCRIPT_PATH = '/charting_library/charting_library.standalone.js';

let scriptLoader: Promise<void> | null = null;

function loadTradingViewScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.TradingView?.widget) return Promise.resolve();
  if (scriptLoader) return scriptLoader;

  scriptLoader = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_PATH}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('TradingView script failed')));
      return;
    }

    const script = document.createElement('script');
    script.src = SCRIPT_PATH;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('TradingView script failed'));
    document.head.appendChild(script);
  });

  return scriptLoader;
}

function intervalMinutesToResolution(intervalMin: number): ResolutionString {
  const map: Record<number, string> = {
    1: '1',
    5: '5',
    15: '15',
    30: '30',
    60: '60',
    240: '240',
    1440: '1D',
  };
  return (map[intervalMin] ?? '1') as ResolutionString;
}

function pickPriceFromTicker(ticker: MarketTicker | undefined): number {
  if (!ticker) return 0;
  if (ticker.bidPrice > 0 && ticker.askPrice > 0) return (ticker.bidPrice + ticker.askPrice) / 2;
  return ticker.markPrice || 0;
}

interface PendingOrder {
  id: string;
  pair: string;
  side: 'long' | 'short';
  type: 'limit' | 'stop_limit' | 'stop' | 'market';
  price: number;
  size: number;
  status: string;
}

export interface ChartOrderPreview {
  pair: string;
  side: 'long' | 'short';
  orderType: 'market' | 'limit';
  entryPrice: number;
  size: number;
  stopLoss: number | null;
  takeProfit: number | null;
}

export interface AdvancedChartProps {
  pair: string;
  pairs: string[];
  pairLabels?: Record<string, string>;
  ticker: MarketTicker | undefined;
  market?: Record<string, MarketTicker>;
  position?: Position;
  positions?: Position[];
  pendingOrders?: PendingOrder[];
  orderPreview?: ChartOrderPreview | null;
  recentTrades?: Trade[];
  intervalMinutes: number;
  onIntervalChange?: (minutes: number) => void;
  onPairChange?: (pair: string) => void;
  onUpdateRisk?: (
    positionId: string,
    stopLoss: number | null,
    takeProfit: number | null,
  ) => Promise<void> | void;
  onPreviewRiskChange?: (patch: { stopLoss?: number | null; takeProfit?: number | null }) => void;
  onCancelOrder?: (orderId: string) => Promise<void> | void;
  isMobile?: boolean;
}

const TV_RESOLUTION_TO_MIN: Record<string, number> = {
  '1': 1,
  '5': 5,
  '15': 15,
  '30': 30,
  '60': 60,
  '240': 240,
  '1D': 1440,
  D: 1440,
};

type LineKind = 'pe' | 'sl' | 'tp' | 'order';

interface LineMeta {
  kind: LineKind;
  key: string;
  positionId?: string;
  orderId?: string;
  isPreview?: boolean;
}

const LINE_COLORS: Record<LineKind, string> = {
  pe: '#16c79a',
  sl: '#ff4d8d',
  tp: '#ff4d8d',
  order: '#16c79a',
};

const LINE_PRICE_BG: Record<LineKind, string> = {
  pe: '#0d8a5f',
  sl: '#c9165e',
  tp: '#c9165e',
  order: '#0d8a5f',
};

const LINE_STYLES: Record<LineKind, number> = {
  pe: 2,
  sl: 2,
  tp: 2,
  order: 2,
};

// Native horzline overrides: keep the dashed line visible across the chart
// but hide its built-in label/price tag — we render those ourselves as HTML
// buttons on top of the chart for a fully styled drag UI.
function lineOverrides(kind: LineKind) {
  const color = LINE_COLORS[kind];
  return {
    linecolor: color,
    linestyle: LINE_STYLES[kind],
    linewidth: 2,
    showPrice: false,
    showLabel: false,
    textcolor: 'rgba(0,0,0,0)',
    fontsize: 1,
    bold: false,
    italic: false,
    horzLabelsAlign: 'left',
    vertLabelsAlign: 'middle',
    'linetoolhorzline.linecolor': color,
    'linetoolhorzline.linestyle': LINE_STYLES[kind],
    'linetoolhorzline.linewidth': 2,
    'linetoolhorzline.showPrice': false,
    'linetoolhorzline.showLabel': false,
    'linetoolhorzline.textcolor': 'rgba(0,0,0,0)',
    'linetoolhorzline.fontsize': 1,
    'linetoolhorzline.bold': false,
    'linetoolhorzline.italic': false,
    'linetoolhorzline.horzLabelsAlign': 'left',
    'linetoolhorzline.vertLabelsAlign': 'middle',
  };
}

function previewSide(side: 'long' | 'short'): string {
  return side === 'long' ? 'Long' : 'Short';
}

function exitSide(side: 'long' | 'short'): string {
  return side === 'long' ? 'Short' : 'Long';
}

function qtyLabel(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return '';
  return size >= 1 ? size.toFixed(2) : size.toFixed(4);
}

function priceLabel(price: number): string {
  if (!Number.isFinite(price)) return '';
  if (price >= 1000) {
    return price.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }
  if (price >= 1) {
    return price.toLocaleString('en-US', { maximumFractionDigits: 4 });
  }
  return price.toPrecision(6);
}

function rectInTopViewport(element: Element): DOMRect {
  const base = element.getBoundingClientRect();
  let left = base.left;
  let top = base.top;
  let currentWindow = element.ownerDocument.defaultView;

  while (currentWindow && currentWindow !== window) {
    const frame = currentWindow.frameElement;
    if (!frame) break;
    const frameRect = frame.getBoundingClientRect();
    left += frameRect.left;
    top += frameRect.top;
    currentWindow = frame.ownerDocument.defaultView;
  }

  return new DOMRect(left, top, base.width, base.height);
}

interface OverlayButton {
  key: string;
  meta: LineMeta;
  price: number;
  label: string;
  draggable: boolean;
  closable: boolean;
}

export default function AdvancedChart({
  pair,
  pairs,
  pairLabels,
  ticker,
  market,
  position,
  positions,
  pendingOrders,
  orderPreview,
  intervalMinutes,
  onIntervalChange,
  onPairChange,
  onUpdateRisk,
  onPreviewRiskChange,
  onCancelOrder,
  isMobile = false,
}: AdvancedChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetContainerRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const widgetRef = useRef<IChartingLibraryWidget | null>(null);
  const datafeedRef = useRef<BtfDatafeed | null>(null);
  // entityId → metadata about which trading line this drawing represents.
  const entityMetaRef = useRef<Map<EntityId, LineMeta>>(new Map());
  // logical key (e.g. "sl:positionId") → entityId, so we can update existing lines.
  const lineByKeyRef = useRef<Map<string, EntityId>>(new Map());
  // suppress drawing_event reactions while we're programmatically updating lines.
  const suppressEventsRef = useRef(false);
  const [chartReady, setChartReady] = useState(false);
  const [overlayButtons, setOverlayButtons] = useState<OverlayButton[]>([]);
  const buttonElementsRef = useRef<Map<string, HTMLDivElement>>(new Map());
  // Live drag overrides: for a given key, the user is currently dragging it
  // and we use this price for visual rendering until pointerup.
  const dragOverrideRef = useRef<Map<string, number>>(new Map());
  // After pointerup, keep the just-dropped price locally until the parent
  // state/server echo catches up. This prevents a visible snap-back to the old
  // SL/TP while the risk update request is in flight.
  const optimisticPriceRef = useRef<Map<string, number>>(new Map());
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const [, forcePriceRender] = useState(0);

  const onUpdateRiskRef = useRef(onUpdateRisk);
  const onPreviewRiskChangeRef = useRef(onPreviewRiskChange);
  const onCancelOrderRef = useRef(onCancelOrder);
  const onPairChangeRef = useRef(onPairChange);
  const onIntervalChangeRef = useRef(onIntervalChange);
  const positionsRef = useRef<Position[]>([]);
  const ordersRef = useRef<PendingOrder[]>([]);
  const lastResolutionRef = useRef<ResolutionString | null>(null);
  // Calibration of (containerY ↔ price) derived from real crossHairMoved
  // events. This is the source of truth used by our overlay buttons because
  // it matches TradingView's internal projection exactly. Falls back to the
  // canvas-based heuristic until at least 2 samples with enough Y delta are
  // collected.
  const calibrationRef = useRef<{
    samples: Array<{ y: number; price: number }>;
    slope: number;
    intercept: number;
    ready: boolean;
    lastUpdated: number;
  }>({ samples: [], slope: 0, intercept: 0, ready: false, lastUpdated: 0 });

  useEffect(() => {
    onUpdateRiskRef.current = onUpdateRisk;
  }, [onUpdateRisk]);
  useEffect(() => {
    onPreviewRiskChangeRef.current = onPreviewRiskChange;
  }, [onPreviewRiskChange]);
  useEffect(() => {
    onCancelOrderRef.current = onCancelOrder;
  }, [onCancelOrder]);
  useEffect(() => {
    onPairChangeRef.current = onPairChange;
  }, [onPairChange]);
  useEffect(() => {
    onIntervalChangeRef.current = onIntervalChange;
  }, [onIntervalChange]);

  const description = useMemo(() => pairLabels ?? {}, [pairLabels]);

  // Initial widget bootstrap.
  useEffect(() => {
    let disposed = false;
    const datafeed = new BtfDatafeed({ pairs, description });
    datafeedRef.current = datafeed;

    loadTradingViewScript()
      .then(() => {
        if (disposed || !widgetContainerRef.current || !window.TradingView?.widget) return;

        const widget = new window.TradingView.widget({
          container: widgetContainerRef.current,
          datafeed,
          symbol: pair,
          interval: intervalMinutesToResolution(intervalMinutes),
          autosize: true,
          fullscreen: false,
          locale: 'fr',
          timezone: 'Etc/UTC',
          library_path: '/charting_library/',
          theme: 'dark',
          custom_css_url: undefined,
          loading_screen: { backgroundColor: '#0e0c0d' },
          disabled_features: [
            'header_symbol_search',
            'header_compare',
            'symbol_search_hot_key',
            'header_saveload',
            'header_screenshot',
            'use_localstorage_for_settings',
            ...(isMobile
              ? ([
                  'left_toolbar',
                  'header_widget',
                  'control_bar',
                  'timeframes_toolbar',
                ] as const)
              : []),
          ],
          enabled_features: ['hide_left_toolbar_by_default'],
          overrides: {
            'paneProperties.background': '#0e0c0d',
            'paneProperties.backgroundType': 'solid',
            'paneProperties.vertGridProperties.color': 'rgba(148, 152, 164, 0.06)',
            'paneProperties.horzGridProperties.color': 'rgba(148, 152, 164, 0.06)',
            'scalesProperties.textColor': '#9498a4',
            'scalesProperties.lineColor': '#231f22',
            'mainSeriesProperties.candleStyle.upColor': '#26a69a',
            'mainSeriesProperties.candleStyle.downColor': '#ef5350',
            'mainSeriesProperties.candleStyle.borderUpColor': '#26a69a',
            'mainSeriesProperties.candleStyle.borderDownColor': '#ef5350',
            'mainSeriesProperties.candleStyle.wickUpColor': '#26a69a',
            'mainSeriesProperties.candleStyle.wickDownColor': '#ef5350',
          },
        });

        widgetRef.current = widget;

        widget.onChartReady(() => {
          if (disposed) return;
          setChartReady(true);

          const chart = widget.activeChart();
          chart.onIntervalChanged().subscribe(null, (newRes: ResolutionString) => {
            const minutes = TV_RESOLUTION_TO_MIN[String(newRes)];
            if (minutes && onIntervalChangeRef.current) {
              onIntervalChangeRef.current(minutes);
            }
          });
          chart.onSymbolChanged().subscribe(null, () => {
            const newSymbol = chart.symbol();
            if (newSymbol && onPairChangeRef.current) {
              onPairChangeRef.current(newSymbol);
            }
            // Symbol change → reset calibration since price scale resets.
            calibrationRef.current.samples = [];
            calibrationRef.current.ready = false;
          });

          // Use TradingView's own crosshair events as the source of truth
          // for the price↔Y projection (perfectly matches the dashed line).
          try {
            chart.crossHairMoved().subscribe(null, ({ price, offsetY }) => {
              if (typeof offsetY !== 'number' || !Number.isFinite(offsetY)) return;
              if (!Number.isFinite(price)) return;
              const cal = calibrationRef.current;
              cal.samples.push({ y: offsetY, price });
              if (cal.samples.length > 24) cal.samples.shift();
              if (cal.samples.length >= 2) {
                // Pick the pair of samples with the largest Y distance for
                // numerical stability.
                let bestI = 0;
                let bestJ = 1;
                let bestDist = 0;
                for (let i = 0; i < cal.samples.length; i += 1) {
                  for (let j = i + 1; j < cal.samples.length; j += 1) {
                    const d = Math.abs(cal.samples[i].y - cal.samples[j].y);
                    if (d > bestDist) {
                      bestDist = d;
                      bestI = i;
                      bestJ = j;
                    }
                  }
                }
                if (bestDist >= 12) {
                  const a = cal.samples[bestI];
                  const b = cal.samples[bestJ];
                  cal.slope = (b.price - a.price) / (b.y - a.y);
                  cal.intercept = a.price - cal.slope * a.y;
                  cal.ready = Math.abs(cal.slope) > 1e-12;
                  cal.lastUpdated = Date.now();
                }
              }
            });
          } catch (err) {
            console.warn('[AdvancedChart] crossHairMoved subscribe failed', err);
          }

          // Seed the calibration immediately by dispatching a few synthetic
          // mousemove events at known Y positions inside the chart canvas.
          // TradingView reacts to native mouse events on its canvases and
          // emits crossHairMoved with (price, offsetY) — that's all we need.
          // Note: TradingView Standalone uses an iframe, so we have to find
          // the actual canvas inside it (same-origin allows querying it).
          const seedCalibration = () => {
            if (disposed) return;
            const container = containerRef.current;
            if (!container) return;

            const allCanvases: HTMLCanvasElement[] = [];
            try {
              allCanvases.push(...Array.from(container.querySelectorAll('canvas')) as HTMLCanvasElement[]);
              const iframes = Array.from(container.querySelectorAll('iframe')) as HTMLIFrameElement[];
              for (const f of iframes) {
                try {
                  const d = f.contentDocument;
                  if (d) allCanvases.push(...Array.from(d.querySelectorAll('canvas')) as HTMLCanvasElement[]);
                } catch {
                  // ignore cross-origin
                }
              }
            } catch {
              // ignore
            }
            let target: HTMLCanvasElement | null = null;
            let maxArea = 0;
            for (const c of allCanvases) {
              const r = rectInTopViewport(c);
              const area = r.width * r.height;
              if (area > maxArea && r.width > 40 && r.height > 40) {
                maxArea = area;
                target = c;
              }
            }
            if (!target) return;
            const r = rectInTopViewport(target);
            const ys = [r.top + 12, r.top + r.height * 0.4, r.bottom - 12];
            for (const y of ys) {
              try {
                const localRect = target.getBoundingClientRect();
                const localX = localRect.left + localRect.width / 2;
                const localY = y - (r.top - localRect.top);
                target.dispatchEvent(new MouseEvent('mousemove', {
                  clientX: localX,
                  clientY: localY,
                  bubbles: true,
                  cancelable: true,
                  view: target.ownerDocument.defaultView ?? window,
                }));
              } catch {
                // ignore
              }
            }
            // Move the synthetic crosshair away to avoid leaving a stuck
            // crosshair line on the chart.
            try {
              target.dispatchEvent(new MouseEvent('mouseleave', {
                clientX: -50,
                clientY: -50,
                bubbles: true,
                cancelable: true,
                view: target.ownerDocument.defaultView ?? window,
              }));
            } catch {
              // ignore
            }
          };
          // Run a few times — first immediately so the calibration is ready
          // before the order form preview appears, then after delays in case
          // the chart's iframe was still laying out.
          setTimeout(seedCalibration, 80);
          setTimeout(seedCalibration, 400);
          setTimeout(seedCalibration, 1200);
          setTimeout(seedCalibration, 2500);

          widget.subscribe('drawing_event', (sourceId, eventType) => {
            if (suppressEventsRef.current) return;
            const meta = entityMetaRef.current.get(sourceId);
            if (!meta) return;

            if (eventType === 'remove') {
              const key = makeKey(meta);
              entityMetaRef.current.delete(sourceId);
              lineByKeyRef.current.delete(key);

              if (meta.isPreview && meta.kind === 'sl') {
                onPreviewRiskChangeRef.current?.({ stopLoss: null });
              } else if (meta.isPreview && meta.kind === 'tp') {
                onPreviewRiskChangeRef.current?.({ takeProfit: null });
              } else if (meta.kind === 'sl' && meta.positionId) {
                const pos = positionsRef.current.find((p) => p.id === meta.positionId);
                void onUpdateRiskRef.current?.(meta.positionId, null, pos?.takeProfit ?? null);
              } else if (meta.kind === 'tp' && meta.positionId) {
                const pos = positionsRef.current.find((p) => p.id === meta.positionId);
                void onUpdateRiskRef.current?.(meta.positionId, pos?.stopLoss ?? null, null);
              } else if (meta.kind === 'order' && meta.orderId) {
                void onCancelOrderRef.current?.(meta.orderId);
              } else if (meta.kind === 'pe' && meta.positionId) {
                // PE drawings shouldn't be removable, but if it happens we
                // simply forget the mapping; the next sync will re-create it.
              }
              return;
            }

            if (eventType === 'points_changed' || eventType === 'move') {
              if (meta.kind !== 'sl' && meta.kind !== 'tp') return;
              if (!meta.positionId) return;
              try {
                const shape = chart.getShapeById(sourceId) as ILineDataSourceApi;
                const points = shape.getPoints();
                const newPrice = points[0]?.price;
                if (!Number.isFinite(newPrice) || newPrice == null || newPrice <= 0) return;

                if (meta.isPreview) {
                  onPreviewRiskChangeRef.current?.(meta.kind === 'sl'
                    ? { stopLoss: newPrice }
                    : { takeProfit: newPrice });
                  return;
                }

                const pos = positionsRef.current.find((p) => p.id === meta.positionId);
                if (meta.kind === 'sl') {
                  void onUpdateRiskRef.current?.(meta.positionId, newPrice, pos?.takeProfit ?? null);
                } else {
                  void onUpdateRiskRef.current?.(meta.positionId, pos?.stopLoss ?? null, newPrice);
                }
              } catch (err) {
                console.warn('[AdvancedChart] failed to read drawing points', err);
              }
            }
          });
        });
      })
      .catch((error) => {
        console.error('TradingView load failed', error);
      });

    return () => {
      disposed = true;
      setChartReady(false);
      const widget = widgetRef.current;
      if (widget) {
        try {
          const chart = widget.activeChart();
          for (const id of entityMetaRef.current.keys()) {
            try {
              chart.removeEntity(id);
            } catch {
              // ignore
            }
          }
        } catch {
          // ignore
        }
      }
      entityMetaRef.current.clear();
      lineByKeyRef.current.clear();
      try {
        widgetRef.current?.remove();
      } catch {
        // ignore
      }
      widgetRef.current = null;
    };
    // Only initialize once; subsequent prop changes are pushed via setSymbol / setResolution below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync available pairs into datafeed (used by symbol search popups).
  useEffect(() => {
    datafeedRef.current?.updatePairs(pairs);
  }, [pairs]);

  // Pair changes from outside the chart → push to widget.
  useEffect(() => {
    const widget = widgetRef.current;
    if (!widget || !chartReady) return;
    try {
      const chart = widget.activeChart();
      if (chart.symbol() !== pair) {
        chart.setSymbol(pair);
      }
    } catch {
      // ignore: widget not ready yet
    }
  }, [pair, chartReady]);

  function removeManagedLines(chart: ReturnType<IChartingLibraryWidget['activeChart']>) {
    suppressEventsRef.current = true;
    for (const id of entityMetaRef.current.keys()) {
      try {
        chart.removeEntity(id);
      } catch {
        // ignore: TradingView may have already recycled the drawing on timeframe changes.
      }
    }
    entityMetaRef.current.clear();
    lineByKeyRef.current.clear();
    setTimeout(() => {
      suppressEventsRef.current = false;
    }, 0);
  }

  // Resolution changes from outside the chart → push to widget.
  useEffect(() => {
    const widget = widgetRef.current;
    if (!widget || !chartReady) return;
    try {
      const chart = widget.activeChart();
      const desired = intervalMinutesToResolution(intervalMinutes);
      if (lastResolutionRef.current !== desired) {
        // Advanced Charts can keep old drawings visually while their entity IDs
        // become stale after a resolution switch. Clear our managed drawings and
        // let the line-sync effect recreate exactly one PE/SL/TP set.
        removeManagedLines(chart);
        lastResolutionRef.current = desired;
      }
      if (chart.resolution() !== desired) {
        chart.setResolution(desired);
      }
    } catch {
      // ignore
    }
  }, [intervalMinutes, chartReady]);

  // Live ticker → push to datafeed for streaming candles.
  useEffect(() => {
    const datafeed = datafeedRef.current;
    if (!datafeed) return;
    if (market) {
      for (const [pairKey, t] of Object.entries(market)) {
        const price = pickPriceFromTicker(t);
        if (price > 0) datafeed.pushTick(pairKey, price, (t.updatedAt || Date.now()));
      }
      return;
    }
    if (ticker) {
      const price = pickPriceFromTicker(ticker);
      if (price > 0) datafeed.pushTick(ticker.pair, price, ticker.updatedAt || Date.now());
    }
  }, [market, ticker]);

  // Lines (PE / SL / TP / pending orders) — recomputed when relevant inputs change.
  useEffect(() => {
    const widget = widgetRef.current;
    if (!widget || !chartReady) return;

    let chart;
    try {
      chart = widget.activeChart();
    } catch (err) {
      console.warn('[AdvancedChart] activeChart() not ready', err);
      return;
    }

    const visiblePositions = (positions ?? (position ? [position] : [])).filter(
      (entry) => entry.pair === pair,
    );
    const visibleOrders = (pendingOrders ?? []).filter(
      (entry) => entry.pair === pair && entry.status !== 'filled' && entry.status !== 'cancelled',
    );
    const visiblePreview = orderPreview && orderPreview.pair === pair && orderPreview.entryPrice > 0 && orderPreview.size > 0
      ? orderPreview
      : null;

    positionsRef.current = visiblePositions;
    ordersRef.current = visibleOrders;

    if (import.meta.env.DEV) {
      console.debug(
        '[AdvancedChart] line sync',
        {
          pair,
          chartReady,
          visiblePositions: visiblePositions.length,
          visibleOrders: visibleOrders.length,
          visiblePreview: Boolean(visiblePreview),
        },
      );
    }

    // Build the desired set of logical line keys for the current pair.
    const desired = new Map<string, { meta: LineMeta; price: number; label: string; locked: boolean }>();
    const stablePrice = (key: string, sourcePrice: number) => {
      const draggingPrice = dragOverrideRef.current.get(key);
      if (draggingPrice != null) return draggingPrice;
      const optimisticPrice = optimisticPriceRef.current.get(key);
      if (optimisticPrice != null) {
        if (Math.abs(optimisticPrice - sourcePrice) <= 1e-6) {
          optimisticPriceRef.current.delete(key);
          return sourcePrice;
        }
        return optimisticPrice;
      }
      return sourcePrice;
    };

    for (const pos of visiblePositions) {
      const peKey = `pe:${pos.id}`;
      desired.set(peKey, {
        meta: { kind: 'pe', key: peKey, positionId: pos.id },
        price: pos.entryPrice,
        label: `Aperçu - ${previewSide(pos.side)} - À cours limité  ${qtyLabel(pos.size)}`,
        locked: true,
      });

      if (pos.stopLoss != null && Number.isFinite(pos.stopLoss)) {
        const key = `sl:${pos.id}`;
        desired.set(key, {
          meta: { kind: 'sl', key, positionId: pos.id },
          price: stablePrice(key, pos.stopLoss),
          label: `Aperçu - ${exitSide(pos.side)} - Stop loss  ${qtyLabel(pos.size)}`,
          locked: false,
        });
      }
      if (pos.takeProfit != null && Number.isFinite(pos.takeProfit)) {
        const key = `tp:${pos.id}`;
        desired.set(key, {
          meta: { kind: 'tp', key, positionId: pos.id },
          price: stablePrice(key, pos.takeProfit),
          label: `Aperçu - ${exitSide(pos.side)} - Take profit  ${qtyLabel(pos.size)}`,
          locked: false,
        });
      }
    }

    const previewLooksLikeOpenPosition = visiblePreview
      ? visiblePositions.some((pos) => {
          const sizeBase = Math.max(1, Math.abs(pos.size), Math.abs(visiblePreview.size));
          const priceBase = Math.max(1, Math.abs(pos.entryPrice), Math.abs(visiblePreview.entryPrice));
          return pos.side === visiblePreview.side
            && Math.abs(pos.size - visiblePreview.size) / sizeBase < 0.001
            && Math.abs(pos.entryPrice - visiblePreview.entryPrice) / priceBase < 0.02;
        })
      : false;

    if (visiblePreview && !previewLooksLikeOpenPosition) {
      const previewId = 'draft-order';
      const peKey = `preview:pe:${previewId}`;
      desired.set(peKey, {
        meta: { kind: 'pe', key: peKey, positionId: previewId, isPreview: true },
        price: visiblePreview.entryPrice,
        label: `Aperçu - ${previewSide(visiblePreview.side)} - ${
          visiblePreview.orderType === 'market' ? 'Au marché' : 'À cours limité'
        }  ${qtyLabel(visiblePreview.size)}`,
        locked: true,
      });

      if (visiblePreview.takeProfit != null && Number.isFinite(visiblePreview.takeProfit)) {
        const key = `preview:tp:${previewId}`;
        desired.set(key, {
          meta: { kind: 'tp', key, positionId: previewId, isPreview: true },
          price: stablePrice(key, visiblePreview.takeProfit),
          label: `Aperçu - ${exitSide(visiblePreview.side)} - Take profit  ${qtyLabel(visiblePreview.size)}`,
          locked: false,
        });
      }

      if (visiblePreview.stopLoss != null && Number.isFinite(visiblePreview.stopLoss)) {
        const key = `preview:sl:${previewId}`;
        desired.set(key, {
          meta: { kind: 'sl', key, positionId: previewId, isPreview: true },
          price: stablePrice(key, visiblePreview.stopLoss),
          label: `Aperçu - ${exitSide(visiblePreview.side)} - Stop loss  ${qtyLabel(visiblePreview.size)}`,
          locked: false,
        });
      }
    }

    for (const order of visibleOrders) {
      const key = `order:${order.id}`;
      desired.set(key, {
        meta: { kind: 'order', key, orderId: order.id },
        price: order.price,
        label: `Aperçu - ${previewSide(order.side)} - À cours limité  ${qtyLabel(order.size)}`,
        locked: true,
      });
    }

    const previousKeys = new Set(lineByKeyRef.current.keys());
    const desiredKeys = new Set(desired.keys());

    const updateOrCreate = async () => {
      suppressEventsRef.current = true;
      try {
        // Remove stale lines.
        for (const key of previousKeys) {
          if (!desiredKeys.has(key)) {
            const id = lineByKeyRef.current.get(key);
            if (id != null) {
              try {
                chart.removeEntity(id);
              } catch {
                // ignore: drawing may already be gone
              }
              entityMetaRef.current.delete(id);
              lineByKeyRef.current.delete(key);
            }
          }
        }

        // Update existing lines / create new ones.
        for (const [key, spec] of desired) {
          const existingId = lineByKeyRef.current.get(key);
          if (existingId != null) {
            try {
              const shape = chart.getShapeById(existingId) as ILineDataSourceApi;
              const points = shape.getPoints();
              // While the user is dragging, the pointer handler owns this
              // shape. Do not let a WS/props resync push it back to the last
              // server price mid-drag.
              const isBeingDragged = dragOverrideRef.current.has(key);
              if (!isBeingDragged && Math.abs((points[0]?.price ?? 0) - spec.price) > 1e-6) {
                shape.setPoints([{ time: nowSec(), price: spec.price }]);
              }
              shape.setProperties({
                text: spec.label,
                ...lineOverrides(spec.meta.kind),
              });
            } catch (err) {
              // The shape may have been removed externally — drop the cache entry
              // and recreate immediately without leaving a ghost reference.
              console.warn('[AdvancedChart] update shape failed', err);
              try {
                chart.removeEntity(existingId);
              } catch {
                // ignore: already removed or recycled by the chart.
              }
              entityMetaRef.current.delete(existingId);
              lineByKeyRef.current.delete(key);
              // fall through to creation below
            }
          }

          if (lineByKeyRef.current.has(key)) {
            continue;
          }

          try {
            const newId = await chart.createShape(
              { time: nowSec(), price: spec.price },
              {
                shape: 'horizontal_line',
                lock: spec.locked,
                disableSelection: spec.locked,
                disableSave: true,
                disableUndo: true,
                showInObjectsTree: false,
                text: '',
                overrides: lineOverrides(spec.meta.kind),
              },
            );
            if (newId != null) {
              entityMetaRef.current.set(newId, spec.meta);
              lineByKeyRef.current.set(key, newId);
            }
          } catch (err) {
            console.warn('[AdvancedChart] createShape failed', err);
          }
        }
      } finally {
        // Defer un-suppressing events to ensure the synchronous batch of
        // points_changed / properties_changed events triggered by our own
        // updates above does not accidentally re-emit network calls.
        setTimeout(() => {
          suppressEventsRef.current = false;
        }, 0);
      }
    };

    void updateOrCreate();

    // Build the matching list of HTML overlay buttons (drag handle + label + price chip).
    const nextButtons: OverlayButton[] = [];
    for (const [key, spec] of desired) {
      const closable = spec.meta.kind === 'order'
        || spec.meta.kind === 'sl'
        || spec.meta.kind === 'tp';
      nextButtons.push({
        key,
        meta: spec.meta,
        price: spec.price,
        label: spec.label,
        draggable: !spec.locked,
        closable,
      });
    }
    // Stable order: PE first, then SL/TP, then orders. Within each kind, by key.
    const kindOrder: Record<LineKind, number> = { pe: 0, order: 1, tp: 2, sl: 3 };
    nextButtons.sort((a, b) => {
      const k = kindOrder[a.meta.kind] - kindOrder[b.meta.kind];
      if (k !== 0) return k;
      return a.key.localeCompare(b.key);
    });
    setOverlayButtons((prev) => {
      if (prev.length !== nextButtons.length) return nextButtons;
      for (let i = 0; i < prev.length; i += 1) {
        const a = prev[i];
        const b = nextButtons[i];
        if (
          a.key !== b.key
          || a.label !== b.label
          || Math.abs(a.price - b.price) > 1e-9
          || a.draggable !== b.draggable
          || a.closable !== b.closable
        ) {
          return nextButtons;
        }
      }
      return prev;
    });
  }, [pair, position, positions, pendingOrders, orderPreview, intervalMinutes, chartReady]);

  // ---- Coordinate conversion price ↔ pixel Y in container space ----
  // TradingView Charting Library Standalone renders the chart inside an
  // <iframe>, so we have to look both in the container's direct DOM AND
  // inside any same-origin iframes to find the actual chart canvases.
  const collectCanvases = useCallback((root: ParentNode): HTMLCanvasElement[] => {
    const out: HTMLCanvasElement[] = [];
    try {
      out.push(...Array.from(root.querySelectorAll('canvas')) as HTMLCanvasElement[]);
    } catch {
      // ignore
    }
    let iframes: HTMLIFrameElement[] = [];
    try {
      iframes = Array.from(root.querySelectorAll('iframe')) as HTMLIFrameElement[];
    } catch {
      iframes = [];
    }
    for (const iframe of iframes) {
      try {
        const doc = iframe.contentDocument;
        if (!doc) continue;
        out.push(...Array.from(doc.querySelectorAll('canvas')) as HTMLCanvasElement[]);
        // Recurse one level into nested iframes if any.
        const inner = doc.querySelectorAll('iframe');
        for (const innerFrame of Array.from(inner) as HTMLIFrameElement[]) {
          try {
            const innerDoc = innerFrame.contentDocument;
            if (innerDoc) {
              out.push(...Array.from(innerDoc.querySelectorAll('canvas')) as HTMLCanvasElement[]);
            }
          } catch {
            // cross-origin — ignore
          }
        }
      } catch {
        // cross-origin — ignore
      }
    }
    return out;
  }, []);

  const getPaneRect = useCallback(() => {
    const container = containerRef.current;
    if (!container) return null;
    const canvases = collectCanvases(container);
    if (!canvases.length) return null;
    // Pick the canvas with the largest area, ignoring tiny / hidden ones.
    let largest: HTMLCanvasElement | null = null;
    let maxArea = 0;
    for (const c of canvases) {
      const r = rectInTopViewport(c);
      const area = r.width * r.height;
      if (area > maxArea && r.width > 40 && r.height > 40) {
        maxArea = area;
        largest = c;
      }
    }
    if (!largest) return null;
    const cRect = container.getBoundingClientRect();
    const lRect = rectInTopViewport(largest);
    let paneHeight = lRect.height;
    try {
      const chart = widgetRef.current?.activeChart();
      const firstPane = chart?.getPanes()[0];
      const tvPaneHeight = firstPane?.getHeight();
      if (Number.isFinite(tvPaneHeight) && tvPaneHeight && tvPaneHeight > 40) {
        paneHeight = Math.min(tvPaneHeight, lRect.height);
      }
    } catch {
      // ignore: fallback to canvas height
    }
    const top = lRect.top - cRect.top;
    return {
      top,
      bottom: top + paneHeight,
      left: lRect.left - cRect.left,
      right: lRect.right - cRect.left,
      height: paneHeight,
      width: lRect.width,
    };
  }, [collectCanvases]);

  const getPriceRange = useCallback((): { top: number; bottom: number } | null => {
    const widget = widgetRef.current;
    if (!widget) return null;
    let chart;
    try {
      chart = widget.activeChart();
    } catch {
      return null;
    }
    const pane = chart.getPanes()[0];
    if (!pane) return null;
    const priceScale = pane.getMainSourcePriceScale();
    if (!priceScale) return null;
    const range = priceScale.getVisiblePriceRange();
    if (!range) return null;
    const top = Math.max(range.from, range.to);
    const bottom = Math.min(range.from, range.to);
    if (top - bottom < 1e-12) return null;
    return { top, bottom };
  }, []);

  const priceToY = useCallback(
    (price: number): number | null => {
      if (!Number.isFinite(price)) return null;
      // Recompute from TradingView's live visible range and pane height every
      // frame. This stays in sync when the user zooms, pans, or rescales.
      const range = getPriceRange();
      const rect = getPaneRect();
      if (!range || !rect) return null;
      const ratio = (range.top - price) / (range.top - range.bottom);
      if (!Number.isFinite(ratio)) return null;
      const yLocal = ratio * rect.height;
      return rect.top + yLocal;
    },
    [getPaneRect, getPriceRange],
  );

  const yToPrice = useCallback(
    (yInContainer: number): number | null => {
      const range = getPriceRange();
      const rect = getPaneRect();
      if (!range || !rect) return null;
      const yLocal = yInContainer - rect.top;
      const ratio = yLocal / rect.height;
      return range.top - ratio * (range.top - range.bottom);
    },
    [getPaneRect, getPriceRange],
  );

  // rAF positioning loop: keeps each overlay button aligned with its price.
  // Also runs even when chart is not yet ready so newly-rendered buttons get
  // a sane fallback position (center of container) instead of staying at -9999.
  useEffect(() => {
    let raf = 0;
    let cancelled = false;
    let warnedNoCanvas = false;
    let lastRange: { top: number; bottom: number } | null = null;
    let lastPaneHeight = 0;
    const step = () => {
      if (cancelled) return;
      // Detect price range or pane size changes — they invalidate the
      // crossHairMoved-based calibration until fresh samples arrive.
      // Use a threshold so micro auto-scale tweaks (<0.5% per tick) don't
      // wipe the calibration on every frame.
      const range = getPriceRange();
      const rect = getPaneRect();
      if (range && rect) {
        let invalidate = false;
        const span = Math.max(1e-9, range.top - range.bottom);
        if (lastRange) {
          const dTop = Math.abs(range.top - lastRange.top) / span;
          const dBottom = Math.abs(range.bottom - lastRange.bottom) / span;
          if (dTop > 0.05 || dBottom > 0.05) invalidate = true;
        }
        if (lastPaneHeight && Math.abs(rect.height - lastPaneHeight) > 4) {
          invalidate = true;
        }
        if (invalidate) {
          const cal = calibrationRef.current;
          cal.samples = [];
          cal.ready = false;
        }
        lastRange = { top: range.top, bottom: range.bottom };
        lastPaneHeight = rect.height;
      }
      const overlay = overlayRef.current;
      const container = containerRef.current;
      if (overlay && container) {
        const containerRect = container.getBoundingClientRect();
        const fallbackY = containerRect.height / 2;
        if (!rect && import.meta.env.DEV && !warnedNoCanvas && buttonElementsRef.current.size > 0) {
          warnedNoCanvas = true;
          // eslint-disable-next-line no-console
          console.warn('[AdvancedChart] cannot find chart canvas yet; using fallback positions');
        }
        let index = 0;
        for (const [key, el] of buttonElementsRef.current) {
          const drag = dragOverrideRef.current.get(key);
          const btn = overlayButtons.find((b) => b.key === key);
          if (!btn) continue;
          const price = drag != null ? drag : btn.price;
          const computed = priceToY(price);
          let y: number;
          let opacity = '1';
          if (computed != null && rect) {
            const clamped = Math.max(rect.top - 6, Math.min(rect.bottom + 6, computed));
            const offscreen = computed < rect.top - 24 || computed > rect.bottom + 24;
            y = clamped;
            opacity = offscreen ? '0.35' : '1';
          } else {
            // Stagger fallback buttons vertically so they don't all overlap.
            y = fallbackY + (index - buttonElementsRef.current.size / 2) * 32;
            opacity = '0.95';
          }
          const x = rect ? Math.max(8, rect.left + 8) : 56;
          el.style.left = `${x}px`;
          el.style.transform = `translate3d(0, ${y}px, 0) translateY(-50%)`;
          el.style.opacity = opacity;
          el.style.pointerEvents = 'auto';
          index += 1;
        }
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [overlayButtons, getPaneRect, priceToY]);

  // ---- Drag interaction on overlay buttons ----
  const handlePointerDownOnDrag = useCallback(
    (event: React.PointerEvent<HTMLDivElement>, btn: OverlayButton) => {
      if (!btn.draggable) return;
      event.preventDefault();
      event.stopPropagation();

      const startKey = btn.key;
      let lastValidPrice = btn.price;
      let chart: ReturnType<IChartingLibraryWidget['activeChart']> | null = null;
      const widget = widgetRef.current;
      if (widget) {
        try { chart = widget.activeChart(); } catch { chart = null; }
      }

      // Suppress drawing_event reactions for the entire drag so we don't
      // bounce updates back from the chart while we drive the line ourselves.
      suppressEventsRef.current = true;
      setDraggingKey(startKey);
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // ignore: capture can fail if the browser already released the pointer.
      }
      dragOverrideRef.current.set(startKey, btn.price);
      forcePriceRender((n) => (n + 1) % 1000000);

      const move = (e: PointerEvent) => {
        const container = containerRef.current;
        if (!container) return;
        const rect = container.getBoundingClientRect();
        const yInContainer = e.clientY - rect.top;
        const newPrice = yToPrice(yInContainer);
        if (newPrice == null || !Number.isFinite(newPrice) || newPrice <= 0) return;
        lastValidPrice = newPrice;
        dragOverrideRef.current.set(startKey, newPrice);
        forcePriceRender((n) => (n + 1) % 1000000);

        // Sync the underlying horzline so the dashed line follows the button.
        if (chart) {
          const id = lineByKeyRef.current.get(startKey);
          if (id != null) {
            try {
              const shape = chart.getShapeById(id) as ILineDataSourceApi;
              shape.setPoints([{ time: nowSec(), price: newPrice }]);
            } catch {
              // ignore — the shape may be transiently unavailable.
            }
          }
        }
      };

      const up = () => {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
        document.removeEventListener('pointercancel', up);
        setDraggingKey(null);
        dragOverrideRef.current.delete(startKey);
        if (lastValidPrice > 0 && Number.isFinite(lastValidPrice)) {
          optimisticPriceRef.current.set(startKey, lastValidPrice);
          window.setTimeout(() => {
            optimisticPriceRef.current.delete(startKey);
            forcePriceRender((n) => (n + 1) % 1000000);
          }, 2500);
        }
        forcePriceRender((n) => (n + 1) % 1000000);

        // Release the event lock slightly after the drag so any trailing
        // points_changed event from our own setPoints calls doesn't trigger
        // a redundant onUpdateRisk roundtrip.
        setTimeout(() => {
          suppressEventsRef.current = false;
        }, 60);

        if (lastValidPrice <= 0 || !Number.isFinite(lastValidPrice)) return;

        const meta = btn.meta;
        if (meta.isPreview) {
          if (meta.kind === 'sl') onPreviewRiskChangeRef.current?.({ stopLoss: lastValidPrice });
          else if (meta.kind === 'tp') onPreviewRiskChangeRef.current?.({ takeProfit: lastValidPrice });
          return;
        }
        if (meta.kind === 'sl' && meta.positionId) {
          const pos = positionsRef.current.find((p) => p.id === meta.positionId);
          void onUpdateRiskRef.current?.(meta.positionId, lastValidPrice, pos?.takeProfit ?? null);
        } else if (meta.kind === 'tp' && meta.positionId) {
          const pos = positionsRef.current.find((p) => p.id === meta.positionId);
          void onUpdateRiskRef.current?.(meta.positionId, pos?.stopLoss ?? null, lastValidPrice);
        }
      };

      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
      document.addEventListener('pointercancel', up);
    },
    [yToPrice],
  );

  const handleClose = useCallback((btn: OverlayButton) => {
    const meta = btn.meta;
    if (meta.isPreview) {
      if (meta.kind === 'sl') onPreviewRiskChangeRef.current?.({ stopLoss: null });
      else if (meta.kind === 'tp') onPreviewRiskChangeRef.current?.({ takeProfit: null });
      return;
    }
    if (meta.kind === 'sl' && meta.positionId) {
      const pos = positionsRef.current.find((p) => p.id === meta.positionId);
      void onUpdateRiskRef.current?.(meta.positionId, null, pos?.takeProfit ?? null);
      return;
    }
    if (meta.kind === 'tp' && meta.positionId) {
      const pos = positionsRef.current.find((p) => p.id === meta.positionId);
      void onUpdateRiskRef.current?.(meta.positionId, pos?.stopLoss ?? null, null);
      return;
    }
    if (meta.kind === 'order' && meta.orderId) {
      void onCancelOrderRef.current?.(meta.orderId);
    }
  }, []);

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden bg-[#0e0c0d]">
      <div ref={widgetContainerRef} className="absolute inset-0 z-0" />
      <div
        ref={overlayRef}
        className={`${draggingKey ? 'pointer-events-auto' : 'pointer-events-none'} absolute inset-0 z-[30]`}
        style={{
          contain: 'layout paint',
          cursor: draggingKey ? 'row-resize' : undefined,
        }}
      >
        {overlayButtons.map((btn) => {
          const isPreview = Boolean(btn.meta.isPreview);
          const bg = LINE_COLORS[btn.meta.kind];
          const priceBg = LINE_PRICE_BG[btn.meta.kind];
          const livePrice = dragOverrideRef.current.get(btn.key);
          const displayPrice = livePrice != null ? livePrice : btn.price;
          return (
            <div
              key={btn.key}
              ref={(el) => {
                if (el) buttonElementsRef.current.set(btn.key, el);
                else buttonElementsRef.current.delete(btn.key);
              }}
              className="pointer-events-auto absolute flex select-none items-stretch overflow-hidden rounded text-[10px] font-semibold leading-none text-white shadow-[0_2px_6px_rgba(0,0,0,0.4)]"
              style={{
                top: 0,
                opacity: 0,
                transition: 'opacity 0.12s linear',
                transform: 'translate3d(0,-9999px,0)',
                fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
                outline: isPreview ? `1px dashed ${bg}` : 'none',
                outlineOffset: -1,
              }}
            >
              <div
                onPointerDown={btn.draggable ? (e) => handlePointerDownOnDrag(e, btn) : undefined}
                className={
                  btn.draggable
                    ? 'flex cursor-row-resize items-center justify-center px-1 transition-colors hover:brightness-125'
                    : 'flex items-center justify-center px-1'
                }
                style={{ background: bg, minWidth: 12 }}
                title={btn.draggable ? 'Glisser pour modifier' : ''}
              >
                {btn.draggable ? (
                  <svg width="5" height="11" viewBox="0 0 5 11" aria-hidden="true">
                    <circle cx="1" cy="1.5" r="0.85" fill="rgba(255,255,255,0.9)" />
                    <circle cx="4" cy="1.5" r="0.85" fill="rgba(255,255,255,0.9)" />
                    <circle cx="1" cy="5.5" r="0.85" fill="rgba(255,255,255,0.9)" />
                    <circle cx="4" cy="5.5" r="0.85" fill="rgba(255,255,255,0.9)" />
                    <circle cx="1" cy="9.5" r="0.85" fill="rgba(255,255,255,0.9)" />
                    <circle cx="4" cy="9.5" r="0.85" fill="rgba(255,255,255,0.9)" />
                  </svg>
                ) : (
                  <svg width="6" height="6" viewBox="0 0 6 6" aria-hidden="true">
                    <circle cx="3" cy="3" r="1.5" fill="rgba(255,255,255,0.9)" />
                  </svg>
                )}
              </div>

              <div
                className="flex items-center px-1.5 py-1 tracking-tight"
                style={{ background: bg }}
              >
                {btn.label}
              </div>

              <div
                className="flex items-center px-1.5 py-1 tabular-nums"
                style={{ background: priceBg }}
              >
                {priceLabel(displayPrice)}
              </div>

              {btn.closable && (
                <button
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleClose(btn);
                  }}
                  className="flex items-center justify-center px-1 text-white/85 transition-colors hover:bg-black/35 hover:text-white"
                  style={{ background: priceBg }}
                  title="Annuler"
                >
                  <svg width="7" height="7" viewBox="0 0 7 7" aria-hidden="true">
                    <path d="M1 1 L6 6 M6 1 L1 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                  </svg>
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function makeKey(meta: LineMeta): string {
  if (meta.key) return meta.key;
  if (meta.kind === 'order') return `order:${meta.orderId}`;
  return `${meta.kind}:${meta.positionId}`;
}
