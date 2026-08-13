import { useEffect, useMemo, useState } from 'react'
import {
  apiAssetUrl,
  getGlobalLeaderboard,
  getLeaderboardSeasons,
  type GlobalLeaderboardRow,
  type LeaderboardSeason,
} from '../lib/api'
import { ShareRankModal, type RankShareRow } from './ShareRankModal'
import './GlobalLeaderboard.css'

const ALL_TIME = '__all__'

function seasonName(season: LeaderboardSeason) {
  if (season.slug) {
    return season.slug.replaceAll('-', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
  }
  return season.nameKey.split('.').at(-2)?.replace(/(\D)(\d)/, '$1 $2') || 'Saison'
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
      .catch((nextError) => active && setError(nextError instanceof Error ? nextError.message : 'Classement indisponible'))
      .finally(() => active && setLoading(false))
    return () => { active = false }
  }, [activeTab, seasons])

  const activeSeason = seasons.find((season) => season.id === activeTab)
  const myIndex = rows.findIndex((row) => row.userId === currentUserId)
  const myRow = myIndex >= 0 ? rows[myIndex] : null
  const contextLabel = activeTab === ALL_TIME ? 'Classement global' : activeSeason ? seasonName(activeSeason) : 'Saison'
  const podium = useMemo(() => [rows[1], rows[0], rows[2]].filter(Boolean), [rows])

  function openShare(row: GlobalLeaderboardRow, rank: number) {
    setShareRow({ rank, name: row.name, pnlUsd: row.pnlUsd })
  }

  return (
    <div className="global-leaderboard-page">
      <header className="subpage-head">
        <button type="button" onClick={onBack} aria-label="Retour">‹</button>
        <div><span>SAISONS BTF</span><h2>Classement global</h2></div>
      </header>

      <div className="global-tabs">
        {seasons.map((season) => (
          <button key={season.id} type="button" className={activeTab === season.id ? 'is-active' : ''}
            disabled={season.status === 'upcoming'} onClick={() => setActiveTab(season.id)}>
            {seasonName(season)}{season.status === 'upcoming' && <small>Bientôt</small>}
          </button>
        ))}
        <button type="button" className={activeTab === ALL_TIME ? 'is-active' : ''} onClick={() => setActiveTab(ALL_TIME)}>Global</button>
      </div>

      {activeSeason?.bannerImage && (
        <section className={`global-season-banner is-${activeSeason.theme}`}>
          <img src={activeSeason.bannerImage} alt="" />
          <div><small>{activeSeason.status === 'active' ? 'SAISON EN COURS' : 'SAISON TERMINÉE'}</small><strong>{seasonName(activeSeason)}</strong></div>
        </section>
      )}

      {activeSeason && activeSeason.status !== 'upcoming' && (
        <section className={`global-season-prizes is-${activeSeason.theme}`}>
          <header>
            <small>{seasonName(activeSeason).toUpperCase()} · LE GRAND PRIX</small>
            <h3>90 jours pour finir #1 et trader au BTF 2027</h3>
            <p>Pendant toute la saison, enchaîne les arènes et cumule ton PnL. Le numéro 1 décroche les trois récompenses.</p>
          </header>
          <div className="global-prize-steps">
            <span><i>1</i>Enchaîne les arènes</span><span>›</span>
            <span><i>2</i>Cumule ton PnL</span><span>›</span>
            <span><i>3</i>Finis #1</span>
          </div>
          <div className="global-prize-grid">
            <article>
              <img src={championBadgeImage(activeSeason)} alt="Badge de Champion" />
              <strong>Badge de Champion</strong>
            </article>
            {activeSeason.shirtImage && <article>
              <img src={activeSeason.shirtImage} alt="Maillot officiel du Champion" />
              <strong>Maillot officiel</strong>
            </article>}
            {activeSeason.arenaImage && <article>
              <small>BTF 2027 · PARIS</small>
              <img src={activeSeason.arenaImage} alt="Accès Arène BTF 2027" />
              <strong>Accès Arène BTF 2027</strong>
            </article>}
          </div>
          <footer>🏆 Un seul vainqueur par saison — la place est unique.</footer>
        </section>
      )}

      {myRow && (
        <section className="global-my-rank">
          <div><small>TON CLASSEMENT</small><strong>#{myIndex + 1}</strong></div>
          <div><small>PNL CUMULÉ</small><strong className={myRow.pnlUsd >= 0 ? 'positive' : 'negative'}>{myRow.pnlUsd >= 0 ? '+' : ''}{myRow.pnlUsd.toFixed(2)} $</strong></div>
          <button type="button" onClick={() => openShare(myRow, myIndex + 1)}>Partager</button>
        </section>
      )}

      {loading ? <div className="global-leaderboard-state">Chargement du classement…</div>
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
                    <span>{row.name}<small>{row.arenas} arène{row.arenas > 1 ? 's' : ''}</small></span>
                  </button>
                  <span><strong>{(row.stats.winRate * 100).toFixed(0)}%</strong><small>{row.stats.closedTrades} trades</small></span>
                  <span className={row.pnlUsd >= 0 ? 'positive' : 'negative'}><strong>{row.pnlUsd >= 0 ? '+' : ''}{row.pnlUsd.toFixed(2)} $</strong>
                    {row.userId === currentUserId && <button type="button" onClick={() => openShare(row, index + 1)}>Partager</button>}
                  </span>
                </article>
              ))}
              {!rows.length && <div className="global-leaderboard-state">Aucun trader classé pour le moment.</div>}
            </section>
          </>}
      <ShareRankModal row={shareRow} competition={contextLabel} participants={rows.length} onClose={() => setShareRow(null)} />
    </div>
  )
}
