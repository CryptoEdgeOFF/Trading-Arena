export type ChartTradeFill = {
  id: string;
  pair: string;
  side: 'long' | 'short';
  action: 'open' | 'close' | 'update';
  price: number;
  time: number;
  size?: number;
};

export type ChartTradeMarker = {
  key: string;
  timeSec: number;
  price: number;
  direction: 'buy' | 'sell';
  color: string;
  text: string;
  tooltip: string;
  stack: number;
};

const BUY_COLOR = '#18c98e';
const SELL_COLOR = '#f43f6e';
const DEFAULT_MAX_MARKERS = 300;

function isBuyFill(trade: ChartTradeFill): boolean {
  return (trade.action === 'open' && trade.side === 'long')
    || (trade.action === 'close' && trade.side === 'short');
}

function toUnixSec(time: number): number {
  if (!Number.isFinite(time) || time <= 0) return 0;
  return time > 1e12 ? Math.floor(time / 1000) : Math.floor(time);
}

export function snapBarTime(timeSec: number, intervalMinutes: number): number {
  const sec = Math.max(60, Math.round(intervalMinutes) * 60);
  return Math.floor(timeSec / sec) * sec;
}

export function tvTimeToSec(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value > 1e12 ? value / 1000 : value;
}

export function resolutionToMinutes(resolution: string | undefined, fallback = 1): number {
  const value = String(resolution || '');
  if (value === '1D' || value === 'D' || value === '1d') return 1440;
  if (value === '3D') return 4320;
  if (value === '1W' || value === 'W') return 10080;
  if (value === '1M') return 43200;
  const minutes = Number.parseInt(value, 10);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : fallback;
}

type TimeScaleLike = {
  width: () => number;
  barSpacing: () => number;
  rightOffset: () => number;
  coordinateToTime?: (x: number) => number | null;
  timeToCoordinate?: (time: number) => number | null;
};

type ChartTimeApi = {
  getTimeScale?: () => TimeScaleLike;
  resolution?: () => string;
  getVisibleBarsRange?: () => { from: number; to: number } | null;
  getVisibleRange?: () => { from: number; to: number };
};

function scaleTimeAt(scale: TimeScaleLike, x: number): number {
  try {
    const raw = scale.coordinateToTime?.(x);
    return raw == null ? 0 : tvTimeToSec(raw);
  } catch {
    return 0;
  }
}

/**
 * Inverse de coordinateToTime : respecte les trous de session (or, forex, week-end).
 * L'ancienne formule linéaire supposait une bougie à chaque intervalle et
 * poussait les pastilles dans le vide.
 */
function invertCoordinateToTime(
  scale: TimeScaleLike,
  timeSec: number,
  width: number,
): number | null {
  if (!scale.coordinateToTime || !(width > 0)) return null;

  const tAt = (x: number) => scaleTimeAt(scale, x);

  const rightmostValid = (): { x: number; t: number } | null => {
    let lo = 0;
    let hi = width;
    for (let i = 0; i < 22; i += 1) {
      const mid = (lo + hi) / 2;
      if (tAt(mid)) lo = mid;
      else hi = mid;
    }
    const t = tAt(lo);
    return t ? { x: lo, t } : null;
  };

  const leftmostValid = (): { x: number; t: number } | null => {
    let lo = 0;
    let hi = width;
    for (let i = 0; i < 22; i += 1) {
      const mid = (lo + hi) / 2;
      if (tAt(mid)) hi = mid;
      else lo = mid;
    }
    const t = tAt(hi);
    return t ? { x: hi, t } : null;
  };

  let xLo = 0;
  let tLo = tAt(0);
  if (!tLo) {
    const edge = leftmostValid();
    if (!edge) return null;
    xLo = edge.x;
    tLo = edge.t;
  }

  let xHi = width;
  let tHi = tAt(width);
  if (!tHi) {
    const edge = rightmostValid();
    if (!edge) return null;
    xHi = edge.x;
    tHi = edge.t;
  }

  const tMin = Math.min(tLo, tHi);
  const tMax = Math.max(tLo, tHi);
  const pad = Math.max(60, (tMax - tMin) * 0.01);
  if (timeSec < tMin - pad || timeSec > tMax + pad) return null;

  let left = tLo <= tHi ? xLo : xHi;
  let right = tLo <= tHi ? xHi : xLo;

  for (let i = 0; i < 28; i += 1) {
    const mid = (left + right) / 2;
    const t = tAt(mid);
    if (!t) {
      right = mid;
      continue;
    }
    if (t < timeSec) left = mid;
    else right = mid;
  }

  return (left + right) / 2;
}

function linearTimeToX(
  chart: ChartTimeApi,
  scale: TimeScaleLike,
  timeSec: number,
  fallbackIntervalMinutes: number,
): number | null {
  const width = scale.width();
  const spacing = scale.barSpacing();
  if (!(width > 0) || !(spacing > 0.2)) return null;
  const rightOffset = scale.rightOffset();
  const lastBarX = width - rightOffset * spacing;
  const intervalSec = resolutionToMinutes(chart.resolution?.(), fallbackIntervalMinutes) * 60;

  let lastBarTime = 0;
  try {
    const bars = chart.getVisibleBarsRange?.();
    if (bars && Number.isFinite(bars.to)) lastBarTime = tvTimeToSec(bars.to);
  } catch {
    lastBarTime = 0;
  }
  if (!lastBarTime) {
    try {
      const visible = chart.getVisibleRange?.();
      if (visible && Number.isFinite(visible.to)) {
        lastBarTime = tvTimeToSec(visible.to) - rightOffset * intervalSec;
      }
    } catch {
      lastBarTime = 0;
    }
  }
  if (!lastBarTime) {
    lastBarTime = scaleTimeAt(scale, Math.max(0, lastBarX));
  }
  if (!lastBarTime) return null;

  const xLocal = lastBarX - ((lastBarTime - timeSec) / intervalSec) * spacing - spacing / 2;
  if (xLocal < -spacing * 2 || xLocal > width + spacing * 2) return null;
  return xLocal;
}

/**
 * X du plot TradingView (0 = bord gauche de l'échelle de temps).
 * Priorité : timeToCoordinate natif, puis inversion de coordinateToTime
 * (trous de session), puis formule linéaire en dernier recours.
 */
export function timeSecToPlotX(
  chart: ChartTimeApi,
  timeSec: number,
  fallbackIntervalMinutes = 1,
): number | null {
  if (!Number.isFinite(timeSec) || timeSec <= 0) return null;
  const scale = chart.getTimeScale?.();
  if (!scale) return null;
  const width = scale.width();
  const spacing = scale.barSpacing();
  if (!(width > 0) || !(spacing > 0.2)) return null;

  try {
    const native = scale.timeToCoordinate?.(timeSec);
    if (native != null && Number.isFinite(native)) return native;
  } catch {
    // ignore
  }

  const inverted = invertCoordinateToTime(scale, timeSec, width);
  if (inverted != null) return inverted;

  return linearTimeToX(chart, scale, timeSec, fallbackIntervalMinutes);
}

/** Fills du pair courant → icônes B/S à coller sur la bougie. */
export function chartTradeMarkers(
  trades: ChartTradeFill[] | undefined,
  pair: string,
  intervalMinutes = 1,
  maxMarkers = DEFAULT_MAX_MARKERS,
): ChartTradeMarker[] {
  if (!trades?.length || !pair) return [];
  const raw: Array<{ trade: ChartTradeFill; timeSec: number; buy: boolean }> = [];
  for (const trade of trades) {
    if (trade.pair !== pair || trade.action === 'update') continue;
    if (!(trade.price > 0)) continue;
    const rawTime = toUnixSec(trade.time);
    if (rawTime <= 0) continue;
    raw.push({
      trade,
      timeSec: snapBarTime(rawTime, intervalMinutes),
      buy: isBuyFill(trade),
    });
  }
  raw.sort((a, b) => b.timeSec - a.timeSec);
  const limited = raw.slice(0, Math.max(1, maxMarkers));
  limited.sort((a, b) => a.timeSec - b.timeSec || a.trade.time - b.trade.time);

  const markers: ChartTradeMarker[] = [];
  const stacks = new Map<string, number>();
  for (const item of limited) {
    const stackKey = `${item.timeSec}:${item.buy ? 'buy' : 'sell'}`;
    const stack = stacks.get(stackKey) ?? 0;
    stacks.set(stackKey, stack + 1);
    markers.push({
      key: `fill:${item.trade.id}:${item.trade.action}`,
      timeSec: item.timeSec,
      price: item.trade.price,
      direction: item.buy ? 'buy' : 'sell',
      color: item.buy ? BUY_COLOR : SELL_COLOR,
      text: item.buy ? 'B' : 'S',
      tooltip: `${item.buy ? 'Buy' : 'Sell'} · ${item.trade.price}`,
      stack,
    });
  }
  return markers;
}

export function tradeMarkersSignature(markers: ChartTradeMarker[]): string {
  return markers.map((marker) => `${marker.key}:${marker.timeSec}:${marker.price}`).join('|');
}
