import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useGameStore } from '../stores/useGameStore';
import {
  MALUS_SEGMENTS,
  MALUS_LABELS,
  MALUS_SPIN_MS,
  getMalusPhase,
  malusWheelRotation,
  formatMalusClock,
  type MalusPhase,
} from '../utils/malus';

const WHEEL_BOX = 340;
const WHEEL_CENTER = WHEEL_BOX / 2;
const WHEEL_RADIUS = 158;
const SEGMENT_ANGLE = 360 / MALUS_SEGMENTS.length;

function polar(angleDeg: number, radius: number): { x: number; y: number } {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: WHEEL_CENTER + radius * Math.cos(rad),
    y: WHEEL_CENTER + radius * Math.sin(rad),
  };
}

function wedgePath(startAngle: number, endAngle: number): string {
  const start = polar(startAngle, WHEEL_RADIUS);
  const end = polar(endAngle, WHEEL_RADIUS);
  const large = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${WHEEL_CENTER} ${WHEEL_CENTER} L ${start.x} ${start.y} A ${WHEEL_RADIUS} ${WHEEL_RADIUS} 0 ${large} 1 ${end.x} ${end.y} Z`;
}

const SEGMENT_FILLS: Record<string, [string, string]> = {
  direction: ['#ef4444', '#dc2626'],
  asset: ['#f59e0b', '#d97706'],
};

function Wheel({ rotation, animate, highlightIndex }: { rotation: number; animate: boolean; highlightIndex: number | null }) {
  return (
    <div className="relative" style={{ width: WHEEL_BOX, height: WHEEL_BOX }}>
      {/* Pointeur en haut */}
      <div className="absolute left-1/2 top-[-6px] z-10 -translate-x-1/2">
        <div
          className="h-0 w-0"
          style={{
            borderLeft: '16px solid transparent',
            borderRight: '16px solid transparent',
            borderTop: '26px solid #f8fafc',
            filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.6))',
          }}
        />
      </div>
      <motion.svg
        width={WHEEL_BOX}
        height={WHEEL_BOX}
        viewBox={`0 0 ${WHEEL_BOX} ${WHEEL_BOX}`}
        initial={{ rotate: animate ? 0 : rotation }}
        animate={{ rotate: rotation }}
        transition={animate ? { duration: MALUS_SPIN_MS / 1000, ease: [0.16, 1, 0.3, 1] } : { duration: 0 }}
        style={{ filter: 'drop-shadow(0 0 40px rgba(0,0,0,0.6))' }}
      >
        <circle cx={WHEEL_CENTER} cy={WHEEL_CENTER} r={WHEEL_RADIUS + 6} fill="#0f172a" stroke="#f8fafc" strokeWidth={4} />
        {MALUS_SEGMENTS.map((type, i) => {
          const start = i * SEGMENT_ANGLE;
          const end = start + SEGMENT_ANGLE;
          const [a, b] = SEGMENT_FILLS[type];
          const fill = i % 4 < 2 ? a : b;
          const center = start + SEGMENT_ANGLE / 2;
          const dim = highlightIndex != null && highlightIndex !== i;
          return (
            <g key={i} opacity={dim ? 0.35 : 1}>
              <path d={wedgePath(start, end)} fill={fill} stroke="rgba(15,23,42,0.55)" strokeWidth={2} />
              <g transform={`rotate(${center} ${WHEEL_CENTER} ${WHEEL_CENTER})`}>
                <text
                  x={WHEEL_CENTER}
                  y={WHEEL_CENTER - WHEEL_RADIUS + 44}
                  textAnchor="middle"
                  fontSize={30}
                >
                  {MALUS_LABELS[type].icon}
                </text>
                <text
                  x={WHEEL_CENTER}
                  y={WHEEL_CENTER - WHEEL_RADIUS + 70}
                  textAnchor="middle"
                  fontSize={15}
                  fontWeight={800}
                  fill="#fff"
                  style={{ letterSpacing: '0.04em' }}
                >
                  {MALUS_LABELS[type].short.toUpperCase()}
                </text>
              </g>
            </g>
          );
        })}
        <circle cx={WHEEL_CENTER} cy={WHEEL_CENTER} r={26} fill="#0f172a" stroke="#f8fafc" strokeWidth={4} />
      </motion.svg>
    </div>
  );
}

export default function MalusWheelOverlay() {
  const malus = useGameStore((s) => s.malus);
  const [now, setNow] = useState(() => Date.now());

  // Phase au montage de CE malus : détermine si on joue l'animation de spin.
  const mountInfoRef = useRef<{ id: string; animate: boolean } | null>(null);
  if (malus && mountInfoRef.current?.id !== malus.id) {
    mountInfoRef.current = {
      id: malus.id,
      animate: Date.now() < malus.triggeredAt + MALUS_SPIN_MS,
    };
  }
  if (!malus) mountInfoRef.current = null;

  useEffect(() => {
    if (!malus) return;
    const interval = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(interval);
  }, [malus]);

  const phase: MalusPhase | null = useMemo(() => (malus ? getMalusPhase(malus, now) : null), [malus, now]);

  if (!malus || !phase) return null;

  const meta = MALUS_LABELS[malus.type];
  const rotation = malusWheelRotation(malus.segmentIndex);
  const animateSpin = mountInfoRef.current?.animate ?? false;

  const isBig = phase === 'spinning' || phase === 'prep';

  return (
    <AnimatePresence>
      {isBig ? (
        <motion.div
          key="malus-modal"
          className="fixed inset-0 z-[140] flex items-center justify-center bg-black/80 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            className="flex flex-col items-center gap-6 px-6 text-center"
            initial={{ scale: 0.85, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 200, damping: 22 }}
          >
            <div className="flex items-center gap-3">
              <span className="text-3xl">🎡</span>
              <h2 className="text-3xl font-black uppercase tracking-[0.15em] text-white">Malus</h2>
            </div>

            <Wheel rotation={rotation} animate={animateSpin} highlightIndex={phase === 'prep' ? malus.segmentIndex : null} />

            {phase === 'spinning' ? (
              <motion.p
                className="text-lg font-semibold text-slate-300"
                animate={{ opacity: [0.4, 1, 0.4] }}
                transition={{ duration: 1.2, repeat: Infinity }}
              >
                La roue tourne…
              </motion.p>
            ) : (
              <motion.div
                className="flex flex-col items-center gap-3"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <div
                  className="rounded-2xl px-6 py-3 text-2xl font-black uppercase tracking-wide text-white shadow-lg"
                  style={{ background: `linear-gradient(135deg, ${meta.color}, ${meta.color}cc)` }}
                >
                  {meta.icon} {meta.title}
                </div>
                <p className="max-w-md text-base text-slate-200">{meta.description}</p>
                <p className="max-w-md text-sm text-amber-300">{meta.prep}</p>
                <div className="mt-2 flex flex-col items-center gap-1">
                  <span className="text-xs uppercase tracking-widest text-slate-400">Préparation — coupez vos positions</span>
                  <span className="font-mono text-5xl font-black tabular-nums text-white">
                    {formatMalusClock(malus.prepEndAt - now)}
                  </span>
                </div>
              </motion.div>
            )}
          </motion.div>
        </motion.div>
      ) : (
        <motion.div
          key="malus-corner"
          className="fixed right-4 top-4 z-[140] w-64 overflow-hidden rounded-2xl border border-white/10 bg-slate-900/95 shadow-2xl backdrop-blur"
          initial={{ opacity: 0, scale: 0.6, x: 40, y: -40 }}
          animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
          exit={{ opacity: 0, scale: 0.8 }}
          transition={{ type: 'spring', stiffness: 220, damping: 24 }}
        >
          <div className="h-1 w-full" style={{ background: meta.color }} />
          <div className="flex items-center gap-3 p-4">
            <div
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-2xl"
              style={{ background: `${meta.color}22`, border: `1px solid ${meta.color}` }}
            >
              {meta.icon}
            </div>
            <div className="min-w-0 flex-1">
              {phase === 'active' ? (
                <>
                  <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-slate-400">
                    <span className="inline-block h-2 w-2 animate-pulse rounded-full" style={{ background: meta.color }} />
                    Malus actif
                  </div>
                  <div className="truncate text-sm font-bold text-white">{meta.title}</div>
                  <div className="font-mono text-2xl font-black tabular-nums text-white">
                    {formatMalusClock(malus.endAt - now)}
                  </div>
                </>
              ) : (
                <>
                  <div className="text-[11px] font-bold uppercase tracking-widest text-emerald-400">Malus terminé</div>
                  <div className="truncate text-sm font-bold text-white">{meta.title}</div>
                  <div className="text-xs text-slate-400">Le malus est levé ✅</div>
                </>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
