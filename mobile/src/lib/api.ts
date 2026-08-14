const API_BASE_URL = (
  import.meta.env.VITE_API_URL ||
  'https://btf-mobile-staging-production.up.railway.app'
).replace(/\/$/, '')
const API_WS_URL = API_BASE_URL.replace(/^http/, 'ws')

export function apiAssetUrl(value?: string | null): string {
  if (!value) return ''
  if (/^(https?:|data:|blob:)/i.test(value)) return value
  return `${API_BASE_URL}${value.startsWith('/') ? value : `/${value}`}`
}

export type PublicCompetition = {
  id: string
  title: string
  code: string
  executionMode: 'paper' | 'real'
  startAt: number
  endAt: number
  registrationEndsAt?: number
  dailyDrawdownPercent?: number | null
  isPublic: boolean
  participants: number
  status: 'registration' | 'starting_soon' | 'live' | 'ended'
  canJoin?: boolean
  canTrade?: boolean
  cashPrize?: {
    currency: string
    total: number
  } | null
  sponsor?: string | null
  bannerImageUrl?: string | null
}

export type SessionUser = {
  id: string
  email: string
  name: string
  phone?: string | null
  phoneVerifiedAt?: number | null
  avatarUrl?: string | null
  socials?: {
    x?: string
    instagram?: string
    discord?: string
    website?: string
  }
}

export type UserBadge =
  | 'btf2026'
  | 'champion'
  | 'paris-champion'
  | 'summer-champion'
  | 'autumn-champion'

export type PlayerProgression = {
  totalXp: number
  level: number
  levelStartXp: number
  nextLevelXp: number
  xpIntoLevel: number
  xpForNextLevel: number
  progressPercent: number
  title: { id: string; label: string; rarity: 'common' | 'rare' | 'epic' | 'legendary' }
  frame: { id: string; label: string; tier: number }
  recentEvents: Array<{
    id: string
    eventType: 'account.created' | 'arena.join' | 'arena.first_trade' | 'arena.completed' | 'arena.podium' | 'arena.top_half' | 'arena.streak' | 'badge.unlocked' | 'trading.achievement'
    amount: number
    label: string
    createdAt: number
  }>
}

export type UserStats = {
  closedTrades: number
  wins: number
  losses: number
  winRate: number
  grossProfit: number
  grossLoss: number
  profitFactor: number | null
  avgWin: number
  avgLoss: number
  avgRR: number | null
  netPnl: number
}

export type Promotion = {
  id: string
  name: string
  category: 'exchange' | 'broker' | 'prop' | 'tool' | 'community'
  accent: string
  tagline: string
  highlight: string
  description?: string
  perks: string[]
  promoCode?: string
  referralUrl?: string
  photoUrl?: string
  featured?: boolean
}

export type NewsArticle = {
  id: string
  title: string
  summary: string
  body: string
  coverUrl: string
  featured: boolean
  publishedAt: number
  createdAt: number
  updatedAt: number
}

let promotionsCache: Promotion[] | null = null
let promotionsRequest: Promise<Promotion[]> | null = null
let promotionsLang = 'en'
const PROMOTIONS_CACHE_KEY = 'btf.promotions.v1'
const NEWS_CACHE_KEY = 'btf.news.v1'

export type MyCompetition = PublicCompetition & {
  breached?: boolean
  rank?: number | null
  myEntry: {
    pnlUsd: number
    pnlPercent: number
    tradesCount: number
  }
}

export type LeaderboardRow = {
  rank: number
  userId: string
  name: string
  avatarUrl?: string | null
  pnlPercent: number
  pnlUsd: number
  tradesCount: number
  updatedAt: number
  breached?: boolean
}

export type GlobalChatMessage = {
  id: string
  userId: string
  name: string
  avatarUrl?: string | null
  body: string
  imageUrl?: string | null
  createdAt: number
  clientId?: string
  replyTo?: {
    id: string
    userId: string
    name: string
    body: string
    imageUrl?: string | null
  } | null
}

export type GlobalLeaderboardStats = UserStats & {
  grossProfit: number
  grossLoss: number
  avgWin: number
  avgLoss: number
}

export type GlobalLeaderboardRow = {
  userId: string
  name: string
  avatarUrl?: string | null
  badges?: UserBadge[]
  pnlUsd: number
  arenas: number
  stats: GlobalLeaderboardStats
}

export type LeaderboardSeason = {
  id: string
  slug: string
  nameKey: string
  startAt: number
  endAt: number
  isActive: boolean
  theme: 'summer' | 'autumn' | 'winter' | 'spring'
  championBadge: UserBadge
  bannerImage?: string | null
  shirtImage?: string | null
  arenaImage?: string | null
  status: 'upcoming' | 'active' | 'ended'
}

export type PublicPlayerProfile = {
  user: {
    id: string
    name: string
    avatarUrl?: string | null
    socials?: SessionUser['socials']
  }
  badges: UserBadge[]
  totalPnlUsd: number
  arenas: Array<{
    id: string
    title: string
    status: PublicCompetition['status']
    rank: number | null
    pnlUsd: number
    pnlPercent: number
    tradesCount: number
  }>
  payouts?: Array<{ id: string; amount: number; currency: string; paidAt: number }>
  stats: UserStats & { totalFees?: number }
  progression?: PlayerProgression | null
}

export type RatingDivision = {
  id: string
  label: string
  /** 3 → 1 (1 = palier haut). 0 = pas de palier (Legend). */
  tier: number
}

export type PlayerRating = {
  points: number
  division: RatingDivision
  next: { label: string; pointsNeeded: number } | null
  worldRank: number | null
  totalPlayers: number
  recentEvents: Array<{ id: string; points: number; label: string; createdAt: number }>
}

export type RatingLeaderboardRow = {
  rank: number
  userId: string
  name: string
  avatarUrl?: string | null
  points: number
  division: RatingDivision
}

export type BootstrapData = {
  user: SessionUser | null
  publicCompetitions: PublicCompetition[]
  myCompetitions: MyCompetition[]
  myStats: UserStats | null
  myBadges: UserBadge[]
  myProgression?: PlayerProgression | null
  myRating?: PlayerRating | null
}

export type AuthRequestResult = {
  email: string
  expiresAt: number
  delivered: boolean
  deliveryError?: string
  devCode?: string
}

export type AuthVerifyResult = {
  token?: string
  user?: SessionUser
  needsPhone?: boolean
  phoneMasked?: string
  smsDelivered?: boolean
  smsError?: string
  devSmsCode?: string
}

export type JournalTrade = {
  id: string
  competitionId: string
  competitionTitle: string
  pair: string
  side: 'long' | 'short'
  action: 'open' | 'close'
  size: number
  price: number
  entryPrice?: number
  leverage: number
  fee: number
  pnl: number
  time: number
}

export type PaperCompetitionSummary = {
  id: string
  title: string
  code?: string
  executionMode: 'paper' | 'real'
  startAt?: number
  endAt?: number
  status?: 'registration' | 'starting_soon' | 'live' | 'ended'
  canTrade?: boolean
  participants?: number
  dailyDrawdownPercent?: number | null
}

export type PaperCompetitionContext =
  | PaperCompetitionSummary
  | {
      competition: PaperCompetitionSummary
      rank: number | null
      userId: string | null
      pnlPercent: number
      pnlUsd: number
      tradesCount: number
      breached: boolean
      breachedAt: number | null
      dailyBaselineEquity: number | null
      dailyLimitEquity: number | null
    }

export type PaperSession = {
  token: string
  player: Record<string, unknown>
  canTrade: boolean
  competition: PaperCompetitionContext
}

export type MarketTicker = {
  pair: string
  symbol: string
  markPrice: number
  bidPrice: number
  askPrice: number
  change24h?: number | null
  spreadBps: number
  updatedAt: number
  marketOpen?: boolean
  marketClosedLabel?: string | null
}

export type Position = {
  id: string
  pair: string
  side: 'long' | 'short'
  size: number
  entryPrice: number
  markPrice: number
  pnl: number
  leverage: number
  margin: number
  feesPaid?: number
  openedAt?: number
  liquidationPrice: number | null
  stopLoss: number | null
  takeProfit: number | null
  stopLossSize?: number | null
  takeProfitSize?: number | null
}

export type PaperOrder = {
  id: string
  pair: string
  side: 'long' | 'short'
  size: number
  orderType: 'market' | 'limit'
  status: 'open' | 'filled' | 'cancelled'
  limitPrice: number | null
  stopLoss?: number | null
  takeProfit?: number | null
  leverage: number
  marginReserved: number
  feeEstimate?: number
  createdAt: number
}

export type PaperTrade = {
  id: string
  pair: string
  side: 'long' | 'short'
  size: number
  price: number
  fee: number
  leverage: number
  pnl: number
  time: number
  action: 'open' | 'close' | 'update'
}

export type PaperPlayer = {
  id: string
  name: string
  currentBalance: number
  availableMargin: number
  usedMargin: number
  pnl: number
  pnlPercent: number
  tradeCount: number
  feesPaid?: number
  trades?: PaperTrade[]
  openPositions: Position[]
  openOrders: PaperOrder[]
  rank: number
}

export type PaperState = {
  player: PaperPlayer
  market: Record<string, MarketTicker>
  fees: {
    maker: number
    taker: number
    spreadBps: number
    minLeverage: number
    maxLeverage: number
  }
  pairs: string[]
  startingBalance: number
  canTrade: boolean
  eventStarted: boolean
  eventEndTime: number | null
  competition: PaperCompetitionContext | null
}

export type PaperMeta = Pick<PaperState, 'pairs' | 'fees' | 'startingBalance'> & {
  enabled: boolean
  market: Record<string, MarketTicker>
  marketMetadata?: Record<string, {
    category?: string
    base?: string
    quote?: string
    name?: string
    imageUrl?: string | null
  }>
}

export type Candle = {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume?: number
}

export type ApiHealth = {
  online: boolean
  latencyMs: number | null
}

async function apiFetch<T>(path: string, init?: RequestInit, token?: string | null): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  })

  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message =
      typeof payload?.error === 'string' ? payload.error : `Erreur API (${response.status})`
    throw new Error(message)
  }

  return payload as T
}

export async function getPublicCompetitions(): Promise<PublicCompetition[]> {
  const data = await apiFetch<{ competitions?: PublicCompetition[] }>('/api/competition/public')
  return Array.isArray(data.competitions) ? data.competitions : []
}

export function getBootstrap(token?: string | null): Promise<BootstrapData> {
  return apiFetch<BootstrapData>('/api/competition/bootstrap', undefined, token)
}

export async function getPromotions(lang = 'en'): Promise<Promotion[]> {
  if (promotionsLang !== lang) {
    promotionsCache = null
    promotionsLang = lang
  }
  if (promotionsCache) return promotionsCache
  if (typeof window !== 'undefined') {
    try {
      const cached = JSON.parse(window.localStorage.getItem(`${PROMOTIONS_CACHE_KEY}.${lang}`) || 'null') as {
        promotions?: Promotion[]
      } | null
      if (Array.isArray(cached?.promotions) && cached.promotions.length > 0) {
        promotionsCache = cached.promotions
        void refreshPromotions(lang)
        return promotionsCache
      }
    } catch {
      window.localStorage.removeItem(`${PROMOTIONS_CACHE_KEY}.${lang}`)
    }
  }
  return refreshPromotions(lang)
}

export async function getNewsPage(before?: number, limit = 20, force = false): Promise<{ news: NewsArticle[]; hasMore: boolean }> {
  if (!before && !force && typeof window !== 'undefined') {
    try {
      const cached = JSON.parse(window.localStorage.getItem(NEWS_CACHE_KEY) || 'null') as { news?: NewsArticle[] } | null
      if (cached?.news?.length) {
        void refreshNewsPage(undefined, limit)
        return { news: cached.news, hasMore: cached.news.length >= limit }
      }
    } catch {
      window.localStorage.removeItem(NEWS_CACHE_KEY)
    }
  }
  return refreshNewsPage(before, limit)
}

async function refreshNewsPage(before?: number, limit = 20): Promise<{ news: NewsArticle[]; hasMore: boolean }> {
  const query = new URLSearchParams({ limit: String(limit) })
  if (before) query.set('before', String(before))
  const result = await apiFetch<{ news?: NewsArticle[] }>(`/api/news?${query}`)
  const news = Array.isArray(result.news) ? result.news : []
  if (!before && typeof window !== 'undefined') {
    window.localStorage.setItem(NEWS_CACHE_KEY, JSON.stringify({ news, storedAt: Date.now() }))
  }
  return { news, hasMore: news.length >= limit }
}

export function getNewsArticle(id: string): Promise<NewsArticle> {
  return apiFetch<{ article: NewsArticle }>(`/api/news/${encodeURIComponent(id)}`).then((result) => result.article)
}

function refreshPromotions(lang = 'en'): Promise<Promotion[]> {
  if (promotionsRequest) return promotionsRequest
  const productionBase = API_BASE_URL.includes('btfarena.com') ? API_BASE_URL : 'https://btfarena.com'
  promotionsRequest = fetch(`${productionBase}/api/promotions?lang=${lang === 'fr' ? 'fr' : 'en'}`)
    .then(async (response) => {
      if (!response.ok) return promotionsCache || []
      const production = await response.json() as { promotions?: Promotion[] }
      const next = (Array.isArray(production.promotions) ? production.promotions : []).map((promotion) => ({
        ...promotion,
        photoUrl: promotion.photoUrl?.startsWith('/') ? `${productionBase}${promotion.photoUrl}` : promotion.photoUrl,
      }))
      if (next.length > 0) {
        promotionsCache = next
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(`${PROMOTIONS_CACHE_KEY}.${lang}`, JSON.stringify({ promotions: next, storedAt: Date.now() }))
        }
      }
      return promotionsCache || []
    })
    .catch(() => promotionsCache || [])
    .finally(() => { promotionsRequest = null })
  return promotionsRequest
}

export function requestAuthCode(input: {
  email: string
  intent: 'login' | 'signup'
  name?: string
  phone?: string
  consent?: boolean
}): Promise<AuthRequestResult> {
  return apiFetch<AuthRequestResult>('/api/competition/auth/request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export function verifyAuthCode(email: string, code: string): Promise<AuthVerifyResult> {
  return apiFetch<AuthVerifyResult>('/api/competition/auth/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, code }),
  })
}

export function verifyPhoneCode(email: string, code: string): Promise<{
  token: string
  user: SessionUser
}> {
  return apiFetch('/api/competition/auth/verify-phone', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, code }),
  })
}

export function loginTestAccount(): Promise<{ token: string; user: SessionUser }> {
  return apiFetch('/api/competition/auth/test-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'ARTEMTEST987' }),
  })
}

export function logoutSession(token: string): Promise<{ ok: true }> {
  return apiFetch('/api/competition/auth/logout', { method: 'POST' }, token)
}

export async function updateUserProfile(token: string, profile: {
  name: string
  phone?: string
  socials: NonNullable<SessionUser['socials']>
}): Promise<SessionUser> {
  const data = await apiFetch<{ user: SessionUser }>('/api/competition/me', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(profile),
  }, token)
  return data.user
}

export async function registerPushDevice(
  token: string,
  deviceToken: string,
  platform: 'ios' | 'android',
  environment: 'sandbox' | 'production' | 'auto',
): Promise<void> {
  await apiFetch('/api/competition/me/push-device', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: deviceToken, platform, environment }),
  }, token)
}

export async function unregisterPushDevice(token: string, deviceToken: string): Promise<void> {
  await apiFetch('/api/competition/me/push-device', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: deviceToken }),
  }, token)
}

export async function uploadUserAvatar(token: string, file: File): Promise<SessionUser> {
  const form = new FormData()
  form.append('avatar', file, file.name || 'avatar.jpg')
  const data = await apiFetch<{ user: SessionUser }>('/api/competition/me/avatar', {
    method: 'POST',
    body: form,
  }, token)
  return data.user
}

export async function getMyTrades(token: string): Promise<JournalTrade[]> {
  const data = await apiFetch<{ trades?: JournalTrade[] }>(
    '/api/competition/my-trades',
    undefined,
    token,
  )
  return Array.isArray(data.trades) ? data.trades : []
}

export async function getGlobalChatMessages(token: string, before?: number): Promise<GlobalChatMessage[]> {
  const query = before ? `?before=${encodeURIComponent(before)}` : ''
  const data = await apiFetch<{ messages?: GlobalChatMessage[] }>(
    `/api/competition/chat/messages${query}`,
    undefined,
    token,
  )
  return Array.isArray(data.messages) ? data.messages : []
}

export async function sendGlobalChatMessage(
  token: string,
  body: string,
  replyToId?: string,
  imageUrl?: string,
): Promise<GlobalChatMessage> {
  const data = await apiFetch<{ message: GlobalChatMessage }>('/api/competition/chat/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body, replyToId, imageUrl }),
  }, token)
  return data.message
}

export async function uploadChatImage(token: string, file: File): Promise<string> {
  const form = new FormData()
  form.append('image', file, file.name || 'photo.jpg')
  const data = await apiFetch<{ imageUrl?: string }>('/api/competition/chat/images', {
    method: 'POST',
    body: form,
  }, token)
  if (!data.imageUrl) throw new Error('Upload impossible')
  return data.imageUrl
}

export function globalChatWebSocketUrl(token: string): string {
  return `${API_WS_URL}/ws/chat?token=${encodeURIComponent(token)}`
}

export function createPaperSession(
  accountToken: string,
  competitionId: string,
): Promise<PaperSession> {
  return apiFetch('/api/competition/trade/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ competitionId }),
  }, accountToken)
}

export function getPaperState(paperToken: string): Promise<PaperState> {
  return apiFetch('/api/paper/me', undefined, paperToken)
}

export function getPaperMeta(): Promise<PaperMeta> {
  return apiFetch('/api/paper/meta')
}

export async function getCompetitionLeaderboard(competitionId: string): Promise<LeaderboardRow[]> {
  const data = await apiFetch<{ leaderboard?: LeaderboardRow[] }>(
    `/api/competition/leaderboard/${encodeURIComponent(competitionId)}`,
  )
  return Array.isArray(data.leaderboard) ? data.leaderboard : []
}

export async function getLeaderboardSeasons(): Promise<{ seasons: LeaderboardSeason[]; activeSeasonId: string | null }> {
  return apiFetch('/api/competition/seasons')
}

export async function getGlobalLeaderboard(seasonId?: string): Promise<GlobalLeaderboardRow[]> {
  const query = seasonId ? `season=${encodeURIComponent(seasonId)}` : 'scope=all'
  const data = await apiFetch<{ rows?: GlobalLeaderboardRow[] }>(`/api/competition/global-leaderboard?${query}`)
  return Array.isArray(data.rows) ? data.rows : []
}

export async function getRatingLeaderboard(): Promise<RatingLeaderboardRow[]> {
  const data = await apiFetch<{ rows?: RatingLeaderboardRow[] }>('/api/competition/rating-leaderboard')
  return Array.isArray(data.rows) ? data.rows : []
}

export function getPublicPlayerProfile(userId: string): Promise<PublicPlayerProfile> {
  return apiFetch(`/api/competition/player/${encodeURIComponent(userId)}`)
}

export function joinCompetition(token: string, input: {
  competitionId: string
  code?: string
  sponsorAccountId?: string
}): Promise<{ ok: true; competitionId: string }> {
  return apiFetch('/api/competition/join', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }, token)
}

export async function getPaperCandles(pair: string): Promise<Candle[]> {
  const data = await apiFetch<{ candles?: Candle[] }>(
    `/api/paper/candles?pair=${encodeURIComponent(pair)}&interval=1&countBack=48`,
  )
  return Array.isArray(data.candles) ? data.candles : []
}

export function placePaperOrder(paperToken: string, order: {
  pair: string
  side: 'long' | 'short'
  size: number
  orderType: 'market' | 'limit'
  limitPrice: number | null
  leverage: number
  stopLoss: number | null
  takeProfit: number | null
}): Promise<{ ok: true }> {
  return apiFetch('/api/paper/order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(order),
  }, paperToken)
}

export function closePaperPosition(
  paperToken: string,
  positionId: string,
  size?: number | null,
): Promise<{ ok: true; alreadyClosed?: boolean }> {
  return apiFetch('/api/paper/close', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ positionId, size: size ?? null }),
  }, paperToken)
}

export function cancelPaperOrder(
  paperToken: string,
  orderId: string,
): Promise<{ ok: true; alreadyClosed?: boolean }> {
  return apiFetch('/api/paper/cancel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderId }),
  }, paperToken)
}

export function updatePaperRisk(
  paperToken: string,
  input: {
    positionId?: string
    orderId?: string
    stopLoss: number | null
    takeProfit: number | null
    stopLossSize?: number | null
    takeProfitSize?: number | null
  },
): Promise<{ ok: true; alreadyClosed?: boolean }> {
  return apiFetch('/api/paper/risk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }, paperToken)
}

export function updatePaperOrderLimit(
  paperToken: string,
  orderId: string,
  limitPrice: number,
): Promise<{ ok: true; alreadyClosed?: boolean }> {
  return apiFetch('/api/paper/order/limit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderId, limitPrice }),
  }, paperToken)
}

export async function checkApiHealth(): Promise<ApiHealth> {
  const startedAt = performance.now()
  try {
    await getPublicCompetitions()
    return {
      online: true,
      latencyMs: Math.round(performance.now() - startedAt),
    }
  } catch {
    return { online: false, latencyMs: null }
  }
}

export { API_BASE_URL, API_WS_URL }
