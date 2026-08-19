import { useState } from 'react'
import { useI18n } from '../i18n'
import type { PlayerRating, RatingDivision } from '../lib/api'
import './DivisionCard.css'

// Bornes des divisions, dupliquées du serveur (ratingStore) pour calculer la
// progression visuelle vers la division suivante sans round-trip supplémentaire.
export const DIVISION_BOUNDS: Record<string, [number, number]> = {
  bronze: [0, 100],
  silver: [100, 250],
  gold: [250, 500],
  platinum: [500, 900],
  diamond: [900, 1_500],
  master: [1_500, 3_600],
  legend: [3_600, Number.POSITIVE_INFINITY],
}

export function divisionDisplayName(division: PlayerRating['division']): string {
  return division.label
}

/** Visuel officiel `/assets/badges/{Label}.png` (Bronze, Silver, …). */
export function DivisionBadge({ division, className }: { division: RatingDivision; className?: string }) {
  const [broken, setBroken] = useState(false)
  if (broken) {
    return <span className={`division-badge-fallback is-${division.id}`}>{division.label}</span>
  }
  return (
    <img
      className={className || 'division-badge-image'}
      src={`/assets/badges/${division.label}.png`}
      alt={division.label}
      onError={() => setBroken(true)}
    />
  )
}

function divisionProgress(rating: PlayerRating): number {
  const bounds = DIVISION_BOUNDS[rating.division.id]
  if (!bounds || !Number.isFinite(bounds[1])) return 100
  const [floor, ceiling] = bounds
  return Math.max(4, Math.min(100, ((rating.points - floor) / (ceiling - floor)) * 100))
}

export function DivisionCard({
  rating,
  variant = 'card',
  onOpen,
}: {
  rating: PlayerRating
  variant?: 'card' | 'compact'
  onOpen?: () => void
}) {
  const { t, locale } = useI18n()
  const body = (
    <>
      <header>
        <small>{t('division.kicker')}</small>
        <em>{t('division.points', { points: rating.points.toLocaleString(locale) })}</em>
      </header>
      <div className="division-card__row">
        <DivisionBadge division={rating.division} className="division-card__badge" />
        <div className="division-card__main">
          <strong>{divisionDisplayName(rating.division)}</strong>
          {rating.worldRank != null
            ? <span>{t('division.world', { rank: rating.worldRank.toLocaleString(locale) })}</span>
            : <span className="division-card__placement">{t('division.placement')}</span>}
        </div>
      </div>
      <div className="division-card__bar" aria-hidden="true"><i style={{ width: `${divisionProgress(rating)}%` }} /></div>
      <footer>
        {rating.next
          ? t('division.toNext', { points: rating.next.pointsNeeded.toLocaleString(locale), label: rating.next.label })
          : t('division.max')}
      </footer>
    </>
  )
  const className = `division-card is-${rating.division.id} ${variant === 'compact' ? 'is-compact' : ''}`
  if (onOpen) {
    return <button className={className} type="button" onClick={onOpen}>{body}</button>
  }
  return <section className={className}>{body}</section>
}
