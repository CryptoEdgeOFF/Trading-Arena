import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { resolveMediaUrl } from '../utils/imageUrl';
import './PnlRaceChart.css';

// Course au PnL des 3 leaders. Design volontairement sobre :
// palette podium (or / argent / bronze), courbes fortement lissées,
// échelle zoomée sur l'écart réel entre les traders.

export type PnlHistorySample = { t: number; rows: Array<{ userId: string; pnlPercent: number }> };
export type PnlHistoryTrader = {
  userId: string;
  name: string;
  avatarUrl?: string | null;
  rank: number;
  pnlPercent: number;
  breached?: boolean;
};
export type PnlMoment = { t: number; type: 'leader' | 'top3'; userId: string };

const CHART_WIDTH = 720;
const CHART_HEIGHT = 280;
const PADDING = { top: 18, right: 52, bottom: 16, left: 14 };
const PODIUM_COLORS = ['#ffc94d', '#c9d2dc', '#cd8b4e'];
const MAX_SERIES = 3;
const BUCKETS = 48;

type Series = {
  trader: PnlHistoryTrader;
  color: string;
  points: Array<{ x: number; y: number }>;
  path: string;
  areaPath: string;
  isLeader: boolean;
  lastValue: number;
};

/**
 * Moyenne par tranche de temps puis EMA : élimine le bruit des
 * échantillons ~10 s pour obtenir une courbe propre.
 */
function resample(list: Array<{ t: number; value: number }>, t0: number, timeSpan: number): Array<{ t: number; value: number }> {
  if (list.length <= 3) return list;
  const buckets: Array<{ sum: number; count: number; t: number }> = [];
  for (const point of list) {
    const index = Math.min(BUCKETS - 1, Math.floor(((point.t - t0) / timeSpan) * BUCKETS));
    if (!buckets[index]) buckets[index] = { sum: 0, count: 0, t: t0 + ((index + 0.5) / BUCKETS) * timeSpan };
    buckets[index].sum += point.value;
    buckets[index].count += 1;
  }
  const averaged = buckets.filter(Boolean).map((bucket) => ({ t: bucket.t, value: bucket.sum / bucket.count }));
  const alpha = 0.45;
  let ema = averaged[0].value;
  const smoothed = averaged.map((point) => {
    ema += alpha * (point.value - ema);
    return { t: point.t, value: ema };
  });
  // Le dernier point reste la valeur réelle actuelle.
  smoothed[smoothed.length - 1] = { t: list[list.length - 1].t, value: list[list.length - 1].value };
  return smoothed;
}

/** Courbe fluide (Catmull-Rom → Bézier). */
function smoothPath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return '';
  if (points.length < 3) {
    return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  }
  let path = `M${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const p0 = points[Math.max(0, index - 1)];
    const p1 = points[index];
    const p2 = points[index + 1];
    const p3 = points[Math.min(points.length - 1, index + 2)];
    path += ` C${(p1.x + (p2.x - p0.x) / 6).toFixed(1)} ${(p1.y + (p2.y - p0.y) / 6).toFixed(1)},${(p2.x - (p3.x - p1.x) / 6).toFixed(1)} ${(p2.y - (p3.y - p1.y) / 6).toFixed(1)},${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return path;
}

function buildChart(
  samples: PnlHistorySample[],
  traders: PnlHistoryTrader[],
): { series: Series[]; min: number; max: number; yFor: (value: number) => number } | null {
  const ranked = traders
    .filter((trader) => trader.rank > 0)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, MAX_SERIES);
  if (ranked.length === 0 || samples.length < 2) return null;

  const t0 = samples[0].t;
  const t1 = samples[samples.length - 1].t;
  const timeSpan = Math.max(1, t1 - t0);

  const values = new Map<string, Array<{ t: number; value: number }>>();
  for (const trader of ranked) values.set(trader.userId, []);
  for (const sample of samples) {
    for (const row of sample.rows) {
      values.get(row.userId)?.push({ t: sample.t, value: row.pnlPercent });
    }
  }
  for (const [userId, list] of values) {
    values.set(userId, resample(list, t0, timeSpan));
  }

  // Échelle zoomée sur l'écart réel entre le premier et le dernier.
  let min = Infinity;
  let max = -Infinity;
  for (const list of values.values()) {
    for (const point of list) {
      if (point.value < min) min = point.value;
      if (point.value > max) max = point.value;
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  const span = Math.max(0.5, max - min);
  const paddedMin = min - span * 0.14;
  const paddedMax = max + span * 0.14;

  const innerWidth = CHART_WIDTH - PADDING.left - PADDING.right;
  const innerHeight = CHART_HEIGHT - PADDING.top - PADDING.bottom;
  const xFor = (t: number) => PADDING.left + ((t - t0) / timeSpan) * innerWidth;
  const yFor = (value: number) => PADDING.top + (1 - (value - paddedMin) / (paddedMax - paddedMin)) * innerHeight;
  const bottomY = CHART_HEIGHT - PADDING.bottom;

  const series = ranked
    .map((trader, index) => {
      const list = values.get(trader.userId) || [];
      if (list.length < 2) return null;
      const points = list.map((point) => ({ x: xFor(point.t), y: yFor(point.value) }));
      const path = smoothPath(points);
      const first = points[0];
      const last = points[points.length - 1];
      return {
        trader,
        color: PODIUM_COLORS[index],
        points,
        path,
        areaPath: `${path} L${last.x.toFixed(1)} ${bottomY} L${first.x.toFixed(1)} ${bottomY} Z`,
        isLeader: trader.rank === 1,
        lastValue: list[list.length - 1].value,
      };
    })
    .filter((item): item is Series => item !== null);

  return { series, min, max, yFor };
}

export function mergePnlSamples(previous: PnlHistorySample[], incoming: PnlHistorySample[]): PnlHistorySample[] {
  const byTime = new Map<number, PnlHistorySample>();
  for (const sample of [...previous, ...incoming]) {
    byTime.set(Math.round(sample.t / 1000), sample);
  }
  return [...byTime.values()].sort((a, b) => a.t - b.t).slice(-480);
}

export default function PnlRaceChart({
  samples,
  traders,
  currentUserId,
}: {
  samples: PnlHistorySample[];
  traders: PnlHistoryTrader[];
  moments?: PnlMoment[];
  currentUserId?: string | null;
}) {
  const { t } = useTranslation();
  const chart = useMemo(() => buildChart(samples, traders), [samples, traders]);
  const leader = traders.filter((trader) => trader.rank > 0).sort((a, b) => a.rank - b.rank)[0];
  const fmt = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;

  if (!chart || chart.series.length === 0) {
    return (
      <section className="pnl-race">
        <header className="pnl-race__head">
          <div><span>{t('raceChart.kicker')}</span><h3>{t('raceChart.title')}</h3></div>
        </header>
        <div className="pnl-race__collecting"><i />{t('raceChart.collecting')}</div>
      </section>
    );
  }

  const { series, min, max, yFor } = chart;
  const tickStep = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000]
    .find((step) => (max - min) / step <= 4) || 1000;
  const tickDecimals = tickStep < 1 ? 1 : 0;
  const ticks: number[] = [];
  for (let value = Math.ceil(min / tickStep) * tickStep; value <= max; value += tickStep) {
    ticks.push(Number(value.toFixed(2)));
  }

  return (
    <section className="pnl-race">
      <header className="pnl-race__head">
        <div><span>{t('raceChart.kicker')}</span><h3>{t('raceChart.title')}</h3></div>
        {leader && <em className="pnl-race__leader">👑 {t('raceChart.dominates', { name: leader.name })}</em>}
      </header>

      <div className="pnl-race__chart">
        <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id="pnl-race-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={PODIUM_COLORS[0]} stopOpacity="0.14" />
              <stop offset="100%" stopColor={PODIUM_COLORS[0]} stopOpacity="0" />
            </linearGradient>
          </defs>
          {ticks.map((value) => (
            <g key={value}>
              <line className="pnl-race__grid" x1={PADDING.left} y1={yFor(value)} x2={CHART_WIDTH - PADDING.right} y2={yFor(value)} />
              <text className="pnl-race__tick" x={CHART_WIDTH - PADDING.right + 8} y={yFor(value) + 3.5}>
                {value.toFixed(tickDecimals)}%
              </text>
            </g>
          ))}
          {series.filter((item) => item.isLeader).map((item) => (
            <path key={`fill-${item.trader.userId}`} d={item.areaPath} fill="url(#pnl-race-fill)" stroke="none" />
          ))}
          {[...series].reverse().map((item) => (
            <path key={item.trader.userId} className="pnl-race__line" d={item.path} fill="none" stroke={item.color}
              strokeWidth={item.isLeader ? 2.6 : 1.8}
              strokeLinecap="round" strokeLinejoin="round"
              opacity={item.trader.breached ? 0.35 : 1} />
          ))}
        </svg>
        {series.map((item) => {
          const last = item.points[item.points.length - 1];
          return (
            <span key={item.trader.userId}
              className={`pnl-race__avatar ${item.isLeader ? 'is-leader' : ''} ${item.trader.userId === currentUserId ? 'is-me' : ''}`}
              style={{
                left: `${(last.x / CHART_WIDTH) * 100}%`,
                top: `${(last.y / CHART_HEIGHT) * 100}%`,
                borderColor: item.color,
                zIndex: 10 - item.trader.rank,
              }}>
              {item.trader.avatarUrl
                ? <img src={resolveMediaUrl(item.trader.avatarUrl)} alt={item.trader.name} />
                : <i>{item.trader.name.slice(0, 2).toUpperCase()}</i>}
            </span>
          );
        })}
      </div>

      <div className="pnl-race__legend">
        {series.map((item) => (
          <span key={item.trader.userId} className={`pnl-race__chip ${item.isLeader ? 'is-leader' : ''}`}>
            <b style={{ color: item.color }}>#{item.trader.rank}</b>
            <strong>{item.trader.name}</strong>
            <em className={item.lastValue >= 0 ? 'positive' : 'negative'}>{fmt(item.lastValue)}</em>
          </span>
        ))}
      </div>
    </section>
  );
}
