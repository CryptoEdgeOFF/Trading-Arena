import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import confetti from 'canvas-confetti'
import type { UserBadge } from '../lib/api'
import { useI18n } from '../i18n'
import './PlayerBadges.css'

type BadgeDef = {
  src: string
  glow: string
  particles: string[]
}

const BADGE_DEFS: Record<UserBadge, BadgeDef> = {
  'paris-champion': {
    src: '/assets/badges/BadgeChampionBTF2026.png',
    glow: '#d4af37',
    particles: ['#fbbf24', '#d4af37', '#fde68a', '#ffffff'],
  },
  champion: {
    src: '/assets/badges/champion.webp',
    glow: '#dc2626',
    particles: ['#ef4444', '#dc2626', '#f87171', '#ffffff'],
  },
  'summer-champion': {
    src: '/assets/badges/Summer Season BTF Arena Badge.png',
    glow: '#f59e0b',
    particles: ['#fbbf24', '#f59e0b', '#fde68a', '#ffffff'],
  },
  'autumn-champion': {
    src: '/assets/badges/Automn Season BTF Arena Badge.png',
    glow: '#ea580c',
    particles: ['#f97316', '#ea580c', '#fdba74', '#ffffff'],
  },
  btf2026: {
    src: '/assets/badges/btf2026.webp',
    glow: '#a855f7',
    particles: ['#a855f7', '#c084fc', '#7c3aed', '#ffffff'],
  },
}

const BADGE_ORDER: UserBadge[] = ['paris-champion', 'summer-champion', 'autumn-champion', 'champion', 'btf2026']
const PARTICLE_COUNT = 30

export function PlayerBadges({ badges, emptyLabel }: { badges: UserBadge[]; emptyLabel?: string }) {
  const { t } = useI18n()
  const [active, setActive] = useState<UserBadge | null>(null)
  const earned = BADGE_ORDER.filter((badge) => badges.includes(badge))
  if (earned.length === 0) {
    return emptyLabel ? <p className="player-badges__empty">{emptyLabel}</p> : null
  }
  return (
    <>
      <div className="player-badges">
        {earned.map((badge) => (
          <button type="button" key={badge} className="player-badges__item" onClick={() => setActive(badge)}>
            <img src={encodeURI(BADGE_DEFS[badge].src)} alt="" />
            <strong>{t(`badges.${badge}`)}</strong>
          </button>
        ))}
      </div>
      <p className="player-badges__hint">{t('badges.tapHint')}</p>
      <BadgeShowcaseModal badge={active} onClose={() => setActive(null)} />
    </>
  )
}

function BadgeShowcaseModal({ badge, onClose }: { badge: UserBadge | null; onClose: () => void }) {
  if (typeof document === 'undefined') return null
  return createPortal(
    <AnimatePresence>
      {badge && <BadgeShowcaseContent key={badge} badge={badge} onClose={onClose} />}
    </AnimatePresence>,
    document.body,
  )
}

function BadgeShowcaseContent({ badge, onClose }: { badge: UserBadge; onClose: () => void }) {
  const { t } = useI18n()
  const def = BADGE_DEFS[badge]
  const particles = useMemo(
    () => Array.from({ length: PARTICLE_COUNT }, (_, index) => {
      const angle = (index / PARTICLE_COUNT) * Math.PI * 2 + Math.random() * 0.6
      const distance = 90 + Math.random() * 120
      return {
        id: index,
        x: Math.cos(angle) * distance,
        y: Math.sin(angle) * distance,
        size: 3 + Math.random() * 6,
        delay: Math.random() * 1.4,
        duration: 1.8 + Math.random() * 1.6,
        color: def.particles[index % def.particles.length],
      }
    }),
    [def.particles],
  )

  useEffect(() => {
    const timer = window.setTimeout(() => {
      confetti({
        particleCount: 90,
        spread: 100,
        startVelocity: 42,
        origin: { x: 0.5, y: 0.42 },
        colors: def.particles,
        scalar: 1.05,
        ticks: 220,
      })
    }, 120)
    return () => window.clearTimeout(timer)
  }, [def.particles])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <motion.div
      className="badge-showcase"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      onClick={onClose}
    >
      <div className="badge-showcase__glow" style={{ background: `radial-gradient(circle at 50% 42%, ${def.glow}33 0%, transparent 55%)` }} />
      <motion.div
        className="badge-showcase__card"
        initial={{ scale: 0.7, y: 30, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.8, y: 20, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 220, damping: 20 }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="badge-showcase__stage">
          {particles.map((particle) => (
            <motion.span
              key={particle.id}
              className="badge-showcase__spark"
              style={{
                width: particle.size,
                height: particle.size,
                backgroundColor: particle.color,
                boxShadow: `0 0 8px ${particle.color}`,
              }}
              initial={{ x: 0, y: 0, opacity: 0, scale: 0 }}
              animate={{ x: particle.x, y: particle.y, opacity: [0, 1, 0], scale: [0, 1, 0.3] }}
              transition={{ duration: particle.duration, delay: particle.delay, repeat: Infinity, ease: 'easeOut' }}
            />
          ))}
          <motion.div
            className="badge-showcase__ring"
            style={{ borderColor: `${def.glow}55` }}
            animate={{ scale: [1, 1.18, 1], opacity: [0.5, 0.1, 0.5] }}
            transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
          />
          <motion.img
            src={encodeURI(def.src)}
            alt=""
            draggable={false}
            style={{ filter: `drop-shadow(0 0 26px ${def.glow}aa)` }}
            animate={{ y: [0, -8, 0] }}
            transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
          />
        </div>
        <h3 style={{ textShadow: `0 0 30px ${def.glow}66` }}>{t(`badges.${badge}`)}</h3>
        <span>{t('badges.unlockedLabel')}</span>
        <div className="badge-showcase__copy">
          <small>{t('badges.howEarned')}</small>
          <p>{t(`badges.${badge}Long`)}</p>
        </div>
        <button type="button" onClick={onClose}>{t('common.close')}</button>
      </motion.div>
    </motion.div>
  )
}
