import { useCallback, useEffect, useState } from 'react'
import { apiAssetUrl, getRatingLeaderboard, type PlayerRating, type RatingLeaderboardRow } from '../lib/api'
import { DivisionCard, divisionDisplayName } from './DivisionCard'
import { useI18n } from '../i18n'
import './RankScreen.css'

export function RankScreen({
  currentUserId,
  myRating,
  onOpenPlayer,
  onSeasonLeaderboard,
}: {
  currentUserId?: string
  myRating?: PlayerRating | null
  onOpenPlayer: (userId: string) => void
  onSeasonLeaderboard: () => void
}) {
  const { t, locale } = useI18n()
  const [rows, setRows] = useState<RatingLeaderboardRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setError('')
    try {
      setRows(await getRatingLeaderboard())
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : t('rank.unavailable'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(), 30_000)
    return () => window.clearInterval(timer)
  }, [load])

  return (
    <div className="rank-screen">
      <div className="page-heading">
        <span>{t('rank.kicker')}</span>
        <h2>{t('rank.title')}</h2>
        <p>{t('rank.lead')}</p>
      </div>

      {myRating && <DivisionCard rating={myRating} />}

      <button className="rank-season-link" type="button" onClick={onSeasonLeaderboard}>
        <div><strong>{t('rank.seasonLink')}</strong><small>{t('rank.seasonLinkHint')}</small></div>
        <i>›</i>
      </button>

      {error ? (
        <div className="rank-error">{error}<button type="button" onClick={() => void load()}>{t('common.retry')}</button></div>
      ) : loading ? (
        <div className="rank-loading"><i />{t('rank.loading')}</div>
      ) : rows.length ? (
        <section className="rank-table">
          <div className="rank-table__head">
            <span>#</span><span>{t('rank.trader')}</span><span>{t('rank.division')}</span><span>{t('rank.points')}</span>
          </div>
          {rows.map((row) => (
            <article key={row.userId} className={row.userId === currentUserId ? 'is-me' : ''}>
              <strong className={row.rank <= 3 ? `is-top is-top-${row.rank}` : ''}>#{row.rank}</strong>
              <button type="button" onClick={() => onOpenPlayer(row.userId)}>
                {row.avatarUrl ? <img src={apiAssetUrl(row.avatarUrl)} alt="" /> : <i>{row.name.slice(0, 2).toUpperCase()}</i>}
                <span>{row.name}{row.userId === currentUserId && <small>{t('common.you')}</small>}</span>
              </button>
              <em className={`rank-division is-${row.division.id}`}>{divisionDisplayName(row.division)}</em>
              <span className="rank-points">{row.points.toLocaleString(locale)}</span>
            </article>
          ))}
        </section>
      ) : (
        <div className="rank-empty">
          <strong>{t('rank.emptyTitle')}</strong>
          <p>{t('rank.emptyLead')}</p>
        </div>
      )}
    </div>
  )
}
