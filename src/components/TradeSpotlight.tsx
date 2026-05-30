import { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useGameStore } from '../stores/useGameStore';
import type { SpotlightTrade } from '../stores/useGameStore';
import PlayerAvatar from './PlayerAvatar';
import { fmtMarketPrice, formatEngineSizeDisplay } from '../utils/positionSizing';
import { releaseSpotlightSlot } from '../utils/arenaSounds';

const DISPLAY_DURATION = 5200;
const STOP_LOSS_DURATION = 6000;
const TAKE_PROFIT_DURATION = 6000;

type Variant = 'open' | 'manual-close' | 'stop-loss' | 'trailing-stop' | 'take-profit';

function getVariant(trade: SpotlightTrade): Variant {
  if (trade.action === 'open') return 'open';
  if (trade.reason === 'stop-loss') {
    // Stop loss suiveur : SL déclenché en gain → traité comme un take profit
    // (vert, son TP). Le trader a sécurisé du profit en suivant le prix.
    return trade.pnl > 0 ? 'trailing-stop' : 'stop-loss';
  }
  if (trade.reason === 'take-profit') return 'take-profit';
  return 'manual-close';
}

function getDuration(variant: Variant): number {
  if (variant === 'stop-loss') return STOP_LOSS_DURATION;
  if (variant === 'take-profit' || variant === 'trailing-stop') return TAKE_PROFIT_DURATION;
  return DISPLAY_DURATION;
}

interface VariantStyle {
  banner: string;
  bannerLabel: string;
  border: string;
  glow: string;
  bg: string;
  accent: string;
  glyph: string;
}

function getStyle(variant: Variant, playerColor: string): VariantStyle {
  switch (variant) {
    case 'stop-loss':
      return {
        banner: 'bg-gradient-to-r from-red-700 via-red-600 to-red-700 text-white',
        bannerLabel: '⚠ STOP LOSS DÉCLENCHÉ ⚠',
        border: '#dc2626',
        glow: 'rgba(220, 38, 38, 0.55)',
        bg: 'linear-gradient(135deg, #1a0606 0%, #2a0a0a 50%, #0d0202 100%)',
        accent: '#fca5a5',
        glyph: '🩸',
      };
    case 'take-profit':
      return {
        banner: 'bg-gradient-to-r from-emerald-600 via-emerald-500 to-emerald-600 text-white',
        bannerLabel: '✦ TAKE PROFIT ATTEINT ✦',
        border: '#10b981',
        glow: 'rgba(16, 185, 129, 0.55)',
        bg: 'linear-gradient(135deg, #042417 0%, #0a3a26 50%, #021810 100%)',
        accent: '#6ee7b7',
        glyph: '💰',
      };
    case 'trailing-stop':
      return {
        banner: 'bg-gradient-to-r from-emerald-600 via-emerald-500 to-emerald-600 text-white',
        bannerLabel: '⤴ STOP LOSS SUIVEUR ⤴',
        border: '#10b981',
        glow: 'rgba(16, 185, 129, 0.55)',
        bg: 'linear-gradient(135deg, #042417 0%, #0a3a26 50%, #021810 100%)',
        accent: '#6ee7b7',
        glyph: '🛡️',
      };
    case 'manual-close':
      return {
        banner: 'bg-gradient-to-r from-zinc-700 to-zinc-600 text-white',
        bannerLabel: 'POSITION FERMÉE',
        border: playerColor,
        glow: `${playerColor}60`,
        bg: 'linear-gradient(135deg, #0f0f0f 0%, #1a1a1f 100%)',
        accent: playerColor,
        glyph: '✕',
      };
    case 'open':
    default:
      return {
        banner: 'bg-gradient-to-r from-red-600 to-red-500 text-white',
        bannerLabel: 'NOUVELLE POSITION',
        border: playerColor,
        glow: `${playerColor}50`,
        bg: 'linear-gradient(135deg, #0f0f0f 0%, #1a1a2e 100%)',
        accent: playerColor,
        glyph: '◢',
      };
  }
}

export default function TradeSpotlight() {
  const current = useGameStore((s) => s.spotlightTrade);
  const dismissSpotlight = useGameStore((s) => s.dismissSpotlight);

  useEffect(() => {
    if (!current) return;
    const duration = getDuration(getVariant(current));
    const timer = window.setTimeout(() => {
      dismissSpotlight();
      releaseSpotlightSlot();
    }, duration);
    return () => {
      window.clearTimeout(timer);
      releaseSpotlightSlot();
    };
  }, [current, dismissSpotlight]);

  if (!current) {
    return (
      <AnimatePresence>{null}</AnimatePresence>
    );
  }

  const variant = getVariant(current);
  const style = getStyle(variant, current.playerColor);
  const isLong = current.side === 'long';
  const duration = getDuration(variant);
  const isPnlPositive = current.pnl >= 0;
  const isHero = variant === 'stop-loss' || variant === 'take-profit' || variant === 'trailing-stop';
  const base = current.pair.split('/')[0] || '';
  const sizeDisplay = formatEngineSizeDisplay(current.pair, current.size, base);
  const sizeLabel = `${sizeDisplay.text} ${sizeDisplay.unit}`;

  return (
    <AnimatePresence>
      <motion.div
        key={current.id}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.3 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-md"
      >
        {/* Hero glow halo (SL / TP) */}
        {isHero && (
          <motion.div
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1.2, opacity: 0.55 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
            className="absolute h-[640px] w-[640px] rounded-full pointer-events-none"
            style={{
              background: `radial-gradient(circle, ${style.glow} 0%, transparent 60%)`,
              filter: 'blur(40px)',
            }}
          />
        )}

        <motion.div
          initial={{ scale: isHero ? 0.55 : 0.7, y: 60 }}
          animate={{ scale: 1, y: 0 }}
          exit={{ scale: 0.85, y: -30, opacity: 0 }}
          transition={{ type: 'spring', stiffness: isHero ? 220 : 180, damping: isHero ? 18 : 22 }}
          className={`relative ${isHero ? 'w-[720px]' : 'w-[640px]'} rounded-3xl border-2 overflow-hidden`}
          style={{
            borderColor: style.border,
            background: style.bg,
            boxShadow: `0 0 80px ${style.glow}, 0 0 200px ${style.glow}, inset 0 1px 0 rgba(255,255,255,0.05)`,
          }}
        >
          {/* Banner */}
          <div className={`relative w-full ${isHero ? 'py-4' : 'py-3'} text-center font-bold uppercase ${style.banner}`}>
            <motion.span
              key={`${current.id}-label`}
              initial={{ scale: 0.85, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.1 }}
              className={`${isHero ? 'text-xl tracking-[0.32em]' : 'text-sm tracking-[0.22em]'} display`}
            >
              {style.bannerLabel}
            </motion.span>

            {isHero && (
              <motion.div
                className="pointer-events-none absolute inset-0"
                initial={{ x: '-100%' }}
                animate={{ x: '100%' }}
                transition={{ duration: 1.6, repeat: Infinity, ease: 'linear' }}
                style={{
                  background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.18), transparent)',
                }}
              />
            )}
          </div>

          <div className={`${isHero ? 'px-12 py-9' : 'px-10 py-8'}`}>
            {/* Player */}
            <div className="flex items-center gap-5 mb-7">
              <PlayerAvatar
                name={current.playerName}
                color={current.playerColor}
                avatar={current.playerAvatar}
                size="lg"
                glow
              />
              <div>
                <div className={`display font-bold text-white leading-none ${isHero ? 'text-4xl' : 'text-3xl'}`}>
                  {current.playerName}
                </div>
                <div className={`mt-1.5 text-zinc-400 ${isHero ? 'text-base' : 'text-sm'}`}>
                  {variant === 'stop-loss' && 'a touché son stop loss'}
                  {variant === 'trailing-stop' && 'a sécurisé son gain au stop suiveur'}
                  {variant === 'take-profit' && 'a sécurisé son take profit'}
                  {variant === 'manual-close' && 'a fermé sa position'}
                  {variant === 'open' && "vient d'ouvrir une position"}
                </div>
              </div>
            </div>

            {/* Direction + Pair */}
            <div className="flex items-center gap-5 mb-7">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: 0.15, type: 'spring' }}
                className={`text-lg font-bold px-5 py-2.5 rounded-xl border ${
                  isLong
                    ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                    : 'bg-red-500/15 text-red-400 border-red-500/30'
                }`}
              >
                {isLong ? '▲ LONG' : '▼ SHORT'}
              </motion.div>

              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.25 }}
                className={`display num font-bold text-white tracking-[0.04em] ${isHero ? 'text-6xl' : 'text-5xl'}`}
              >
                {current.pair}
              </motion.div>
            </div>

            {/* Details */}
            {variant === 'open' ? (
              <div className="grid grid-cols-2 gap-4">
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.35 }}
                  className="min-w-0 rounded-xl bg-white/5 border border-white/5 p-5"
                >
                  <div className="micro mb-2 text-zinc-500">Taille</div>
                  <div
                    className="display num truncate text-2xl font-bold text-white tabular-nums"
                    title={sizeLabel}
                  >
                    {sizeLabel}
                  </div>
                </motion.div>
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.45 }}
                  className="min-w-0 rounded-xl bg-white/5 border border-white/5 p-5"
                >
                  <div className="micro mb-2 text-zinc-500">Prix d'entrée</div>
                  <div
                    className="display num truncate text-2xl font-bold text-white tabular-nums"
                    title={`$${fmtMarketPrice(current.entryPrice)}`}
                  >
                    ${fmtMarketPrice(current.entryPrice)}
                  </div>
                </motion.div>
              </div>
            ) : (
              <motion.div
                initial={{ opacity: 0, y: 14, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ delay: 0.32, type: 'spring', stiffness: 200 }}
                className="rounded-2xl border border-white/10 bg-black/40 p-6"
                style={{
                  boxShadow: `inset 0 0 60px ${style.glow}`,
                }}
              >
                <div className="micro mb-2 text-zinc-400 text-center">P&amp;L réalisé</div>
                <motion.div
                  key={`${current.id}-pnl`}
                  initial={{ scale: 1.2 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', stiffness: 220, damping: 12 }}
                  className={`text-center display num font-bold tabular-nums ${
                    isPnlPositive ? 'text-emerald-400' : 'text-red-400'
                  } ${isHero ? 'text-7xl' : 'text-5xl'}`}
                  style={{
                    textShadow: isPnlPositive
                      ? '0 0 48px rgba(16,185,129,0.55)'
                      : '0 0 48px rgba(239,68,68,0.55)',
                  }}
                >
                  {isPnlPositive ? '+' : ''}
                  {current.pnl.toFixed(2)} $
                </motion.div>
                {isHero && (
                  <div className={`mt-3 text-center ${variant === 'stop-loss' ? 'text-red-300' : 'text-emerald-300'} text-sm tracking-[0.2em] uppercase`}>
                    {variant === 'take-profit' && 'objectif sécurisé · le combat continue'}
                    {variant === 'trailing-stop' && 'gain verrouillé au stop suiveur · le combat continue'}
                    {variant === 'stop-loss' && 'risque coupé · prochaine offensive en préparation'}
                  </div>
                )}
              </motion.div>
            )}
          </div>

          {/* Timer bar */}
          <motion.div
            className="h-1.5"
            style={{ background: style.border }}
            initial={{ width: '100%' }}
            animate={{ width: '0%' }}
            transition={{ duration: duration / 1000, ease: 'linear' }}
          />
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
