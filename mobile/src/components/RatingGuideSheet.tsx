import { motion } from 'framer-motion'
import { useI18n } from '../i18n'
import { DIVISION_BOUNDS } from './DivisionCard'
import './RatingGuideSheet.css'

const LADDER: Array<{ id: string; label: string }> = [
  { id: 'bronze', label: 'Bronze' },
  { id: 'silver', label: 'Silver' },
  { id: 'gold', label: 'Gold' },
  { id: 'platinum', label: 'Platinum' },
  { id: 'diamond', label: 'Diamond' },
  { id: 'master', label: 'Master' },
  { id: 'legend', label: 'Legend' },
]

const SCORING: Array<{ key: string; points: string; positive: boolean }> = [
  { key: 'win', points: '+100', positive: true },
  { key: 'second', points: '+80', positive: true },
  { key: 'third', points: '+65', positive: true },
  { key: 'top10', points: '+45', positive: true },
  { key: 'top25', points: '+25', positive: true },
  { key: 'top50', points: '+10', positive: true },
  { key: 'bottomHalf', points: '−10', positive: false },
  { key: 'breached', points: '−25', positive: false },
]

function rangeLabel(id: string, locale: string): string {
  const [floor, ceiling] = DIVISION_BOUNDS[id]
  if (!Number.isFinite(ceiling)) return `${floor.toLocaleString(locale)}+`
  return `${floor.toLocaleString(locale)} – ${(ceiling - 1).toLocaleString(locale)}`
}

export function RatingGuideSheet({ onClose }: { onClose: () => void }) {
  const { t, locale } = useI18n()
  return (
    <div className="auth-overlay" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target) onClose()
    }}>
      <motion.section className="rating-guide" role="dialog" aria-modal="true" aria-labelledby="rating-guide-title"
        initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 300 }}>
        <div className="auth-sheet__handle" />
        <button className="auth-sheet__close" type="button" onClick={onClose} aria-label={t('ratingGuide.close')}>×</button>
        <span className="auth-sheet__kicker">{t('rank.kicker')}</span>
        <h2 id="rating-guide-title">{t('ratingGuide.title')}</h2>
        <p className="rating-guide__intro">{t('ratingGuide.intro')}</p>

        <section>
          <h3>{t('ratingGuide.scoringTitle')}</h3>
          <div className="rating-guide__scoring">
            {SCORING.map((row) => (
              <div key={row.key}>
                <span>{t(`ratingGuide.rows.${row.key}`)}</span>
                <em className={row.positive ? 'positive' : 'negative'}>{row.points}</em>
              </div>
            ))}
          </div>
          <p className="rating-guide__note">{t('ratingGuide.sizeBonus')}</p>
        </section>

        <section>
          <h3>{t('ratingGuide.divisionsTitle')}</h3>
          <div className="rating-guide__ladder">
            {LADDER.map((division) => (
              <div key={division.id}>
                <i className={`is-${division.id}`} />
                <strong>{division.label}</strong>
                <em>{rangeLabel(division.id, locale)} pts</em>
              </div>
            ))}
          </div>
          <p className="rating-guide__note">{t('ratingGuide.tiersNote')}</p>
          <p className="rating-guide__note">{t('ratingGuide.floorNote')}</p>
        </section>
      </motion.section>
    </div>
  )
}
