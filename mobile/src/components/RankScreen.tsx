import { useEffect, useRef, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { useI18n } from '../i18n'
import {
  getGlobalLeaderboard,
  getLeaderboardSeasons,
  getRatingLeaderboard,
  type GlobalLeaderboardRow,
  type LeaderboardSeason,
  type PlayerRating,
  type PublicCompetition,
  type RatingLeaderboardRow,
} from '../lib/api'
import { getSponsor } from '../lib/sponsors'
import { DivisionBadge, DivisionCard, DIVISION_BOUNDS, divisionDisplayName } from './DivisionCard'
import { PlayerName } from './PlayerName'
import { TraderPhoto } from './ProfileAvatar'
import './RankScreen.css'

const MAJOR_VIDEO_SRC = '/assets/Videos/major-paris-mobile.mp4'

function armVideo(video: HTMLVideoElement) {
  video.muted = true
  video.defaultMuted = true
  video.volume = 0
  video.playsInline = true
  video.setAttribute('muted', '')
  video.setAttribute('playsinline', '')
  video.setAttribute('webkit-playsinline', '')
}

function MajorVideo() {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    let cancelled = false
    let blobUrl = ''
    armVideo(video)

    const play = () => {
      if (cancelled || !video.paused) return
      armVideo(video)
      void video.play().catch(() => undefined)
    }

    const onReady = () => play()

    void (async () => {
      if (Capacitor.isNativePlatform()) {
        try {
          const response = await fetch(MAJOR_VIDEO_SRC)
          const url = URL.createObjectURL(await response.blob())
          if (cancelled) {
            URL.revokeObjectURL(url)
            return
          }
          blobUrl = url
          video.src = url
          video.load()
        } catch {
          /* src d'origine */
        }
      }
      play()
    })()

    video.addEventListener('loadeddata', onReady)
    video.addEventListener('canplay', onReady)
    video.addEventListener('canplaythrough', onReady)
    const onVisible = () => {
      if (document.visibilityState === 'visible') play()
    }
    document.addEventListener('visibilitychange', onVisible)
    const retry = window.setInterval(play, 700)

    return () => {
      cancelled = true
      window.clearInterval(retry)
      video.removeEventListener('loadeddata', onReady)
      video.removeEventListener('canplay', onReady)
      video.removeEventListener('canplaythrough', onReady)
      document.removeEventListener('visibilitychange', onVisible)
      if (blobUrl) URL.revokeObjectURL(blobUrl)
    }
  }, [])

  return (
    <video
      ref={videoRef}
      src={MAJOR_VIDEO_SRC}
      autoPlay
      muted
      loop
      playsInline
      preload="auto"
      controls={false}
      disablePictureInPicture
      aria-hidden="true"
      tabIndex={-1}
    />
  )
}

function formatSeasonClock(ms: number, dayUnit: string) {
  const total = Math.max(0, Math.floor(ms / 1000))
  const days = Math.floor(total / 86_400)
  const pad = (value: number) => String(value).padStart(2, '0')
  const clock = `${pad(Math.floor((total % 86_400) / 3_600))}h ${pad(Math.floor((total % 3_600) / 60))}m ${pad(total % 60)}s`
  return days > 0 ? `${days}${dayUnit} ${clock}` : clock
}

export function RankScreen({
  currentUserId,
  rating,
  competitions = [],
  onJoin,
  onOpenPlayer,
}: {
  currentUserId?: string
  rating?: PlayerRating | null
  competitions?: PublicCompetition[]
  onJoin?: (competition: PublicCompetition) => void
  onOpenPlayer: (userId: string) => void
}) {
  const { t, locale, lang } = useI18n()
  const [now, setNow] = useState(Date.now())
  const [seasons, setSeasons] = useState<LeaderboardSeason[]>([])
  const [selectedSeasonId, setSelectedSeasonId] = useState('')
  const [seasonRows, setSeasonRows] = useState<GlobalLeaderboardRow[]>([])
  const [ratingRows, setRatingRows] = useState<RatingLeaderboardRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [pane, setPane] = useState<'season' | 'rating'>('season')
  const [seasonVisibleCount, setSeasonVisibleCount] = useState(10)
  const [ratingVisibleCount, setRatingVisibleCount] = useState(20)

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const [seasonData, nextRatingRows] = await Promise.all([
          getLeaderboardSeasons(),
          getRatingLeaderboard().catch(() => [] as RatingLeaderboardRow[]),
        ])
        const availableSeasons = [...seasonData.seasons].sort((a, b) => {
          if (a.theme === 'summer' && b.theme !== 'summer') return -1
          if (b.theme === 'summer' && a.theme !== 'summer') return 1
          return a.startAt - b.startAt
        })
        const season = availableSeasons.find(({ id, status }) => id === seasonData.activeSeasonId && status !== 'upcoming')
          || availableSeasons.find(({ status }) => status === 'active')
          || availableSeasons.find(({ status }) => status !== 'upcoming')
        if (active) {
          setSeasons(availableSeasons)
          setSelectedSeasonId(season?.id || '')
          setRatingRows(nextRatingRows)
          if (!season) setLoading(false)
        }
      } catch (nextError) {
        if (active) {
          setError(nextError instanceof Error ? nextError.message : t('rank.unavailable'))
          setLoading(false)
        }
      }
    })()
    return () => { active = false }
  }, [t])

  useEffect(() => {
    if (!selectedSeasonId) return
    let active = true
    setLoading(true)
    setError('')
    void getGlobalLeaderboard(selectedSeasonId)
      .then((rows) => { if (active) setSeasonRows(rows) })
      .catch((nextError) => { if (active) setError(nextError instanceof Error ? nextError.message : t('rank.unavailable')) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [selectedSeasonId, t])

  const mySeasonIndex = seasonRows.findIndex(({ userId }) => userId === currentUserId)
  const mySeasonRow = mySeasonIndex >= 0 ? seasonRows[mySeasonIndex] : null
  const visibleSeasonRows = seasonRows.slice(0, seasonVisibleCount)
  const showMySeasonBelow = mySeasonIndex >= seasonVisibleCount && Boolean(mySeasonRow)
  const visibleRatingRows = ratingRows.slice(0, ratingVisibleCount)
  const myRatingRow = ratingRows.find(({ userId }) => userId === currentUserId)
  const showMyRatingBelow = Boolean(myRatingRow && (myRatingRow.rank || 0) > ratingVisibleCount)
  const divisionStrip = Object.keys(DIVISION_BOUNDS).map((id) => ({
    id,
    label: id.charAt(0).toUpperCase() + id.slice(1),
  }))
  const joinableArenas = competitions
    .filter((competition) => (
      competition.entryMode !== 'team'
      && competition.status !== 'ended'
      && competition.status !== 'live'
      && (competition.status === 'registration' || competition.canJoin === true)
    ))
    .sort((a, b) => a.startAt - b.startAt)
  const selectedSeason = seasons.find(({ id }) => id === selectedSeasonId)
  const seasonRemaining = selectedSeason && selectedSeason.endAt > now
    ? formatSeasonClock(selectedSeason.endAt - now, lang === 'fr' ? 'j' : 'd')
    : null

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <div className="rank-screen">
      <div className="rank-tabs">
        <button type="button" className={pane === 'season' ? 'is-active' : ''} onClick={() => setPane('season')}>
          {t('rank.tabSeason')}
        </button>
        <button type="button" className={pane === 'rating' ? 'is-active' : ''} onClick={() => setPane('rating')}>
          {t('rank.tabRating')}
        </button>
      </div>

      {pane === 'season' && joinableArenas.length > 0 && onJoin && (
        <section className="rank-join">
          <small>{t('home.openForJoin')}</small>
          {joinableArenas.map((arena) => {
            const sponsor = getSponsor(arena.sponsor)
            return (
              <button key={arena.id} type="button" onClick={() => onJoin(arena)}>
                <span>
                  <strong>{arena.title}</strong>
                  {sponsor && <em>{t('join.introSubtitle', { name: sponsor.name })}</em>}
                </span>
                <b>{t('arena.join')}</b>
              </button>
            )
          })}
        </section>
      )}

      {pane === 'season' && (
      <section className="rank-paris">
        <div className="rank-paris__visual">
          <MajorVideo />
          <span>PARIS</span><strong>MAJOR</strong>
        </div>
        <div className="rank-paris__copy">
          <p>{t('rank.parisLeadMobile')}</p>
          <div>
            <span>{t('rank.parisStepOne')}</span>
            <span>{t('rank.parisStepTwo')}</span>
            <span className="is-final">{t('rank.parisStepThree')}</span>
          </div>
        </div>
      </section>
      )}

      {pane === 'season' && (
      <section className="rank-season-ranking">
        <header>
          <div><small>{t('rank.seasonKicker')}</small><h2>{t('rank.seasonTitle')}</h2></div>
          <div className="rank-season-ranking__status">
            <strong>{t('rank.topOneParis')}</strong>
          </div>
        </header>
        {seasons.length > 1 && (
          <div className="rank-season-tabs" aria-label={t('rank.chooseSeason')}>
            {seasons.map((season) => {
                const upcoming = season.status === 'upcoming'
                return (
                  <button
                    key={season.id}
                    type="button"
                    disabled={upcoming}
                    className={`${selectedSeasonId === season.id && !upcoming ? 'is-active' : ''} ${upcoming ? 'is-soon' : ''}`}
                    onClick={() => { if (!upcoming) setSelectedSeasonId(season.id) }}
                  >
                    {t(season.nameKey)}
                    {upcoming ? <em>{t('rank.seasonComing')}</em> : null}
                  </button>
                )
              })}
          </div>
        )}
        <div className="rank-season-ranking__visual">
          <img className="rank-season-ranking__banner" src={selectedSeason?.bannerImage || '/assets/Seasons/summer-season-ranking.webp'} alt="" />
          {selectedSeason?.endAt ? (
            <span className="rank-season-ranking__clock">
              <small>{seasonRemaining ? t('rank.seasonEndsIn') : t('rank.seasonEnded')}</small>
              {seasonRemaining && <b>{seasonRemaining}</b>}
            </span>
          ) : null}
        </div>
        <div className="rank-season-prizes">
          <small>{t('rank.seasonPrizesLabel')}</small>
          <div>
            {[
              {
                src: encodeURI(
                  selectedSeason?.championBadge === 'autumn-champion'
                    ? '/assets/badges/autumn-season-badge.webp'
                    : '/assets/badges/summer-season-badge.webp',
                ),
                label: t('rank.seasonPrizeBadge'),
              },
              {
                src: encodeURI(selectedSeason?.shirtImage || '/assets/badges/summer-season-shirt.webp'),
                label: t('rank.seasonPrizeShirt'),
              },
              {
                src: encodeURI(selectedSeason?.arenaImage || '/assets/pictures/arena3d.webp'),
                label: t('rank.seasonPrizeParis'),
              },
            ].map((prize) => (
              <article key={prize.label}>
                <img src={prize.src} alt="" draggable={false} />
                <strong>{prize.label}</strong>
              </article>
            ))}
          </div>
        </div>
        {mySeasonRow && (
          <div className="rank-season-ranking__me">
            <div><small>{t('common.you')}</small><strong>#{mySeasonIndex + 1}</strong></div>
            <span className={mySeasonRow.pnlUsd >= 0 ? 'positive' : 'negative'}>{mySeasonRow.pnlUsd >= 0 ? '+' : ''}{mySeasonRow.pnlUsd.toFixed(2)} $</span>
          </div>
        )}
        {loading ? <div className="rank-season-ranking__state">{t('rank.loading')}</div>
          : error ? <div className="rank-season-ranking__state is-error">{error}</div>
            : seasonRows.length ? (
              <div className="rank-season-ranking__rows">
                {visibleSeasonRows.map((row, index) => (
                  <button key={row.userId} type="button" className={`${index === 0 ? 'is-paris is-rank-1' : ''} ${row.userId === currentUserId ? 'is-me' : ''}`} onClick={() => onOpenPlayer(row.userId)}>
                    <b>#{index + 1}</b>
                    <TraderPhoto avatarUrl={row.avatarUrl} name={row.name} />
                    <div><strong><PlayerName name={row.name} country={row.country} /></strong><small>{row.userId === currentUserId ? t('common.you') : t(row.arenas > 1 ? 'global.arenasPlural' : 'global.arenas', { count: row.arenas })}</small></div>
                    {index === 0 && <em>{t('rank.parisZone')}</em>}
                    <span className={row.pnlUsd >= 0 ? 'positive' : 'negative'}>{row.pnlUsd >= 0 ? '+' : ''}{row.pnlUsd.toFixed(2)} $</span>
                  </button>
                ))}
                {showMySeasonBelow && mySeasonRow && (
                  <>
                    <div className="rank-list-gap" aria-hidden="true">···</div>
                    <button type="button" className="is-me is-pinned" onClick={() => onOpenPlayer(mySeasonRow.userId)}>
                      <b>#{mySeasonIndex + 1}</b>
                      <TraderPhoto avatarUrl={mySeasonRow.avatarUrl} name={mySeasonRow.name} />
                      <div><strong><PlayerName name={mySeasonRow.name} country={mySeasonRow.country} /></strong><small>{t('common.you')}</small></div>
                      <span className={mySeasonRow.pnlUsd >= 0 ? 'positive' : 'negative'}>{mySeasonRow.pnlUsd >= 0 ? '+' : ''}{mySeasonRow.pnlUsd.toFixed(2)} $</span>
                    </button>
                  </>
                )}
                {seasonVisibleCount < seasonRows.length && (
                  <button type="button" className="rank-more" onClick={() => setSeasonVisibleCount((count) => count + 10)}>
                    {t('rank.loadMore')}
                  </button>
                )}
              </div>
            ) : <div className="rank-season-ranking__state">{t('global.empty')}</div>}
      </section>
      )}

      {pane === 'rating' && (
      <section className="rank-rating">
        <header>
          <div><small>{t('rank.kicker')}</small><h2>{t('rank.title')}</h2></div>
          <span className="ranking-scope-badge is-permanent">{t('rankingScope.permanent')}</span>
        </header>
        <p>{t('rank.lead')}</p>
        {rating && <DivisionCard rating={rating} variant="compact" />}
        <div className="rank-divisions">
          {divisionStrip.map((division) => (
            <article key={division.id} className={rating?.division.id === division.id ? 'is-mine' : ''}>
              <DivisionBadge division={{ id: division.id, label: division.label, tier: 0 }} />
              <strong>{division.label}</strong>
              {rating?.division.id === division.id && <small>{t('common.you')}</small>}
            </article>
          ))}
        </div>
        {myRatingRow && (
          <div className="rank-season-ranking__me">
            <div><small>{t('common.you')}</small><strong>#{myRatingRow.rank}</strong></div>
            <span>{myRatingRow.points.toLocaleString(locale)} pts</span>
          </div>
        )}
        {(visibleRatingRows.length > 0 || showMyRatingBelow) && (
          <div className="rank-table">
            <div className="rank-table__head"><span>#</span><span>{t('rank.trader')}</span><span>{t('rank.division')}</span><span>{t('rank.points')}</span></div>
            {visibleRatingRows.map((row) => (
              <article key={row.userId} className={row.userId === currentUserId ? 'is-me' : ''}>
                <strong>#{row.rank}</strong>
                <button type="button" onClick={() => onOpenPlayer(row.userId)}>
                  <TraderPhoto avatarUrl={row.avatarUrl} name={row.name} />
                  <span><PlayerName name={row.name} country={row.country} />{row.userId === currentUserId && <small>{t('common.you')}</small>}</span>
                </button>
                <em className={`rank-division is-${row.division.id}`}>{divisionDisplayName(row.division)}</em>
                <span className="rank-points">{row.points.toLocaleString(locale)}</span>
              </article>
            ))}
            {showMyRatingBelow && myRatingRow && (
              <>
                <div className="rank-list-gap" aria-hidden="true">···</div>
                <article className="is-me is-pinned">
                  <strong>#{myRatingRow.rank}</strong>
                  <button type="button" onClick={() => onOpenPlayer(myRatingRow.userId)}>
                    <TraderPhoto avatarUrl={myRatingRow.avatarUrl} name={myRatingRow.name} />
                    <span><PlayerName name={myRatingRow.name} country={myRatingRow.country} /><small>{t('common.you')}</small></span>
                  </button>
                  <em className={`rank-division is-${myRatingRow.division.id}`}>{divisionDisplayName(myRatingRow.division)}</em>
                  <span className="rank-points">{myRatingRow.points.toLocaleString(locale)}</span>
                </article>
              </>
            )}
            {ratingVisibleCount < ratingRows.length && (
              <button type="button" className="rank-more" onClick={() => setRatingVisibleCount((count) => count + 20)}>
                {t('rank.loadMore')}
              </button>
            )}
          </div>
        )}
        {!loading && ratingRows.length === 0 && (
          <div className="rank-empty">
            <strong>{t('rank.emptyTitle')}</strong>
            <p>{t('rank.emptyLead')}</p>
          </div>
        )}
      </section>
      )}
    </div>
  )
}
