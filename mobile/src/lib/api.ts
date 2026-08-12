const API_BASE_URL = (
  import.meta.env.VITE_API_URL ||
  'https://btf-mobile-staging-production.up.railway.app'
).replace(/\/$/, '')
const API_WS_URL = API_BASE_URL.replace(/^http/, 'ws')

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
}

export type UserBadge =
  | 'btf2026'
  | 'champion'
  | 'paris-champion'
  | 'summer-champion'
  | 'autumn-champion'

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

export type MyCompetition = PublicCompetition & {
  breached?: boolean
  rank?: number | null
  myEntry: {
    pnlUsd: number
    pnlPercent: number
    tradesCount: number
  }
}

export type BootstrapData = {
  user: SessionUser | null
  publicCompetitions: PublicCompetition[]
  myCompetitions: MyCompetition[]
  myStats: UserStats | null
  myBadges: UserBadge[]
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
  liquidationPrice: number | null
  stopLoss: number | null
  takeProfit: number | null
}

export type PaperOrder = {
  id: string
  pair: string
  side: 'long' | 'short'
  size: number
  orderType: 'market' | 'limit'
  status: 'open' | 'filled' | 'cancelled'
  limitPrice: number | null
  leverage: number
  marginReserved: number
  createdAt: number
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

export async function getMyTrades(token: string): Promise<JournalTrade[]> {
  const data = await apiFetch<{ trades?: JournalTrade[] }>(
    '/api/competition/my-trades',
    undefined,
    token,
  )
  return Array.isArray(data.trades) ? data.trades : []
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
