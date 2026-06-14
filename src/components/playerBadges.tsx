import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import confetti from 'canvas-confetti';

/**
 * Badges collectionnables des joueurs (cf. server/competitionManager.ts) :
 * - 'champion' : a terminé 1er d'au moins une arène terminée.
 * - 'btf2026'  : a participé aux qualifications BTF 2026 (événement physique Paris).
 */
export type UserBadge = 'btf2026' | 'champion' | 'paris-champion';

type BadgeDef = {
  src: string;
  nameKey: string;
  descKey: string;
  longDescKey: string;
  /** Couleur de halo / lueur du badge. */
  glow: string;
  /** Palette de particules pour l'effet animé. */
  particles: string[];
};

const BADGE_DEFS: Record<UserBadge, BadgeDef> = {
  'paris-champion': {
    src: '/assets/badges/BadgeChampionBTF2026.png',
    nameKey: 'badges.parisChampion',
    descKey: 'badges.parisChampionDesc',
    longDescKey: 'badges.parisChampionLong',
    glow: '#d4af37',
    particles: ['#fbbf24', '#d4af37', '#fde68a', '#ffffff'],
  },
  champion: {
    src: '/assets/badges/champion.webp',
    nameKey: 'badges.champion',
    descKey: 'badges.championDesc',
    longDescKey: 'badges.championLong',
    glow: '#dc2626',
    particles: ['#ef4444', '#dc2626', '#f87171', '#ffffff'],
  },
  btf2026: {
    src: '/assets/badges/btf2026.webp',
    nameKey: 'badges.btf2026',
    descKey: 'badges.btf2026Desc',
    longDescKey: 'badges.btf2026Long',
    glow: '#a855f7',
    particles: ['#a855f7', '#c084fc', '#7c3aed', '#ffffff'],
  },
};

/** Ordre d'affichage : le plus prestigieux d'abord. */
const BADGE_ORDER: UserBadge[] = ['paris-champion', 'champion', 'btf2026'];

function sortBadges(badges: UserBadge[]): UserBadge[] {
  return BADGE_ORDER.filter((badge) => badges.includes(badge));
}

/** Couleurs des chips inline (assorties à la DA de chaque badge). */
const CHIP_STYLES: Record<UserBadge, string> = {
  'paris-champion': 'border-yellow-400/50 bg-yellow-400/12 text-yellow-200',
  champion: 'border-amber-400/40 bg-amber-400/10 text-amber-200',
  btf2026: 'border-purple-400/40 bg-purple-400/12 text-purple-200',
};

/**
 * Badges inline sous forme de chips texte lisibles, à afficher juste après un
 * pseudo (les visuels complets s'affichent sur la page publique du joueur).
 * Rend null si le joueur n'a aucun badge.
 */
export function NameBadges({ badges, compact = false }: { badges?: UserBadge[] | null; compact?: boolean }) {
  const { t } = useTranslation();
  if (!badges?.length) return null;
  return (
    <span className="inline-flex shrink-0 items-center gap-1 align-middle">
      {sortBadges(badges).map((badge) => {
        const def = BADGE_DEFS[badge];
        return (
          <span
            key={badge}
            title={`${t(def.nameKey)} — ${t(def.descKey)}`}
            className={`whitespace-nowrap rounded-md border font-bold uppercase tracking-[0.1em] ${CHIP_STYLES[badge]} ${
              compact ? 'px-1 py-px text-[8px]' : 'px-1.5 py-0.5 text-[9px]'
            }`}
          >
            {t(def.nameKey)}
          </span>
        );
      })}
    </span>
  );
}

/**
 * Collection de badges pour la page profil : montre tous les badges existants,
 * débloqués en couleur, verrouillés en gris. Cliquer un badge ouvre la modale
 * « showcase » animée qui explique comment il a été obtenu.
 */
export function BadgeCollection({ badges }: { badges: UserBadge[] }) {
  const { t } = useTranslation();
  const [active, setActive] = useState<{ badge: UserBadge; earned: boolean } | null>(null);

  return (
    <>
      <div className="grid grid-cols-3 gap-3">
        {BADGE_ORDER.map((badge) => {
          const def = BADGE_DEFS[badge];
          const earned = badges.includes(badge);
          return (
            <button
              type="button"
              key={badge}
              onClick={() => setActive({ badge, earned })}
              className={`group flex flex-col items-center gap-2 rounded-xl border px-3 py-4 text-center transition-transform duration-200 hover:-translate-y-0.5 ${
                earned
                  ? 'border-[#2c2c36] bg-[#101016] hover:border-[#3a3a46]'
                  : 'border-[#1a1a20] bg-[#0a0a0d] hover:border-[#26262e]'
              }`}
            >
              <img
                src={def.src}
                alt={t(def.nameKey)}
                className={`h-24 w-auto select-none transition-transform duration-200 group-hover:scale-105 ${
                  earned ? 'drop-shadow-[0_0_14px_rgba(255,255,255,0.12)]' : 'opacity-30 grayscale'
                }`}
                draggable={false}
              />
              <div>
                <div
                  className={`text-xs font-bold uppercase tracking-[0.12em] ${
                    earned ? 'text-white' : 'text-[#71717a]'
                  }`}
                >
                  {t(def.nameKey)}
                </div>
                <div className="mt-1 text-[10px] leading-snug text-[#71717a]">
                  {earned ? t(def.descKey) : t('badges.locked')}
                </div>
              </div>
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-center text-[10px] uppercase tracking-[0.14em] text-[#52525b]">
        {t('badges.tapHint')}
      </p>
      <BadgeShowcaseModal
        badge={active?.badge ?? null}
        earned={active?.earned ?? false}
        onClose={() => setActive(null)}
      />
    </>
  );
}

/**
 * Modale plein écran « showcase » d'un badge : badge agrandi avec halo pulsant,
 * particules animées en continu, burst de confettis à l'ouverture, et
 * explication de la manière dont le badge s'obtient.
 */
export function BadgeShowcaseModal({
  badge,
  earned,
  onClose,
}: {
  badge: UserBadge | null;
  earned: boolean;
  onClose: () => void;
}) {
  return (
    <AnimatePresence>
      {badge && <BadgeShowcaseContent key={badge} badge={badge} earned={earned} onClose={onClose} />}
    </AnimatePresence>
  );
}

const PARTICLE_COUNT = 30;

function BadgeShowcaseContent({
  badge,
  earned,
  onClose,
}: {
  badge: UserBadge;
  earned: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const def = BADGE_DEFS[badge];

  const particles = useMemo(
    () =>
      Array.from({ length: PARTICLE_COUNT }, (_, i) => {
        const angle = (i / PARTICLE_COUNT) * Math.PI * 2 + Math.random() * 0.6;
        const distance = 110 + Math.random() * 150;
        return {
          id: i,
          x: Math.cos(angle) * distance,
          y: Math.sin(angle) * distance,
          size: 3 + Math.random() * 6,
          delay: Math.random() * 1.4,
          duration: 1.8 + Math.random() * 1.6,
          color: def.particles[i % def.particles.length],
        };
      }),
    [def.particles],
  );

  // Burst de confettis à l'ouverture (uniquement si le badge est débloqué).
  useEffect(() => {
    if (!earned) return;
    let cancelled = false;
    const fire = () => {
      if (cancelled) return;
      confetti({
        particleCount: 90,
        spread: 100,
        startVelocity: 42,
        origin: { x: 0.5, y: 0.42 },
        colors: def.particles,
        scalar: 1.05,
        ticks: 220,
      });
    };
    const timer = setTimeout(fire, 120);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [earned, def.particles]);

  // Fermeture au clavier (Échap).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      onClick={onClose}
      className="fixed inset-0 z-[130] flex items-center justify-center overflow-y-auto bg-black/80 px-6 py-8 backdrop-blur-md"
      style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 2rem)' }}
    >
      {/* Halo radial de fond teinté par la couleur du badge */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: `radial-gradient(circle at 50% 42%, ${def.glow}33 0%, transparent 55%)`,
        }}
      />

      <motion.div
        initial={{ scale: 0.7, y: 30, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.8, y: 20, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 220, damping: 20 }}
        onClick={(e) => e.stopPropagation()}
        className="relative flex w-full max-w-md flex-col items-center text-center"
      >
        {/* Zone badge + particules */}
        <div className="relative flex h-60 w-60 items-center justify-center sm:h-96 sm:w-96">
          {/* Particules animées en continu */}
          {earned &&
            particles.map((p) => (
              <motion.span
                key={p.id}
                className="absolute rounded-full"
                style={{
                  width: p.size,
                  height: p.size,
                  backgroundColor: p.color,
                  boxShadow: `0 0 8px ${p.color}`,
                }}
                initial={{ x: 0, y: 0, opacity: 0, scale: 0 }}
                animate={{ x: p.x, y: p.y, opacity: [0, 1, 0], scale: [0, 1, 0.3] }}
                transition={{
                  duration: p.duration,
                  delay: p.delay,
                  repeat: Infinity,
                  ease: 'easeOut',
                }}
              />
            ))}

          {/* Anneau pulsant */}
          <motion.div
            className="absolute h-[200px] w-[200px] rounded-full sm:h-[300px] sm:w-[300px]"
            style={{ border: `2px solid ${def.glow}55` }}
            animate={{ scale: [1, 1.18, 1], opacity: [0.5, 0.1, 0.5] }}
            transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
          />

          {/* Badge */}
          <motion.img
            src={def.src}
            alt={t(def.nameKey)}
            draggable={false}
            className={`relative z-10 h-44 w-auto select-none sm:h-72 ${earned ? '' : 'opacity-40 grayscale'}`}
            style={earned ? { filter: `drop-shadow(0 0 26px ${def.glow}aa)` } : undefined}
            animate={earned ? { y: [0, -8, 0] } : undefined}
            transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
          />
        </div>

        {/* Nom du badge */}
        <h3
          className="mt-3 font-rajdhani text-3xl font-bold uppercase tracking-wide text-white sm:mt-8 sm:text-4xl"
          style={earned ? { textShadow: `0 0 30px ${def.glow}66` } : undefined}
        >
          {t(def.nameKey)}
        </h3>

        {/* Statut débloqué / verrouillé */}
        <span
          className={`mt-3 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] ${
            earned
              ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300'
              : 'border-[#3a3a46] bg-white/5 text-[#a1a1aa]'
          }`}
        >
          {earned ? t('badges.unlockedLabel') : t('badges.lockedLabel')}
        </span>

        {/* Explication : comment l'obtenir */}
        <div className="mt-4 w-full rounded-2xl border border-white/10 bg-white/[0.04] p-4 sm:mt-5 sm:p-5">
          <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-[#71717a]">
            {t('badges.howEarned')}
          </div>
          <p className="text-sm leading-relaxed text-[#d4d4d8]">{t(def.longDescKey)}</p>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="mt-5 rounded-full border border-white/15 bg-white/5 px-6 py-2 text-xs font-bold uppercase tracking-[0.14em] text-white transition-colors hover:bg-white/10 sm:mt-6"
        >
          {t('common.close')}
        </button>
      </motion.div>
    </motion.div>
  );
}
