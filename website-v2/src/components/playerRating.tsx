import { useState } from 'react';
import { useTranslation } from 'react-i18next';

// Système BTF Rating (Arena Points) — mêmes divisions et seuils que le serveur
// (server/ratingStore.ts) et que l'app mobile.

export type RatingDivision = {
  id: string;
  label: string;
  /** Compatibilité API ; toujours 0 depuis la suppression des sous-paliers. */
  tier: number;
};

export type PlayerRating = {
  points: number;
  division: RatingDivision;
  next: { label: string; pointsNeeded: number } | null;
  worldRank: number | null;
  totalPlayers: number;
  recentEvents: Array<{ id: string; points: number; label: string; createdAt: number }>;
};

export type RatingLeaderboardRow = {
  rank: number;
  userId: string;
  name: string;
  avatarUrl?: string | null;
  country?: string | null;
  points: number;
  division: RatingDivision;
};

export const DIVISIONS: Array<{ id: string; label: string; floor: number; ceiling: number }> = [
  { id: 'bronze', label: 'Bronze', floor: 0, ceiling: 100 },
  { id: 'silver', label: 'Silver', floor: 100, ceiling: 250 },
  { id: 'gold', label: 'Gold', floor: 250, ceiling: 500 },
  { id: 'platinum', label: 'Platinum', floor: 500, ceiling: 900 },
  { id: 'diamond', label: 'Diamond', floor: 900, ceiling: 1_500 },
  { id: 'master', label: 'Master', floor: 1_500, ceiling: 3_600 },
  { id: 'legend', label: 'Legend', floor: 3_600, ceiling: Number.POSITIVE_INFINITY },
];

export const DIVISION_COLORS: Record<string, string> = {
  bronze: '#c2724a',
  silver: '#cbd5e1',
  gold: '#f5b300',
  platinum: '#7fd4d4',
  diamond: '#7fb1ff',
  master: '#c48bff',
  legend: '#ffd257',
};

const DIVISION_IMAGES: Record<string, string> = {
  bronze: '/landing/bronze.webp',
  silver: '/landing/silver.webp',
  gold: '/landing/gold.webp',
  platinum: '/landing/platinum.webp',
  diamond: '/landing/diamond.webp',
  master: '/landing/master.webp',
  legend: '/landing/legend.webp',
};

export function divisionDisplayName(division: RatingDivision): string {
  return division.label;
}

/** Progression (0-100 %) dans la division courante, vers la division suivante. */
export function divisionProgress(rating: PlayerRating): number {
  const bounds = DIVISIONS.find((d) => d.id === rating.division.id);
  if (!bounds || !Number.isFinite(bounds.ceiling)) return 100;
  return Math.max(3, Math.min(100, ((rating.points - bounds.floor) / (bounds.ceiling - bounds.floor)) * 100));
}

export function DivisionBadge({ division, size = 96 }: { division: RatingDivision; size?: number }) {
  const [broken, setBroken] = useState(false);
  const src = DIVISION_IMAGES[division.id];
  if (!src || broken) {
    const color = DIVISION_COLORS[division.id] || '#cbd5e1';
    return (
      <span
        className="display inline-flex items-center justify-center rounded-xl border text-center text-sm font-black uppercase tracking-wider"
        style={{
          width: size,
          height: size,
          color,
          borderColor: `${color}66`,
          background: `radial-gradient(80% 80% at 50% 20%, ${color}22, transparent 70%), #0c0c10`,
          textShadow: `0 0 18px ${color}88`,
        }}
      >
        {division.label}
      </span>
    );
  }
  return (
    <img
      src={src}
      alt={division.label}
      style={{ width: size, height: 'auto', filter: 'drop-shadow(0 10px 24px rgba(0,0,0,.6))' }}
      onError={() => setBroken(true)}
      draggable={false}
    />
  );
}

/**
 * Carte rating complète : badge, division, points, barre de
 * progression vers la division suivante et rang mondial.
 */
export function RatingCard({ rating, compact = false }: { rating: PlayerRating; compact?: boolean }) {
  const { t } = useTranslation();
  const color = DIVISION_COLORS[rating.division.id] || '#cbd5e1';
  const progress = divisionProgress(rating);
  return (
    <div
      className="relative flex items-center gap-4 overflow-hidden rounded-2xl border p-4 sm:gap-5 sm:p-5"
      style={{
        borderColor: `${color}44`,
        background: `radial-gradient(90% 100% at 100% 0%, ${color}14, transparent 60%), #0b0b10`,
      }}
    >
      <DivisionBadge division={rating.division} size={compact ? 72 : 96} />
      <div className="min-w-0 flex-1">
        <div className="micro text-[9px]" style={{ color }}>
          {t('rating.kicker')}
        </div>
        <div className="display text-xl font-black uppercase leading-tight text-white sm:text-2xl">
          {divisionDisplayName(rating.division)}
        </div>
        <div className="num mt-0.5 text-xs text-[#a1a1aa]">
          {t('rating.points', { points: rating.points })}
          {rating.worldRank != null && (
            <span className="ml-2 text-[#71717a]">
              {t('rating.worldRank', { rank: rating.worldRank, total: rating.totalPlayers })}
            </span>
          )}
        </div>
        <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full transition-[width] duration-700"
            style={{ width: `${progress}%`, background: `linear-gradient(90deg, ${color}, #ffffffcc)`, boxShadow: `0 0 12px ${color}` }}
          />
        </div>
        <div className="mt-1.5 text-[10px] text-[#71717a]">
          {rating.next
            ? t('rating.nextAt', { label: rating.next.label, points: rating.next.pointsNeeded })
            : t('rating.maxDivision')}
        </div>
      </div>
    </div>
  );
}
