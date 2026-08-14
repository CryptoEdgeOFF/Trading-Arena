import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Capacitor } from '@capacitor/core'
import { Haptics, ImpactStyle } from '@capacitor/haptics'
import { PushNotifications } from '@capacitor/push-notifications'
import { StatusBar, Style } from '@capacitor/status-bar'
import { AnimatePresence, motion } from 'framer-motion'
import {
  API_BASE_URL,
  apiAssetUrl,
  getBootstrap,
  getChampionOfWeek,
  getCompetitionLeaderboard,
  getGlobalChatMessages,
  getNewsPage,
  getPnlHistory,
  getPromotions,
  logoutSession,
  registerPushDevice,
  unregisterPushDevice,
  type BootstrapData,
  type ChampionOfWeek,
  type LeaderboardRow,
  type MyCompetition,
  type PnlHistorySample,
  type PnlHistoryTrader,
  type PnlMoment,
  type PublicCompetition,
  type SessionUser,
  type UserBadge,
} from './lib/api'
import {
  clearPaperSessionToken,
  clearSessionToken,
  readSessionToken,
  writeSessionToken,
} from './lib/session'
import { AuthSheet } from './components/AuthSheet'
import { DealsScreen } from './components/DealsScreen'
import { DivisionCard, divisionDisplayName } from './components/DivisionCard'
import { GlobalChat } from './components/GlobalChat'
import { GlobalLeaderboard } from './components/GlobalLeaderboard'
import { JoinArenaSheet } from './components/JoinArenaSheet'
import { LanguageSwitcher } from './components/LanguageSwitcher'
import { NewsScreen } from './components/NewsScreen'
import { PlayerProfile } from './components/PlayerProfile'
import { PnlRaceChart } from './components/PnlRaceChart'
import { ProfileAvatar } from './components/ProfileAvatar'
import { ProfileSettings } from './components/ProfileSettings'
import { RankScreen } from './components/RankScreen'
import { ShareRankModal } from './components/ShareRankModal'
import { TradeJournal } from './components/TradeJournal'
import { TradingTerminal } from './components/TradingTerminal'
import { useI18n } from './i18n'
import './App.css'

type Tab = 'home' | 'live' | 'rank' | 'deals' | 'trade' | 'community' | 'news' | 'leaderboard' | 'global-leaderboard' | 'journal' | 'settings' | 'player' | 'profile'
type IconName = Tab | 'bell' | 'arrow' | 'refresh' | 'shield'

const icons: Record<IconName, ReactNode> = {
  home: <path d="M7 4.8v14.4a.5.5 0 0 0 .76.43l11.77-7.2a.5.5 0 0 0 0-.86L7.76 4.37A.5.5 0 0 0 7 4.8Z" />,
  live: <path d="M12 12h.01M8.5 8.5a5 5 0 0 0 0 7m7-7a5 5 0 0 1 0 7M5.6 5.6a9 9 0 0 0 0 12.8m12.8-12.8a9 9 0 0 1 0 12.8" />,
  rank: <path d="M8 21h8m-4-4v4M6 4h12v3a6 6 0 0 1-12 0V4Zm12 1h3a3 3 0 0 1-3 4M6 5H3a3 3 0 0 0 3 4" />,
  deals: <path d="M20 12v8H4v-8M2 7h20v5H2V7Zm10 13V7m0 0H7.5A2.5 2.5 0 1 1 12 4.8M12 7h4.5A2.5 2.5 0 1 0 12 4.8" />,
  trade: <path d="M5 19V9m0 0L2.5 11.5M5 9l2.5 2.5M19 5v10m0 0 2.5-2.5M19 15l-2.5-2.5M10 7h4m-4 5h4m-4 5h4" />,
  community: <path d="M21 12a8 8 0 0 1-8 8H7l-4 2 1.4-4.2A8 8 0 1 1 21 12ZM9 11h.01M12 11h.01M15 11h.01" />,
  news: <path d="M5 4h14v16H5V4Zm3 4h8M8 12h8m-8 4h5" />,
  leaderboard: <path d="M4 20V10h4v10H4Zm6 0V4h4v16h-4Zm6 0v-7h4v7h-4Z" />,
  'global-leaderboard': <path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 0c2.4 2.5 3.7 5.5 3.7 9S14.4 18.5 12 21m0-18C9.6 5.5 8.3 8.5 8.3 12s1.3 6.5 3.7 9M3 12h18" />,
  journal: <path d="M5 3h14v18H5V3Zm4 5h6m-6 4h6m-6 4h4" />,
  settings: <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm7.4-3.5a7 7 0 0 0-.1-1l2-1.6-2-3.4-2.4 1a8 8 0 0 0-1.7-1L15 3.5h-4L10.6 6a8 8 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6a7 7 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a8 8 0 0 0 1.7 1l.4 2.5h4l.4-2.5a8 8 0 0 0 1.7-1l2.4 1 2-3.4-2-1.6a7 7 0 0 0 .1-1Z" />,
  player: <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm7 9a7 7 0 0 0-14 0" />,
  profile: <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm7 9a7 7 0 0 0-14 0" />,
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
        src={competition.bannerImageUrl ? apiAssetUrl(competition.bannerImageUrl) : '/assets/pictures/BTF ARENA SEO.png'} alt="" />
      <div className="arena-card__shade" />
      <div className="arena-card__glow" />
      <div className="arena-card__top">
        <span className="live-pill"><i />{status}</span>
        <FormatChip format={competition.format} />
        <span className="arena-card__players">{t('arena.players', { count: players })}</span>
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


// Données simulées en attendant le classement officiel de la saison.
const seasonPodium = [
  { rank: 2, name: 'NOVA QUEEN', pnlPercent: 142.8, trades: 214 },
  { rank: 1, name: 'KRAKEN MIKE', pnlPercent: 187.4, trades: 302 },
  { rank: 3, name: 'DARK PIPS', pnlPercent: 121.6, trades: 178 },
]
const seasonRunners = [
  { rank: 4, name: 'ALPHA WOLF', pnlPercent: 98.2 },
  { rank: 5, name: 'MME CANDLE', pnlPercent: 87.5 },
  { rank: 6, name: 'ZEN SCALPER', pnlPercent: 79.1 },
]

function SeasonShowcase({ onGlobalLeaderboard }: { onGlobalLeaderboard: () => void }) {
  const { t } = useI18n()
  return (
    <section className="home-season">
      <div className="home-season__banner">
        <img src="/assets/pictures/trader-silhouette.jpg" alt="" />
        <div className="home-season__banner-text">
          <span>{t('season.eyebrow')}</span>
          <h2>{t('season.title')}<br /><em>{t('season.titleEm')}</em></h2>
          <p>{t('season.lead')}</p>
        </div>
      </div>
      <div className="home-season__podium">
        {seasonPodium.map((player) => (
          <button key={player.rank} type="button" className={`home-season__player is-rank-${player.rank}`} onClick={onGlobalLeaderboard}>
            <i>{player.rank}</i>
            <span>{player.name.split(' ').map((word) => word[0]).join('').slice(0, 2)}</span>
            <strong>{player.name}</strong>
            <em>+{player.pnlPercent.toFixed(1)}%</em>
            <small>{t('season.trades', { trades: player.trades })}</small>
          </button>
        ))}
      </div>
      <div className="home-season__runners">
        {seasonRunners.map((player) => (
          <button key={player.rank} type="button" onClick={onGlobalLeaderboard}>
            <i>#{player.rank}</i>
            <strong>{player.name}</strong>
            <em>+{player.pnlPercent.toFixed(1)}%</em>
          </button>
        ))}
        <button className="home-season__more" type="button" onClick={onGlobalLeaderboard}>
          {t('season.seeFull')} <b>›</b>
        </button>
      </div>
    </section>
  )
}

// Objectifs de compétition : l'état « fait » est détecté via les événements
// du ledger backend (xpStore), qui reste la source de vérité côté serveur.
const homeMissions = [
  { id: 'join', eventType: 'arena.join', labelKey: 'missions.join' },
  { id: 'finish', eventType: 'arena.completed', labelKey: 'missions.finish' },
  { id: 'top-half', eventType: 'arena.top_half', labelKey: 'missions.topHalf' },
  { id: 'capital', eventType: 'trading.achievement', labelKey: 'missions.capital' },
  { id: 'podium', eventType: 'arena.podium', labelKey: 'missions.podium' },
] as const

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
  const clock = `${pad(Math.floor((total % 86_400) / 3_600))}:${pad(Math.floor((total % 3_600) / 60))}:${pad(total % 60)}`
  return days > 0 ? `${days}${dayUnit} ${clock}` : clock
}

function NextArenaHero({
  competitions,
  mineById,
  authed,
  onJoin,
  onTrade,
  onLeaderboard,
  onAuth,
}: {
  competitions: PublicCompetition[]
  mineById: Map<string, MyCompetition>
  authed: boolean
  onJoin: (competition: PublicCompetition) => void
  onTrade: (competitionId: string) => void
  onLeaderboard: (competitionId: string) => void
  onAuth: () => void
}) {
  const { t, locale } = useI18n()
  const now = useNow()
  const liveArena = competitions
    .filter((competition) => competition.status === 'live')
    .sort((a, b) => a.endAt - b.endAt)[0]
  const upcomingArena = competitions
    .filter((competition) => competition.status === 'registration' || competition.status === 'starting_soon')
    .sort((a, b) => a.startAt - b.startAt)[0]
  const arena = liveArena || upcomingArena
  if (!arena) return null
  const isLive = arena.status === 'live'
  const mine = mineById.get(arena.id)
  return (
    <section className={`next-arena ${isLive ? 'is-live' : ''}`}>
      <header>
        <span className="next-arena__kicker"><i />{isLive ? t('nextArena.liveNow') : t('nextArena.kicker')}</span>
        <FormatChip format={arena.format} />
        <span className="next-arena__players">{t('nextArena.registered', { count: (arena.participants ?? 0).toLocaleString(locale) })}</span>
      </header>
      <h2>{arena.title || t('arena.fallbackTitle')}</h2>
      <div className="next-arena__countdown">
        <small>{isLive ? t('nextArena.endsIn') : t('nextArena.startsIn')}</small>
        <strong>{formatCountdown((isLive ? arena.endAt : arena.startAt) - now, t('nextArena.dayUnit'))}</strong>
      </div>
      <footer>
        <div className="next-arena__prize">
          <small>{t('arena.prize')}</small>
          <strong>
            {arena.cashPrize?.total
              ? `${arena.cashPrize.total.toLocaleString(locale)} ${arena.cashPrize.currency || '€'}`
              : t('arena.toConfirm')}
          </strong>
        </div>
        <div className="next-arena__actions">
          {mine?.canTrade && <button className="is-primary" type="button" onClick={() => onTrade(arena.id)}>{t('nextArena.trade')}</button>}
          {!mine && arena.canJoin !== false && (
            <button className="is-primary" type="button" onClick={() => authed ? onJoin(arena) : onAuth()}>{t('nextArena.join')}</button>
          )}
          <button type="button" onClick={() => onLeaderboard(arena.id)}>{isLive ? t('nextArena.watch') : t('arena.leaderboard')}</button>
        </div>
      </footer>
    </section>
  )
}

function LiveScreen({
  competitions,
  mineById,
  onLeaderboard,
  onTrade,
  onGlobalLeaderboard,
}: {
  competitions: PublicCompetition[]
  mineById: Map<string, MyCompetition>
  onLeaderboard: (competitionId: string) => void
  onTrade: (competitionId: string) => void
  onGlobalLeaderboard: () => void
}) {
  const { t, locale } = useI18n()
  const now = useNow()
  const [champion, setChampion] = useState<ChampionOfWeek | null>(null)
  useEffect(() => {
    let cancelled = false
    getChampionOfWeek().then((next) => { if (!cancelled) setChampion(next) }).catch(() => {})
    return () => { cancelled = true }
  }, [])
  const liveArenas = competitions
    .filter((competition) => competition.status === 'live')
    .sort((a, b) => a.endAt - b.endAt)
  const upcoming = competitions
    .filter((competition) => competition.status === 'registration' || competition.status === 'starting_soon')
    .sort((a, b) => a.startAt - b.startAt)
    .slice(0, 5)
  return (
    <div className="live-screen">
      <div className="page-heading">
        <span>{t('live.kicker')}</span>
        <h2>{t('live.title')}</h2>
        <p>{t('live.lead')}</p>
      </div>
      {liveArenas.length ? (
        <div className="live-list">
          {liveArenas.map((arena) => (
            <motion.article key={arena.id} className="live-card" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
              <header>
                <span className="live-pill"><i />{t('arena.live')}</span>
                <small>{t('arena.players', { count: (arena.participants ?? 0).toLocaleString(locale) })}</small>
              </header>
              <h3>{arena.title || t('arena.fallbackTitle')}</h3>
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
      ) : (
        <div className="live-empty">
          <strong>{t('live.emptyTitle')}</strong>
          <p>{t('live.emptyLead')}</p>
        </div>
      )}
      {upcoming.length > 0 && (
        <section className="live-upcoming">
          <header><span>{t('live.nextUp')}</span></header>
          {upcoming.map((arena) => (
            <button key={arena.id} type="button" onClick={() => onLeaderboard(arena.id)}>
              <span className="live-upcoming__label">
                <strong>{arena.title || t('arena.fallbackTitle')}</strong>
                <FormatChip format={arena.format} />
              </span>
              <span className="live-upcoming__when">
                <em>{formatCountdown(arena.startAt - now, t('nextArena.dayUnit'))}</em>
                <small>{new Date(arena.startAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}</small>
              </span>
            </button>
          ))}
        </section>
      )}
      {champion && (
        <section className="champion-week">
          <header><span>👑 {t('live.championKicker')}</span></header>
          <div className="champion-week__body">
            {champion.winner.avatarUrl
              ? <img src={apiAssetUrl(champion.winner.avatarUrl)} alt="" />
              : <i>{champion.winner.name.slice(0, 2).toUpperCase()}</i>}
            <div>
              <strong>{champion.winner.name}</strong>
              <small>{champion.competitionTitle}</small>
            </div>
            <em className={champion.winner.pnlPercent >= 0 ? 'positive' : 'negative'}>
              {champion.winner.pnlPercent >= 0 ? '+' : ''}{champion.winner.pnlPercent.toFixed(2)}%
            </em>
          </div>
        </section>
      )}
      <button className="live-top-traders" type="button" onClick={onGlobalLeaderboard}>
        <div><strong>{t('live.topTraders')}</strong><small>{t('live.topTradersHint')}</small></div>
        <i>›</i>
      </button>
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
  onChat,
  onRank,
  unreadNews,
  unreadChat,
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
  onChat: () => void
  onRank: () => void
  unreadNews: number
  unreadChat: number
}) {
  const { t, locale } = useI18n()
  const [showEnded, setShowEnded] = useState(false)
  const user = dashboard?.user
  const statsCompetitions = (dashboard?.myCompetitions || []).filter((competition) => !/qualif/i.test(competition.title))
  const totalPnl = statsCompetitions.reduce((sum, competition) => sum + competition.myEntry.pnlUsd, 0)
  const averagePnlPercent = statsCompetitions.length
    ? statsCompetitions.reduce((sum, competition) => sum + competition.myEntry.pnlPercent, 0) / statsCompetitions.length
    : 0
  const mineById = new Map((dashboard?.myCompetitions || []).map((competition) => [competition.id, competition]))
  const earnedEventTypes = new Set((dashboard?.myProgression?.recentEvents || []).map((event) => event.eventType))
  const active = competitions
    .filter((competition) => competition.status !== 'ended')
    .sort((a, b) => a.startAt - b.startAt)
  const ended = competitions.filter((competition) => competition.status === 'ended').sort((a, b) => b.endAt - a.endAt)
  const hour = new Date().getHours()
  const greeting = hour >= 18 || hour < 5 ? t('home.greetingEvening') : t('home.greetingMorning')

  return (
    <div className="home-dashboard">
      {user ? (
        <>
          <header className="home-greeting">
            <ProfileAvatar avatarUrl={user.avatarUrl} name={user.name} size="sm" />
            <div>
              <small>{greeting}</small>
              <strong>{user.name}</strong>
              {dashboard.myRating && <em>{divisionDisplayName(dashboard.myRating.division)}</em>}
            </div>
            <button className="news-button" type="button" onClick={onChat} aria-label={t('home.openChat')}>
              <Icon name="community" size={19} />
              {unreadChat > 0 && <b className="news-unread-badge">{unreadChat > 9 ? '9+' : unreadChat}</b>}
            </button>
            <button className="news-button" type="button" onClick={onNews} aria-label={t('home.openNews')}>
              <Icon name="bell" size={19} />
              {unreadNews > 0 && <b className="news-unread-badge">{unreadNews > 9 ? '9+' : unreadNews}</b>}
            </button>
            <button type="button" onClick={onProfile} aria-label={t('home.openProfile')}><Icon name="arrow" size={18} /></button>
          </header>

          <NextArenaHero competitions={competitions} mineById={mineById} authed
            onJoin={onJoin} onTrade={onTrade} onLeaderboard={onLeaderboard} onAuth={onAuth} />

          <section className="home-stat-strip">
            <button type="button" onClick={onProfile} className={totalPnl >= 0 ? 'is-profit' : 'is-loss'}>
              <small>{t('home.pnlGlobal')}</small>
              <strong>{totalPnl >= 0 ? '+' : ''}{totalPnl.toLocaleString(locale, { maximumFractionDigits: 2 })} $</strong>
              <span>{t(statsCompetitions.length > 1 ? 'home.avgArenasPlural' : 'home.avgArenas', {
                avg: `${averagePnlPercent >= 0 ? '+' : ''}${averagePnlPercent.toFixed(2)}`,
                count: statsCompetitions.length,
              })}</span>
            </button>
            {dashboard.myRating && (
              <button type="button" onClick={onRank} className={`is-division is-${dashboard.myRating.division.id}`}>
                <small>{t('division.kicker')}</small>
                <strong>{divisionDisplayName(dashboard.myRating.division)}</strong>
                <span>{t('division.points', { points: dashboard.myRating.points.toLocaleString(locale) })}</span>
              </button>
            )}
          </section>
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

      {!user && (
        <NextArenaHero competitions={competitions} mineById={mineById} authed={false}
          onJoin={onJoin} onTrade={onTrade} onLeaderboard={onLeaderboard} onAuth={onAuth} />
      )}

      <section className="home-arena-section">
        <div className="section-title">
          <div><span>{t('home.competitions')}</span><h2>{t('home.arenas')}</h2></div>
          <button type="button" onClick={onRefresh} aria-label={t('common.refresh')}><Icon name="refresh" size={18} /></button>
        </div>
        {loading ? <div className="skeleton-card"><i /><i /><i /></div> : active.length ? (
          <div className="arena-list">{active.map((competition) => (
            <ArenaCard key={competition.id} competition={competition} mine={mineById.get(competition.id)}
              joined={mineById.has(competition.id)} onJoin={onJoin} onTrade={onTrade} onLeaderboard={onLeaderboard} />
          ))}</div>
        ) : <div className="home-arena-empty">{t('home.emptyOpen')}</div>}
        {ended.length > 0 && (
          <button className="home-ended-toggle" type="button" onClick={() => setShowEnded((value) => !value)}>
            {showEnded ? t('home.hideEnded') : t('home.showEnded', { count: ended.length })}
          </button>
        )}
        {showEnded && (
          <div className="arena-list">{ended.map((competition) => (
            <ArenaCard key={competition.id} competition={competition} mine={mineById.get(competition.id)}
              joined={mineById.has(competition.id)} onJoin={onJoin} onTrade={onTrade} onLeaderboard={onLeaderboard} />
          ))}</div>
        )}
      </section>

      <SeasonShowcase onGlobalLeaderboard={onGlobalLeaderboard} />

      {user && (
        <section className="home-missions" aria-label={t('home.missions')}>
          <header>
            <div><small>{t('home.missionsKicker')}</small><strong>{t('home.missions')}</strong></div>
          </header>
          <div className="home-missions__carousel">
            {homeMissions.map((mission) => {
              const done = earnedEventTypes.has(mission.eventType)
              return (
                <div key={mission.id} className={`home-mission ${done ? 'is-done' : ''}`}>
                  <strong>{t(`${mission.labelKey}.label`)}</strong>
                  <small>{t(`${mission.labelKey}.hint`)}</small>
                  {done && <b className="home-mission__check">✓</b>}
                </div>
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}

function App() {
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
  const [playerBackTab, setPlayerBackTab] = useState<'leaderboard' | 'global-leaderboard' | 'community' | 'rank'>('leaderboard')
  const [leaderboardCompetitionId, setLeaderboardCompetitionId] = useState('')
  const [leaderboardBackTab, setLeaderboardBackTab] = useState<Exclude<Tab, 'leaderboard'>>('home')
  const [globalLeaderboardBackTab, setGlobalLeaderboardBackTab] = useState<Exclude<Tab, 'global-leaderboard'>>('home')
  const [unreadChatCount, setUnreadChatCount] = useState(0)
  const [unreadNewsCount, setUnreadNewsCount] = useState(0)
  const [initialNewsId, setInitialNewsId] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const storedToken = await readSessionToken()
    const nextDashboard = await getBootstrap(storedToken).catch(() => null)
    setToken(storedToken)
    setDashboard(nextDashboard)
    setCompetitions(nextDashboard?.publicCompetitions ?? [])
    if (storedToken && nextDashboard && !nextDashboard.user) {
      await clearSessionToken()
      setToken(null)
    }
    setLoading(false)
  }, [])

  const markChatSeen = useCallback((timestamp: number) => {
    const userId = dashboard?.user?.id
    if (!userId) return
    const key = `btf.chat.lastSeen.${userId}`
    const previous = Number(window.localStorage.getItem(key) || 0)
    if (timestamp > previous) window.localStorage.setItem(key, String(timestamp))
    setUnreadChatCount(0)
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

  useEffect(() => {
    const userId = dashboard?.user?.id
    if (!token || !userId) {
      setUnreadChatCount(0)
      return
    }
    let active = true
    const refreshUnread = async () => {
      const messages = await getGlobalChatMessages(token).catch(() => [])
      if (!active || !messages.length) return
      window.localStorage.setItem(`btf.chat.messages.${userId}`, JSON.stringify(messages.slice(-150)))
      const latest = messages.at(-1)!.createdAt
      if (tab === 'community') {
        markChatSeen(latest)
        return
      }
      const seenKey = `btf.chat.lastSeen.${userId}`
      const storedSeenAt = window.localStorage.getItem(seenKey)
      if (!storedSeenAt) {
        window.localStorage.setItem(seenKey, String(latest))
        setUnreadChatCount(0)
        return
      }
      const seenAt = Number(storedSeenAt)
      setUnreadChatCount(Math.min(99, messages.filter((message) => message.createdAt > seenAt && message.userId !== userId).length))
    }
    void refreshUnread()
    const timer = window.setInterval(() => void refreshUnread(), 12_000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [dashboard?.user?.id, markChatSeen, tab, token])

  function selectTab(nextTab: Tab) {
    setTab(nextTab)
    if (Capacitor.isNativePlatform()) void Haptics.impact({ style: ImpactStyle.Light })
  }

  function openLeaderboard(competitionId: string, from: Exclude<Tab, 'leaderboard'>) {
    setLeaderboardCompetitionId(competitionId)
    setLeaderboardBackTab(from)
    selectTab('leaderboard')
  }

  function openGlobalLeaderboard(from: Exclude<Tab, 'global-leaderboard'>) {
    setGlobalLeaderboardBackTab(from)
    selectTab('global-leaderboard')
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
        void registerPushDevice(token, registration.value, platform, environment).catch(() => undefined)
      }))
      listeners.push(await PushNotifications.addListener('registrationError', (registrationError) => {
        console.warn('[push] registration failed:', registrationError.error)
      }))
      listeners.push(await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
        const data = action.notification.data as { kind?: string; competitionId?: string; newsId?: string }
        const competitionId = String(data?.competitionId || '')
        if (data?.kind === 'news') {
          setInitialNewsId(String(data.newsId || ''))
          selectTab('news')
          return
        }
        if (data?.kind === 'rank_change' && competitionId) {
          openLeaderboard(competitionId, 'home')
          return
        }
        if (data?.kind === 'rank_change') {
          selectTab('global-leaderboard')
          return
        }
        if (data?.kind === 'chat_reply') {
          selectTab('community')
          return
        }
        if (data?.kind === 'order_filled' || data?.kind === 'stop_loss' || data?.kind === 'take_profit' || data?.kind === 'arena_open') {
          if (competitionId) setTradeCompetitionId(competitionId)
          selectTab(competitionId ? 'trade' : 'home')
        }
      }))
      if (Capacitor.getPlatform() === 'android') {
        await PushNotifications.createChannel({
          id: 'btf_trading',
          name: 'Trading BTF',
          description: 'Ordres, SL/TP, rang et ouverture des arènes',
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
    setTab('profile')
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
              onChat={() => selectTab('community')}
              onRank={() => selectTab('rank')}
              unreadNews={unreadNewsCount}
              unreadChat={unreadChatCount}
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
              onGlobalLeaderboard={() => openGlobalLeaderboard('live')}
            />
          )}

          {tab === 'rank' && (
            <RankScreen
              currentUserId={dashboard?.user?.id}
              myRating={dashboard?.myRating}
              onOpenPlayer={(userId) => {
                setSelectedPlayerId(userId)
                setPlayerBackTab('rank')
                selectTab('player')
              }}
              onSeasonLeaderboard={() => openGlobalLeaderboard('rank')}
            />
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
              onBack={() => selectTab(leaderboardBackTab)}
              onOpenPlayer={(userId) => {
                setSelectedPlayerId(userId)
                setPlayerBackTab('leaderboard')
                selectTab('player')
              }}
            />
          )}

          {tab === 'global-leaderboard' && (
            <GlobalLeaderboard
              currentUserId={dashboard?.user?.id}
              onBack={() => selectTab(globalLeaderboardBackTab)}
              onOpenPlayer={(userId) => {
                setSelectedPlayerId(userId)
                setPlayerBackTab('global-leaderboard')
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
            />
          )}

          {tab === 'profile' && (
            dashboard?.user ? (
              <ProfileScreen
                dashboard={dashboard}
                onJournal={() => selectTab('journal')}
                onGlobalLeaderboard={() => openGlobalLeaderboard('profile')}
                onRewards={() => selectTab('deals')}
                onRank={() => selectTab('rank')}
                onSettings={() => selectTab('settings')}
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
          <JoinArenaSheet token={token} competition={joiningArena} onClose={() => setJoiningArena(null)}
            onJoined={() => {
              setJoiningArena(null)
              void load()
            }} />
        )}
      </AnimatePresence>
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

function LeaderboardScreen({
  competitions,
  initialCompetitionId,
  currentUserId,
  onBack,
  onOpenPlayer,
}: {
  competitions: PublicCompetition[]
  initialCompetitionId: string
  currentUserId?: string
  onBack: () => void
  onOpenPlayer: (userId: string) => void
}) {
  const { t, locale } = useI18n()
  const [competitionId, setCompetitionId] = useState(
    initialCompetitionId || competitions.find((item) => item.status === 'live')?.id || competitions[0]?.id || '',
  )
  const [rows, setRows] = useState<LeaderboardRow[]>([])
  const [loadingRows, setLoadingRows] = useState(true)
  const [error, setError] = useState('')
  const [shareRow, setShareRow] = useState<LeaderboardRow | null>(null)
  const [pnlHistory, setPnlHistory] = useState<{ samples: PnlHistorySample[]; traders: PnlHistoryTrader[]; moments: PnlMoment[] } | null>(null)
  const pnlBufferRef = useRef<{ competitionId: string; samples: PnlHistorySample[] }>({ competitionId: '', samples: [] })

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

  const loadLeaderboard = useCallback(async () => {
    if (!competitionId) {
      setRows([])
      setLoadingRows(false)
      return
    }
    setError('')
    try {
      const [nextRows, history] = await Promise.all([
        getCompetitionLeaderboard(competitionId),
        isLiveCompetition ? getPnlHistory(competitionId).catch(() => null) : Promise.resolve(null),
      ])
      setRows(nextRows.sort((a, b) => a.rank - b.rank || b.pnlPercent - a.pnlPercent))
      if (history) {
        const buffer = pnlBufferRef.current
        const merged = buffer.competitionId === competitionId
          ? mergePnlSamples(buffer.samples, history.samples)
          : mergePnlSamples([], history.samples)
        pnlBufferRef.current = { competitionId, samples: merged }
        setPnlHistory({ samples: merged, traders: history.traders, moments: history.moments })
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
    const timer = window.setInterval(() => void loadLeaderboard(), 10_000)
    return () => window.clearInterval(timer)
  }, [loadLeaderboard])

  const competition = competitions.find((item) => item.id === competitionId)
  const myRow = rows.find((row) => row.userId === currentUserId)
  const podium = [rows[1], rows[0], rows[2]].filter((row): row is LeaderboardRow => Boolean(row))

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

  return (
    <div className="leaderboard-page">
      <div className="leaderboard-page__head">
        <button className="leaderboard-back" type="button" onClick={onBack} aria-label={t('common.back')}>
          <Icon name="arrow" size={18} />
        </button>
        <div><span>{t('leaderboard.liveKicker')}</span><h2>Leaderboard</h2></div>
        <button type="button" onClick={() => void loadLeaderboard()} aria-label={t('common.refresh')}><Icon name="refresh" size={18} /></button>
      </div>

      <label className="leaderboard-competition-select">
        <span>{t('leaderboard.arena')}</span>
        <select value={competitionId} onChange={(event) => setCompetitionId(event.target.value)}>
          {competitions.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
        </select>
      </label>

      <section className="leaderboard-hero">
        <div><small>{competition?.status === 'live' ? t('arena.live') : String(competition?.status || '').replaceAll('_', ' ')}</small><h3>{competition?.title}</h3></div>
        <div><small>{t('leaderboard.participants')}</small><strong>{competition?.participants ?? rows.length}</strong></div>
      </section>

      {myRow && (
        <section className="my-ranking-card">
          <div><small>{t('leaderboard.yourRank')}</small><strong>#{myRow.rank}</strong></div>
          <div><small>{t('leaderboard.performance')}</small><strong className={myRow.pnlUsd >= 0 ? 'positive' : 'negative'}>{myRow.pnlUsd >= 0 ? '+' : ''}{myRow.pnlUsd.toLocaleString(locale, { maximumFractionDigits: 2 })} $</strong><span>{myRow.pnlPercent >= 0 ? '+' : ''}{myRow.pnlPercent.toFixed(2)}%</span></div>
          {myRow.rank > 0 && <button type="button" onClick={() => setShareRow(myRow)}>{t('common.share')}</button>}
        </section>
      )}

      {error ? (
        <div className="leaderboard-page-error">{error}<button type="button" onClick={() => void loadLeaderboard()}>{t('common.retry')}</button></div>
      ) : loadingRows ? (
        <div className="leaderboard-page-loading"><i />{t('leaderboard.syncing')}</div>
      ) : (
        <>
          {isLiveCompetition && pnlHistory && (
            <PnlRaceChart samples={pnlHistory.samples} traders={pnlHistory.traders} moments={pnlHistory.moments} currentUserId={currentUserId} />
          )}

          {podium.length > 0 && (
            <section className="leaderboard-podium">
              {podium.map((row) => (
                <article key={row.userId} className={`is-rank-${row.rank}`}>
                  <span className="podium-rank">#{row.rank}</span>
                  {row.avatarUrl ? <img src={apiAssetUrl(row.avatarUrl)} alt="" /> : <i>{row.name.slice(0, 2).toUpperCase()}</i>}
                  <strong>{row.name}</strong>
                  <small className={row.pnlUsd >= 0 ? 'positive' : 'negative'}>{row.pnlUsd >= 0 ? '+' : ''}{row.pnlUsd.toLocaleString(locale, { maximumFractionDigits: 0 })} $</small>
                </article>
              ))}
            </section>
          )}

          <section className="leaderboard-table">
            <div className="leaderboard-table__head"><span>{t('leaderboard.rank')}</span><span>{t('leaderboard.trader')}</span><span>{t('leaderboard.trades')}</span><span>PnL</span></div>
            {rows.map((row) => (
              <article key={row.userId} className={`${row.userId === currentUserId ? 'is-me' : ''} ${row.breached ? 'is-breached' : ''}`}>
                <strong>#{row.rank}</strong>
                <button type="button" className="leaderboard-table__player" onClick={() => onOpenPlayer(row.userId)}>
                  {row.avatarUrl ? <img src={apiAssetUrl(row.avatarUrl)} alt="" /> : <i>{row.name.slice(0, 2).toUpperCase()}</i>}
                  <span>{row.name}{row.userId === currentUserId && <small>{t('common.you')}</small>}</span>
                </button>
                <span>{row.tradesCount}</span>
                <span className={row.pnlUsd >= 0 ? 'positive' : 'negative'}><strong>{row.pnlUsd >= 0 ? '+' : ''}{row.pnlUsd.toLocaleString(locale, { maximumFractionDigits: 2 })} $</strong><small>{row.pnlPercent >= 0 ? '+' : ''}{row.pnlPercent.toFixed(2)}%</small></span>
              </article>
            ))}
            {!rows.length && <div className="leaderboard-table-empty">{t('leaderboard.emptyRows')}</div>}
          </section>
        </>
      )}
      <ShareRankModal row={shareRow} competition={competition?.title || 'BTF Arena'}
        participants={competition?.participants || rows.length} onClose={() => setShareRow(null)} />
    </div>
  )
}

const badgeLabels: Record<UserBadge, string> = {
  btf2026: 'BTF 2026',
  champion: 'Champion',
  'paris-champion': 'Champion Paris',
  'summer-champion': 'Champion Summer',
  'autumn-champion': 'Champion Autumn',
}

function ProfileScreen({ dashboard, onJournal, onGlobalLeaderboard, onRewards, onRank, onSettings, onLogout }: {
  dashboard: BootstrapData
  onJournal: () => void
  onGlobalLeaderboard: () => void
  onRewards: () => void
  onRank: () => void
  onSettings: () => void
  onLogout: () => void
}) {
  const { t, locale } = useI18n()
  const user = dashboard.user!
  const stats = dashboard.myStats
  return (
    <div className="profile-screen">
      <div className="profile-identity">
        <ProfileAvatar avatarUrl={user.avatarUrl} name={user.name} size="lg" />
        <div><small>{t('profile.synced')}</small><h2>{user.name}</h2>
          <p>{user.email}</p>
        </div>
      </div>
      {dashboard.myRating && <DivisionCard rating={dashboard.myRating} variant="compact" onOpen={onRank} />}
      <div className="profile-stats">
        <div><small>{t('profile.totalPnl')}</small><strong className={(stats?.netPnl ?? 0) >= 0 ? 'positive' : 'negative'}>{(stats?.netPnl ?? 0).toLocaleString(locale, { maximumFractionDigits: 2 })} $</strong></div>
        <div><small>{t('profile.winRate')}</small><strong>{((stats?.winRate ?? 0) * 100).toFixed(1)}%</strong></div>
        <div><small>{t('profile.trades')}</small><strong>{stats?.closedTrades ?? 0}</strong></div>
        <div><small>{t('home.avgRR')}</small><strong>{stats?.avgRR?.toFixed(2) || '—'}</strong></div>
        <div><small>{t('home.profitFactor')}</small><strong>{stats?.profitFactor == null ? '—' : stats.profitFactor.toFixed(2)}</strong></div>
      </div>
      <section className="profile-actions">
        <button type="button" onClick={onJournal}><span><Icon name="journal" size={20} /></span><div><strong>{t('profile.journal')}</strong><small>{t('profile.journalHint')}</small></div><i>›</i></button>
        <button type="button" onClick={onRewards}><span><Icon name="deals" size={20} /></span><div><strong>{t('profile.rewards')}</strong><small>{t('profile.rewardsHint')}</small></div><i>›</i></button>
        <button type="button" onClick={onGlobalLeaderboard}><span><Icon name="global-leaderboard" size={20} /></span><div><strong>{t('profile.global')}</strong><small>{t('profile.globalHint')}</small></div><i>›</i></button>
        <button type="button" onClick={onSettings}><span><Icon name="settings" size={20} /></span><div><strong>{t('profile.edit')}</strong><small>{t('profile.editHint')}</small></div><i>›</i></button>
      </section>
      <section className="profile-section">
        <span>{t('profile.language')}</span>
        <div className="profile-language">
          <p>{t('profile.languageHint')}</p>
          <LanguageSwitcher />
        </div>
      </section>
      <section className="profile-section">
        <span>{t('profile.badges')}</span>
        <div className="badge-list">
          {dashboard.myBadges.length
            ? dashboard.myBadges.map((badge) => <div key={badge}><Icon name="shield" size={18} />{badgeLabels[badge]}</div>)
            : <p>{t('profile.noBadges')}</p>}
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
