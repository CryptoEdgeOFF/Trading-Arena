import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Capacitor } from '@capacitor/core'
import { Haptics, ImpactStyle } from '@capacitor/haptics'
import { PushNotifications } from '@capacitor/push-notifications'
import { StatusBar, Style } from '@capacitor/status-bar'
import { AnimatePresence, motion } from 'framer-motion'
import {
  API_BASE_URL,
  apiAssetUrl,
  checkApiHealth,
  getBootstrap,
  getCompetitionLeaderboard,
  getGlobalChatMessages,
  getNewsPage,
  getPromotions,
  logoutSession,
  registerPushDevice,
  unregisterPushDevice,
  type ApiHealth,
  type BootstrapData,
  type LeaderboardRow,
  type MyCompetition,
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
import { GlobalChat } from './components/GlobalChat'
import { GlobalLeaderboard } from './components/GlobalLeaderboard'
import { JoinArenaSheet } from './components/JoinArenaSheet'
import { NewsScreen } from './components/NewsScreen'
import { PlayerProfile } from './components/PlayerProfile'
import { PlayerProgressionBar } from './components/PlayerProgressionBar'
import { ProfileAvatar } from './components/ProfileAvatar'
import { ProfileSettings } from './components/ProfileSettings'
import { ShareRankModal } from './components/ShareRankModal'
import { TradeJournal } from './components/TradeJournal'
import { TradingTerminal } from './components/TradingTerminal'
import './App.css'

type Tab = 'home' | 'deals' | 'trade' | 'community' | 'news' | 'leaderboard' | 'global-leaderboard' | 'journal' | 'settings' | 'player' | 'profile'
type IconName = Tab | 'bell' | 'arrow' | 'refresh' | 'shield'

const icons: Record<IconName, ReactNode> = {
  home: <path d="M3 10.8 12 3l9 7.8v9.7a.5.5 0 0 1-.5.5H15v-6H9v6H3.5a.5.5 0 0 1-.5-.5v-9.7Z" />,
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
  const title = competition.title || 'Arène BTF'
  const players = competition.participants ?? 0
  const status = competition.status === 'live' ? 'En direct'
    : competition.status === 'registration' ? 'Inscriptions ouvertes'
      : competition.status === 'starting_soon' ? 'À venir'
        : 'Terminée'
  return (
    <motion.article className={`arena-card is-${competition.status}`} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}>
      <img className="arena-card__banner"
        src={competition.bannerImageUrl ? apiAssetUrl(competition.bannerImageUrl) : '/assets/pictures/BTF ARENA SEO.png'} alt="" />
      <div className="arena-card__shade" />
      <div className="arena-card__glow" />
      <div className="arena-card__top">
        <span className="live-pill"><i />{status}</span>
        <span className="arena-card__players">{players} joueurs</span>
      </div>
      <h3>{title}</h3>
      <div className="arena-card__schedule">
        <span><small>DÉBUT</small><strong>{new Date(competition.startAt).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })}</strong></span>
        <span><small>FIN</small><strong>{new Date(competition.endAt).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })}</strong></span>
        {mine && <span><small>MON RANG</small><strong>#{mine.rank ?? '—'}</strong></span>}
      </div>
      <div className="arena-card__meta">
        <div>
          <small>Dotation</small>
          <strong>
            {competition.cashPrize?.total
              ? `${competition.cashPrize.total.toLocaleString('fr-FR')} ${competition.cashPrize.currency || '€'}`
              : 'À confirmer'}
          </strong>
        </div>
        <div className="arena-card__actions">
          {mine?.canTrade && <button type="button" onClick={() => onTrade(competition.id)}>Trader</button>}
          {!joined && competition.canJoin !== false && (
            <button type="button" onClick={() => onJoin(competition)}>S’inscrire</button>
          )}
          <button type="button" onClick={() => onLeaderboard(competition.id)} aria-label={`Voir le classement de ${title}`}>
            Classement <Icon name="arrow" size={16} />
          </button>
        </div>
      </div>
    </motion.article>
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
  onJournal,
  onGlobalLeaderboard,
  onProfile,
}: {
  loading: boolean
  competitions: PublicCompetition[]
  dashboard: BootstrapData | null
  onRefresh: () => void
  onAuth: () => void
  onJoin: (competition: PublicCompetition) => void
  onTrade: (competitionId: string) => void
  onLeaderboard: (competitionId: string) => void
  onJournal: () => void
  onGlobalLeaderboard: () => void
  onProfile: () => void
}) {
  const user = dashboard?.user
  const stats = dashboard?.myStats
  const statsCompetitions = (dashboard?.myCompetitions || []).filter((competition) => !/qualif/i.test(competition.title))
  const totalPnl = statsCompetitions.reduce((sum, competition) => sum + competition.myEntry.pnlUsd, 0)
  const averagePnlPercent = statsCompetitions.length
    ? statsCompetitions.reduce((sum, competition) => sum + competition.myEntry.pnlPercent, 0) / statsCompetitions.length
    : 0
  const mineById = new Map((dashboard?.myCompetitions || []).map((competition) => [competition.id, competition]))
  const open = competitions.filter((competition) => competition.status === 'live' || competition.status === 'registration')
  const upcoming = competitions.filter((competition) => competition.status === 'starting_soon')
  const ended = competitions.filter((competition) => competition.status === 'ended').sort((a, b) => b.endAt - a.endAt)

  const arenaSection = (eyebrow: string, title: string, list: PublicCompetition[], empty: string) => (
    <section className="home-arena-section">
      <div className="section-title">
        <div><span>{eyebrow}</span><h2>{title}</h2></div>
        {title === 'Arènes ouvertes' && <button type="button" onClick={onRefresh} aria-label="Actualiser"><Icon name="refresh" size={18} /></button>}
      </div>
      {loading ? <div className="skeleton-card"><i /><i /><i /></div> : list.length ? (
        <div className="arena-list">{list.map((competition) => (
          <ArenaCard key={competition.id} competition={competition} mine={mineById.get(competition.id)}
            joined={mineById.has(competition.id)} onJoin={onJoin} onTrade={onTrade} onLeaderboard={onLeaderboard} />
        ))}</div>
      ) : <div className="home-arena-empty">{empty}</div>}
    </section>
  )

  return (
    <div className="home-dashboard">
      {user ? (
        <section className="home-profile-card">
          <div className="home-profile-card__identity">
            <ProfileAvatar avatarUrl={user.avatarUrl} name={user.name} progression={dashboard.myProgression} size="sm" />
            <span><small>TRADER CONNECTÉ</small><strong>{user.name}</strong>{dashboard.myProgression && <em>{dashboard.myProgression.title.label}</em>}<p>{user.email}</p></span>
            <button type="button" onClick={onProfile}>›</button>
          </div>
          {dashboard.myProgression && <div className="home-profile-xp"><PlayerProgressionBar progression={dashboard.myProgression} variant="compact" /></div>}
          <div className="home-profile-stats">
            <div><small>PNL TOTAL</small><strong className={totalPnl >= 0 ? 'positive' : 'negative'}>{totalPnl >= 0 ? '+' : ''}{totalPnl.toFixed(2)} $</strong></div>
            <div><small>PNL MOYEN</small><strong className={averagePnlPercent >= 0 ? 'positive' : 'negative'}>{averagePnlPercent >= 0 ? '+' : ''}{averagePnlPercent.toFixed(2)}%</strong></div>
            <div><small>ARÈNES</small><strong>{statsCompetitions.length}</strong></div>
            <div><small>WIN RATE</small><strong>{((stats?.winRate || 0) * 100).toFixed(1)}%</strong></div>
            <div><small>R/R MOYEN</small><strong>{stats?.avgRR?.toFixed(2) || '—'}</strong></div>
            <div><small>PROFIT FACTOR</small><strong>{stats?.profitFactor == null ? '—' : stats.profitFactor.toFixed(2)}</strong></div>
          </div>
          <div className="home-profile-links">
            <button className="home-journal-link" type="button" onClick={onJournal}>Ouvrir mon journal <span>→</span></button>
            <button className="home-journal-link" type="button" onClick={onGlobalLeaderboard}>Classement global & saisons <span>→</span></button>
          </div>
        </section>
      ) : (
        <section className="home-guest-hero">
          <div className="eyebrow"><span /> Compétition de trading</div>
          <h1>Entre dans<br /><em>l’arène.</em></h1>
          <p>Affronte les meilleurs traders et suis ta performance en direct.</p>
          <button type="button" onClick={onAuth}>Se connecter <Icon name="arrow" size={17} /></button>
          <button className="home-global-link" type="button" onClick={onGlobalLeaderboard}>Voir le classement global</button>
        </section>
      )}
      {arenaSection('EN CE MOMENT', 'Arènes ouvertes', open, 'Aucune arène ouverte actuellement.')}
      {arenaSection('PROCHAINEMENT', 'Arènes à venir', upcoming, 'Les prochaines arènes seront annoncées ici.')}
      {arenaSection('HISTORIQUE', 'Arènes fermées', ended, 'Aucune arène terminée pour le moment.')}
    </div>
  )
}

function App() {
  const [tab, setTab] = useState<Tab>('home')
  const [competitions, setCompetitions] = useState<PublicCompetition[]>([])
  const [health, setHealth] = useState<ApiHealth>({ online: false, latencyMs: null })
  const [dashboard, setDashboard] = useState<BootstrapData | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [showAuth, setShowAuth] = useState(false)
  const [loading, setLoading] = useState(true)
  const [joiningArena, setJoiningArena] = useState<PublicCompetition | null>(null)
  const [tradeCompetitionId, setTradeCompetitionId] = useState('')
  const [selectedPlayerId, setSelectedPlayerId] = useState('')
  const [playerBackTab, setPlayerBackTab] = useState<'leaderboard' | 'global-leaderboard' | 'community'>('leaderboard')
  const [leaderboardCompetitionId, setLeaderboardCompetitionId] = useState('')
  const [leaderboardBackTab, setLeaderboardBackTab] = useState<Exclude<Tab, 'leaderboard'>>('home')
  const [unreadChatCount, setUnreadChatCount] = useState(0)
  const [unreadNewsCount, setUnreadNewsCount] = useState(0)
  const [initialNewsId, setInitialNewsId] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const storedToken = await readSessionToken()
    const [nextHealth, nextDashboard] = await Promise.all([
      checkApiHealth(),
      getBootstrap(storedToken).catch(() => null),
    ])
    setHealth(nextHealth)
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
    void getPromotions()
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
    { id: 'home', label: 'Accueil' },
    { id: 'community', label: 'Chat' },
    { id: 'trade', label: 'Trader' },
    { id: 'deals', label: 'Deals' },
    { id: 'profile', label: 'Profil' },
  ]
  const leaderboardCompetitions = [
    ...competitions,
    ...(dashboard?.myCompetitions || []).filter((item) => !competitions.some((competition) => competition.id === item.id)),
  ]

  return (
    <main className="app-shell">
      <div className="ambient ambient--one" />
      <div className="ambient ambient--two" />
      {tab !== 'trade' && (
        <header className="topbar">
          <button className="brand" type="button" onClick={() => selectTab('home')} aria-label="Accueil BTF Arena">
            <img src="/assets/pictures/BTF_ARENA_logo.png" alt="BTF Arena" />
          </button>
          <div className="topbar__actions">
            <span className={`api-state ${health.online ? 'is-online' : ''}`}>
              <i /> {health.online ? `${health.latencyMs ?? 0} ms` : 'hors ligne'}
            </span>
            <button className="icon-button news-button" type="button" aria-label="Ouvrir les actualités" onClick={() => {
              setInitialNewsId('')
              selectTab('news')
            }}>
              <Icon name="bell" size={20} />
              {unreadNewsCount > 0 && <b className="topbar-unread-badge">{unreadNewsCount > 9 ? '9+' : unreadNewsCount}</b>}
            </button>
          </div>
        </header>
      )}

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
              onJournal={() => selectTab('journal')}
              onGlobalLeaderboard={() => selectTab('global-leaderboard')}
              onProfile={() => selectTab('profile')}
            />
          )}

          {tab === 'deals' && <DealsScreen />}

          {tab === 'news' && <NewsScreen initialArticleId={initialNewsId} onSeen={markNewsSeen} />}

          {tab === 'community' && (
            token && dashboard?.user ? (
              <GlobalChat token={token} user={dashboard.user} onLatestSeen={markChatSeen} onOpenPlayer={(userId) => {
                setSelectedPlayerId(userId)
                setPlayerBackTab('community')
                selectTab('player')
              }} />
            ) : (
              <div className="empty-state empty-state--feature">
                <span><Icon name="community" size={34} /></span><small>COMMUNAUTÉ BTF</small>
                <h3>Connexion requise</h3>
                <p>Connecte-toi pour discuter avec les traders et partager tes analyses.</p>
                <button className="auth-open" type="button" onClick={() => setShowAuth(true)}>Se connecter</button>
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
                <span><Icon name="trade" size={34} /></span><small>TERMINAL MOBILE</small>
                <h3>Connexion requise</h3>
                <p>Connecte ton compte BTF pour retrouver tes arènes et tes positions actives.</p>
                <button className="auth-open" type="button" onClick={() => setShowAuth(true)}>Se connecter</button>
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
              onBack={() => selectTab('home')}
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
                onGlobalLeaderboard={() => selectTab('global-leaderboard')}
                onSettings={() => selectTab('settings')}
                onLogout={() => void handleLogout()}
              />
            ) : (
              <div className="empty-state empty-state--feature">
                <span><Icon name="profile" size={34} /></span><small>COMPTE JOUEUR</small>
                <h3>Retrouve ton profil</h3>
                <p>Connecte le même compte que sur PC pour retrouver immédiatement tes compétitions, trades, rangs et badges.</p>
                <button className="auth-open" type="button" onClick={() => setShowAuth(true)}>Se connecter</button>
                <code>{API_BASE_URL.replace('https://', '')}</code>
              </div>
            )
          )}
        </motion.section>
      </AnimatePresence>

      <nav className="bottom-nav" aria-label="Navigation principale">
        {navItems.map((item) => (
          <button key={item.id} type="button" className={`${tab === item.id ? 'is-active' : ''} ${item.id === 'trade' ? 'is-primary-trade' : ''}`}
            onClick={() => selectTab(item.id)} aria-current={tab === item.id ? 'page' : undefined}>
            <span><Icon name={item.id} size={22} /></span>{item.label}
            {item.id === 'community' && unreadChatCount > 0 && <b className="nav-unread-badge">+{unreadChatCount}</b>}
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
  const [competitionId, setCompetitionId] = useState(
    initialCompetitionId || competitions.find((item) => item.status === 'live')?.id || competitions[0]?.id || '',
  )
  const [rows, setRows] = useState<LeaderboardRow[]>([])
  const [loadingRows, setLoadingRows] = useState(true)
  const [error, setError] = useState('')
  const [shareRow, setShareRow] = useState<LeaderboardRow | null>(null)

  useEffect(() => {
    if (initialCompetitionId && competitions.some((item) => item.id === initialCompetitionId)) {
      setCompetitionId(initialCompetitionId)
      return
    }
    if (!competitions.some((item) => item.id === competitionId)) {
      setCompetitionId(competitions.find((item) => item.status === 'live')?.id || competitions[0]?.id || '')
    }
  }, [competitionId, competitions, initialCompetitionId])

  const loadLeaderboard = useCallback(async () => {
    if (!competitionId) {
      setRows([])
      setLoadingRows(false)
      return
    }
    setError('')
    try {
      const nextRows = await getCompetitionLeaderboard(competitionId)
      setRows(nextRows.sort((a, b) => a.rank - b.rank || b.pnlPercent - a.pnlPercent))
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Classement indisponible')
    } finally {
      setLoadingRows(false)
    }
  }, [competitionId])

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
          <span>COMPÉTITION</span><h2>Classement</h2>
          <p>Inscris-toi à une arène pour apparaître dans le classement.</p>
        </div>
        <div className="empty-card"><div><strong>Aucune arène</strong><p>Ton classement apparaîtra ici après ton inscription.</p></div></div>
      </div>
    )
  }

  return (
    <div className="leaderboard-page">
      <div className="leaderboard-page__head">
        <button className="leaderboard-back" type="button" onClick={onBack} aria-label="Retour">
          <Icon name="arrow" size={18} />
        </button>
        <div><span>CLASSEMENT LIVE</span><h2>Leaderboard</h2></div>
        <button type="button" onClick={() => void loadLeaderboard()} aria-label="Actualiser"><Icon name="refresh" size={18} /></button>
      </div>

      <label className="leaderboard-competition-select">
        <span>ARÈNE</span>
        <select value={competitionId} onChange={(event) => setCompetitionId(event.target.value)}>
          {competitions.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
        </select>
      </label>

      <section className="leaderboard-hero">
        <div><small>{competition?.status === 'live' ? 'EN DIRECT' : String(competition?.status || '').replaceAll('_', ' ')}</small><h3>{competition?.title}</h3></div>
        <div><small>PARTICIPANTS</small><strong>{competition?.participants ?? rows.length}</strong></div>
      </section>

      {myRow && (
        <section className="my-ranking-card">
          <div><small>TON CLASSEMENT</small><strong>#{myRow.rank}</strong></div>
          <div><small>PERFORMANCE</small><strong className={myRow.pnlUsd >= 0 ? 'positive' : 'negative'}>{myRow.pnlUsd >= 0 ? '+' : ''}{myRow.pnlUsd.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} $</strong><span>{myRow.pnlPercent >= 0 ? '+' : ''}{myRow.pnlPercent.toFixed(2)}%</span></div>
          {myRow.rank > 0 && <button type="button" onClick={() => setShareRow(myRow)}>Partager</button>}
        </section>
      )}

      {error ? (
        <div className="leaderboard-page-error">{error}<button type="button" onClick={() => void loadLeaderboard()}>Réessayer</button></div>
      ) : loadingRows ? (
        <div className="leaderboard-page-loading"><i />Synchronisation du classement</div>
      ) : (
        <>
          {podium.length > 0 && (
            <section className="leaderboard-podium">
              {podium.map((row) => (
                <article key={row.userId} className={`is-rank-${row.rank}`}>
                  <span className="podium-rank">#{row.rank}</span>
                  {row.avatarUrl ? <img src={apiAssetUrl(row.avatarUrl)} alt="" /> : <i>{row.name.slice(0, 2).toUpperCase()}</i>}
                  <strong>{row.name}</strong>
                  <small className={row.pnlUsd >= 0 ? 'positive' : 'negative'}>{row.pnlUsd >= 0 ? '+' : ''}{row.pnlUsd.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} $</small>
                </article>
              ))}
            </section>
          )}

          <section className="leaderboard-table">
            <div className="leaderboard-table__head"><span>Rang</span><span>Trader</span><span>Trades</span><span>PnL</span></div>
            {rows.map((row) => (
              <article key={row.userId} className={`${row.userId === currentUserId ? 'is-me' : ''} ${row.breached ? 'is-breached' : ''}`}>
                <strong>#{row.rank}</strong>
                <button type="button" className="leaderboard-table__player" onClick={() => onOpenPlayer(row.userId)}>
                  {row.avatarUrl ? <img src={apiAssetUrl(row.avatarUrl)} alt="" /> : <i>{row.name.slice(0, 2).toUpperCase()}</i>}
                  <span>{row.name}{row.userId === currentUserId && <small>TOI</small>}</span>
                </button>
                <span>{row.tradesCount}</span>
                <span className={row.pnlUsd >= 0 ? 'positive' : 'negative'}><strong>{row.pnlUsd >= 0 ? '+' : ''}{row.pnlUsd.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} $</strong><small>{row.pnlPercent >= 0 ? '+' : ''}{row.pnlPercent.toFixed(2)}%</small></span>
              </article>
            ))}
            {!rows.length && <div className="leaderboard-table-empty">Aucun participant classé pour le moment.</div>}
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

function ProfileScreen({ dashboard, onJournal, onGlobalLeaderboard, onSettings, onLogout }: {
  dashboard: BootstrapData
  onJournal: () => void
  onGlobalLeaderboard: () => void
  onSettings: () => void
  onLogout: () => void
}) {
  const user = dashboard.user!
  const stats = dashboard.myStats
  return (
    <div className="profile-screen">
      <div className="profile-identity">
        <ProfileAvatar avatarUrl={user.avatarUrl} name={user.name} progression={dashboard.myProgression} size="lg" />
        <div><small>COMPTE SYNCHRONISÉ</small><h2>{user.name}</h2>
          {dashboard.myProgression && <em className={`profile-title rarity-${dashboard.myProgression.title.rarity}`}>{dashboard.myProgression.title.label}</em>}
          <p>{user.email}</p>
        </div>
      </div>
      <div className="profile-stats">
        <div><small>PnL total</small><strong className={(stats?.netPnl ?? 0) >= 0 ? 'positive' : 'negative'}>{(stats?.netPnl ?? 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} $</strong></div>
        <div><small>Win rate</small><strong>{((stats?.winRate ?? 0) * 100).toFixed(1)}%</strong></div>
        <div><small>Trades</small><strong>{stats?.closedTrades ?? 0}</strong></div>
      </div>
      {dashboard.myProgression && <section className="profile-progression">
        <header><span>PROGRESSION DU TRADER</span><small>{dashboard.myProgression.frame.label}</small></header>
        <PlayerProgressionBar progression={dashboard.myProgression} />
        {dashboard.myProgression.recentEvents.length > 0 && <div className="profile-xp-events">
          {dashboard.myProgression.recentEvents.slice(0, 5).map((event) => <div key={event.id}>
            <i>+{event.amount}</i><span><strong>{event.label}</strong><small>{new Date(event.createdAt).toLocaleDateString('fr-FR')}</small></span>
          </div>)}
        </div>}
      </section>}
      <section className="profile-actions">
        <button type="button" onClick={onJournal}><span><Icon name="journal" size={20} /></span><div><strong>Journal de trading</strong><small>Statistiques, historique et partage des PnL</small></div><i>›</i></button>
        <button type="button" onClick={onGlobalLeaderboard}><span><Icon name="global-leaderboard" size={20} /></span><div><strong>Classement global</strong><small>Saisons, classement général et partage du rang</small></div><i>›</i></button>
        <button type="button" onClick={onSettings}><span><Icon name="settings" size={20} /></span><div><strong>Modifier mon profil</strong><small>Photo, identité et réseaux sociaux</small></div><i>›</i></button>
      </section>
      <section className="profile-section">
        <span>MES BADGES</span>
        <div className="badge-list">
          {dashboard.myBadges.length
            ? dashboard.myBadges.map((badge) => <div key={badge}><Icon name="shield" size={18} />{badgeLabels[badge]}</div>)
            : <p>Aucun badge débloqué pour le moment.</p>}
        </div>
      </section>
      <section className="profile-section">
        <span>MES ARÈNES</span>
        <div className="profile-arenas">
          {dashboard.myCompetitions.length
            ? dashboard.myCompetitions.map((competition) => (
              <div key={competition.id}>
                <div><strong>{competition.title}</strong><small>{competition.myEntry.tradesCount} trades</small></div>
                <div><strong>#{competition.rank ?? '—'}</strong><small>{competition.myEntry.pnlUsd.toLocaleString('fr-FR')} $</small></div>
              </div>
            ))
            : <p>Aucune compétition rattachée à ce compte.</p>}
        </div>
      </section>
      <button className="logout-button" type="button" onClick={onLogout}>Se déconnecter de cet appareil</button>
    </div>
  )
}

export default App
