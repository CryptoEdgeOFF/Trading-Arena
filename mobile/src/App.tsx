import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Capacitor } from '@capacitor/core'
import { Haptics, ImpactStyle } from '@capacitor/haptics'
import { PushNotifications } from '@capacitor/push-notifications'
import { StatusBar, Style } from '@capacitor/status-bar'
import { AnimatePresence, motion } from 'framer-motion'
import {
  API_BASE_URL,
  API_WS_URL,
  apiAssetUrl,
  getBootstrap,
  getCompetitionLeaderboard,
  getGlobalChatMessages,
  getGlobalLeaderboard,
  getLeaderboardSeasons,
  getNewsPage,
  newsCoverAssetUrl,
  getPnlHistory,
  getPromotions,
  logoutSession,
  registerPushDevice,
  unregisterPushDevice,
  type BootstrapData,
  type GlobalLeaderboardRow,
  type LeaderboardRow,
  type MyCompetition,
  type NewsArticle,
  type PlayerRating,
  type PnlHistorySample,
  type PnlHistoryTrader,
  type PnlMoment,
  type PublicCompetition,
  type SessionUser,
} from './lib/api'
import {
  clearPaperSessionToken,
  clearSessionToken,
  readSessionToken,
  writeSessionToken,
} from './lib/session'
import { AuthSheet } from './components/AuthSheet'
import { DealsScreen } from './components/DealsScreen'
import { HomeBonusCard } from './components/HomeBonusCard'
import { DIVISION_BOUNDS, DivisionBadge, DivisionCard, divisionDisplayName } from './components/DivisionCard'
import { GlobalChat } from './components/GlobalChat'
import { JoinArenaSheet } from './components/JoinArenaSheet'
import { LaunchSplash } from './components/LaunchSplash'
import { LanguageSwitcher } from './components/LanguageSwitcher'
import { closeNewsArticleIfOpen, NewsScreen } from './components/NewsScreen'
import { PlayerBadges } from './components/PlayerBadges'
import { PlayerName } from './components/PlayerName'
import { PlayerProfile } from './components/PlayerProfile'
import { PayoutsScreen } from './components/PayoutsScreen'
import { PnlRaceChart } from './components/PnlRaceChart'
import { ProfileAvatar, TraderPhoto } from './components/ProfileAvatar'
import { ProfileSettings } from './components/ProfileSettings'
import { RankScreen } from './components/RankScreen'
import { ShareRankModal } from './components/ShareRankModal'
import { TeamScreen } from './components/TeamScreen'
import { TradeJournal } from './components/TradeJournal'
import { TradingTerminal } from './components/TradingTerminal'
import { useBackSwipe } from './lib/useBackSwipe'
import { useI18n } from './i18n'
import './App.css'

type Tab = 'home' | 'live' | 'rank' | 'deals' | 'trade' | 'community' | 'news' | 'leaderboard' | 'journal' | 'settings' | 'player' | 'profile' | 'payouts' | 'team'
type IconName = Tab | 'bell' | 'arrow' | 'refresh' | 'shield'
const ENABLE_TEST_TOOLS = import.meta.env.VITE_ENABLE_TEST_LOGIN === 'true'

const icons: Record<IconName, ReactNode> = {
  home: <path d="M7 4.8v14.4a.5.5 0 0 0 .76.43l11.77-7.2a.5.5 0 0 0 0-.86L7.76 4.37A.5.5 0 0 0 7 4.8Z" />,
  live: <path d="M12 12h.01M8.5 8.5a5 5 0 0 0 0 7m7-7a5 5 0 0 1 0 7M5.6 5.6a9 9 0 0 0 0 12.8m12.8-12.8a9 9 0 0 1 0 12.8" />,
  rank: <path d="M8 21h8m-4-4v4M6 4h12v3a6 6 0 0 1-12 0V4Zm12 1h3a3 3 0 0 1-3 4M6 5H3a3 3 0 0 0 3 4" />,
  deals: <path d="M20 12v8H4v-8M2 7h20v5H2V7Zm10 13V7m0 0H7.5A2.5 2.5 0 1 1 12 4.8M12 7h4.5A2.5 2.5 0 1 0 12 4.8" />,
  trade: <path d="M5 19V9m0 0L2.5 11.5M5 9l2.5 2.5M19 5v10m0 0 2.5-2.5M19 15l-2.5-2.5M10 7h4m-4 5h4m-4 5h4" />,
  community: <path d="M21 12a8 8 0 0 1-8 8H7l-4 2 1.4-4.2A8 8 0 1 1 21 12ZM9 11h.01M12 11h.01M15 11h.01" />,
  news: <path d="M5 4h14v16H5V4Zm3 4h8M8 12h8m-8 4h5" />,
  leaderboard: <path d="M4 20V10h4v10H4Zm6 0V4h4v16h-4Zm6 0v-7h4v7h-4Z" />,
  journal: <path d="M5 3h14v18H5V3Zm4 5h6m-6 4h6m-6 4h4" />,
  settings: <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm7.4-3.5a7 7 0 0 0-.1-1l2-1.6-2-3.4-2.4 1a8 8 0 0 0-1.7-1L15 3.5h-4L10.6 6a8 8 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6a7 7 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a8 8 0 0 0 1.7 1l.4 2.5h4l.4-2.5a8 8 0 0 0 1.7-1l2.4 1 2-3.4-2-1.6a7 7 0 0 0 .1-1Z" />,
  player: <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm7 9a7 7 0 0 0-14 0" />,
  profile: <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm7 9a7 7 0 0 0-14 0" />,
  payouts: <path d="M4 7h16v12H4V7Zm2 4h12M8 7V5h8v2" />,
  team: <path d="M16 11a3 3 0 1 0-3-3 3 3 0 0 0 3 3Zm-8 0a3 3 0 1 0-3-3 3 3 0 0 0 3 3Zm8 2c-2.3 0-7 1.2-7 3.5V19h14v-2.5C23 14.2 18.3 13 16 13Zm-8 0c-.3 0-.7 0-1 .1C4.6 13.6 1 15 1 17.5V19h7" />,
  bell: <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Zm-8 12h4" />,
  arrow: <path d="m9 18 6-6-6-6" />,
  refresh: <path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" />,
  shield: <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Zm-3-10 2 2 4-5" />,
}

function Icon({ name, size = 22 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {icons[name]}
    </svg>
  )
}

function FormatChip({ format }: { format?: 'blitz' | 'weekly' | null }) {
  const { t } = useI18n()
  if (!format) return null
  return (
    <span className={`format-chip is-${format}`}>
      {format === 'blitz' ? t('format.blitz') : t('format.weekly')}
    </span>
  )
}

function isTeamLeaderboardRow(row: LeaderboardRow) {
  return Boolean(row.teamId && row.members?.length)
}

function isMyLeaderboardRow(row: LeaderboardRow, currentUserId?: string) {
  if (!currentUserId) return false
  if (row.userId === currentUserId) return true
  return Boolean(row.members?.some((member) => member.userId === currentUserId))
}

function TeamOrPlayerName({
  row,
  currentUserId,
  youLabel,
}: {
  row: LeaderboardRow
  currentUserId?: string
  youLabel: string
}) {
  const teamRow = isTeamLeaderboardRow(row)
  return (
    <span>
      <PlayerName name={row.name} country={teamRow ? null : row.country} />
      {isMyLeaderboardRow(row, currentUserId) && <small>{youLabel}</small>}
      {teamRow && <em className="team-members-line">{row.members!.map((member) => member.name).join(' · ')}</em>}
    </span>
  )
}

const ARENA_VISUALS = {
  weekly: '/assets/pictures/arena-live-gold.webp',
  blitz: '/assets/pictures/arena-live-red.webp',
  default: '/assets/pictures/arena-live-red.webp',
} as const

function arenaVisual(competition: Pick<PublicCompetition, 'bannerImageUrl' | 'format'>) {
  if (competition.bannerImageUrl) return apiAssetUrl(competition.bannerImageUrl)
  return competition.format === 'weekly' ? ARENA_VISUALS.weekly : ARENA_VISUALS.default
}

function ArenaCard({
  competition,
  onLeaderboard,
  onJoin,
  onTrade,
  joined,
  mine,
}: {
  competition: PublicCompetition
  onLeaderboard: (competitionId: string) => void
  onJoin: (competition: PublicCompetition) => void
  onTrade: (competitionId: string) => void
  joined: boolean
  mine?: MyCompetition
}) {
  const { t, locale } = useI18n()
  const title = competition.title || t('arena.fallbackTitle')
  const players = competition.participants ?? 0
  const status = competition.status === 'live' ? t('arena.live')
    : competition.status === 'registration' ? t('arena.registration')
      : competition.status === 'starting_soon' ? t('arena.startingSoon')
        : t('arena.ended')
  return (
    <motion.article className={`arena-card is-${competition.status}`} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}>
      <img className="arena-card__banner"
        src={competition.bannerImageUrl ? apiAssetUrl(competition.bannerImageUrl) : '/assets/pictures/btf-arena-seo.webp'} alt="" />
      <div className="arena-card__shade" />
      <div className="arena-card__glow" />
      <div className="arena-card__top">
        <span className="live-pill"><i />{status}</span>
        <FormatChip format={competition.format} />
        {competition.entryMode === 'team' && <span className="format-chip is-team">{t('arena.teamChip')}</span>}
        <span className="arena-card__players">{competition.entryMode === 'team' ? t('arena.teams', { count: players }) : t('arena.players', { count: players })}</span>
      </div>
      <h3>{title}</h3>
      <div className="arena-card__schedule">
        <span><small>{t('arena.start')}</small><strong>{new Date(competition.startAt).toLocaleDateString(locale, { day: '2-digit', month: 'short' })}</strong></span>
        <span><small>{t('arena.end')}</small><strong>{new Date(competition.endAt).toLocaleDateString(locale, { day: '2-digit', month: 'short' })}</strong></span>
        {mine && <span><small>{t('arena.myRank')}</small><strong>#{mine.rank ?? '—'}</strong></span>}
      </div>
      <div className="arena-card__meta">
        <div>
          <small>{t('arena.prize')}</small>
          <strong>
            {competition.cashPrize?.total
              ? `${competition.cashPrize.total.toLocaleString(locale)} ${competition.cashPrize.currency || '€'}`
              : t('arena.toConfirm')}
          </strong>
        </div>
        <div className="arena-card__actions">
          {mine?.canTrade && <button type="button" onClick={() => onTrade(competition.id)}>{t('arena.trade')}</button>}
          {!joined && competition.canJoin !== false && (
            <button type="button" onClick={() => onJoin(competition)}>{t('arena.join')}</button>
          )}
          <button type="button" onClick={() => onLeaderboard(competition.id)} aria-label={t('arena.leaderboardAria', { title })}>
            {t('arena.leaderboard')} <Icon name="arrow" size={16} />
          </button>
        </div>
      </div>
    </motion.article>
  )
}

/** Progression (0-100 %) dans la division courante, vers la division suivante. */
function divisionProgress(rating: PlayerRating): number {
  const bounds = DIVISION_BOUNDS[rating.division.id]
  if (!bounds || !Number.isFinite(bounds[1])) return 100
  const [floor, ceiling] = bounds
  return Math.max(3, Math.min(100, ((rating.points - floor) / (ceiling - floor)) * 100))
}


function SeasonShowcase({ onGlobalLeaderboard }: { onGlobalLeaderboard: () => void }) {
  const { t } = useI18n()
  const [rows, setRows] = useState<GlobalLeaderboardRow[]>([])
  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const data = await getLeaderboardSeasons()
        const season = data.seasons.find(({ id }) => id === data.activeSeasonId)
          || data.seasons.find(({ status }) => status === 'active')
          || data.seasons.filter(({ status }) => status !== 'upcoming').at(-1)
        const nextRows = season ? await getGlobalLeaderboard(season.id) : []
        if (active) setRows(nextRows)
      } catch {
        if (active) setRows([])
      }
    })()
    return () => { active = false }
  }, [])
  const rankedRows = rows.map((row, index) => ({ ...row, rank: index + 1 }))
  const podium = [rankedRows[1], rankedRows[0], rankedRows[2]].filter((row): row is GlobalLeaderboardRow & { rank: number } => Boolean(row))
  const runners = rankedRows.slice(3, 6)
  return (
    <section className="home-season">
      <div className="home-season__banner">
        <img src="/assets/Seasons/summer-season-ranking.webp" alt="" />
        <div className="home-season__banner-text">
          <span>{t('season.eyebrow')}</span>
          <h2>{t('season.title')}<br /><em>{t('season.titleEm')}</em></h2>
          <p>{t('season.lead')}</p>
        </div>
      </div>
      {podium.length > 0 && <div className="home-season__podium">
        {podium.map((player) => (
          <button key={player.userId} type="button" className={`home-season__player is-rank-${player.rank}`} onClick={onGlobalLeaderboard}>
            <i>{player.rank}</i>
            <span>{player.avatarUrl ? <TraderPhoto avatarUrl={player.avatarUrl} name={player.name} /> : player.name.split(' ').map((word) => word[0]).join('').slice(0, 2)}</span>
            <strong><PlayerName name={player.name} country={player.country} /></strong>
            <em>{player.pnlUsd >= 0 ? '+' : ''}{player.pnlUsd.toFixed(0)} $</em>
            <small>{t('season.arenas', { count: player.arenas })}</small>
          </button>
        ))}
      </div>}
      <div className="home-season__runners">
        {runners.map((player) => (
          <button key={player.userId} type="button" onClick={onGlobalLeaderboard}>
            <i>#{player.rank}</i>
            <strong><PlayerName name={player.name} country={player.country} /></strong>
            <em>{player.pnlUsd >= 0 ? '+' : ''}{player.pnlUsd.toFixed(0)} $</em>
          </button>
        ))}
        <button className="home-season__more" type="button" onClick={onGlobalLeaderboard}>
          {t('season.seeFull')} <b>›</b>
        </button>
      </div>
    </section>
  )
}

function useNow(intervalMs = 1_000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(timer)
  }, [intervalMs])
  return now
}

function formatCountdown(ms: number, dayUnit: string) {
  const total = Math.max(0, Math.floor(ms / 1_000))
  const days = Math.floor(total / 86_400)
  const pad = (value: number) => String(value).padStart(2, '0')
  const clock = `${pad(Math.floor((total % 86_400) / 3_600))}h ${pad(Math.floor((total % 3_600) / 60))}m ${pad(total % 60)}s`
  return days > 0 ? `${days}${dayUnit} ${clock}` : clock
}

function chatSeenKey(userId: string, competitionId?: string) {
  return competitionId ? `btf.chat.lastSeen.${userId}.${competitionId}` : `btf.chat.lastSeen.${userId}`
}

function readChatSeen(userId: string, competitionId?: string) {
  return Number(window.localStorage.getItem(chatSeenKey(userId, competitionId)) || 0)
}

function writeChatSeen(userId: string, timestamp: number, competitionId?: string) {
  if (!userId || !Number.isFinite(timestamp) || timestamp <= 0) return
  const previous = readChatSeen(userId, competitionId)
  if (timestamp > previous) window.localStorage.setItem(chatSeenKey(userId, competitionId), String(timestamp))
}

function countUnreadChat(
  messages: Array<{ userId: string; createdAt: number }>,
  userId: string,
  competitionId?: string,
) {
  const seen = readChatSeen(userId, competitionId)
  if (!seen) {
    const latest = messages.at(-1)?.createdAt || 0
    if (latest) writeChatSeen(userId, latest, competitionId)
    return 0
  }
  return messages.filter((message) => message.createdAt > seen && message.userId !== userId).length
}

function ArenaChatOverlay({
  competitionId,
  title,
  token,
  user,
  onClose,
  onAuth,
  onOpenPlayer,
}: {
  competitionId: string
  title: string
  token?: string | null
  user?: SessionUser | null
  onClose: () => void
  onAuth: () => void
  onOpenPlayer: (userId: string) => void
}) {
  return createPortal(
    <div className="arena-chat-overlay">
      <GlobalChat
        token={token}
        user={user}
        competitionId={competitionId}
        title={title}
        onClose={onClose}
        onAuth={onAuth}
        onLatestSeen={(timestamp) => {
          if (user?.id) writeChatSeen(user.id, timestamp, competitionId)
        }}
        onOpenPlayer={onOpenPlayer}
      />
    </div>,
    document.body,
  )
}

function LiveScreen({
  competitions,
  mineById,
  onLeaderboard,
  onTrade,
}: {
  competitions: PublicCompetition[]
  mineById: Map<string, MyCompetition>
  onLeaderboard: (competitionId: string) => void
  onTrade: (competitionId: string) => void
}) {
  const { t, locale } = useI18n()
  const now = useNow()
  const [previousLimit, setPreviousLimit] = useState(0)
  const liveArenas = competitions
    .filter((competition) => competition.status === 'live')
    .sort((a, b) => a.endAt - b.endAt)
  const myArenas = competitions
    .filter((competition) => (
      competition.status !== 'ended'
      && (
        mineById.has(competition.id)
        || /^(STAGING|MOBILE STAGING)\b/i.test(competition.title)
      )
    ))
    .sort((a, b) => {
      const rank = (status: PublicCompetition['status']) => (
        status === 'live' ? 0 : status === 'starting_soon' ? 1 : status === 'registration' ? 2 : 9
      )
      const byStatus = rank(a.status) - rank(b.status)
      return byStatus !== 0 ? byStatus : a.startAt - b.startAt
    })
  const featuredMine = myArenas[0] || null
  const otherMine = myArenas.slice(1)
  const otherLiveArenas = liveArenas.filter((competition) => !mineById.has(competition.id))
  const upcoming = competitions
    .filter((competition) => (
      (competition.status === 'registration' || competition.status === 'starting_soon')
      && !mineById.has(competition.id)
    ))
    .sort((a, b) => a.startAt - b.startAt)
  const allPrevious = competitions
    .filter((competition) => competition.status === 'ended')
    .sort((a, b) => b.endAt - a.endAt)
  const previous = allPrevious.slice(0, previousLimit)
  const compactEmpty = (label: string) => (
    <div className="live-empty is-compact"><p>{label}</p></div>
  )
  const renderLiveArenas = (arenas: PublicCompetition[]) => (
    <div className="live-list">
      {arenas.map((arena, index) => (
        <motion.article key={arena.id} className="live-card" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <img className="live-card__art" src={arenaVisual(arena)} alt="" />
          <i className="live-card__fx" aria-hidden="true" />
          <header>
            <span className="live-card__number">ARENA {String(index + 1).padStart(2, '0')}</span>
            <small>{t('arena.players', { count: (arena.participants ?? 0).toLocaleString(locale) })}</small>
          </header>
          <div className="live-card__title">
            <span className="live-card__thumb"><img src={arenaVisual(arena)} alt="" /></span>
            <div>
              <span className="live-pill"><i />{t('arena.live')}</span>
              <h3>{arena.title || t('arena.fallbackTitle')}</h3>
            </div>
          </div>
          <div className="live-card__meta">
            <span><small>{t('live.remaining')}</small><strong>{formatCountdown(arena.endAt - now, t('nextArena.dayUnit'))}</strong></span>
            <div className="live-card__actions">
              {mineById.get(arena.id)?.canTrade && <button type="button" onClick={() => onTrade(arena.id)}>{t('arena.trade')}</button>}
              <button className="is-primary" type="button" onClick={() => onLeaderboard(arena.id)}>{t('live.spectate')}</button>
            </div>
          </div>
        </motion.article>
      ))}
    </div>
  )
  return (
    <div className="live-screen">
      <header className="live-lobby-head">
        <div>
          <span><i /> {t('live.kicker')}</span>
          <h2>{t('live.title')}</h2>
          <p>{t('live.lead')}</p>
        </div>
        <strong>{String(myArenas.length).padStart(2, '0')}</strong>
      </header>
      <section className="live-upcoming">
        <header><span>{t('live.mine')}</span><i /></header>
        {featuredMine ? (
          <article className={`live-mine ${featuredMine.status === 'live' ? 'is-live' : 'is-soon'}`}>
            <img className="live-mine__art" src={arenaVisual(featuredMine)} alt="" />
            <div className="live-mine__top">
              <span className={`live-pill ${featuredMine.status === 'live' ? '' : 'is-soon'}`}>
                <i />{featuredMine.status === 'live' ? t('arena.live') : t('live.registered')}
              </span>
              <FormatChip format={featuredMine.format} />
              {featuredMine.entryMode === 'team' && <span className="format-chip is-team">{t('arena.teamChip')}</span>}
            </div>
            <h3>{featuredMine.title || t('arena.fallbackTitle')}</h3>
            <div className="live-mine__countdown">
              <small>{featuredMine.status === 'live' ? t('live.remaining') : t('live.startsIn')}</small>
              <strong>{formatCountdown(
                (featuredMine.status === 'live' ? featuredMine.endAt : featuredMine.startAt) - now,
                t('nextArena.dayUnit'),
              )}</strong>
              {featuredMine.status !== 'live' && (
                <em>{t('live.startsAt')} {new Date(featuredMine.startAt).toLocaleString(locale, {
                  weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                })}</em>
              )}
            </div>
            <footer>
              <small>{t('arena.players', { count: (featuredMine.participants ?? 0).toLocaleString(locale) })}</small>
              <div className="live-card__actions">
                {mineById.get(featuredMine.id)?.canTrade && (
                  <button type="button" onClick={() => onTrade(featuredMine.id)}>{t('arena.trade')}</button>
                )}
                <button className="is-primary" type="button" onClick={() => onLeaderboard(featuredMine.id)}>
                  {featuredMine.status === 'live' ? t('live.spectate') : t('arena.leaderboard')}
                </button>
              </div>
            </footer>
          </article>
        ) : compactEmpty(t('live.emptyMine'))}
        {otherMine.length > 0 && renderLiveArenas(otherMine.filter((arena) => arena.status === 'live'))}
        {otherMine.filter((arena) => arena.status !== 'live').map((arena) => (
          <div key={arena.id} className="live-upcoming__row">
            <span className="live-upcoming__icon"><img src={arenaVisual(arena)} alt="" /></span>
            <button type="button" onClick={() => onLeaderboard(arena.id)}>
              <span className="live-upcoming__label">
                <strong>{arena.title || t('arena.fallbackTitle')}</strong>
                <small>{t('live.registered')}</small>
              </span>
              <span className="live-upcoming__when">
                <em>{formatCountdown(arena.startAt - now, t('nextArena.dayUnit'))}</em>
                <small>{new Date(arena.startAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}</small>
              </span>
            </button>
          </div>
        ))}
      </section>
      <section className="live-upcoming">
        <header><span>{t('live.current')}</span><i /></header>
        {otherLiveArenas.length ? renderLiveArenas(otherLiveArenas) : compactEmpty(t('live.emptyOtherLive'))}
      </section>
      <section className="live-upcoming">
        <header><span>{t('live.upcoming')}</span><i /></header>
        {upcoming.length > 0 ? (
          upcoming.map((arena) => (
            <div key={arena.id} className="live-upcoming__row">
              <span className="live-upcoming__icon"><img src={arenaVisual(arena)} alt="" /></span>
              <button type="button" onClick={() => onLeaderboard(arena.id)}>
                <span className="live-upcoming__label">
                  <strong>{arena.title || t('arena.fallbackTitle')}</strong>
                  <FormatChip format={arena.format} />
                  {arena.entryMode === 'team' && <span className="format-chip is-team">{t('arena.teamChip')}</span>}
                </span>
                <span className="live-upcoming__when">
                  <em>{formatCountdown(arena.startAt - now, t('nextArena.dayUnit'))}</em>
                  <small>{new Date(arena.startAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}</small>
                </span>
              </button>
            </div>
          ))
        ) : compactEmpty(t('live.emptyUpcoming'))}
      </section>
      <section className="live-upcoming">
        <header><span>{t('live.previous')}</span><i /></header>
        {previous.map((arena) => (
          <div key={arena.id} className="live-upcoming__row">
            <span className="live-upcoming__icon"><img src={arenaVisual(arena)} alt="" /></span>
            <button type="button" onClick={() => onLeaderboard(arena.id)}>
              <span className="live-upcoming__label">
                <strong>{arena.title || t('arena.fallbackTitle')}</strong>
                <small>{t('arena.ended')}</small>
              </span>
              <span className="live-upcoming__when">
                <em>{t('arena.leaderboard')}</em>
                <small>{new Date(arena.endAt).toLocaleDateString(locale)}</small>
              </span>
            </button>
          </div>
        ))}
        {allPrevious.length === 0 && compactEmpty(t('live.emptyPrevious'))}
        {previousLimit < allPrevious.length && (
          <button className="home-ended-toggle" type="button" onClick={() => setPreviousLimit((current) => current + 5)}>
            {previousLimit === 0 ? t('live.loadPrevious') : t('live.loadMorePrevious')}
          </button>
        )}
      </section>
    </div>
  )
}

function HomeScreen({
  loading,
  competitions,
  dashboard,
  onRefresh,
  onAuth,
  onJoin,
  onTrade,
  onLeaderboard,
  onGlobalLeaderboard,
  onProfile,
  onNews,
  onOpenArticle,
  onRank,
  onPayouts,
  onDeals,
  unreadNews,
  claimablePayouts,
}: {
  loading: boolean
  competitions: PublicCompetition[]
  dashboard: BootstrapData | null
  onRefresh: () => void
  onAuth: () => void
  onJoin: (competition: PublicCompetition) => void
  onTrade: (competitionId: string) => void
  onLeaderboard: (competitionId: string) => void
  onGlobalLeaderboard: () => void
  onProfile: () => void
  onNews: () => void
  onOpenArticle: (articleId: string) => void
  onRank: () => void
  onPayouts: () => void
  onDeals: () => void
  unreadNews: number
  claimablePayouts: number
}) {
  const { t, locale } = useI18n()
  const user = dashboard?.user
  const statsCompetitions = (dashboard?.myCompetitions || []).filter((competition) => !/qualif/i.test(competition.title))
  const totalPnl = statsCompetitions.reduce((sum, competition) => sum + competition.myEntry.pnlUsd, 0)
  const mineById = new Map((dashboard?.myCompetitions || []).map((competition) => [competition.id, competition]))
  const isStagingTradingTest = (title?: string | null) => /^(STAGING|MOBILE STAGING)\b/i.test(String(title || ''))
  const active = competitions
    .filter((competition) => (
      competition.status === 'live'
      && (
        mineById.has(competition.id)
        || competition.canJoin === true
        || isStagingTradingTest(competition.title)
      )
    ))
    .sort((a, b) => a.endAt - b.endAt)
  const activeIds = new Set(active.map((competition) => competition.id))
  const openForJoin = competitions
    .filter((competition) => (
      competition.entryMode !== 'team'
      && competition.status !== 'ended'
      && !activeIds.has(competition.id)
      && (competition.status === 'registration' || competition.canJoin === true)
    ))
    .sort((a, b) => a.startAt - b.startAt)
  const hour = new Date().getHours()
  const greeting = hour >= 18 || hour < 5 ? t('home.greetingEvening') : t('home.greetingMorning')
  const [latestNews, setLatestNews] = useState<NewsArticle[]>([])

  useEffect(() => {
    let cancelled = false
    void getNewsPage(undefined, 2)
      .then((result) => {
        if (!cancelled) setLatestNews(result.news.slice(0, 2))
      })
      .catch(() => {
        if (!cancelled) setLatestNews([])
      })
    return () => { cancelled = true }
  }, [])

  return (
    <div className="home-dashboard">
      {user ? (
        <>
          <header className="home-topbar">
            <img className="home-topbar__logo" src="/assets/pictures/btf-logo-header.png" alt="BTF Arena" />
            <button className="news-button" type="button" onClick={onNews} aria-label={t('home.openNews')}>
              <Icon name="bell" size={19} />
              {unreadNews > 0 && <b className="news-unread-badge">{unreadNews > 9 ? '9+' : unreadNews}</b>}
            </button>
          </header>

          <section className={`player-card ${dashboard.myRating ? `is-${dashboard.myRating.division.id}` : ''}`}>
            <i className="player-card__fx" aria-hidden="true" />
            <div className="player-card__identity">
              <button type="button" onClick={onProfile} aria-label={t('home.openProfile')}>
                <ProfileAvatar avatarUrl={user.avatarUrl} name={user.name} size="sm" />
              </button>
              <div>
                <small>{greeting}</small>
                <strong><PlayerName name={user.name} country={user.country} /></strong>
              </div>
            </div>

            <div className="player-card__body">
              <div className="player-card__stats">
                <button type="button" onClick={onProfile} className={totalPnl >= 0 ? 'is-profit' : 'is-loss'}>
                  <small>{t('home.pnlGlobal')}</small>
                  <strong>{totalPnl >= 0 ? '+' : ''}{totalPnl.toLocaleString(locale, { maximumFractionDigits: 2 })} $</strong>
                </button>
                <button type="button" onClick={onProfile}>
                  <small>{t('home.profitFactor')}</small>
                  <strong>{dashboard.myStats?.profitFactor == null ? '—' : dashboard.myStats.profitFactor.toFixed(2)}</strong>
                </button>
                <button type="button" onClick={onRank}>
                  <small>{t('playerCard.worldRank')}</small>
                  <strong>
                    {dashboard.myRating?.worldRank != null
                      ? `#${dashboard.myRating.worldRank.toLocaleString(locale)} / ${dashboard.myRating.totalPlayers.toLocaleString(locale)}`
                      : '—'}
                  </strong>
                </button>
              </div>
              {dashboard.myRating && (
                <button className="player-card__badge" type="button" onClick={onRank} aria-label={t('division.kicker')}>
                  <DivisionBadge division={dashboard.myRating.division} />
                </button>
              )}
            </div>

            {dashboard.myRating && (
              <button className="player-card__progress" type="button" onClick={onRank}>
                <span>
                  <strong>
                    {divisionDisplayName(dashboard.myRating.division)}
                    <small className="ranking-scope-badge is-permanent">{t('rankingScope.permanent')}</small>
                  </strong>
                  <em>
                    {dashboard.myRating.next
                      ? t('division.toNext', { points: dashboard.myRating.next.pointsNeeded.toLocaleString(locale), label: dashboard.myRating.next.label })
                      : t('division.max')}
                  </em>
                </span>
                <i aria-hidden="true"><b style={{ width: `${divisionProgress(dashboard.myRating)}%` }} /></i>
              </button>
            )}
          </section>

          {claimablePayouts > 0 && (
            <button className="payout-notif" type="button" onClick={onPayouts}>
              <span>
                <strong>{t('home.payoutNotif')}</strong>
                <small>{t(claimablePayouts > 1 ? 'home.payoutNotifLeadPlural' : 'home.payoutNotifLead', { count: claimablePayouts })}</small>
              </span>
              <em>{t('home.claim')} ›</em>
            </button>
          )}

        </>
      ) : (
        <section className="home-guest-hero">
          <button className="news-button home-guest-hero__news" type="button" onClick={onNews} aria-label={t('home.openNews')}>
            <Icon name="bell" size={19} />
            {unreadNews > 0 && <b className="news-unread-badge">{unreadNews > 9 ? '9+' : unreadNews}</b>}
          </button>
          <div className="eyebrow"><span /> {t('home.guestEyebrow')}</div>
          <h1>{t('home.guestTitle')}<br /><em>{t('home.guestTitleEm')}</em></h1>
          <p>{t('home.guestLead')}</p>
          <button type="button" onClick={onAuth}>{t('common.login')} <Icon name="arrow" size={17} /></button>
          <button className="home-global-link" type="button" onClick={onGlobalLeaderboard}>{t('home.guestGlobal')}</button>
        </section>
      )}

      {openForJoin.length > 0 && (
        <section className="home-arena-section">
          <div className="section-title">
            <div><span>{t('home.competitions')}</span><h2>{t('home.openForJoin')}</h2></div>
          </div>
          <div className="home-join-list">
            {openForJoin.map((competition) => (
              <ArenaCard
                key={competition.id}
                competition={competition}
                mine={mineById.get(competition.id)}
                joined={mineById.has(competition.id)}
                onJoin={onJoin}
                onTrade={onTrade}
                onLeaderboard={onLeaderboard}
              />
            ))}
          </div>
        </section>
      )}

      {latestNews.length > 0 && (
        <section className="home-news">
          <div className="home-news__head">
            <span>{t('news.homeBanner')}</span>
            <button type="button" onClick={onNews}>{t('news.homeAll')} →</button>
          </div>
          {latestNews.map((article) => {
            const english = locale.startsWith('en')
            const title = english && article.titleEn ? article.titleEn : article.title
            return (
              <button key={article.id} type="button" className="home-news__card" onClick={() => onOpenArticle(article.id)}>
                {article.coverUrl && <img src={newsCoverAssetUrl(article.coverUrl, 'card')} alt="" />}
                <span>
                  <small>
                    {article.featured ? t('news.featured') : ''}
                    {new Date(article.publishedAt || article.createdAt).toLocaleDateString(locale, { day: 'numeric', month: 'short' })}
                  </small>
                  <strong>{title}</strong>
                </span>
              </button>
            )
          })}
        </section>
      )}

      {user && (loading || active.length > 0) && <section className="home-arena-section">
        {(loading || active.length > 0) && (
          <div className="section-title">
            <div><span>{t('home.competitions')}</span><h2>{t('live.current')}</h2></div>
            <button type="button" onClick={onRefresh} aria-label={t('common.refresh')}><Icon name="refresh" size={18} /></button>
          </div>
        )}
        {loading ? <div className="skeleton-card"><i /><i /><i /></div> : active.length ? (
          <div className="arena-list">{active.map((competition) => (
            <ArenaCard key={competition.id} competition={competition} mine={mineById.get(competition.id)}
              joined={mineById.has(competition.id)} onJoin={onJoin} onTrade={onTrade} onLeaderboard={onLeaderboard} />
          ))}</div>
        ) : null}
      </section>}

      <SeasonShowcase onGlobalLeaderboard={onGlobalLeaderboard} />
      <HomeBonusCard onOpen={onDeals} />
    </div>
  )
}

function App() {
  const [showLaunchSplash, setShowLaunchSplash] = useState(true)
  const { t, lang } = useI18n()
  const [tab, setTab] = useState<Tab>('home')
  const [competitions, setCompetitions] = useState<PublicCompetition[]>([])
  const [dashboard, setDashboard] = useState<BootstrapData | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [showAuth, setShowAuth] = useState(false)
  const [loading, setLoading] = useState(true)
  const [joiningArena, setJoiningArena] = useState<PublicCompetition | null>(null)
  const [tradeCompetitionId, setTradeCompetitionId] = useState('')
  const [selectedPlayerId, setSelectedPlayerId] = useState('')
  const [playerBackTab, setPlayerBackTab] = useState<'leaderboard' | 'community' | 'rank'>('leaderboard')
  const [leaderboardCompetitionId, setLeaderboardCompetitionId] = useState('')
  const [leaderboardBackTab, setLeaderboardBackTab] = useState<Exclude<Tab, 'leaderboard'>>('home')
  const [unreadNewsCount, setUnreadNewsCount] = useState(0)
  const [initialNewsId, setInitialNewsId] = useState('')
  const initialArenaRef = useRef(new URLSearchParams(window.location.search).get('arena') || '')

  const load = useCallback(async () => {
    setLoading(true)
    const storedToken = await readSessionToken()
    const nextDashboard = await getBootstrap(storedToken).catch(() => null)
    setToken(storedToken)
    setDashboard(nextDashboard)
    setCompetitions(nextDashboard?.publicCompetitions ?? [])
    const requestedArena = initialArenaRef.current
    if (requestedArena && nextDashboard?.publicCompetitions.some(({ id }) => id === requestedArena)) {
      initialArenaRef.current = ''
      setLeaderboardCompetitionId(requestedArena)
      setLeaderboardBackTab('home')
      setTab('leaderboard')
    }
    if (storedToken && nextDashboard && !nextDashboard.user) {
      await clearSessionToken()
      setToken(null)
    }
    setLoading(false)
  }, [])

  const markChatSeen = useCallback((timestamp: number) => {
    const userId = dashboard?.user?.id
    if (!userId) return
    writeChatSeen(userId, timestamp)
  }, [dashboard?.user?.id])

  const markNewsSeen = useCallback((timestamp: number) => {
    const previous = Number(window.localStorage.getItem('btf.news.lastSeen') || 0)
    if (timestamp > previous) window.localStorage.setItem('btf.news.lastSeen', String(timestamp))
    setUnreadNewsCount(0)
  }, [])

  useEffect(() => {
    void load()
    void getPromotions(lang)
    void getNewsPage()
    if (Capacitor.isNativePlatform()) {
      void StatusBar.setStyle({ style: Style.Dark })
      void StatusBar.setBackgroundColor({ color: '#050507' }).catch(() => undefined)
    }
  }, [load])

  useEffect(() => {
    let active = true
    const refreshNews = async () => {
      const result = await getNewsPage(undefined, 50, true).catch(() => null)
      if (!active || !result) return
      const seenAt = Number(window.localStorage.getItem('btf.news.lastSeen') || 0)
      setUnreadNewsCount(Math.min(99, result.news.filter((article) => (article.publishedAt || article.createdAt) > seenAt).length))
    }
    void refreshNews()
    const timer = window.setInterval(() => void refreshNews(), 60_000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [])

  function selectTab(nextTab: Tab) {
    setTab(nextTab)
    if (Capacitor.isNativePlatform()) void Haptics.impact({ style: ImpactStyle.Light })
  }

  const goBack = showAuth
    ? () => setShowAuth(false)
    : joiningArena
      ? () => setJoiningArena(null)
      : tab === 'payouts' || tab === 'deals' || tab === 'journal' || tab === 'settings' || tab === 'team'
        ? () => selectTab('profile')
        : tab === 'news'
          ? () => { if (!closeNewsArticleIfOpen()) selectTab('home') }
          : tab === 'leaderboard'
            ? () => selectTab(leaderboardBackTab)
            : tab === 'player'
              ? () => selectTab(playerBackTab)
              : null
  useBackSwipe(goBack)

  function openLeaderboard(competitionId: string, from: Exclude<Tab, 'leaderboard'>) {
    setLeaderboardCompetitionId(competitionId)
    setLeaderboardBackTab(from)
    selectTab('leaderboard')
  }

  function openGlobalLeaderboard(_from: Tab) {
    selectTab('rank')
  }

  useEffect(() => {
    if (!token || !Capacitor.isNativePlatform()) return
    let active = true
    const listeners: Array<{ remove: () => Promise<void> }> = []
    const setup = async () => {
      listeners.push(await PushNotifications.addListener('registration', (registration) => {
        if (!active) return
        window.localStorage.setItem('btf.pushDeviceToken', registration.value)
        const environment = import.meta.env.VITE_APNS_ENV === 'sandbox' || import.meta.env.VITE_APNS_ENV === 'production'
          ? import.meta.env.VITE_APNS_ENV
          : 'auto'
        const platform = Capacitor.getPlatform() === 'android' ? 'android' : 'ios'
        void registerPushDevice(token, registration.value, platform, environment)
          .then(() => console.info('[push] device registered'))
          .catch((error) => console.warn('[push] register failed:', error))
      }))
      listeners.push(await PushNotifications.addListener('registrationError', (registrationError) => {
        console.warn('[push] registration failed:', registrationError.error)
      }))
      listeners.push(await PushNotifications.addListener('pushNotificationReceived', (notification) => {
        console.info('[push] received', notification.title || 'BTF Arena', notification.body || '')
      }))
      listeners.push(await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
        const data = action.notification.data as { kind?: string; competitionId?: string; newsId?: string }
        if (data?.kind === 'payout') {
          selectTab('payouts')
          return
        }
        const competitionId = String(data?.competitionId || '')
        if (data?.kind === 'news') {
          setInitialNewsId(String(data.newsId || ''))
          selectTab('news')
          return
        }
        if ((data?.kind === 'rank_change' || data?.kind === 'podium_lost') && competitionId) {
          openLeaderboard(competitionId, 'home')
          return
        }
        if (data?.kind === 'rank_change' || data?.kind === 'podium_lost') {
          selectTab('rank')
          return
        }
        if (data?.kind === 'chat_reply') {
          selectTab('community')
          return
        }
        if (data?.kind === 'new_arena') {
          selectTab('live')
          return
        }
        if (
          data?.kind === 'order_filled'
          || data?.kind === 'stop_loss'
          || data?.kind === 'take_profit'
          || data?.kind === 'drawdown_warning'
          || data?.kind === 'arena_open'
        ) {
          if (competitionId) setTradeCompetitionId(competitionId)
          selectTab(competitionId ? 'trade' : 'home')
        }
      }))
      if (Capacitor.getPlatform() === 'android') {
        await PushNotifications.createChannel({
          id: 'btf_trading',
          name: 'Trading BTF',
          description: 'Ordres, SL/TP, drawdown, podium, arènes et actualités',
          importance: 5,
          visibility: 1,
          vibration: true,
        })
      }
      let permission = await PushNotifications.checkPermissions()
      if (permission.receive === 'prompt') permission = await PushNotifications.requestPermissions()
      if (permission.receive === 'granted') await PushNotifications.register()
    }
    void setup()
    return () => {
      active = false
      for (const listener of listeners) void listener.remove()
    }
  }, [token])

  async function handleAuthenticated(nextToken: string, _user: SessionUser) {
    await writeSessionToken(nextToken)
    setToken(nextToken)
    setShowAuth(false)
    await load()
  }

  async function handleLogout() {
    if (token) {
      const deviceToken = window.localStorage.getItem('btf.pushDeviceToken')
      if (deviceToken) await unregisterPushDevice(token, deviceToken).catch(() => undefined)
      await logoutSession(token).catch(() => undefined)
    }
    await Promise.all([clearSessionToken(), clearPaperSessionToken()])
    setToken(null)
    setDashboard((current) => current ? {
      ...current,
      user: null,
      myCompetitions: [],
      myStats: null,
      myBadges: [],
    } : null)
  }

  const navItems: Array<{ id: Tab; label: string }> = [
    { id: 'home', label: t('nav.play') },
    { id: 'live', label: t('nav.live') },
    { id: 'trade', label: t('nav.trade') },
    { id: 'rank', label: t('nav.rank') },
    { id: 'profile', label: t('nav.profile') },
  ]
  const leaderboardCompetitions = [
    ...competitions,
    ...(dashboard?.myCompetitions || []).filter((item) => !competitions.some((competition) => competition.id === item.id)),
  ]

  return (
    <main className={`app-shell ${Capacitor.isNativePlatform() ? 'is-native' : ''}`}>
      <div className="ambient ambient--one" />
      <div className="ambient ambient--two" />

      <AnimatePresence mode="wait">
        <motion.section key={tab} className={`screen ${tab === 'trade' ? 'screen--trade' : ''} ${tab === 'community' ? 'screen--community' : ''}`} initial={{ opacity: 0, x: 10 }}
          animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={{ duration: 0.22 }}>
          {tab === 'home' && (
            <HomeScreen
              loading={loading}
              competitions={leaderboardCompetitions}
              dashboard={dashboard}
              onRefresh={() => void load()}
              onAuth={() => setShowAuth(true)}
              onJoin={(competition) => token ? setJoiningArena(competition) : setShowAuth(true)}
              onTrade={(competitionId) => {
                setTradeCompetitionId(competitionId)
                selectTab('trade')
              }}
              onLeaderboard={(id) => openLeaderboard(id, 'home')}
              onGlobalLeaderboard={() => openGlobalLeaderboard('home')}
              onProfile={() => selectTab('profile')}
              onNews={() => {
                setInitialNewsId('')
                selectTab('news')
              }}
              onOpenArticle={(articleId) => {
                setInitialNewsId(articleId)
                selectTab('news')
              }}
              onRank={() => selectTab('rank')}
              onPayouts={() => selectTab('payouts')}
              onDeals={() => selectTab('deals')}
              unreadNews={unreadNewsCount}
              claimablePayouts={dashboard?.claimablePayouts || 0}
            />
          )}

          {tab === 'live' && (
            <LiveScreen
              competitions={leaderboardCompetitions}
              mineById={new Map((dashboard?.myCompetitions || []).map((competition) => [competition.id, competition]))}
              onLeaderboard={(id) => openLeaderboard(id, 'live')}
              onTrade={(competitionId) => {
                setTradeCompetitionId(competitionId)
                selectTab('trade')
              }}
            />
          )}

          {tab === 'rank' && (
            <RankScreen
              currentUserId={dashboard?.user?.id}
              rating={dashboard?.myRating}
              competitions={leaderboardCompetitions}
              onJoin={(competition) => token ? setJoiningArena(competition) : setShowAuth(true)}
              onOpenPlayer={(userId) => {
                setSelectedPlayerId(userId)
                setPlayerBackTab('rank')
                selectTab('player')
              }}
            />
          )}

          {tab === 'payouts' && token && (
            <PayoutsScreen token={token} onBack={() => selectTab('profile')} onChanged={() => void load()} />
          )}

          {tab === 'deals' && <DealsScreen onBack={() => selectTab('profile')} />}

          {tab === 'news' && <NewsScreen initialArticleId={initialNewsId} onSeen={markNewsSeen} onBack={() => selectTab('home')} />}

          {tab === 'community' && (
            token && dashboard?.user ? (
              <GlobalChat token={token} user={dashboard.user} onLatestSeen={markChatSeen} onOpenPlayer={(userId) => {
                setSelectedPlayerId(userId)
                setPlayerBackTab('community')
                selectTab('player')
              }} />
            ) : (
              <div className="empty-state empty-state--feature">
                <span><Icon name="community" size={34} /></span><small>{t('empty.communityKicker')}</small>
                <h3>{t('empty.communityTitle')}</h3>
                <p>{t('empty.communityLead')}</p>
                <button className="auth-open" type="button" onClick={() => setShowAuth(true)}>{t('common.login')}</button>
              </div>
            )
          )}

          {tab === 'trade' && (
            token && dashboard?.user ? (
              <TradingTerminal accountToken={token} competitions={dashboard.myCompetitions}
                initialCompetitionId={tradeCompetitionId}
                settingsUserId={dashboard.user.id}
                onOpenLeaderboard={(id) => openLeaderboard(id, 'trade')} />
            ) : (
              <div className="empty-state empty-state--feature">
                <span><Icon name="trade" size={34} /></span><small>{t('empty.tradeKicker')}</small>
                <h3>{t('empty.tradeTitle')}</h3>
                <p>{t('empty.tradeLead')}</p>
                <button className="auth-open" type="button" onClick={() => setShowAuth(true)}>{t('common.login')}</button>
              </div>
            )
          )}

          {tab === 'leaderboard' && (
            <LeaderboardScreen
              competitions={leaderboardCompetitions}
              initialCompetitionId={leaderboardCompetitionId}
              currentUserId={dashboard?.user?.id}
              token={token}
              sessionUser={dashboard?.user}
              onBack={() => selectTab(leaderboardBackTab)}
              onAuth={() => setShowAuth(true)}
              onOpenPlayer={(userId) => {
                setSelectedPlayerId(userId)
                setPlayerBackTab('leaderboard')
                selectTab('player')
              }}
            />
          )}

          {tab === 'player' && selectedPlayerId && (
            <PlayerProfile userId={selectedPlayerId} onBack={() => selectTab(playerBackTab)} />
          )}

          {tab === 'journal' && token && dashboard?.user && (
            <TradeJournal token={token} user={dashboard.user} onBack={() => selectTab('profile')} />
          )}

          {tab === 'settings' && token && dashboard?.user && (
            <ProfileSettings
              token={token}
              user={dashboard.user}
              onBack={() => selectTab('profile')}
              onUpdated={(user) => setDashboard((current) => current ? { ...current, user } : current)}
              onDeleted={() => {
                void handleLogout()
                selectTab('home')
              }}
            />
          )}

          {tab === 'team' && token && dashboard?.user && (
            <TeamScreen
              token={token}
              user={dashboard.user}
              team={dashboard.myTeam || null}
              onBack={() => selectTab('profile')}
              onChanged={(team) => setDashboard((current) => current ? { ...current, myTeam: team } : current)}
            />
          )}

          {tab === 'profile' && (
            dashboard?.user ? (
              <ProfileScreen
                dashboard={dashboard}
                token={token}
                onJournal={() => selectTab('journal')}
                onGlobalLeaderboard={() => openGlobalLeaderboard('profile')}
                onRewards={() => selectTab('deals')}
                onPayouts={() => selectTab('payouts')}
                onRank={() => selectTab('rank')}
                onSettings={() => selectTab('settings')}
                onTeam={() => selectTab('team')}
                onLogout={() => void handleLogout()}
              />
            ) : (
              <div className="empty-state empty-state--feature">
                <span><Icon name="profile" size={34} /></span><small>{t('empty.profileKicker')}</small>
                <h3>{t('empty.profileTitle')}</h3>
                <p>{t('empty.profileLead')}</p>
                <button className="auth-open" type="button" onClick={() => setShowAuth(true)}>{t('common.login')}</button>
                <code>{API_BASE_URL.replace('https://', '')}</code>
              </div>
            )
          )}
        </motion.section>
      </AnimatePresence>

      <nav className="bottom-nav" aria-label={t('nav.main')}>
        {navItems.map((item) => (
          <button key={item.id} type="button" className={`${tab === item.id ? 'is-active' : ''} ${item.id === 'trade' ? 'is-primary-trade' : ''}`}
            onClick={() => selectTab(item.id)} aria-current={tab === item.id ? 'page' : undefined}>
            <span><Icon name={item.id} size={22} /></span>{item.label}
          </button>
        ))}
      </nav>
      <AnimatePresence>
        {showAuth && <AuthSheet onClose={() => setShowAuth(false)} onAuthenticated={handleAuthenticated} />}
        {joiningArena && token && (
          <JoinArenaSheet
            token={token}
            userId={dashboard?.user?.id}
            team={dashboard?.myTeam}
            competition={joiningArena}
            onClose={() => setJoiningArena(null)}
            onJoined={() => {
              setJoiningArena(null)
              void load()
            }} />
        )}
      </AnimatePresence>
      {showLaunchSplash && <LaunchSplash onDone={() => setShowLaunchSplash(false)} />}
    </main>
  )
}

/**
 * Fusionne les échantillons PnL déjà accumulés côté client avec ceux du
 * serveur : chaque poll (10 s) ajoute le point « live » renvoyé par l'API,
 * donc la courbe s'allonge en continu sans attendre les échantillons
 * throttlés côté serveur. Déduplication à la seconde, fenêtre bornée.
 */
function mergePnlSamples(previous: PnlHistorySample[], incoming: PnlHistorySample[]): PnlHistorySample[] {
  const byTime = new Map<number, PnlHistorySample>()
  for (const sample of [...previous, ...incoming]) {
    byTime.set(Math.round(sample.t / 1000), sample)
  }
  return [...byTime.values()].sort((a, b) => a.t - b.t).slice(-480)
}

function BroadcastTicker({
  moments,
  traders,
  leader,
  participants,
  bestPnl,
}: {
  moments?: PnlMoment[]
  traders?: PnlHistoryTrader[]
  leader: LeaderboardRow | null
  participants: number
  bestPnl: number
}) {
  const { t } = useI18n()
  const items = useMemo(() => {
    const names = new Map((traders || []).map((trader) => [trader.userId, trader.name]))
    const list: Array<{ key: string; text: string; hot?: boolean }> = []
    if (leader) list.push({ key: 'leader', text: `👑 ${t('spectate.dominates', { name: leader.name })}`, hot: true })
    for (const moment of (moments || []).slice(-6).reverse()) {
      list.push({
        key: `${moment.t}-${moment.userId}-${moment.type}`,
        text: `${moment.type === 'leader' ? '⚡' : '▲'} ${t(moment.type === 'leader' ? 'spectate.momentLeader' : 'spectate.momentTop3', { name: names.get(moment.userId) || 'Trader' })}`,
      })
    }
    list.push({ key: 'traders', text: t('leaderboard.field', { count: participants }) })
    if (Number.isFinite(bestPnl) && bestPnl !== 0) {
      list.push({ key: 'best', text: `${t('leaderboard.best')} ${bestPnl >= 0 ? '+' : ''}${bestPnl.toFixed(2)}%`, hot: bestPnl > 0 })
    }
    return list
  }, [bestPnl, leader, moments, participants, t, traders])

  if (!items.length) return null
  const track = [...items, ...items]
  return (
    <div className="spec-ticker" aria-hidden="true">
      <span className="spec-ticker__tag"><i />{t('leaderboard.live')}</span>
      <div className="spec-ticker__rail">
        <div className="spec-ticker__track">
          {track.map((item, index) => (
            <span key={`${item.key}-${index}`}>{item.hot ? <b>{item.text}</b> : item.text}<em>·</em></span>
          ))}
        </div>
      </div>
    </div>
  )
}

function VersusStrip({
  left,
  right,
  onOpenPlayer,
}: {
  left: LeaderboardRow
  right: LeaderboardRow
  onOpenPlayer: (userId: string) => void
}) {
  const { t } = useI18n()
  const leftScore = Math.max(0.0001, left.pnlPercent - Math.min(0, Math.min(left.pnlPercent, right.pnlPercent)) + 0.5)
  const rightScore = Math.max(0.0001, right.pnlPercent - Math.min(0, Math.min(left.pnlPercent, right.pnlPercent)) + 0.5)
  const leftShare = Math.round((leftScore / (leftScore + rightScore)) * 100)
  const gap = Math.abs(left.pnlPercent - right.pnlPercent)

  function side(row: LeaderboardRow, position: 'left' | 'right', label: string) {
    const pos = row.pnlPercent >= 0
    const teamRow = isTeamLeaderboardRow(row)
    return (
      <button
        type="button"
        className={`spec-vs__side ${position === 'right' ? 'is-right' : ''}`}
        onClick={() => { if (!teamRow) onOpenPlayer(row.userId) }}
      >
        <span className="spec-vs__avatar">
          <TraderPhoto avatarUrl={row.avatarUrl} name={row.name} />
        </span>
        <span className="spec-vs__meta">
          <small>{label}</small>
          <strong><TeamOrPlayerName row={row} youLabel="" /></strong>
          <em className={pos ? 'is-pos' : 'is-neg'}>{pos ? '+' : ''}{row.pnlPercent.toFixed(2)}%</em>
        </span>
      </button>
    )
  }

  return (
    <section className="spec-vs">
      <div className="spec-vs__row">
        {side(left, 'left', t('leaderboard.rank1'))}
        <span className="spec-vs__badge">{t('leaderboard.versus')}</span>
        {side(right, 'right', t('leaderboard.rank2'))}
      </div>
      <div className="spec-vs__bar">
        <i style={{ width: `${leftShare}%` }} />
        <i style={{ width: `${100 - leftShare}%` }} />
        <span className="spec-vs__gap">Δ {gap.toFixed(2)}%</span>
      </div>
    </section>
  )
}

function LeaderboardScreen({
  competitions,
  initialCompetitionId,
  currentUserId,
  token,
  sessionUser,
  onBack,
  onAuth,
  onOpenPlayer,
}: {
  competitions: PublicCompetition[]
  initialCompetitionId: string
  currentUserId?: string
  token?: string | null
  sessionUser?: SessionUser | null
  onBack: () => void
  onAuth: () => void
  onOpenPlayer: (userId: string) => void
}) {
  const { t, locale } = useI18n()
  const now = useNow()
  const [competitionId, setCompetitionId] = useState(
    initialCompetitionId || competitions.find((item) => item.status === 'live')?.id || competitions[0]?.id || '',
  )
  const [rows, setRows] = useState<LeaderboardRow[]>([])
  const [loadingRows, setLoadingRows] = useState(true)
  const [error, setError] = useState('')
  const [shareRow, setShareRow] = useState<LeaderboardRow | null>(null)
  const [linkCopied, setLinkCopied] = useState(false)
  const [showChat, setShowChat] = useState(false)
  const [unreadChat, setUnreadChat] = useState(0)
  const [pnlHistory, setPnlHistory] = useState<{ samples: PnlHistorySample[]; traders: PnlHistoryTrader[]; moments: PnlMoment[] } | null>(null)
  const pnlBufferRef = useRef<{ competitionId: string; samples: PnlHistorySample[] }>({ competitionId: '', samples: [] })
  const pnlCursorRef = useRef<{ competitionId: string; cursor: number }>({ competitionId: '', cursor: 0 })
  const lastLivePnlSampleRef = useRef(0)

  useEffect(() => {
    if (initialCompetitionId && competitions.some((item) => item.id === initialCompetitionId)) {
      setCompetitionId(initialCompetitionId)
      return
    }
    if (!competitions.some((item) => item.id === competitionId)) {
      setCompetitionId(competitions.find((item) => item.status === 'live')?.id || competitions[0]?.id || '')
    }
  }, [competitionId, competitions, initialCompetitionId])

  const isLiveCompetition = competitions.find((item) => item.id === competitionId)?.status === 'live'

  useEffect(() => {
    if (!competitionId || showChat) {
      if (showChat) setUnreadChat(0)
      return
    }
    const userId = sessionUser?.id || currentUserId || 'guest'
    let cancelled = false
    const refresh = async () => {
      const messages = await getGlobalChatMessages(token, undefined, competitionId).catch(() => [])
      if (cancelled) return
      setUnreadChat(countUnreadChat(messages, userId, competitionId))
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), 20_000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [competitionId, currentUserId, sessionUser?.id, showChat, token])

  const loadLeaderboard = useCallback(async () => {
    if (!competitionId) {
      setRows([])
      setLoadingRows(false)
      return
    }
    setError('')
    try {
      const cursorState = pnlCursorRef.current
      const historyCursor = cursorState.competitionId === competitionId ? cursorState.cursor : 0
      const [nextRows, history] = await Promise.all([
        getCompetitionLeaderboard(competitionId),
        isLiveCompetition ? getPnlHistory(competitionId, historyCursor).catch(() => null) : Promise.resolve(null),
      ])
      const sorted = nextRows.sort((a, b) => a.rank - b.rank || b.pnlPercent - a.pnlPercent)
      setRows(sorted)
      if (history?.cursor) pnlCursorRef.current = { competitionId, cursor: history.cursor }
      if (history?.samples?.length && history.traders?.length) {
        const buffer = pnlBufferRef.current
        const merged = buffer.competitionId === competitionId
          ? mergePnlSamples(buffer.samples, history.samples)
          : mergePnlSamples([], history.samples)
        pnlBufferRef.current = { competitionId, samples: merged }
        setPnlHistory((current) => {
          const moments = historyCursor > 0
            ? [...(current?.moments || []), ...(history.moments || [])]
            : history.moments || []
          return {
            samples: merged,
            traders: history.traders,
            moments: [...new Map(moments.map((moment) => [`${moment.t}:${moment.type}:${moment.userId}`, moment])).values()],
          }
        })
      } else if (isLiveCompetition) {
        const ranked = sorted.filter((row) => row.rank > 0).slice(0, 10)
        if (!ranked.length) {
          setPnlHistory(null)
        } else {
          const now = Date.now()
          const rowsSnapshot = ranked.map((row) => ({ userId: row.userId, pnlPercent: row.pnlPercent }))
          const sample = { t: now, rows: rowsSnapshot }
          const traders = ranked.map((row) => ({
            userId: row.userId,
            name: row.name,
            avatarUrl: row.avatarUrl,
            rank: row.rank,
            pnlPercent: row.pnlPercent,
            breached: row.breached,
          }))
          const buffer = pnlBufferRef.current
          const seed = buffer.competitionId === competitionId
            ? [sample]
            : [{ t: now - 30_000, rows: rowsSnapshot }, sample]
          const merged = mergePnlSamples(buffer.competitionId === competitionId ? buffer.samples : [], seed)
          pnlBufferRef.current = { competitionId, samples: merged }
          setPnlHistory({ samples: merged, traders, moments: [] })
        }
      } else {
        setPnlHistory(null)
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : t('leaderboard.unavailable'))
    } finally {
      setLoadingRows(false)
    }
  }, [competitionId, isLiveCompetition, t])

  useEffect(() => {
    setLoadingRows(true)
    void loadLeaderboard()
    const timer = window.setInterval(() => void loadLeaderboard(), 30_000)
    return () => window.clearInterval(timer)
  }, [loadLeaderboard])

  useEffect(() => {
    if (!isLiveCompetition || !competitionId) return
    const ranked = rows.filter((row) => row.rank > 0).slice(0, 10)
    const now = Date.now()
    if (!ranked.length || now - lastLivePnlSampleRef.current < 2000) return
    lastLivePnlSampleRef.current = now
    const sample = {
      t: now,
      rows: ranked.map((row) => ({ userId: row.userId, pnlPercent: row.pnlPercent })),
    }
    const buffer = pnlBufferRef.current
    const merged = mergePnlSamples(
      buffer.competitionId === competitionId ? buffer.samples : [],
      buffer.competitionId === competitionId ? [sample] : [{ ...sample, t: now - 30_000 }, sample],
    )
    pnlBufferRef.current = { competitionId, samples: merged }
    setPnlHistory((current) => ({
      samples: merged,
      traders: ranked.map((row) => ({
        userId: row.userId,
        name: row.name,
        avatarUrl: row.avatarUrl,
        rank: row.rank,
        pnlPercent: row.pnlPercent,
        breached: row.breached,
      })),
      moments: current?.moments || [],
    }))
  }, [competitionId, isLiveCompetition, rows])

  useEffect(() => {
    if (!competitionId) return
    let stopped = false
    let socket: WebSocket | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined
    const connect = () => {
      socket = new WebSocket(`${API_WS_URL}/ws?arenaId=${encodeURIComponent(competitionId)}`)
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(String(event.data))
          if (message?.type === 'arena:init' && Array.isArray(message.data?.leaderboard)) {
            setRows(message.data.leaderboard.sort((a: LeaderboardRow, b: LeaderboardRow) => a.rank - b.rank || b.pnlPercent - a.pnlPercent))
            setLoadingRows(false)
            return
          }
          if (message?.type !== 'arena:patch' || message.data?.competitionId !== competitionId) return
          setRows((current) => {
            const byUserId = new Map(current.map((row) => [row.userId, row]))
            for (const userId of message.data.removed || []) byUserId.delete(userId)
            for (const patch of message.data.upserts || []) {
              if (!patch?.userId) continue
              const previous = byUserId.get(patch.userId)
              byUserId.set(patch.userId, { ...previous, ...patch } as LeaderboardRow)
            }
            return [...byUserId.values()].sort((a, b) => a.rank - b.rank || b.pnlPercent - a.pnlPercent)
          })
        } catch { /* message invalide ignoré */ }
      }
      socket.onclose = () => {
        if (!stopped) reconnectTimer = setTimeout(connect, 1000)
      }
      socket.onerror = () => socket?.close()
    }
    connect()
    return () => {
      stopped = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      socket?.close()
    }
  }, [competitionId])

  const competition = competitions.find((item) => item.id === competitionId)
  const myRow = rows.find((row) => row.userId === currentUserId)
  const spectatorUrl = `${API_BASE_URL}/spectate/${encodeURIComponent(competitionId)}`

  async function shareArena() {
    if (!competitionId) return
    const shareData = {
      title: competition?.title || 'BTF Arena',
      text: t('leaderboard.shareArenaText'),
      url: spectatorUrl,
    }
    try {
      if (navigator.share) {
        await navigator.share(shareData)
        return
      }
      await navigator.clipboard.writeText(spectatorUrl)
      setLinkCopied(true)
      window.setTimeout(() => setLinkCopied(false), 2_000)
    } catch (shareError) {
      if (!(shareError instanceof DOMException && shareError.name === 'AbortError')) {
        setError(t('leaderboard.shareFailed'))
      }
    }
  }

  if (!competitions.length) {
    return (
      <div className="leaderboard-page">
        <div className="page-heading">
          <span>{t('leaderboard.kicker')}</span><h2>{t('leaderboard.title')}</h2>
          <p>{t('leaderboard.emptyLead')}</p>
        </div>
        <div className="empty-card"><div><strong>{t('leaderboard.noArena')}</strong><p>{t('leaderboard.noArenaLead')}</p></div></div>
      </div>
    )
  }

  const remaining = competition?.status === 'live' && competition.endAt
    ? formatCountdown(competition.endAt - now, t('nextArena.dayUnit'))
    : null
  const ranked = rows.filter((row) => row.rank > 0 && !row.breached)
  const podium = [ranked[1], ranked[0], ranked[2]].filter((row): row is LeaderboardRow => Boolean(row))
  const breachedRows = rows.filter((row) => row.breached)
  const notTraded = rows.filter((row) => row.rank === 0 && !row.breached)
  const rest = ranked.slice(3)
  const bestPnl = ranked.reduce((best, row) => Math.max(best, row.pnlPercent), 0)

  return (
    <div className="leaderboard-page">
      <header className="spectate-hud">
        <button className="leaderboard-back" type="button" onClick={onBack} aria-label={t('common.back')}>
          <Icon name="arrow" size={18} />
        </button>
        <div className="spectate-hud__meta">
          <span className={`spectate-hud__live ${competition?.status === 'live' ? 'is-on' : ''}`}>
            {competition?.status === 'live' ? t('arena.live') : t('leaderboard.kicker')}
          </span>
          <span className="ranking-scope-badge is-live">{t('rankingScope.liveArena')}</span>
          {remaining && <strong>{remaining}</strong>}
          <em>{t('leaderboard.field', { count: competition?.participants ?? rows.length })}</em>
        </div>
        <button className="spectate-hud__share" type="button" onClick={() => void shareArena()}>
          {linkCopied ? '✓' : '↗'}
        </button>
      </header>

      {myRow && (
        <section className="spectate-you">
          <b>#{myRow.rank}</b>
          <span>{t('leaderboard.youStrip')}</span>
          <strong className={myRow.pnlPercent >= 0 ? 'positive' : 'negative'}>
            {myRow.pnlPercent >= 0 ? '+' : ''}{myRow.pnlPercent.toFixed(2)}%
          </strong>
          {myRow.rank > 0 && <button type="button" onClick={() => setShareRow(myRow)}>{t('common.share')}</button>}
        </section>
      )}

      {(() => {
        const prize = competition?.cashPrize
        const hasPrize = Boolean(prize && (prize.label || prize.imageUrl || prize.total > 0 || prize.items?.length || prize.breakdown?.length))
        if (!hasPrize || !prize) return null
        const title = prize.label || (prize.total > 0 ? `${prize.total.toLocaleString(locale)} ${prize.currency || 'USD'}` : t('leaderboard.mainPrize'))
        return (
          <section className="spectate-prizes">
            <span>{t('leaderboard.prizes')}</span>
            <div className="spectate-prizes__hero">
              {prize.imageUrl && <img src={apiAssetUrl(prize.imageUrl)} alt="" />}
              <div>
                <strong>{title}</strong>
                {prize.description && <small>{prize.description}</small>}
              </div>
            </div>
            {prize.breakdown && prize.breakdown.length > 0 && (
              <div className="spectate-prizes__rows">
                {prize.breakdown.map((row) => (
                  <div key={row.rank}>
                    <span>{t('leaderboard.place', { rank: row.rank })}</span>
                    <b>{row.amount.toLocaleString(locale)} {prize.currency}</b>
                  </div>
                ))}
              </div>
            )}
            {prize.items && prize.items.length > 0 && (
              <div className="spectate-prizes__items">
                {prize.items.map((item, index) => (
                  <article key={`${item.title || 'lot'}-${index}`}>
                    {item.imageUrl && <img src={apiAssetUrl(item.imageUrl)} alt="" />}
                    <strong>{item.title || (item.rank ? t('leaderboard.place', { rank: item.rank }) : t('leaderboard.mainPrize'))}</strong>
                  </article>
                ))}
              </div>
            )}
          </section>
        )
      })()}

      {error ? (
        <div className="leaderboard-page-error">{error}<button type="button" onClick={() => void loadLeaderboard()}>{t('common.retry')}</button></div>
      ) : loadingRows ? (
        <div className="leaderboard-page-loading"><i />{t('leaderboard.syncing')}</div>
      ) : (
        <>
          <BroadcastTicker
            moments={pnlHistory?.moments}
            traders={pnlHistory?.traders}
            leader={ranked[0] || null}
            participants={competition?.participants ?? rows.length}
            bestPnl={bestPnl}
          />

          {isLiveCompetition && pnlHistory && (
            <PnlRaceChart samples={pnlHistory.samples} traders={pnlHistory.traders} moments={pnlHistory.moments} currentUserId={currentUserId} />
          )}

          {ranked.length >= 2 && <VersusStrip left={ranked[0]} right={ranked[1]} onOpenPlayer={onOpenPlayer} />}

          <button className="spectate-chat-cta" type="button" onClick={() => { setShowChat(true); setUnreadChat(0) }}>
            <Icon name="community" size={20} />
            <span>{t('chat.arenaOpen')}</span>
            {unreadChat > 0 && <b className="news-unread-badge">{unreadChat > 99 ? '99+' : unreadChat}</b>}
            <i>›</i>
          </button>

          {podium.length > 0 && (
            <section className="leaderboard-podium">
              {podium.map((row) => (
                <article key={row.userId} className={`is-rank-${row.rank}`}>
                  <span className="podium-rank">#{row.rank}</span>
                  <TraderPhoto avatarUrl={row.avatarUrl} name={row.name} />
                  <strong><TeamOrPlayerName row={row} currentUserId={currentUserId} youLabel={t('common.you')} /></strong>
                  <small className={row.pnlUsd >= 0 ? 'positive' : 'negative'}>{row.pnlUsd >= 0 ? '+' : ''}{row.pnlUsd.toLocaleString(locale, { maximumFractionDigits: 0 })} $</small>
                </article>
              ))}
            </section>
          )}

          <section className="leaderboard-table">
            <div className="leaderboard-table__head"><span>{t('leaderboard.rank')}</span><span>{competition?.entryMode === 'team' ? t('leaderboard.team') : t('leaderboard.trader')}</span><span>{t('leaderboard.trades')}</span><span>PnL</span></div>
            {rest.map((row) => (
              <article key={row.userId} className={isMyLeaderboardRow(row, currentUserId) ? 'is-me' : ''}>
                <strong>#{row.rank}</strong>
                <button type="button" className="leaderboard-table__player" onClick={() => { if (!isTeamLeaderboardRow(row)) onOpenPlayer(row.userId) }}>
                  <TraderPhoto avatarUrl={row.avatarUrl} name={row.name} />
                  <TeamOrPlayerName row={row} currentUserId={currentUserId} youLabel={t('common.you')} />
                </button>
                <span>{row.tradesCount}</span>
                <span className={row.pnlUsd >= 0 ? 'positive' : 'negative'}><strong>{row.pnlUsd >= 0 ? '+' : ''}{row.pnlUsd.toLocaleString(locale, { maximumFractionDigits: 2 })} $</strong><small>{row.pnlPercent >= 0 ? '+' : ''}{row.pnlPercent.toFixed(2)}%</small></span>
              </article>
            ))}
            {!ranked.length && <div className="leaderboard-table-empty">{t('leaderboard.emptyRows')}</div>}
          </section>

          {breachedRows.length > 0 && (
            <section className="leaderboard-table is-breached-list">
              <div className="leaderboard-section-head">
                <span>{t('leaderboard.breachedList')}</span>
                <strong>{t('leaderboard.breachedSectionTitle')}</strong>
                <p>{t('leaderboard.breachedSectionHint')}</p>
              </div>
              {breachedRows.map((row) => (
                <article key={row.userId} className={`is-breached ${isMyLeaderboardRow(row, currentUserId) ? 'is-me' : ''}`}>
                  <strong>—</strong>
                  <button type="button" className="leaderboard-table__player" onClick={() => { if (!isTeamLeaderboardRow(row)) onOpenPlayer(row.userId) }}>
                    <TraderPhoto avatarUrl={row.avatarUrl} name={row.name} />
                    <TeamOrPlayerName row={row} currentUserId={currentUserId} youLabel={t('common.you')} />
                  </button>
                  <span>{row.tradesCount}</span>
                  <span className={row.pnlUsd >= 0 ? 'positive' : 'negative'}><strong>{row.pnlUsd >= 0 ? '+' : ''}{row.pnlUsd.toLocaleString(locale, { maximumFractionDigits: 2 })} $</strong><small>{row.pnlPercent >= 0 ? '+' : ''}{row.pnlPercent.toFixed(2)}%</small></span>
                </article>
              ))}
            </section>
          )}

          {notTraded.length > 0 && (
            <section className="leaderboard-table is-enrolled-list">
              <div className="leaderboard-section-head">
                <span>{t('leaderboard.enrolledList')}</span>
                <strong>{t('leaderboard.enrolledNoTrade')}</strong>
                <p>{t('leaderboard.enrolledNoTradeHint')}</p>
              </div>
              {notTraded.map((row) => (
                <article key={row.userId} className={isMyLeaderboardRow(row, currentUserId) ? 'is-me' : ''}>
                  <strong>—</strong>
                  <button type="button" className="leaderboard-table__player" onClick={() => { if (!isTeamLeaderboardRow(row)) onOpenPlayer(row.userId) }}>
                    <TraderPhoto avatarUrl={row.avatarUrl} name={row.name} />
                    <TeamOrPlayerName row={row} currentUserId={currentUserId} youLabel={t('common.you')} />
                  </button>
                  <span>{row.tradesCount}</span>
                  <span className="negative"><strong>—</strong></span>
                </article>
              ))}
            </section>
          )}
        </>
      )}
      <ShareRankModal row={shareRow} competition={competition?.title || 'BTF Arena'}
        participants={competition?.participants || rows.length} spectatorUrl={spectatorUrl} onClose={() => setShareRow(null)} />

      {showChat && competitionId && (
        <ArenaChatOverlay
          competitionId={competitionId}
          title={competition?.title || t('chat.arenaTitle')}
          token={token}
          user={sessionUser}
          onClose={() => setShowChat(false)}
          onAuth={onAuth}
          onOpenPlayer={(userId) => {
            setShowChat(false)
            onOpenPlayer(userId)
          }}
        />
      )}
    </div>
  )
}

function ProfileScreen({ dashboard, token, onJournal, onGlobalLeaderboard, onRewards, onPayouts, onRank, onSettings, onTeam, onLogout }: {
  dashboard: BootstrapData
  token: string | null
  onJournal: () => void
  onGlobalLeaderboard: () => void
  onRewards: () => void
  onPayouts: () => void
  onRank: () => void
  onSettings: () => void
  onTeam: () => void
  onLogout: () => void
}) {
  const { t, locale } = useI18n()
  const user = dashboard.user!
  const stats = dashboard.myStats
  const claimable = dashboard.claimablePayouts || 0
  return (
    <div className="profile-screen">
      <div className="profile-identity">
        <ProfileAvatar avatarUrl={user.avatarUrl} name={user.name} size="lg" />
        <div><small>{t('profile.synced')}</small>
          <h2><PlayerName name={user.name} country={user.country} /></h2>
          <p>{user.email}</p>
        </div>
      </div>
      {dashboard.myRating && <DivisionCard rating={dashboard.myRating} variant="compact" onOpen={onRank} />}
      <section className="profile-section">
        <span>{t('profile.badges')}</span>
        <PlayerBadges badges={dashboard.myBadges} emptyLabel={t('profile.noBadges')} />
      </section>
      <div className="profile-stats">
        <div><small>{t('profile.totalPnl')}</small><strong className={(stats?.netPnl ?? 0) >= 0 ? 'positive' : 'negative'}>{(stats?.netPnl ?? 0).toLocaleString(locale, { maximumFractionDigits: 2 })} $</strong></div>
        <div><small>{t('profile.winRate')}</small><strong>{((stats?.winRate ?? 0) * 100).toFixed(1)}%</strong></div>
        <div><small>{t('profile.trades')}</small><strong>{stats?.closedTrades ?? 0}</strong></div>
        <div><small>{t('home.avgRR')}</small><strong>{stats?.avgRR?.toFixed(2) || '—'}</strong></div>
        <div><small>{t('home.profitFactor')}</small><strong>{stats?.profitFactor == null ? '—' : stats.profitFactor.toFixed(2)}</strong></div>
      </div>
      <section className="profile-actions">
        <button type="button" onClick={onJournal}><span><Icon name="journal" size={20} /></span><div><strong>{t('profile.journal')}</strong><small>{t('profile.journalHint')}</small></div><i>›</i></button>
        <button type="button" onClick={onPayouts}>
          <span><Icon name="payouts" size={20} /></span>
          <div>
            <strong>{t('profile.payouts')}</strong>
            <small>{claimable > 0 ? t('profile.claimPayouts') : t('profile.payoutsHint')}</small>
          </div>
          {claimable > 0 && <b className="news-unread-badge">{claimable > 9 ? '9+' : claimable}</b>}
          <i>›</i>
        </button>
        <button type="button" onClick={onRewards}><span><Icon name="deals" size={20} /></span><div><strong>{t('profile.rewards')}</strong><small>{t('profile.rewardsHint')}</small></div><i>›</i></button>
        <button type="button" onClick={onTeam}><span>{dashboard.myTeam?.imageUrl ? <img src={apiAssetUrl(dashboard.myTeam.imageUrl)} alt="" /> : <Icon name="team" size={20} />}</span><div><strong>{t('profile.team')}</strong><small>{dashboard.myTeam ? dashboard.myTeam.name : t('profile.teamHint')}</small></div><i>›</i></button>
        <button type="button" onClick={onGlobalLeaderboard}><span><Icon name="rank" size={20} /></span><div><strong>{t('profile.global')}</strong><small>{t('profile.globalHint')}</small></div><i>›</i></button>
        <button type="button" onClick={onSettings}><span><Icon name="settings" size={20} /></span><div><strong>{t('profile.edit')}</strong><small>{t('profile.editHint')}</small></div><i>›</i></button>
        {ENABLE_TEST_TOOLS && token && (
          <button
            type="button"
            onClick={() => {
              void import('./lib/testTools').then(({ sendPushTest }) => sendPushTest(token)).then((result) => {
                window.alert(
                  result.sent > 0
                    ? t('profile.pushTestOk')
                    : !result.configured
                      ? t('profile.pushTestNoServer')
                      : result.devices === 0
                        ? t('profile.pushTestNoDevice')
                        : t('profile.pushTestFail'),
                )
              }).catch((error) => window.alert(`${t('profile.pushTestFail')}\n${error instanceof Error ? error.message : ''}`))
            }}
          >
            <span><Icon name="bell" size={20} /></span>
            <div><strong>{t('profile.pushTest')}</strong><small>{t('profile.pushTestHint')}</small></div>
            <i>›</i>
          </button>
        )}
      </section>
      <section className="profile-section">
        <span>{t('profile.language')}</span>
        <div className="profile-language">
          <p>{t('profile.languageHint')}</p>
          <LanguageSwitcher />
        </div>
      </section>
      <section className="profile-section">
        <span>{t('profile.arenas')}</span>
        <div className="profile-arenas">
          {dashboard.myCompetitions.length
            ? dashboard.myCompetitions.map((competition) => (
              <div key={competition.id}>
                <div><strong>{competition.title}</strong><small>{competition.myEntry.tradesCount} {t('profile.trades').toLowerCase()}</small></div>
                <div><strong>#{competition.rank ?? '—'}</strong><small>{competition.myEntry.pnlUsd.toLocaleString(locale)} $</small></div>
              </div>
            ))
            : <p>{t('profile.noArenas')}</p>}
        </div>
      </section>
      <button className="logout-button" type="button" onClick={onLogout}>{t('profile.logout')}</button>
    </div>
  )
}

export default App
