import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { animate, motion, useMotionValue } from 'framer-motion';

/**
 * Formatters
 */
export function formatCompactSigned(value: number, decimals = 2): string {
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 10_000) return `${sign}${(abs / 1_000).toFixed(abs >= 100_000 ? 0 : 1)}K`;
  if (abs >= 1_000) return `${sign}${abs.toFixed(0)}`;
  return `${sign}${abs.toFixed(decimals)}`;
}

export function formatCompactUnsigned(value: number, decimals = 0): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 10_000) return `${(abs / 1_000).toFixed(abs >= 100_000 ? 0 : 1)}K`;
  if (abs >= 1_000) return `${abs.toFixed(0)}`;
  return abs.toFixed(decimals);
}

export function formatPercent(value: number, decimals = 2): string {
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  const abs = Math.abs(value);
  if (abs >= 10_000) return `${sign}${(abs / 1000).toFixed(1)}K`;
  if (abs >= 1000) return `${sign}${abs.toFixed(0)}`;
  if (abs >= 100) return `${sign}${abs.toFixed(1)}`;
  return `${sign}${abs.toFixed(decimals)}`;
}

/**
 * AnimatedNumber - smooth tween from previous value to new value.
 * Uses framer-motion. Renders the formatted output through a ref.
 */
export function AnimatedNumber({
  value,
  format,
  duration = 0.65,
}: {
  value: number;
  format: (v: number) => string;
  duration?: number;
}) {
  const motionValue = useMotionValue(value);
  const ref = useRef<HTMLSpanElement>(null);
  const formatRef = useRef(format);
  formatRef.current = format;

  useEffect(() => {
    if (ref.current) ref.current.textContent = formatRef.current(motionValue.get());
    const unsubscribe = motionValue.on('change', (latest) => {
      if (ref.current) ref.current.textContent = formatRef.current(latest);
    });
    return unsubscribe;
  }, [motionValue]);

  useEffect(() => {
    const controls = animate(motionValue, value, {
      duration,
      ease: [0.22, 1, 0.36, 1],
    });
    return () => controls.stop();
  }, [value, duration, motionValue]);

  return <span ref={ref}>{format(value)}</span>;
}

/**
 * Generic metric card with optional positive/negative toning.
 */
export type MetricTone = 'neutral' | 'pos' | 'neg';

export function MetricCard({
  label,
  value,
  format,
  unit,
  tone = 'neutral',
  hero = false,
  delayClass,
  trend,
  hint,
}: {
  label: string;
  value: number;
  format: (v: number) => string;
  unit?: string;
  tone?: MetricTone;
  hero?: boolean;
  delayClass?: string;
  trend?: { value: number; suffix?: string } | null;
  hint?: ReactNode;
}) {
  const cardCls = `metric ${tone === 'pos' ? 'metric-pos' : tone === 'neg' ? 'metric-neg' : ''} ${
    hero ? 'metric-hero' : ''
  } card-shine rise-in ${delayClass || ''}`;
  const valueCls = `metric-value ${tone === 'pos' ? 'is-pos' : tone === 'neg' ? 'is-neg' : ''}`;

  return (
    <motion.div
      className={cardCls}
      whileHover={{ y: -2 }}
      transition={{ type: 'spring', stiffness: 320, damping: 22 }}
    >
      <div className="metric-label">
        <span className="truncate">{label}</span>
        {trend && (
          <span className={`metric-trend ${trend.value > 0 ? 'up' : trend.value < 0 ? 'down' : 'flat'}`}>
            {trend.value > 0 ? '▲' : trend.value < 0 ? '▼' : '–'}
            {Math.abs(trend.value).toFixed(1)}
            {trend.suffix || ''}
          </span>
        )}
      </div>
      <div className={valueCls}>
        <AnimatedNumber value={value} format={format} />
        {unit && <span className="unit">{unit}</span>}
      </div>
      {hint && <div className="text-[10px] uppercase tracking-[0.18em] text-[#71717a]">{hint}</div>}
    </motion.div>
  );
}

/**
 * Big PnL display block: large % up top, $ underneath, with progress bar.
 */
export function PnLDisplay({
  pnlPercent,
  pnlUsd,
  size = 'md',
  align = 'right',
}: {
  pnlPercent: number;
  pnlUsd: number;
  size?: 'md' | 'lg';
  align?: 'left' | 'right' | 'center';
}) {
  const pos = pnlPercent >= 0;
  const tone = pnlPercent === 0 ? 'flat' : pos ? 'up' : 'down';
  const alignCls = align === 'right' ? 'items-end text-right' : align === 'center' ? 'items-center text-center' : 'items-start text-left';
  const fillRatio = Math.min(1, Math.abs(pnlPercent) / 100);

  return (
    <div className={`flex min-w-0 flex-col gap-2 ${alignCls}`}>
      <div className="micro text-[10px] text-[#71717a]">PnL</div>
      <div
        className={`metric-value ${size === 'lg' ? 'metric-pnl-big' : ''} ${
          pos ? 'is-pos' : 'is-neg'
        }`}
        style={{ justifyContent: align === 'right' ? 'flex-end' : align === 'center' ? 'center' : 'flex-start' }}
      >
        <AnimatedNumber value={pnlPercent} format={(v) => formatPercent(v)} />
        <span className="unit">%</span>
      </div>
      <div className={`pnl-pill ${tone}`}>
        <AnimatedNumber value={pnlUsd} format={(v) => formatCompactSigned(v)} />
        <span className="text-[#71717a]">USD</span>
      </div>
      <div className="progress-track w-full max-w-[180px]">
        <div
          className={`progress-fill ${pos ? 'up' : 'down'}`}
          style={{ width: `${fillRatio * 100}%` }}
        />
      </div>
    </div>
  );
}

/**
 * Lightweight hook: detect when value changes to flash the wrapper.
 */
export function useValueFlash(value: number): 'up' | 'down' | null {
  const [flash, setFlash] = useState<'up' | 'down' | null>(null);
  const prev = useRef(value);
  useEffect(() => {
    if (value > prev.current) setFlash('up');
    else if (value < prev.current) setFlash('down');
    prev.current = value;
    const id = setTimeout(() => setFlash(null), 700);
    return () => clearTimeout(id);
  }, [value]);
  return flash;
}
