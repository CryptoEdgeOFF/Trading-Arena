import { useEffect, useMemo, useState } from 'react'
import {
  apiAssetUrl,
  getGlobalLeaderboard,
  getLeaderboardSeasons,
  type GlobalLeaderboardRow,
  type LeaderboardSeason,
} from '../lib/api'
import { ShareRankModal, type RankShareRow } from './ShareRankModal'
import { useI18n } from '../i18n'
import './GlobalLeaderboard.css'

const ALL_TIME = '__all__'

function seasonName(season: LeaderboardSeason) {
  if (season.slug) {
    return season.slug.replaceAll('-', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
  }
  return season.nameKey.split('.').at(-2)?.replace(/(\D)(\d)/, '$1 $2') || 'Season'
}

function championBadgeImage(season: LeaderboardSeason) {
  return season.championBadge === 'autumn-champion'
    ? '/assets/badges/Automn Season BTF Arena Badge.png'
    : '/assets/badges/Summer Season BTF Arena Badge.png'
}

export function GlobalLeaderboard({
  currentUserId,
  onBack,
  onOpenPlayer,
}: {
  currentUserId?: string
  onBack: () => void
  onOpenPlayer: (userId: string) => void
}) {
  const { t } = useI18n()
  const [seasons, setSeasons] = useState<LeaderboardSeason[]>([])
  const [activeTab, setActiveTab] = useState('')
  const [rows, setRows] = useState<GlobalLeaderboardRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [shareRow, setShareRow] = useState<RankShareRow | null>(null)

  useEffect(() => {
    let active = true
    void getLeaderboardSeasons().then((data) => {
      if (!active) return
      const next = data.seasons.slice().sort((a, b) => a.startAt - b.startAt)
      setSeasons(next)
      setActiveTab(data.activeSeasonId || next.find((season) => season.status === 'active')?.id || ALL_TIME)
    }).catch(() => {
      if (active) setActiveTab(ALL_TIME)
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!activeTab) return
    const season = seasons.find((item) => item.id === activeTab)
    if (season?.status === 'upcoming') {
      setRows([])
      setLoading(false)
      return
    }
    let active = true
    setLoading(true)
    setError('')
    void getGlobalLeaderboard(activeTab === ALL_TIME ? undefined : activeTab)
      .then((next) => active && setRows(next))
      .catch((nextError) => active && setError(nextError instanceof Error ? nextError.message : t('global.unavailable')))
      .finally(() => active && setLoading(false))
    return () => { active = false }
  }, [activeTab, seasons])

  const activeSeason = seasons.find((season) => season.id === activeTab)
  const myIndex = rows.findIndex((row) => row.userId === currentUserId)
  const myRow = myIndex >= 0 ? rows[myIndex] : null
  const contextLabel = activeTab === ALL_TIME ? t('global.title') : activeSeason ? seasonName(activeSeason) : t('global.season')
  const podium = useMemo(() => [rows[1], rows[0], rows[2]].filter(Boolean), [rows])

  function openShare(row: GlobalLeaderboardRow, rank: number) {
    setShareRow({ rank, name: row.name, pnlUsd: row.pnlUsd })
  }

  return (
    <div className="global-leaderboard-page">
      <header className="subpage-head">
        <button type="button" onClick={onBack} aria-label={t('common.back')}>‹</button>
        <div><span>{t('global.kicker')}</span><h2>{t('global.title')}</h2></div>
      </header>

      <div className="global-tabs">
        {seasons.map((season) => (
          <button key={season.id} type="button" className={activeTab === season.id ? 'is-active' : ''}
            disabled={season.status === 'upcoming'} onClick={() => setActiveTab(season.id)}>
            {seasonName(season)}{season.status === 'upcoming' && <small>{t('global.soon')}</small>}
          </button>
        ))}
        <button type="button" className={activeTab === ALL_TIME ? 'is-active' : ''} onClick={() => setActiveTab(ALL_TIME)}>{t('global.allTime')}</button>
      </div>

      {activeSeason?.bannerImage && (
        <section className={`global-season-banner is-${activeSeason.theme}`}>
          <img src={activeSeason.bannerImage} alt="" />
          <div><small>{activeSeason.status === 'active' ? t('global.seasonLive') : t('global.seasonEnded')}</small><strong>{seasonName(activeSeason)}</strong></div>
        </section>
      )}

      {activeSeason && activeSeason.status !== 'upcoming' && (
        <section className={`global-season-prizes is-${activeSeason.theme}`}>
          <header>
            <small>{t('global.grandPrix', { season: seasonName(activeSeason).toUpperCase() })}</small>
            <h3>{t('global.prizeTitle')}</h3>
            <p>{t('global.prizeLead')}</p>
          </header>
          <div className="global-prize-steps">
            <span><i>1</i>{t('global.step1')}</span><span>›</span>
            <span><i>2</i>{t('global.step2')}</span><span>›</span>
            <span><i>3</i>{t('global.step3')}</span>
          </div>
          <div className="global-prize-grid">
            <article>
              <img src={championBadgeImage(activeSeason)} alt={t('global.championBadge')} />
              <strong>{t('global.championBadge')}</strong>
            </article>
            {activeSeason.shirtImage && <article>
              <img src={activeSeason.shirtImage} alt={t('global.officialShirt')} />
              <strong>{t('global.officialShirt')}</strong>
            </article>}
            {activeSeason.arenaImage && <article>
              <small>BTF 2027 · PARIS</small>
              <img src={activeSeason.arenaImage} alt={t('global.arenaAccess')} />
              <strong>{t('global.arenaAccess')}</strong>
            </article>}
          </div>
          <footer>{t('global.unique')}</footer>
        </section>
      )}

      {myRow && (
        <section className="global-my-rank">
          <div><small>{t('global.yourRank')}</small><strong>#{myIndex + 1}</strong></div>
          <div><small>{t('global.cumulated')}</small><strong className={myRow.pnlUsd >= 0 ? 'positive' : 'negative'}>{myRow.pnlUsd >= 0 ? '+' : ''}{myRow.pnlUsd.toFixed(2)} $</strong></div>
          <button type="button" onClick={() => openShare(myRow, myIndex + 1)}>{t('common.share')}</button>
        </section>
      )}

      {loading ? <div className="global-leaderboard-state">{t('global.loading')}</div>
        : error ? <div className="global-leaderboard-state is-error">{error}</div>
          : <>
            {podium.length > 0 && (
              <section className="global-podium">
                {podium.map((row) => {
                  const rank = rows.indexOf(row) + 1
                  return <article key={row.userId} className={`is-rank-${rank}`} onClick={() => onOpenPlayer(row.userId)}>
                    <span>#{rank}</span>
                    {row.avatarUrl ? <img src={apiAssetUrl(row.avatarUrl)} alt="" /> : <i>{row.name.slice(0, 2).toUpperCase()}</i>}
                    <strong>{row.name}</strong><small>{row.pnlUsd >= 0 ? '+' : ''}{row.pnlUsd.toFixed(0)} $</small>
                  </article>
                })}
              </section>
            )}
            <section className="global-ranking-list">
              <header><span>RANG</span><span>TRADER</span><span>STATS</span><span>PNL</span></header>
              {rows.map((row, index) => (
                <article key={row.userId} className={row.userId === currentUserId ? 'is-me' : ''}>
                  <strong>#{index + 1}</strong>
                  <button type="button" onClick={() => onOpenPlayer(row.userId)}>
                    {row.avatarUrl ? <img src={apiAssetUrl(row.avatarUrl)} alt="" /> : <i>{row.name.slice(0, 2).toUpperCase()}</i>}
                    <span>{row.name}<small>{t(row.arenas > 1 ? 'global.arenasPlural' : 'global.arenas', { count: row.arenas })}</small></span>
                  </button>
                  <span><strong>{(row.stats.winRate * 100).toFixed(0)}%</strong><small>{row.stats.closedTrades} trades</small></span>
                  <span className={row.pnlUsd >= 0 ? 'positive' : 'negative'}><strong>{row.pnlUsd >= 0 ? '+' : ''}{row.pnlUsd.toFixed(2)} $</strong>
                    {row.userId === currentUserId && <button type="button" onClick={() => openShare(row, index + 1)}>{t('common.share')}</button>}
                  </span>
                </article>
              ))}
              {!rows.length && <div className="global-leaderboard-state">{t('global.empty')}</div>}
            </section>
          </>}
      <ShareRankModal row={shareRow} competition={contextLabel} participants={rows.length} onClose={() => setShareRow(null)} />
    </div>
  )
}
