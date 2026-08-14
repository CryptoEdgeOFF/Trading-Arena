import { useI18n } from '../i18n'
import type { PlayerRating } from '../lib/api'
import './DivisionCard.css'

const TIER_ROMAN = ['', 'I', 'II', 'III']

// Bornes des divisions, dupliquées du serveur (ratingStore) pour calculer la
// progression visuelle dans le palier sans round-trip supplémentaire.
const DIVISION_BOUNDS: Record<string, [number, number]> = {
  bronze: [0, 200],
  silver: [200, 500],
  gold: [500, 900],
  platinum: [900, 1_400],
  diamond: [1_400, 2_000],
  master: [2_000, 2_800],
  grandmaster: [2_800, 4_000],
  legend: [4_000, Number.POSITIVE_INFINITY],
}

export function divisionDisplayName(division: PlayerRating['division']): string {
  return division.tier > 0 ? `${division.label} ${TIER_ROMAN[division.tier]}` : division.label
}

function tierProgress(rating: PlayerRating): number {
  const bounds = DIVISION_BOUNDS[rating.division.id]
  if (!bounds || !Number.isFinite(bounds[1])) return 100
  const [floor, ceiling] = bounds
  const tierSize = (ceiling - floor) / 3
  const tierStart = floor + (3 - rating.division.tier) * tierSize
  return Math.max(4, Math.min(100, ((rating.points - tierStart) / tierSize) * 100))
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
      <div className="division-card__main">
        <strong>{divisionDisplayName(rating.division)}</strong>
        {rating.worldRank != null
          ? <span>{t('division.world', { rank: rating.worldRank.toLocaleString(locale) })}</span>
          : <span className="division-card__placement">{t('division.placement')}</span>}
      </div>
      <div className="division-card__bar" aria-hidden="true"><i style={{ width: `${tierProgress(rating)}%` }} /></div>
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
