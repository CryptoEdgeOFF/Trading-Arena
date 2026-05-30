import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useGameStore } from '../stores/useGameStore';
import {
  MALUS_LABELS,
  MALUS_SPIN_MS,
  getMalusPhase,
  formatMalusClock,
  type MalusPhase,
  type MalusType,
} from '../utils/malus';

const ITEM_W = 190;
const GAP = 14;
const STEP = ITEM_W + GAP;
const WINDOW_W = 620;
const WINDOW_CENTER = WINDOW_W / 2;
const ITEM_COUNT = 34;
/** Index sur lequel le carousel s'arrête (selon la parité = type). */
const TARGET_INDEX: Record<MalusType, number> = { direction: 28, asset: 29 };

function buildItems(): MalusType[] {
  return Array.from({ length: ITEM_COUNT }, (_, i) => (i % 2 === 0 ? 'direction' : 'asset'));
}

function MalusIcon({ type, size = 34 }: { type: MalusType; size?: number }) {
  if (type === 'direction') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3v18" />
        <path d="M7 8l5-5 5 5" />
        <path d="M7 16l5 5 5-5" />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="3.4" />
    </svg>
  );
}

function Carousel({ type, animate, landed }: { type: MalusType; animate: boolean; landed: boolean }) {
  const items = useMemo(buildItems, []);
  const targetIndex = TARGET_INDEX[type];
  const finalX = WINDOW_CENTER - (targetIndex * STEP + ITEM_W / 2);
  const initialX = WINDOW_CENTER - ITEM_W / 2;
  const accent = MALUS_LABELS[type].color;

  return (
    <div className="relative" style={{ width: WINDOW_W, height: 150 }}>
      {/* Cadre de sélection central */}
      <div
        className="pointer-events-none absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2 rounded-2xl"
        style={{
          width: ITEM_W + 8,
          height: 138,
          border: `2px solid ${landed ? accent : 'rgba(255,255,255,0.25)'}`,
          boxShadow: landed ? `0 0 30px ${accent}66` : 'none',
          transition: 'border-color 0.3s, box-shadow 0.3s',
        }}
      />
      {/* Pointeur haut */}
      <div className="pointer-events-none absolute left-1/2 top-[2px] z-30 -translate-x-1/2">
        <div
          className="h-0 w-0"
          style={{
            borderLeft: '8px solid transparent',
            borderRight: '8px solid transparent',
            borderTop: `12px solid ${landed ? accent : '#f8fafc'}`,
          }}
        />
      </div>

      {/* Piste avec fondu sur les bords */}
      <div
        className="absolute inset-0 overflow-hidden"
        style={{ maskImage: 'linear-gradient(to right, transparent, #000 14%, #000 86%, transparent)', WebkitMaskImage: 'linear-gradient(to right, transparent, #000 14%, #000 86%, transparent)' }}
      >
        <motion.div
          className="absolute top-1/2 flex -translate-y-1/2"
          style={{ gap: GAP }}
          initial={{ x: animate ? initialX : finalX }}
          animate={{ x: finalX }}
          transition={animate ? { duration: MALUS_SPIN_MS / 1000, ease: [0.12, 0.8, 0.12, 1] } : { duration: 0 }}
        >
          {items.map((itemType, i) => {
            const selected = landed && i === targetIndex;
            const meta = MALUS_LABELS[itemType];
            return (
              <div
                key={i}
                className="flex shrink-0 flex-col items-center justify-center gap-2 rounded-2xl"
                style={{
                  width: ITEM_W,
                  height: 130,
                  background: selected ? `${meta.color}1f` : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${selected ? meta.color : 'rgba(255,255,255,0.08)'}`,
                  color: selected ? meta.color : 'rgba(255,255,255,0.55)',
                  transform: selected ? 'scale(1.04)' : 'scale(1)',
                  transition: 'all 0.3s',
                }}
              >
                <MalusIcon type={itemType} />
                <span className="text-xs font-bold uppercase tracking-[0.18em]">{meta.short}</span>
              </div>
            );
          })}
        </motion.div>
      </div>
    </div>
  );
}

export default function MalusWheelOverlay() {
  const malus = useGameStore((s) => s.malus);
  const [now, setNow] = useState(() => Date.now());

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
  const animateSpin = mountInfoRef.current?.animate ?? false;
  const isBig = phase === 'spinning' || phase === 'prep';

  return (
    <AnimatePresence>
      {isBig ? (
        <motion.div
          key="malus-modal"
          className="fixed inset-0 z-[140] flex items-center justify-center bg-black/85 backdrop-blur-md"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            className="flex flex-col items-center gap-8 px-6 text-center"
            initial={{ scale: 0.92, y: 16 }}
            animate={{ scale: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 220, damping: 24 }}
          >
            <span className="text-xs font-bold uppercase tracking-[0.4em] text-slate-400">Malus</span>

            <Carousel type={malus.type} animate={animateSpin} landed={phase === 'prep'} />

            {phase === 'spinning' ? (
              <motion.p
                className="text-sm font-medium uppercase tracking-[0.25em] text-slate-500"
                animate={{ opacity: [0.3, 0.9, 0.3] }}
                transition={{ duration: 1.2, repeat: Infinity }}
              >
                Tirage en cours
              </motion.p>
            ) : (
              <motion.div className="flex max-w-md flex-col items-center gap-4" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
                <div className="flex items-center gap-2" style={{ color: meta.color }}>
                  <MalusIcon type={malus.type} size={26} />
                  <h2 className="text-2xl font-black uppercase tracking-wide text-white">{meta.title}</h2>
                </div>
                <p className="text-base text-slate-300">{meta.description}</p>
                <p className="text-sm text-amber-300/90">{meta.prep}</p>
                <div className="mt-1 flex flex-col items-center gap-1">
                  <span className="text-[11px] uppercase tracking-[0.3em] text-slate-500">Préparation</span>
                  <span className="font-mono text-5xl font-black tabular-nums text-white">{formatMalusClock(malus.prepEndAt - now)}</span>
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
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl"
              style={{ background: `${meta.color}22`, border: `1px solid ${meta.color}`, color: meta.color }}
            >
              <MalusIcon type={malus.type} size={26} />
            </div>
            <div className="min-w-0 flex-1">
              {phase === 'active' ? (
                <>
                  <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-slate-400">
                    <span className="inline-block h-2 w-2 animate-pulse rounded-full" style={{ background: meta.color }} />
                    Malus actif
                  </div>
                  <div className="truncate text-sm font-bold text-white">{meta.title}</div>
                  <div className="font-mono text-2xl font-black tabular-nums text-white">{formatMalusClock(malus.endAt - now)}</div>
                </>
              ) : (
                <>
                  <div className="text-[11px] font-bold uppercase tracking-widest text-emerald-400">Malus terminé</div>
                  <div className="truncate text-sm font-bold text-white">{meta.title}</div>
                  <div className="text-xs text-slate-400">Le malus est levé</div>
                </>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
