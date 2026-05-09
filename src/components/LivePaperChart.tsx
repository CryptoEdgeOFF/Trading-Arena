import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CandlestickSeries,
  ColorType,
  createChart,
  LineSeries,
  type CandlestickData,
  type IChartApi,
  type ISeriesApi,
  type Time,
} from 'lightweight-charts';
import { type MarketTicker, type Position } from '../stores/useGameStore';

type Candle = CandlestickData<Time>;

const MINUTE = 60;
const HISTORY_LENGTH = 240;

const PAIR_SEED: Record<string, number> = {
  'BTC/USD': 3.17,
  'ETH/USD': 5.31,
  'SOL/USD': 7.47,
  'XRP/USD': 11.19,
};

function floorToInterval(timestampSeconds: number, intervalMinutes: number): Time {
  const intervalSeconds = intervalMinutes * MINUTE;
  return (Math.floor(timestampSeconds / intervalSeconds) * intervalSeconds) as Time;
}

function buildFallbackCandles(pair: string, price: number, intervalMinutes: number): Candle[] {
  const now = Math.floor(Date.now() / 1000);
  const intervalSeconds = intervalMinutes * MINUTE;
  const currentTime = Math.floor(now / intervalSeconds) * intervalSeconds;
  const seed = PAIR_SEED[pair] ?? 2.73;
  let previousClose = price * (1 - 0.0025);

  return Array.from({ length: HISTORY_LENGTH }, (_, index) => {
    const time = (currentTime - (HISTORY_LENGTH - index - 1) * intervalSeconds) as Time;
    const drift = Math.sin((index + 1) * seed) * price * 0.00055;
    const open = previousClose;
    const close = index === HISTORY_LENGTH - 1 ? price : Math.max(0.000001, open + drift);
    const wick = Math.abs(Math.cos((index + 1) * seed)) * price * 0.00035;
    const high = Math.max(open, close) + wick;
    const low = Math.max(0.000001, Math.min(open, close) - wick);
    previousClose = close;

    return { time, open, high, low, close };
  });
}

function mergeTick(candles: Candle[], price: number, intervalMinutes: number): Candle[] {
  const time = floorToInterval(Math.floor(Date.now() / 1000), intervalMinutes);
  const last = candles[candles.length - 1];

  if (!last || last.time !== time) {
    const open = last?.close ?? price;
    return [...candles.slice(-(HISTORY_LENGTH - 1)), {
      time,
      open,
      high: Math.max(open, price),
      low: Math.min(open, price),
      close: price,
    }];
  }

  return [
    ...candles.slice(0, -1),
    {
      ...last,
      high: Math.max(last.high, price),
      low: Math.min(last.low, price),
      close: price,
    },
  ];
}

function normalizeHistoricalCandles(candles: Candle[], livePrice: number, intervalMinutes: number): Candle[] {
  const clean = candles
    .filter((candle) => (
      Number(candle.time)
      && Number.isFinite(candle.open)
      && Number.isFinite(candle.high)
      && Number.isFinite(candle.low)
      && Number.isFinite(candle.close)
    ))
    .slice(-HISTORY_LENGTH);

  return livePrice > 0 ? mergeTick(clean, livePrice, intervalMinutes) : clean;
}

function exponentialMovingAverage(candles: Candle[], period: number) {
  if (candles.length < period) return [];

  const multiplier = 2 / (period + 1);
  let ema = candles.slice(0, period).reduce((sum, candle) => sum + candle.close, 0) / period;
  const values: { time: Time; value: number }[] = [{ time: candles[period - 1].time, value: ema }];

  for (let index = period; index < candles.length; index += 1) {
    ema = (candles[index].close - ema) * multiplier + ema;
    values.push({ time: candles[index].time, value: ema });
  }

  return values;
}

function livePriceFromTicker(ticker: MarketTicker | undefined): number {
  if (!ticker) return 0;
  const mid = ticker.bidPrice > 0 && ticker.askPrice > 0
    ? (ticker.bidPrice + ticker.askPrice) / 2
    : 0;
  return mid || ticker.markPrice || 0;
}

export default function LivePaperChart({
  pair,
  ticker,
  position,
  onRiskChange,
  interval,
  indicators,
  fitRequest = 0,
}: {
  pair: string;
  ticker: MarketTicker | undefined;
  position?: Position;
  onRiskChange?: (pair: string, stopLoss: number | null, takeProfit: number | null) => void;
  interval: number;
  indicators: { ema20: boolean; ema50: boolean };
  fitRequest?: number;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const ema20Ref = useRef<ISeriesApi<'Line'> | null>(null);
  const ema50Ref = useRef<ISeriesApi<'Line'> | null>(null);
  const candlesRef = useRef<Candle[]>([]);
  const initializedKeyRef = useRef<string | null>(null);
  const onRiskChangeRef = useRef(onRiskChange);
  const priceLinesRef = useRef<ReturnType<ISeriesApi<'Candlestick'>['createPriceLine']>[]>([]);
  const [historyStatus, setHistoryStatus] = useState<'loading' | 'real' | 'fallback'>('loading');
  const [lineCoords, setLineCoords] = useState<{ stopLoss: number | null; takeProfit: number | null }>({
    stopLoss: null,
    takeProfit: null,
  });
  const [draftRisk, setDraftRisk] = useState<{ stopLoss: number | null; takeProfit: number | null }>({
    stopLoss: null,
    takeProfit: null,
  });
  const [dragging, setDragging] = useState<'stopLoss' | 'takeProfit' | null>(null);

  const livePrice = livePriceFromTicker(ticker);
  const suggestedStopLoss = position
    ? position.side === 'long'
      ? position.entryPrice * 0.995
      : position.entryPrice * 1.005
    : null;
  const suggestedTakeProfit = position
    ? position.side === 'long'
      ? position.entryPrice * 1.01
      : position.entryPrice * 0.99
    : null;
  const stopLossPrice = draftRisk.stopLoss ?? position?.stopLoss ?? suggestedStopLoss;
  const takeProfitPrice = draftRisk.takeProfit ?? position?.takeProfit ?? suggestedTakeProfit;

  const priceFormatter = useMemo(() => {
    return (price: number) => price.toLocaleString('en-US', {
      minimumFractionDigits: price > 100 ? 1 : 4,
      maximumFractionDigits: price > 100 ? 1 : 4,
    });
  }, []);

  useEffect(() => {
    onRiskChangeRef.current = onRiskChange;
  }, [onRiskChange]);

  useEffect(() => {
    setDraftRisk({ stopLoss: null, takeProfit: null });
  }, [position?.pair, position?.entryPrice, position?.side]);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: '#0e0c0d' },
        textColor: '#9498a4',
        fontFamily: 'Inter, system-ui, sans-serif',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: 'rgba(148, 152, 164, 0.055)' },
        horzLines: { color: 'rgba(148, 152, 164, 0.055)' },
      },
      rightPriceScale: {
        borderColor: '#231f22',
        scaleMargins: { top: 0.08, bottom: 0.12 },
      },
      timeScale: {
        borderColor: '#231f22',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 8,
        barSpacing: 8,
      },
      crosshair: {
        mode: 0,
        vertLine: { color: 'rgba(224, 226, 234, 0.25)', labelBackgroundColor: '#231f22' },
        horzLine: { color: 'rgba(224, 226, 234, 0.25)', labelBackgroundColor: '#231f22' },
      },
      localization: { priceFormatter },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#15c990',
      downColor: '#c026d3',
      borderUpColor: '#15c990',
      borderDownColor: '#c026d3',
      wickUpColor: '#15c990',
      wickDownColor: '#c026d3',
      priceLineColor: '#e0e2ea',
      priceLineWidth: 1,
    });
    const ema20 = chart.addSeries(LineSeries, {
      color: '#f59e0b',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    const ema50 = chart.addSeries(LineSeries, {
      color: '#38bdf8',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    chartRef.current = chart;
    seriesRef.current = series;
    ema20Ref.current = ema20;
    ema50Ref.current = ema50;

    return () => {
      priceLinesRef.current = [];
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      ema20Ref.current = null;
      ema50Ref.current = null;
      candlesRef.current = [];
      initializedKeyRef.current = null;
    };
  }, [priceFormatter]);

  useEffect(() => {
    if (!seriesRef.current || livePrice <= 0) return;
    const historyKey = `${pair}:${interval}`;
    if (initializedKeyRef.current === historyKey) return;

    initializedKeyRef.current = historyKey;
    setHistoryStatus('loading');

    const controller = new AbortController();
    fetch(`/api/paper/candles?pair=${encodeURIComponent(pair)}&interval=${interval}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Historique indisponible');
        return response.json();
      })
      .then((data: { candles?: Candle[] }) => {
        if (!seriesRef.current) return;
        const historical = normalizeHistoricalCandles(data.candles || [], livePrice, interval);
        candlesRef.current = historical.length > 0 ? historical : buildFallbackCandles(pair, livePrice, interval);
        seriesRef.current.setData(candlesRef.current);
        ema20Ref.current?.setData(indicators.ema20 ? exponentialMovingAverage(candlesRef.current, 20) : []);
        ema50Ref.current?.setData(indicators.ema50 ? exponentialMovingAverage(candlesRef.current, 50) : []);
        chartRef.current?.timeScale().fitContent();
        chartRef.current?.timeScale().scrollToRealTime();
        setHistoryStatus(historical.length > 0 ? 'real' : 'fallback');
      })
      .catch((error) => {
        if (controller.signal.aborted || !seriesRef.current) return;
        console.error('Paper candle history failed:', (error as Error).message);
        candlesRef.current = buildFallbackCandles(pair, livePrice, interval);
        seriesRef.current.setData(candlesRef.current);
        ema20Ref.current?.setData(indicators.ema20 ? exponentialMovingAverage(candlesRef.current, 20) : []);
        ema50Ref.current?.setData(indicators.ema50 ? exponentialMovingAverage(candlesRef.current, 50) : []);
        chartRef.current?.timeScale().fitContent();
        chartRef.current?.timeScale().scrollToRealTime();
        setHistoryStatus('fallback');
      });

    return () => controller.abort();
  }, [pair, livePrice, interval, indicators.ema20, indicators.ema50]);

  useEffect(() => {
    if (!seriesRef.current || livePrice <= 0 || candlesRef.current.length === 0) return;

    candlesRef.current = mergeTick(candlesRef.current, livePrice, interval);
    const latest = candlesRef.current[candlesRef.current.length - 1];
    seriesRef.current.update(latest);
    ema20Ref.current?.setData(indicators.ema20 ? exponentialMovingAverage(candlesRef.current, 20) : []);
    ema50Ref.current?.setData(indicators.ema50 ? exponentialMovingAverage(candlesRef.current, 50) : []);
  }, [livePrice, ticker?.updatedAt, interval, indicators.ema20, indicators.ema50]);

  useEffect(() => {
    const updateCoords = () => {
      const series = seriesRef.current;
      if (!series || !position) {
        setLineCoords({ stopLoss: null, takeProfit: null });
        return;
      }

      setLineCoords({
        stopLoss: stopLossPrice == null ? null : series.priceToCoordinate(stopLossPrice),
        takeProfit: takeProfitPrice == null ? null : series.priceToCoordinate(takeProfitPrice),
      });
    };

    updateCoords();
    const chart = chartRef.current;
    chart?.timeScale().subscribeVisibleLogicalRangeChange(updateCoords);
    window.addEventListener('resize', updateCoords);

    return () => {
      chart?.timeScale().unsubscribeVisibleLogicalRangeChange(updateCoords);
      window.removeEventListener('resize', updateCoords);
    };
  }, [position, stopLossPrice, takeProfitPrice, livePrice]);

  useEffect(() => {
    ema20Ref.current?.setData(indicators.ema20 ? exponentialMovingAverage(candlesRef.current, 20) : []);
    ema50Ref.current?.setData(indicators.ema50 ? exponentialMovingAverage(candlesRef.current, 50) : []);
  }, [indicators.ema20, indicators.ema50]);

  useEffect(() => {
    if (fitRequest > 0) {
      chartRef.current?.timeScale().fitContent();
      chartRef.current?.timeScale().scrollToRealTime();
    }
  }, [fitRequest]);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;

    priceLinesRef.current.forEach((line) => series.removePriceLine(line));
    priceLinesRef.current = [];

    if (!position) return;

    priceLinesRef.current.push(series.createPriceLine({
      price: position.entryPrice,
      color: position.side === 'long' ? '#15c990' : '#c026d3',
      lineWidth: 2,
      lineStyle: 2,
      axisLabelVisible: true,
      title: `ENTRY ${position.side.toUpperCase()}`,
    }));

  }, [
    position?.entryPrice,
    position?.pair,
    position?.side,
  ]);

  useEffect(() => {
    if (!dragging) return;
    const activeLine = dragging;

    function move(event: PointerEvent) {
      const container = containerRef.current;
      const series = seriesRef.current;
      if (!container || !series) return;

      const rect = container.getBoundingClientRect();
      const y = event.clientY - rect.top;
      const price = Number(series.coordinateToPrice(y));
      if (!Number.isFinite(price) || price <= 0) return;

      setDraftRisk((current) => ({
        ...current,
        [activeLine]: price,
      }));
    }

    function up() {
      const stopLoss = activeLine === 'stopLoss'
        ? draftRisk.stopLoss
        : (draftRisk.stopLoss ?? position?.stopLoss ?? null);
      const takeProfit = activeLine === 'takeProfit'
        ? draftRisk.takeProfit
        : (draftRisk.takeProfit ?? position?.takeProfit ?? null);

      if (position) {
        onRiskChangeRef.current?.(position.pair, stopLoss, takeProfit);
      }
      setDragging(null);
    }

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });

    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [dragging, draftRisk.stopLoss, draftRisk.takeProfit, position]);

  function renderRiskLine(kind: 'stopLoss' | 'takeProfit', y: number | null, price: number | null) {
    if (!position || y == null || price == null) return null;
    const isStop = kind === 'stopLoss';
    const color = isStop ? '#c026d3' : '#15c990';
    const label = isStop ? 'SL' : 'TP';

    return (
      <div className="absolute left-0 right-0 z-10" style={{ top: y }}>
        <div className="h-px w-full" style={{ background: color }} />
        <button
          type="button"
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setDragging(kind);
          }}
          className="absolute right-2 top-1/2 flex -translate-y-1/2 cursor-grab items-center gap-2 rounded border px-2 py-1 text-[10px] font-semibold text-white shadow-lg active:cursor-grabbing"
          style={{ borderColor: color, background: `${color}dd` }}
        >
          {label}
          <span className="num">{priceFormatter(price)}</span>
        </button>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full bg-[#0e0c0d]">
      <div ref={containerRef} className="h-full w-full" />
      {renderRiskLine('stopLoss', lineCoords.stopLoss, stopLossPrice)}
      {renderRiskLine('takeProfit', lineCoords.takeProfit, takeProfitPrice)}
      <div className="pointer-events-none absolute left-3 top-3 rounded-md border border-[#231f22] bg-[#181517]/90 px-2 py-1 text-[10px] text-[#9498a4]">
        {historyStatus === 'real' ? 'Kraken OHLC' : historyStatus === 'loading' ? 'Chargement candles' : 'Candles fallback'} · live WebSocket ticks · drag SL/TP · {interval}m
      </div>
    </div>
  );
}
