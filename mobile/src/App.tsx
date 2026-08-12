import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Capacitor } from '@capacitor/core'
import { Haptics, ImpactStyle } from '@capacitor/haptics'
import { StatusBar, Style } from '@capacitor/status-bar'
import { AnimatePresence, motion } from 'framer-motion'
import {
  API_BASE_URL,
  checkApiHealth,
  getBootstrap,
  logoutSession,
  type ApiHealth,
  type BootstrapData,
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
import { TradingTerminal } from './components/TradingTerminal'
import './App.css'

type Tab = 'home' | 'arenas' | 'trade' | 'profile'

const icons: Record<Tab | 'bell' | 'arrow' | 'refresh' | 'shield', ReactNode> = {
  home: <path d="M3 10.8 12 3l9 7.8v9.7a.5.5 0 0 1-.5.5H15v-6H9v6H3.5a.5.5 0 0 1-.5-.5v-9.7Z" />,
  arenas: <path d="M8 4h8v3.2c0 2.7-1.8 4.8-4 4.8s-4-2.1-4-4.8V4Zm0 1H4v2a4 4 0 0 0 4.8 3.9M16 5h4v2a4 4 0 0 1-4.8 3.9M12 12v5m-4 4h8m-7-4h6v4H9v-4Z" />,
  trade: <path d="M5 19V9m0 0L2.5 11.5M5 9l2.5 2.5M19 5v10m0 0 2.5-2.5M19 15l-2.5-2.5M10 7h4m-4 5h4m-4 5h4" />,
  profile: <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm7 9a7 7 0 0 0-14 0" />,
  bell: <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Zm-8 12h4" />,
  arrow: <path d="m9 18 6-6-6-6" />,
  refresh: <path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" />,
  shield: <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Zm-3-10 2 2 4-5" />,
}

function Icon({ name, size = 22 }: { name: keyof typeof icons; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {icons[name]}
    </svg>
  )
}

function ArenaCard({ competition }: { competition: PublicCompetition }) {
  const title = competition.title || 'Arène BTF'
  const players = competition.participants ?? 0
  const status = String(competition.status || 'À venir').replaceAll('_', ' ')
  return (
    <motion.article className="arena-card" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}>
      <div className="arena-card__glow" />
      <div className="arena-card__top">
        <span className="live-pill"><i />{status}</span>
        <span className="arena-card__players">{players} joueurs</span>
      </div>
      <h3>{title}</h3>
      <div className="arena-card__meta">
        <div>
          <small>Dotation</small>
          <strong>
            {competition.cashPrize?.total
              ? `${competition.cashPrize.total.toLocaleString('fr-FR')} ${competition.cashPrize.currency || '€'}`
              : 'À confirmer'}
          </strong>
        </div>
        <button type="button" aria-label={`Voir ${title}`}><Icon name="arrow" size={19} /></button>
      </div>
    </motion.article>
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

  useEffect(() => {
    void load()
    if (Capacitor.isNativePlatform()) {
      void StatusBar.setStyle({ style: Style.Dark })
      void StatusBar.setBackgroundColor({ color: '#050507' }).catch(() => undefined)
    }
  }, [load])

  function selectTab(nextTab: Tab) {
    setTab(nextTab)
    if (Capacitor.isNativePlatform()) void Haptics.impact({ style: ImpactStyle.Light })
  }

  async function handleAuthenticated(nextToken: string, _user: SessionUser) {
    await writeSessionToken(nextToken)
    setToken(nextToken)
    setShowAuth(false)
    await load()
    setTab('profile')
  }

  async function handleLogout() {
    if (token) await logoutSession(token).catch(() => undefined)
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
    { id: 'arenas', label: 'Arènes' },
    { id: 'trade', label: 'Trader' },
    { id: 'profile', label: 'Profil' },
  ]

  return (
    <main className="app-shell">
      <div className="ambient ambient--one" />
      <div className="ambient ambient--two" />
      <header className="topbar">
        <button className="brand" type="button" onClick={() => selectTab('home')} aria-label="Accueil BTF Arena">
          <span className="brand__mark">BTF</span><span className="brand__name">ARENA</span>
        </button>
        <div className="topbar__actions">
          <span className={`api-state ${health.online ? 'is-online' : ''}`}>
            <i /> {health.online ? `${health.latencyMs ?? 0} ms` : 'hors ligne'}
          </span>
          <button className="icon-button" type="button" aria-label="Notifications"><Icon name="bell" size={20} /></button>
        </div>
      </header>

      <AnimatePresence mode="wait">
        <motion.section key={tab} className="screen" initial={{ opacity: 0, x: 10 }}
          animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={{ duration: 0.22 }}>
          {tab === 'home' && (
            <>
              <div className="eyebrow"><span /> Compétition de trading</div>
              <h1>Entre dans<br /><em>l’arène.</em></h1>
              <p className="lead">Affronte les meilleurs traders, suis ton classement en direct et transforme chaque décision en performance.</p>
              <button className="primary-button" type="button" onClick={() => selectTab('arenas')}>
                Explorer les arènes <Icon name="arrow" size={19} />
              </button>
              <section className="section-block">
                <div className="section-title">
                  <div><span>EN CE MOMENT</span><h2>Arènes ouvertes</h2></div>
                  <button type="button" onClick={() => void load()} aria-label="Actualiser"><Icon name="refresh" size={19} /></button>
                </div>
                <CompetitionList loading={loading} competitions={competitions.slice(0, 2)} />
              </section>
            </>
          )}

          {tab === 'arenas' && (
            <>
              <div className="page-heading">
                <span>SAISON EN COURS</span><h2>Les arènes</h2>
                <p>Inscris-toi, respecte les règles et grimpe au classement général.</p>
              </div>
              <CompetitionList loading={loading} competitions={competitions} full />
            </>
          )}

          {tab === 'trade' && (
            token && dashboard?.user ? (
              <TradingTerminal accountToken={token} competitions={dashboard.myCompetitions} />
            ) : (
              <div className="empty-state empty-state--feature">
                <span><Icon name="trade" size={34} /></span><small>TERMINAL MOBILE</small>
                <h3>Connexion requise</h3>
                <p>Connecte ton compte BTF pour retrouver tes arènes et tes positions actives.</p>
                <button className="auth-open" type="button" onClick={() => setShowAuth(true)}>Se connecter</button>
              </div>
            )
          )}

          {tab === 'profile' && (
            dashboard?.user ? (
              <ProfileScreen dashboard={dashboard} onLogout={() => void handleLogout()} />
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
          <button key={item.id} type="button" className={tab === item.id ? 'is-active' : ''}
            onClick={() => selectTab(item.id)} aria-current={tab === item.id ? 'page' : undefined}>
            <span><Icon name={item.id} size={22} /></span>{item.label}
          </button>
        ))}
      </nav>
      <AnimatePresence>
        {showAuth && <AuthSheet onClose={() => setShowAuth(false)} onAuthenticated={handleAuthenticated} />}
      </AnimatePresence>
    </main>
  )
}

function CompetitionList({ loading, competitions, full = false }: {
  loading: boolean
  competitions: PublicCompetition[]
  full?: boolean
}) {
  if (loading) return <div className="skeleton-card"><i /><i /><i /></div>
  if (competitions.length) {
    return <div className="arena-list">{competitions.map((item) => <ArenaCard key={item.id} competition={item} />)}</div>
  }
  return (
    <div className={full ? 'empty-state' : 'empty-card'}>
      <span className={full ? '' : 'empty-card__icon'}><Icon name={full ? 'arenas' : 'shield'} size={full ? 34 : 24} /></span>
      <div>
        <strong>{full ? 'Aucune arène ouverte' : 'La prochaine arène se prépare'}</strong>
        <p>Le backend staging est connecté. Les compétitions apparaîtront ici automatiquement.</p>
      </div>
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

function ProfileScreen({ dashboard, onLogout }: {
  dashboard: BootstrapData
  onLogout: () => void
}) {
  const user = dashboard.user!
  const stats = dashboard.myStats
  return (
    <div className="profile-screen">
      <div className="profile-identity">
        <div className="profile-avatar">
          {user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : user.name.slice(0, 2).toUpperCase()}
        </div>
        <div><small>COMPTE SYNCHRONISÉ</small><h2>{user.name}</h2><p>{user.email}</p></div>
      </div>
      <div className="profile-stats">
        <div><small>PnL total</small><strong className={(stats?.netPnl ?? 0) >= 0 ? 'positive' : 'negative'}>{(stats?.netPnl ?? 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} $</strong></div>
        <div><small>Win rate</small><strong>{(stats?.winRate ?? 0).toFixed(1)}%</strong></div>
        <div><small>Trades</small><strong>{stats?.closedTrades ?? 0}</strong></div>
      </div>
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
