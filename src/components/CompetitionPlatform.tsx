import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { MouseEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';
import Seo from './Seo';
import CompeteHeader from './CompeteHeader';
import MobileHome from './MobileHome';
import HomeSeasonBoard from './HomeSeasonBoard';
import HomeBonusBanner from './HomeBonusBanner';
import { useIsMobileWeb } from '../lib/mobileWeb';
import {
  AnimatedNumber,
  MetricCard,
  formatCompactSigned,
  formatCompactUnsigned,
  formatPercent,
} from './competeMetrics';
import OptimizedImage, { AvatarImage } from './OptimizedImage';
import { NameBadges, getBadgeVisual, type UserBadge } from './playerBadges';
import {
  DIVISION_COLORS,
  DivisionBadge,
  divisionDisplayName,
  divisionProgress,
  type PlayerRating,
} from './playerRating';
import { formatDHMS } from '../utils/formatters';
import { newsCoverUrl, resolveMediaUrl } from '../utils/imageUrl';
import { fetchPublicNews } from '../lib/publicNews';
import { localizeNews } from '../lib/newsLocale';
import { getSponsor, ninjaTraderCupBanner, normalizeSponsorAccountId, resolveArenaBrand } from '../lib/sponsors';
import { countryFlag } from '../lib/country';
import { analytics } from '../lib/analytics';
import { buildArenaItemListJsonLd } from '../lib/structuredData';
import {
  clearPaperSessionToken,
  LEGACY_PAPER_SESSION_KEY,
  writePaperBootstrapCache,
  writePaperSessionToken,
} from '../lib/paperSession';
import {
  COMPETE_SESSION_KEY,
  mergeSessionUser,
  readCachedCompeteUser,
  writeCachedCompeteUser,
  type CompeteSessionUser,
} from '../lib/competeSession';

const SESSION_KEY = COMPETE_SESSION_KEY;
const ENABLE_TEST_LOGIN = import.meta.env.DEV || import.meta.env.VITE_ENABLE_TEST_LOGIN === 'true';

function readCachedUser(): CompeteSessionUser | null {
  return readCachedCompeteUser();
}

function writeCachedUser(user: CompeteSessionUser | null): void {
  writeCachedCompeteUser(user);
}

function readCachedJSON<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeCachedJSON<T>(key: string, value: T): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

const PUBLIC_CACHE_KEY = 'btf-comp-public-cache';
const MINE_CACHE_KEY = 'btf-comp-mine-cache';
interface CashPrizeItem {
  rank?: number;
  imageUrl?: string;
  title?: string;
  description?: string;
}

interface CashPrize {
  currency: string;
  total: number;
  breakdown?: Array<{ rank: number; amount: number }>;
  label?: string;
  imageUrl?: string;
  description?: string;
  items?: CashPrizeItem[];
}

interface CompetitionPublic {
  id: string;
  title: string;
  code: string;
  executionMode: 'paper' | 'real';
  startAt: number;
  endAt: number;
  registrationEndsAt?: number;
  dailyDrawdownPercent?: number | null;
  isPublic: boolean;
  participants: number;
  status: 'registration' | 'starting_soon' | 'live' | 'ended';
  canJoin?: boolean;
  canTrade?: boolean;
  cashPrize?: CashPrize | null;
  sponsor?: string | null;
  sponsorReferralUrl?: string | null;
  sponsorName?: string | null;
  sponsorLogoUrl?: string | null;
  bannerImageUrl?: string | null;
  bannerHref?: string | null;
  entryMode?: 'solo' | 'team';
  teamSize?: number | null;
}

interface CompetitionMine {
  id: string;
  title: string;
  code: string;
  executionMode: 'paper' | 'real';
  startAt: number;
  endAt: number;
  registrationEndsAt?: number;
  dailyDrawdownPercent?: number | null;
  status: 'registration' | 'starting_soon' | 'live' | 'ended';
  canJoin?: boolean;
  canTrade?: boolean;
  breached?: boolean;
  myEntry: {
    pnlUsd: number;
    pnlPercent: number;
    tradesCount: number;
  };
  cashPrize?: CashPrize | null;
  participants?: number;
  rank?: number | null;
  sponsor?: string | null;
  sponsorName?: string | null;
  sponsorLogoUrl?: string | null;
  seasonId?: string | null;
  bannerImageUrl?: string | null;
  bannerHref?: string | null;
}

interface SeasonInfo {
  id: string;
  nameKey: string;
  startAt: number;
  endAt: number;
  isActive: boolean;
  status: 'upcoming' | 'active' | 'ended';
  theme?: string;
  homeBannerImage?: string | null;
  championBadge?: UserBadge;
  shirtImage?: string | null;
  arenaImage?: string | null;
}

type HomeNewsArticle = {
  id: string;
  title: string;
  summary: string;
  body: string;
  titleEn?: string;
  summaryEn?: string;
  bodyEn?: string;
  coverUrl: string;
  featured: boolean;
  publishedAt: number;
  createdAt: number;
};

interface UserStats {
  closedTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  grossProfit: number;
  grossLoss: number;
  profitFactor: number | null;
  avgWin: number;
  avgLoss: number;
  avgRR: number | null;
  netPnl: number;
}

type SessionUser = CompeteSessionUser;

type AuthIntent = 'login' | 'signup';
type AuthStep = 'request' | 'verify-email' | 'verify-phone';

interface PendingAuth {
  intent: AuthIntent;
  email: string;
  expiresAt: number;
  devCode?: string;
  delivered: boolean;
  deliveryError?: string;
  phoneMasked?: string;
  smsDelivered?: boolean;
  smsError?: string;
  devSmsCode?: string;
}

function dateLocale(): string {
  return i18n.resolvedLanguage === 'fr' ? 'fr-FR' : 'en-US';
}

/** Arène de qualification (ex. "BTF QUALIFICATIONS") — exclue des stats profil. */
function isQualificationCompetition(title: string | undefined | null): boolean {
  return /qualif/i.test(String(title || ''));
}

function fmtDateShort(value: number): string {
  return new Date(value).toLocaleDateString(dateLocale(), { day: '2-digit', month: 'short' });
}

function fmtDateTime(value: number): string {
  return new Date(value).toLocaleString(dateLocale(), { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * Bloc d'info planning : rappelle quand les inscriptions se terminent et quand
 * le trading démarre. Affiché uniquement avant le départ (inscription / bientôt).
 */
function ScheduleInfo({
  startAt,
  registrationEndsAt,
  status,
  className = '',
}: {
  startAt: number;
  registrationEndsAt?: number;
  status: 'registration' | 'starting_soon' | 'live' | 'ended';
  className?: string;
}) {
  const { t } = useTranslation();
  if (status === 'live' || status === 'ended') return null;
  const regEnd = registrationEndsAt ?? startAt;
  const regClosed = Date.now() >= regEnd;
  return (
    <div className={`space-y-1.5 rounded-lg border border-[#241e30] bg-white/[0.02] px-3 py-2.5 text-[11px] leading-tight text-[#a1a1aa] sm:text-xs ${className}`}>
      <div className="flex items-center gap-2">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-[#dc6a6a]">
          <rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" />
        </svg>
        <span>
          {regClosed
            ? t('publicCard.registrationClosed')
            : <>{t('publicCard.registrationEnds')} <span className="font-semibold text-white">{fmtDateTime(regEnd)}</span></>}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-[#34d399]">
          <polygon points="5 3 19 12 5 21 5 3" />
        </svg>
        <span>{t('publicCard.tradingStarts')} <span className="font-semibold text-white">{fmtDateTime(startAt)}</span></span>
      </div>
    </div>
  );
}

/**
 * Affiche la règle de drawdown journalier d'une arène (si définie).
 * `variant="badge"` → pastille compacte pour les cartes ; `variant="block"` →
 * encart détaillé pour la modale d'inscription.
 */
function DrawdownRule({
  percent,
  variant = 'badge',
  className = '',
}: {
  percent?: number | null;
  variant?: 'badge' | 'block';
  className?: string;
}) {
  const { t } = useTranslation();
  if (percent == null || percent <= 0) return null;

  if (variant === 'badge') {
    return (
      <span
        className={`inline-flex items-center gap-1.5 rounded-md border border-[#ef4444]/30 bg-[#ef4444]/10 px-2 py-1 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[#fca5a5] ${className}`}
        title={t('joinModal.dailyDrawdownRuleDesc', { percent })}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 17l6-6 4 4 8-8" /><path d="M21 7v6h-6" />
        </svg>
        {t('publicCard.dailyDrawdown')} {percent}%
      </span>
    );
  }

  return (
    <div className={`rounded-lg border border-[#ef4444]/30 bg-[#ef4444]/8 px-3 py-2.5 ${className}`}>
      <div className="flex items-center gap-2 text-[12px] font-semibold text-[#fca5a5]">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
          <path d="M3 17l6-6 4 4 8-8" /><path d="M21 7v6h-6" />
        </svg>
        {t('joinModal.dailyDrawdownRule', { percent })}
      </div>
      <p className="mt-1 text-[11px] leading-snug text-[#a1a1aa]">
        {t('joinModal.dailyDrawdownRuleDesc', { percent })}
      </p>
    </div>
  );
}

function useCountdown(target: number): string {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return formatDHMS(target - now, i18n.language.startsWith('fr') ? 'j' : 'd');
}

function formatPrizeAmount(amount: number, currency: string): string {
  const value = Math.round(amount).toLocaleString('en-US').replace(/,/g, ' ');
  return `${value} ${currency}`;
}

function getPrizeTitle(prize: CashPrize | null | undefined): string {
  if (!prize) return '';
  if (prize.label) return prize.label;
  if (prize.total > 0) return formatPrizeAmount(prize.total, prize.currency);
  return '';
}

function hasPrize(prize: CashPrize | null | undefined): prize is CashPrize {
  return Boolean(
    prize && (prize.label || prize.imageUrl || prize.total > 0 || (prize.items && prize.items.length > 0)),
  );
}

function prizeItemKey(item: CashPrizeItem): string {
  return `${item.title || ''}\n${item.imageUrl || ''}\n${item.description || ''}`;
}

function groupPrizeItems(items: CashPrizeItem[]): Array<{ item: CashPrizeItem; ranks: number[] }> {
  const ranked = items
    .filter((item) => Number(item.rank) > 0)
    .sort((a, b) => Number(a.rank) - Number(b.rank));
  const groups: Array<{ item: CashPrizeItem; ranks: number[] }> = [];
  for (const item of ranked) {
    const last = groups[groups.length - 1];
    if (last && prizeItemKey(last.item) === prizeItemKey(item)) {
      if (item.rank) last.ranks.push(item.rank);
    } else {
      groups.push({ item, ranks: item.rank ? [item.rank] : [] });
    }
  }
  return groups;
}

function PrizePreview({ prize, compact = false }: { prize: CashPrize | null | undefined; compact?: boolean }) {
  const { t } = useTranslation();
  if (!hasPrize(prize)) return null;
  const items = prize.items || [];
  const firstItem = items[0];
  const title = getPrizeTitle(prize) || firstItem?.title || '';
  const displayImage = prize.imageUrl || firstItem?.imageUrl || '';
  const extraLots = prize.imageUrl ? items.length : Math.max(items.length - 1, 0);
  return (
    <div className={`flex items-center gap-3 rounded-2xl border border-amber-500/20 bg-amber-500/8 ${compact ? 'mt-3 p-2.5' : 'mt-4 p-3'}`}>
      {displayImage ? (
        <OptimizedImage
          src={displayImage}
          alt={title || t('prize.rewardAlt')}
          className={`${compact ? 'h-12 w-12' : 'h-16 w-16'} shrink-0 rounded-xl border border-amber-400/25 object-cover`}
          displayWidth={compact ? 96 : 128}
        />
      ) : (
        <div className={`${compact ? 'h-12 w-12' : 'h-16 w-16'} flex shrink-0 items-center justify-center rounded-xl border border-amber-400/25 bg-[#241a05] text-amber-200`}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20 12v8H4v-8" />
            <path d="M2 7h20v5H2z" />
            <path d="M12 22V7" />
            <path d="M12 7H7.5a2.5 2.5 0 1 1 2.1-3.85C10.6 4.55 12 7 12 7Z" />
            <path d="M12 7h4.5a2.5 2.5 0 1 0-2.1-3.85C13.4 4.55 12 7 12 7Z" />
          </svg>
        </div>
      )}
      <div className="min-w-0">
        <div className="micro text-[9px] text-amber-300/85">{t('prize.toWin')}</div>
        <div className="truncate text-sm font-bold text-white sm:text-base">{title}</div>
        {prize.total > 0 && prize.label && (
          <div className="mt-0.5 text-[11px] text-amber-100/60">{formatPrizeAmount(prize.total, prize.currency)}</div>
        )}
        {extraLots > 0 && (
          <div className="mt-0.5 text-[11px] font-semibold text-amber-300/80">{t('prize.moreLots', { count: extraLots })}</div>
        )}
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: CompetitionPublic['status'] }) {
  const { t } = useTranslation();
  if (status === 'live') {
    return (
      <span className="pill pill-live">
        <span className="live-dot" />
        {t('status.live')}
      </span>
    );
  }
  if (status === 'registration') return <span className="pill pill-coming">{t('status.registration')}</span>;
  if (status === 'starting_soon') return <span className="pill pill-coming">{t('status.startingSoon')}</span>;
  return <span className="pill pill-ended">{t('status.ended')}</span>;
}

function ModePill({ mode }: { mode: 'paper' | 'real' }) {
  const { t } = useTranslation();
  return <span className={`pill ${mode === 'real' ? 'pill-real' : 'pill-paper'}`}>{mode === 'paper' ? t('mode.paper') : t('mode.real')}</span>;
}

function scrollToCompeteSection(event: MouseEvent<HTMLAnchorElement>, targetId: string) {
  event.preventDefault();
  const target = document.getElementById(targetId);
  if (!target) return;

  const header = document.querySelector('.compete-header') as HTMLElement | null;
  const headerOffset = (header?.offsetHeight ?? 64) + 8;
  const top = window.scrollY + target.getBoundingClientRect().top - headerOffset;

  window.scrollTo({
    top: Math.max(top, 0),
    behavior: 'smooth',
  });
  window.history.replaceState(null, '', `#${targetId}`);
}

export default function CompetitionPlatform() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { t, i18n } = useTranslation();
  const isMobileWeb = useIsMobileWeb();
  // Initialise the session synchronously from localStorage so authenticated
  // users see their data immediately on refresh, without waiting for the
  // backend to come back. We then validate in the background and clear the
  // cached state if the session is no longer accepted.
  const [session, setSession] = useState<{ token: string; user: SessionUser } | null>(() => {
    const token = window.localStorage.getItem(SESSION_KEY);
    const cachedUser = readCachedUser();
    if (token && cachedUser) return { token, user: cachedUser };
    return null;
  });

  const [intent, setIntent] = useState<AuthIntent>('login');
  const [step, setStep] = useState<AuthStep>('request');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [smsOtp, setSmsOtp] = useState('');
  const [consent, setConsent] = useState(false);
  const [pendingAuth, setPendingAuth] = useState<PendingAuth | null>(null);

  // Hydrate competition lists from localStorage too so the page renders
  // populated even before the bootstrap response arrives.
  const [publicCompetitions, setPublicCompetitions] = useState<CompetitionPublic[]>(
    () => readCachedJSON<CompetitionPublic[]>(PUBLIC_CACHE_KEY) || [],
  );
  const [myCompetitions, setMyCompetitions] = useState<CompetitionMine[]>(
    () => readCachedJSON<CompetitionMine[]>(MINE_CACHE_KEY) || [],
  );
  const [myStats, setMyStats] = useState<UserStats | null>(null);
  const [myBadges, setMyBadges] = useState<UserBadge[]>([]);
  const [myRating, setMyRating] = useState<PlayerRating | null>(null);
  const [seasons, setSeasons] = useState<SeasonInfo[]>([]);
  const [latestNews, setLatestNews] = useState<HomeNewsArticle[]>([]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [joinTarget, setJoinTarget] = useState<CompetitionPublic | null>(null);
  const [joinCode, setJoinCode] = useState('');
  const [joinSponsorId, setJoinSponsorId] = useState('');
  const [joinError, setJoinError] = useState('');

  // Récupère (ou rafraîchit) l'état complet de la plateforme : user + public + mine.
  // Réutilisable au montage et à la volée (ex. quand un timer de départ atteint 0).
  const refreshData = useCallback(async () => {
    const token = window.localStorage.getItem(SESSION_KEY);
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;

    try {
      const response = await fetch('/api/competition/bootstrap', { headers });
      if (!response.ok) return;
      const data = await response.json();
      if (!data) return;

      const publicComps: CompetitionPublic[] = data.publicCompetitions || [];
      const mineComps: CompetitionMine[] = data.myCompetitions || [];
      setPublicCompetitions(publicComps);
      setMyCompetitions(mineComps);
      setMyStats((data.myStats as UserStats | null) ?? null);
      setMyBadges((data.myBadges as UserBadge[] | undefined) ?? []);
      setMyRating((data.myRating as PlayerRating | null) ?? null);
      writeCachedJSON(PUBLIC_CACHE_KEY, publicComps);
      writeCachedJSON(MINE_CACHE_KEY, mineComps);

      if (token) {
        if (data.user) {
          const merged = mergeSessionUser(readCachedCompeteUser(), data.user as CompeteSessionUser);
          setSession({ token, user: merged });
          writeCachedCompeteUser(merged);
        } else {
          // Token rejected by server -> clear the optimistic session.
          window.localStorage.removeItem(SESSION_KEY);
          writeCachedUser(null);
          setSession(null);
          setMyCompetitions([]);
          setMyStats(null);
          writeCachedJSON(MINE_CACHE_KEY, []);
        }
      }
    } catch {
      // Network failure: keep the optimistic state so the UI stays usable.
    }
  }, []);

  // Single bootstrap call on mount: returns user + public + mine in one
  // round-trip, eliminating the cascade of cold starts that used to slow
  // down the page after a refresh.
  useEffect(() => {
    // Ne jamais réutiliser une ancienne clé unique qui pouvait contenir une session LIVE.
    window.localStorage.removeItem(LEGACY_PAPER_SESSION_KEY);
    void refreshData();
    void fetch('/api/competition/seasons')
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (Array.isArray(payload?.seasons)) setSeasons(payload.seasons as SeasonInfo[]);
      })
      .catch(() => undefined);
  }, [refreshData]);

  // Re-sync depuis le cache quand on revient sur l'onglet (ex. après Settings).
  useEffect(() => {
    function syncSessionFromCache() {
      const token = window.localStorage.getItem(SESSION_KEY);
      const cached = readCachedCompeteUser();
      if (!token || !cached) return;
      setSession((prev) => {
        if (!prev || prev.token !== token) return { token, user: cached };
        return { token, user: mergeSessionUser(prev.user, cached) };
      });
    }

    function onVisibilityChange() {
      if (document.visibilityState === 'visible') syncSessionFromCache();
    }

    window.addEventListener('focus', syncSessionFromCache);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('focus', syncSessionFromCache);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  // Keep the cached user in sync if it changes (e.g. profile update).
  useEffect(() => {
    if (session?.user) writeCachedCompeteUser(session.user);
  }, [session?.user]);

  useEffect(() => {
    let cancelled = false;
    void fetchPublicNews(2)
      .then((news) => {
        if (!cancelled) setLatestNews(news as HomeNewsArticle[]);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  async function refreshPublicCompetitions() {
    const response = await fetch('/api/competition/public');
    const data = await response.json();
    const list = data.competitions || [];
    setPublicCompetitions(list);
    writeCachedJSON(PUBLIC_CACHE_KEY, list);
  }

  async function refreshMyCompetitions(token: string) {
    const response = await fetch('/api/competition/mine', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return;
    const data = await response.json();
    const list = data.competitions || [];
    setMyCompetitions(list);
    writeCachedJSON(MINE_CACHE_KEY, list);
  }

  function switchIntent(next: AuthIntent) {
    setIntent(next);
    setStep('request');
    setOtp('');
    setSmsOtp('');
    setPendingAuth(null);
    setError('');
  }

  function resetAuth() {
    setStep('request');
    setEmail('');
    setName('');
    setPhone('');
    setOtp('');
    setSmsOtp('');
    setPendingAuth(null);
  }

  async function requestCode() {
    setBusy(true);
    setError('');
    try {
      // Backdoor compte de test : si le pseudo magique est tapé dans
      // le champ email (intent login), on bypass complètement l'OTP.
      const trimmedEmail = email.trim();
      if (ENABLE_TEST_LOGIN && intent === 'login' && trimmedEmail === 'ARTEMTEST987') {
        const response = await fetch('/api/competition/auth/test-login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: trimmedEmail }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || t('authErrors.testLogin'));
        window.localStorage.setItem(SESSION_KEY, data.token);
        writeCachedUser(data.user);
        setSession({ token: data.token, user: data.user });
        void refreshMyCompetitions(data.token);
        resetAuth();
        return;
      }

      const response = await fetch('/api/competition/auth/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          name,
          phone: intent === 'signup' ? phone : undefined,
          intent,
          ...(intent === 'signup' ? { consent } : {}),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || t('authErrors.request'));
      setPendingAuth({
        intent,
        email: String(data.email || email).trim(),
        expiresAt: Number(data.expiresAt) || Date.now() + 10 * 60 * 1000,
        devCode: data.devCode,
        delivered: Boolean(data.delivered),
        deliveryError: data.deliveryError,
      });
      setStep('verify-email');
      setOtp('');
    } catch (err: any) {
      setError(err.message || t('common.unknownError'));
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode() {
    if (!pendingAuth) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/competition/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: pendingAuth.email, code: otp }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || t('authErrors.verify'));

      if (data.needsPhone) {
        setPendingAuth({
          ...pendingAuth,
          phoneMasked: data.phoneMasked,
          smsDelivered: Boolean(data.smsDelivered),
          smsError: data.smsError,
          devSmsCode: data.devSmsCode,
        });
        setStep('verify-phone');
        setSmsOtp('');
        return;
      }

      window.localStorage.setItem(SESSION_KEY, data.token);
      writeCachedUser(data.user);
      setSession({ token: data.token, user: data.user });
      analytics.login('email');
      void refreshMyCompetitions(data.token);
      resetAuth();
    } catch (err: any) {
      setError(err.message || t('common.unknownError'));
    } finally {
      setBusy(false);
    }
  }

  async function verifyPhoneCode() {
    if (!pendingAuth) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/competition/auth/verify-phone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: pendingAuth.email, code: smsOtp }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || t('authErrors.verifySms'));
      window.localStorage.setItem(SESSION_KEY, data.token);
      writeCachedUser(data.user);
      setSession({ token: data.token, user: data.user });
      analytics.signUp('email');
      void refreshMyCompetitions(data.token);
      resetAuth();
    } catch (err: any) {
      setError(err.message || t('common.unknownError'));
    } finally {
      setBusy(false);
    }
  }

  function logout() {
    const token = window.localStorage.getItem(SESSION_KEY);
    // Révocation serveur de la session (best-effort) en plus du nettoyage local.
    if (token) {
      void fetch('/api/competition/auth/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => undefined);
    }
    window.localStorage.removeItem(SESSION_KEY);
    clearPaperSessionToken();
    writeCachedUser(null);
    writeCachedJSON(MINE_CACHE_KEY, []);
    setSession(null);
    setMyCompetitions([]);
  }

  function openJoinModal(competition: CompetitionPublic) {
    if (!session) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      setError(t('authErrors.loginToJoin'));
      return;
    }
    setJoinTarget(competition);
    setJoinCode('');
    setJoinSponsorId('');
    setJoinError('');
  }

  function closeJoinModal() {
    setJoinTarget(null);
    setJoinCode('');
    setJoinSponsorId('');
    setJoinError('');
  }

  async function submitJoin() {
    if (!session || !joinTarget) return;
    const sponsor = getSponsor(joinTarget.sponsor);
    if (sponsor?.requiresAccountId) {
      if (!joinSponsorId.trim()) {
        setJoinError(
          sponsor.accountIdType === 'email'
            ? t('sponsor.missingEmail', { name: sponsor.name })
            : t('sponsor.missingId', { name: sponsor.name }),
        );
        return;
      }
      if (sponsor.validateAccountId && !sponsor.validateAccountId(joinSponsorId)) {
        setJoinError(
          sponsor.accountIdType === 'email'
            ? t('sponsor.emailInvalid')
            : t('sponsor.idInvalid', { name: sponsor.name, example: sponsor.accountIdExample || '' }),
        );
        return;
      }
    }
    setBusy(true);
    setJoinError('');
    try {
      const response = await fetch(
        '/api/competition/join',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.token}`,
          },
          body: JSON.stringify({
            code: joinCode,
            competitionId: joinTarget.id,
            ...(sponsor?.requiresAccountId
              ? { sponsorAccountId: normalizeSponsorAccountId(joinSponsorId, sponsor) }
              : {}),
          }),
        },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || t('authErrors.join'));
      if (data.competitionId !== joinTarget.id) {
        throw new Error(t('authErrors.codeMismatch'));
      }
      analytics.competitionJoin({
        competitionId: joinTarget.id,
        competitionName: joinTarget.title,
        sponsor: joinTarget.sponsor ?? undefined,
      });
      await Promise.all([
        refreshPublicCompetitions(),
        refreshMyCompetitions(session.token),
      ]);
      closeJoinModal();
    } catch (err: any) {
      setJoinError(err.message || t('common.unknownError'));
    } finally {
      setBusy(false);
    }
  }

  function buildTradeUrl(competition: CompetitionMine): string {
    const params = new URLSearchParams();
    params.set('competitionId', competition.id);
    params.set('competitionTitle', competition.title);
    params.set('competitionMode', competition.executionMode);
    return `/trade?${params.toString()}`;
  }

  async function startCompetitionTrading(competition: CompetitionMine) {
    if (!session) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/competition/trade/session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.token}`,
        },
        body: JSON.stringify({ competitionId: competition.id }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || t('authErrors.tradingAccess'));
      writePaperSessionToken('compete', data.token);
      if (data.player) {
        writePaperBootstrapCache({
          token: data.token,
          player: data.player,
          platform: 'compete',
          competitionId: competition.id,
          competition: data.competition || null,
          market: data.market || null,
          canTrade: typeof data.canTrade === 'boolean' ? data.canTrade : null,
        });
      }
      // SPA navigation keeps the React tree alive (no full reload, no JS
      // re-parse). Combined with the bootstrap cache above, the terminal
      // mounts already populated.
      navigate(buildTradeUrl(competition));
    } catch (err: any) {
      setError(err.message || t('common.unknownError'));
    } finally {
      setBusy(false);
    }
  }

  const activeMyCompetitions = useMemo(
    () => myCompetitions.filter((competition) => competition.status !== 'ended'),
    [myCompetitions],
  );
  const joinablePublicCompetitions = useMemo(
    () => {
      const joinedIds = new Set(myCompetitions.map((competition) => competition.id));
      return publicCompetitions.filter((competition) => (
        competition.status !== 'ended'
        && competition.entryMode !== 'team'
        && !joinedIds.has(competition.id)
      ));
    },
    [myCompetitions, publicCompetitions],
  );

  useEffect(() => {
    const arenaId = searchParams.get('arena');
    const joinFirst = searchParams.get('join') === '1';
    if (!arenaId && !joinFirst) return;
    if (publicCompetitions.length === 0) return;

    const competition = arenaId
      ? publicCompetitions.find((item) => item.id === arenaId)
      : publicCompetitions.find((item) => (
        item.status !== 'ended'
        && item.entryMode !== 'team'
        && (item.status === 'registration' || item.canJoin === true)
      ));

    if (!competition || competition.status === 'ended') {
      const next = new URLSearchParams(searchParams);
      next.delete('arena');
      next.delete('join');
      setSearchParams(next, { replace: true });
      return;
    }

    if (!session) {
      document.getElementById('signup')?.scrollIntoView({ behavior: 'smooth' });
      return;
    }

    setJoinTarget(competition);
    setJoinCode('');
    setJoinSponsorId('');
    setJoinError('');
    const next = new URLSearchParams(searchParams);
    next.delete('arena');
    next.delete('join');
    setSearchParams(next, { replace: true });
  }, [publicCompetitions, searchParams, session, setSearchParams]);
  // Les stats du profil n'incluent pas les arènes de qualification (ex. BTF
  // QUALIFICATIONS) — cohérent avec le leaderboard global.
  const statsCompetitions = useMemo(
    () => myCompetitions.filter((competition) => !isQualificationCompetition(competition.title)),
    [myCompetitions],
  );
  const totalPnl = useMemo(() => statsCompetitions.reduce((acc, entry) => acc + entry.myEntry.pnlUsd, 0), [statsCompetitions]);
  const avgPnlPct = useMemo(() => {
    if (statsCompetitions.length === 0) return 0;
    return statsCompetitions.reduce((acc, entry) => acc + entry.myEntry.pnlPercent, 0) / statsCompetitions.length;
  }, [statsCompetitions]);

  const arenaJsonLd = useMemo(() => {
    const arenas = publicCompetitions
      .filter((c) => c.status !== 'ended')
      .map((c) => ({
        id: c.id,
        title: c.title,
        startAt: c.startAt,
        endAt: c.endAt,
        status: c.status,
        bannerImageUrl: c.bannerImageUrl ?? null,
        prizeLabel: hasPrize(c.cashPrize) ? getPrizeTitle(c.cashPrize) : null,
      }));
    return arenas.length > 0 ? buildArenaItemListJsonLd(arenas) : undefined;
  }, [publicCompetitions]);

  const activeSeason = useMemo(
    () => seasons.find((season) => season.status === 'active') || seasons.find((season) => season.isActive) || null,
    [seasons],
  );

  const authPanel = !session ? (
    <AuthPanel
      intent={intent}
      step={step}
      email={email}
      name={name}
      phone={phone}
      otp={otp}
      smsOtp={smsOtp}
      consent={consent}
      busy={busy}
      error={error}
      pendingAuth={pendingAuth}
      onSwitch={switchIntent}
      onEmail={setEmail}
      onName={setName}
      onPhone={setPhone}
      onConsent={setConsent}
      onOtp={setOtp}
      onSmsOtp={setSmsOtp}
      onRequest={requestCode}
      onVerify={verifyCode}
      onVerifyPhone={verifyPhoneCode}
      onBack={() => { setStep('request'); setError(''); }}
    />
  ) : null;

  return (
    <div className="compete min-h-dvh-safe bg-[#050507]">
      <Seo
        title={t('seo.homeTitle')}
        description={t('seo.homeDesc')}
        keywords={t('seo.homeKeywords')}
        path="/compete"
        jsonLd={arenaJsonLd}
      />
      <CompeteHeader user={session?.user || null} onLogout={logout} />

      {isMobileWeb ? (
        <MobileHome
          user={session?.user || null}
          rating={myRating}
          stats={myStats}
          totalPnl={totalPnl}
          arenas={activeMyCompetitions.map((competition) => ({
            id: competition.id,
            title: competition.title,
            status: competition.status,
            startAt: competition.startAt,
            endAt: competition.endAt,
            sponsor: competition.sponsor,
            sponsorName: competition.sponsorName,
            sponsorLogoUrl: competition.sponsorLogoUrl,
            bannerImageUrl: competition.bannerImageUrl,
            myEntry: competition.myEntry,
          }))}
          joinableArenas={joinablePublicCompetitions
            .filter((competition) => (
              competition.status !== 'live'
              && (competition.status === 'registration' || competition.canJoin === true)
            ))
            .sort((a, b) => a.startAt - b.startAt)
            .map((competition) => ({
              id: competition.id,
              title: competition.title,
              status: competition.status,
              startAt: competition.startAt,
              endAt: competition.endAt,
              sponsor: competition.sponsor,
              sponsorName: competition.sponsorName,
              sponsorLogoUrl: competition.sponsorLogoUrl,
              bannerImageUrl: competition.bannerImageUrl,
              canJoin: competition.canJoin,
              joined: myCompetitions.some((entry) => entry.id === competition.id),
            }))}
          latestNews={latestNews}
          season={activeSeason}
          authSlot={authPanel}
          onAuthIntent={switchIntent}
          onRefresh={() => { void refreshData(); }}
          onTrade={(competitionId) => {
            const competition = myCompetitions.find((entry) => entry.id === competitionId);
            if (competition) void startCompetitionTrading(competition);
          }}
          onJoin={(competitionId) => {
            const competition = publicCompetitions.find((entry) => entry.id === competitionId);
            if (!session) {
              document.getElementById('signup')?.scrollIntoView({ behavior: 'smooth' });
              return;
            }
            if (competition) openJoinModal(competition);
          }}
          onLeaderboard={(competitionId) => navigate(`/compete/leaderboard/${competitionId}`)}
        />
      ) : (
      <main className="compete-bg pb-8">
        {/* HERO plein écran — pas de marge négative sur mobile : évite que le contenu passe sous le header / Safari */}
        <section
          id="signup"
          className="relative isolate min-h-[min(92svh,920px)] overflow-hidden pt-2 sm:-mt-[76px] sm:pt-[76px]"
        >
          <div aria-hidden className="pointer-events-none absolute inset-0">
            <img
              src="/assets/pictures/Traderpng.webp"
              alt=""
              className="absolute inset-0 h-full w-full object-cover object-[72%_18%] opacity-55 sm:object-[78%_12%] sm:opacity-60"
              loading="eager"
              decoding="async"
              fetchPriority="high"
            />
            <div className="absolute inset-0 bg-[radial-gradient(70%_70%_at_82%_28%,rgba(220,38,38,0.28),transparent_58%)]" />
            <div className="absolute inset-0 bg-gradient-to-r from-[#050507] from-[18%] via-[#050507]/86 via-[52%] to-[#050507]/20" />
            <div className="absolute inset-0 bg-gradient-to-t from-[#050507] via-[#050507]/20 to-[#050507]/75" />
            <div
              className="absolute inset-0 opacity-[0.14]"
              style={{
                backgroundImage: 'linear-gradient(rgba(255,255,255,.08) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.08) 1px,transparent 1px)',
                backgroundSize: '80px 80px',
                maskImage: 'linear-gradient(90deg,#000 0%,transparent 72%)',
              }}
            />
            <div className="hero-scanline" />
          </div>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-[#dc2626]/70 to-transparent" />

          <div className="relative z-10 mx-auto flex min-h-[inherit] max-w-[1440px] items-center px-5 py-16 sm:px-8 sm:py-20 md:px-10 md:py-24">
            <div className={session ? 'grid w-full gap-8' : 'grid w-full gap-12 lg:grid-cols-[1.15fr_0.85fr] lg:items-center'}>
              {!session && <div>
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                  className="mb-4 flex items-center gap-2"
                >
                  <span className="h-px w-7 bg-gradient-to-r from-[#dc2626] to-transparent" />
                  <span className="micro text-[10px] text-[#f5b8b8]/90 sm:text-[11px]">{t('hero.eyebrow')}</span>
                </motion.div>
                <motion.h1
                  initial={{ opacity: 0, y: 18 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.7, delay: 0.05, ease: [0.22, 1, 0.36, 1] }}
                  className="display max-w-3xl text-[clamp(3.25rem,12vw,7.6rem)] font-bold leading-[0.9] tracking-tight"
                >
                  <span className="sr-only">{t('hero.seoHeading')} — </span>
                  <span aria-hidden="true">
                    TRADE.
                    <br />
                    RANK.
                    <br />
                    <span className="bg-gradient-to-r from-[#ff4b4b] via-[#dc2626] to-[#7f1d1d] bg-clip-text text-transparent">WIN.</span>
                  </span>
                </motion.h1>
                <motion.p
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
                  className="mt-6 max-w-xl text-base leading-relaxed text-[#b8b8c2] md:text-lg"
                >
                  {t('hero.subtitle')}
                </motion.p>

                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, delay: 0.22, ease: [0.22, 1, 0.36, 1] }}
                  className="mt-7 flex flex-col gap-3 sm:flex-row"
                >
                  <a href="#arenas" onClick={(event) => scrollToCompeteSection(event, 'arenas')} className="blood-cta flex items-center justify-center px-6 py-4 text-sm">
                    {t('hero.ctaArenas')}
                  </a>
                  <a href="#process" onClick={(event) => scrollToCompeteSection(event, 'process')} className="ghost-cta flex items-center justify-center px-6 py-4 text-sm uppercase tracking-[0.14em]">
                    {t('hero.ctaHow')}
                  </a>
                </motion.div>
              </div>}

              {/* AUTH PANEL */}
              <div className={session ? 'grid w-full gap-5' : 'grid gap-5'}>
                {!session ? (
                  authPanel
                ) : (
                  <>
                    <UserSummary user={session.user} pnlUsd={totalPnl} avgPnlPct={avgPnlPct} count={statsCompetitions.length} stats={myStats} badges={myBadges} rating={myRating} />
                  </>
                )}
              </div>
            </div>
          </div>
        </section>

        {!session && <ProcessSection />}

        {/* MES COMPETITIONS */}
        {session && (
          <section className="mx-auto max-w-7xl px-6 pt-10 md:px-10">
            <SectionHeader eyebrow={t('sections.myCompetitionsEyebrow')} title={t('sections.activeArenasTitle')} />
            {activeMyCompetitions.length === 0 ? (
              <div className="glass-card mt-6 p-10 text-center">
                <p className="text-[#b8b8c2]">
                  {myCompetitions.length === 0
                    ? t('sections.emptyNoJoin')
                    : t('sections.emptyNoActive')}
                </p>
                <p className="mt-2 text-sm text-[#71717a]">
                  {myCompetitions.length === 0
                    ? t('sections.hintChoose')
                    : t('sections.hintHistory')}
                </p>
              </div>
            ) : (
              <div className="mt-6 grid gap-6">
                {activeMyCompetitions.map((competition, idx) => (
                  <MyCompetitionCard
                    key={competition.id}
                    competition={competition}
                    busy={busy}
                    index={idx}
                    onTrade={() => startCompetitionTrading(competition)}
                    onStart={refreshData}
                  />
                ))}
              </div>
            )}
          </section>
        )}

        {/* PUBLIC COMPETITIONS */}
        <section id="arenas" className="mx-auto max-w-7xl px-6 pt-16 md:px-10">
          <SectionHeader
            eyebrow={t('sections.publicEyebrow')}
            title={t('sections.publicTitle')}
            sub={t('sections.publicSub')}
          />
          {joinablePublicCompetitions.length === 0 ? (
            <div className="glass-card mt-6 p-10 text-center text-sm text-[#b8b8c2]">
              {t('sections.publicEmpty')}
            </div>
          ) : (
            <div className="mt-6 grid gap-6">
              {joinablePublicCompetitions.map((competition, idx) => {
                const alreadyJoined = myCompetitions.some((entry) => entry.id === competition.id);
                return (
                  <PublicCompetitionCard
                    key={competition.id}
                    competition={competition}
                    alreadyJoined={alreadyJoined}
                    onJoin={() => openJoinModal(competition)}
                    index={idx}
                  />
                );
              })}
            </div>
          )}
        </section>

        <SummerSeasonHomeSection seasons={seasons} />

        {latestNews.length > 0 && (
          <section className="mx-auto max-w-7xl px-5 pt-16 sm:px-8 md:px-10">
            <div className="mb-3 flex items-center justify-between gap-3">
              <span className="micro text-[10px] text-[#dc2626]">{t('news.homeBanner')}</span>
              <Link to="/compete/news" className="micro text-[10px] text-[#8b8490] transition-colors hover:text-white">
                {t('news.homeAll')} →
              </Link>
            </div>
            <div className={`grid gap-3 ${latestNews.length > 1 ? 'md:grid-cols-2' : ''}`}>
              {latestNews.map((article) => {
                const localized = localizeNews(article, i18n.language);
                return (
                  <Link
                    key={article.id}
                    to={`/compete/news/${article.id}`}
                    className="group relative flex min-h-[92px] overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0b0b10] transition-colors hover:border-white/20"
                  >
                    {article.coverUrl && (
                      <OptimizedImage
                        src={newsCoverUrl(article.coverUrl, 'card') || article.coverUrl}
                        alt={localized.title}
                        displayWidth={360}
                        width={360}
                        height={200}
                        sizes="160px"
                        className="h-full w-[132px] shrink-0 object-cover sm:w-[160px]"
                      />
                    )}
                    <span className="flex min-w-0 flex-1 flex-col justify-center px-4 py-3 sm:px-5">
                      <small className="micro text-[9px] text-[#dc2626]">
                        {article.featured ? `${t('news.featured')} · ` : ''}
                        {new Date(article.publishedAt || article.createdAt).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short' })}
                      </small>
                      <strong className="display mt-1 line-clamp-2 text-lg font-black uppercase italic leading-tight text-white sm:text-xl">
                        {localized.title}
                      </strong>
                      {localized.summary && (
                        <em className="mt-1 line-clamp-1 text-xs not-italic text-[#8b8490]">{localized.summary}</em>
                      )}
                    </span>
                  </Link>
                );
              })}
            </div>
          </section>
        )}

        <HomeBonusBanner />

      </main>
      )}

      {joinTarget && (
        <JoinCompetitionModal
          competition={joinTarget}
          code={joinCode}
          onCode={setJoinCode}
          sponsorId={joinSponsorId}
          onSponsorId={setJoinSponsorId}
          error={joinError}
          busy={busy}
          onClose={closeJoinModal}
          onSubmit={submitJoin}
        />
      )}
    </div>
  );
}

/* ----------------------------- SUB COMPONENTS ----------------------------- */

type HomeSeasonInfo = SeasonInfo;

/** Annonce sur la page d'accueil : la saison en cours + lien vers le leaderboard. */
function SummerSeasonHomeSection({ seasons }: { seasons: HomeSeasonInfo[] }) {
  const { t } = useTranslation();
  const season = seasons.find((item) => item.status === 'active')
    || seasons.find((item) => item.isActive)
    || null;

  if (!season || season.status !== 'active') return null;

  return (
    <section className="mx-auto max-w-7xl px-6 pt-16 md:px-10">
      <div className="border-b border-[#1a1a20] pb-5">
        <div className="flex items-center gap-2">
          <span className="h-px w-6 bg-[#dc2626]" />
          <div className="micro text-[10px] text-[#dc2626]">{t('sections.seasonEyebrow')}</div>
        </div>
      </div>
      <div className="mt-6">
        <HomeSeasonBoard />
      </div>
    </section>
  );
}

function ProcessSection() {
  const { t } = useTranslation();
  const steps = [
    { icon: 'user', title: t('process.step1Title'), text: t('process.step1Text') },
    { icon: 'arena', title: t('process.step2Title'), text: t('process.step2Text') },
    { icon: 'prize', title: t('process.step3Title'), text: t('process.step3Text') },
  ];

  return (
    <section id="process" className="mx-auto max-w-7xl px-6 pt-10 md:px-10">
      <SectionHeader
        eyebrow={t('process.eyebrow')}
        title={t('process.title')}
        sub={t('process.sub')}
      />
      <div id="platform" className="compete-process__grid mt-6">
        <div className="compete-process__steps">
          {steps.map((step, index) => (
            <motion.article
              key={step.title}
              initial={{ opacity: 0, y: 14 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-80px' }}
              transition={{ duration: 0.5, delay: index * 0.08, ease: [0.22, 1, 0.36, 1] }}
              className="process-step"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="process-icon">
                  <StepIcon type={step.icon} />
                </div>
                <div className="process-number">{String(index + 1).padStart(2, '0')}</div>
              </div>
              <h3 className="display mt-2.5 text-lg font-bold text-white">{step.title}</h3>
              <p className="mt-1 text-[13px] leading-snug text-[#a1a1aa]">{step.text}</p>
            </motion.article>
          ))}
          <a
            href="#signup"
            onClick={(event) => scrollToCompeteSection(event, 'signup')}
            className="blood-cta inline-flex items-center justify-center px-6 py-3.5 text-sm"
          >
            {t('platform.cta')}
          </a>
        </div>
        <figure className="compete-platform__visual">
          <img
            src="/assets/pictures/BTF%20arena%20platform.png"
            alt={t('platform.alt')}
            width={1535}
            height={1024}
            className="compete-platform__shot"
            loading="lazy"
            decoding="async"
          />
        </figure>
      </div>
    </section>
  );
}

function StepIcon({ type }: { type: string }) {
  if (type === 'user') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M20 21a8 8 0 0 0-16 0" />
        <circle cx="12" cy="7" r="4" />
        <path d="M17.5 8.5h3M19 7v3" />
      </svg>
    );
  }
  if (type === 'arena') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 20V9l8-5 8 5v11" />
        <path d="M8 20v-7h8v7" />
        <path d="M9 10h6" />
        <path d="M12 4v16" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 21h8" />
      <path d="M12 17v4" />
      <path d="M7 4h10v4a5 5 0 0 1-10 0V4Z" />
      <path d="M17 6h3a3 3 0 0 1-3 3" />
      <path d="M7 6H4a3 3 0 0 0 3 3" />
      <path d="M10 11.5 12 10l2 1.5" />
    </svg>
  );
}

function SectionHeader({ eyebrow, title, sub }: { eyebrow: string; title?: string; sub?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-80px' }}
      transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
      className="border-b border-[#1a1a20] pb-5"
    >
      <div className="flex items-center gap-2">
        <span className="h-px w-6 bg-[#dc2626]" />
        <div className="micro text-[10px] text-[#dc2626]">{eyebrow}</div>
      </div>
      {title && <h2 className="display mt-2 text-2xl font-bold text-white sm:text-3xl md:text-4xl">{title}</h2>}
      {sub && <p className="mt-2 text-sm text-[#b8b8c2]">{sub}</p>}
    </motion.div>
  );
}

function AuthPanel({
  intent, step, email, name, phone, otp, smsOtp, consent, busy, error, pendingAuth,
  onSwitch, onEmail, onName, onPhone, onOtp, onSmsOtp, onConsent, onRequest, onVerify, onVerifyPhone, onBack,
}: {
  intent: AuthIntent;
  step: AuthStep;
  email: string;
  name: string;
  phone: string;
  otp: string;
  smsOtp: string;
  consent: boolean;
  busy: boolean;
  error: string;
  pendingAuth: PendingAuth | null;
  onSwitch: (next: AuthIntent) => void;
  onEmail: (value: string) => void;
  onName: (value: string) => void;
  onPhone: (value: string) => void;
  onOtp: (value: string) => void;
  onSmsOtp: (value: string) => void;
  onConsent: (value: boolean) => void;
  onRequest: () => void;
  onVerify: () => void;
  onVerifyPhone: () => void;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const title = step === 'verify-phone'
    ? t('auth.titleVerifyPhone')
    : step === 'verify-email'
      ? t('auth.titleVerifyEmail')
      : intent === 'login' ? t('auth.titleLogin') : t('auth.titleSignup');
  const subtitle = step === 'verify-phone'
    ? t('auth.subVerifyPhone')
    : step === 'verify-email'
      ? t('auth.subVerifyEmail')
      : t('auth.subRequest');

  return (
    <div className="glass-card relative overflow-hidden p-7 md:p-8">
      <div className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-[#dc2626]/15 blur-3xl" />
      <div className="relative">
        <div className="micro text-[10px] text-[#dc2626]">{t('auth.traderAccess')}</div>
        <h3 className="display mt-2 text-2xl font-bold text-white">{title}</h3>
        <p className="mt-1 text-sm text-[#b8b8c2]">{subtitle}</p>

        {step === 'request' && (
          <>
            <div className="mt-5 flex gap-1 rounded-2xl border border-[#232329] bg-[#0c0c10] p-1">
              <button type="button" onClick={() => onSwitch('login')} className={`tab-btn ${intent === 'login' ? 'active' : ''}`}>{t('auth.tabLogin')}</button>
              <button type="button" onClick={() => onSwitch('signup')} className={`tab-btn ${intent === 'signup' ? 'active' : ''}`}>{t('auth.tabSignup')}</button>
            </div>

            <div className="mt-5 space-y-3">
              <div>
                <label className="mb-1.5 block text-xs uppercase tracking-[0.18em] text-[#71717a]">{t('auth.email')}</label>
                <input
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => onEmail(event.target.value)}
                  placeholder={t('auth.emailPlaceholder')}
                  className="input-field"
                />
              </div>
              {intent === 'signup' && (
                <>
                  <div>
                    <label className="mb-1.5 block text-xs uppercase tracking-[0.18em] text-[#71717a]">{t('auth.username')}</label>
                    <input
                      type="text"
                      value={name}
                      onChange={(event) => onName(event.target.value)}
                      placeholder={t('auth.usernamePlaceholder')}
                      className="input-field"
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs uppercase tracking-[0.18em] text-[#71717a]">{t('auth.phone')}</label>
                    <input
                      type="tel"
                      autoComplete="tel"
                      value={phone}
                      onChange={(event) => onPhone(event.target.value)}
                      placeholder={t('auth.phonePlaceholder')}
                      className="input-field"
                    />
                    <p className="mt-1.5 text-[10px] text-[#71717a]">
                      {t('auth.phoneHint')}
                    </p>
                  </div>
                  <label className="flex items-start gap-2 pt-1 text-[10px] leading-snug text-[#8a8a93]">
                    <input
                      type="checkbox"
                      checked={consent}
                      onChange={(event) => onConsent(event.target.checked)}
                      className="mt-0.5 h-3.5 w-3.5 shrink-0 cursor-pointer accent-[#dc2626]"
                    />
                    <span>
                      {t('auth.consentText')}{' '}
                      <a href="/cgu" target="_blank" rel="noopener noreferrer" className="text-[#fca5a5] underline hover:text-white">{t('footer.cgu')}</a>{' '}
                      {t('auth.consentAnd')}{' '}
                      <a href="/confidentialite" target="_blank" rel="noopener noreferrer" className="text-[#fca5a5] underline hover:text-white">{t('footer.privacy')}</a>
                      {t('auth.consentNewsletter')}
                    </span>
                  </label>
                </>
              )}
            </div>
            {error && <div className="mt-3 text-sm text-[#fca5a5]">{error}</div>}
            <button
              type="button"
              onClick={onRequest}
              disabled={busy || !email.trim() || (intent === 'signup' && (!name.trim() || !phone.trim() || !consent))}
              className="blood-cta mt-5 w-full px-5 py-4 text-sm"
            >
              {busy ? t('auth.sending') : t('auth.getCode')}
            </button>
            <p className="mt-3 text-center text-[11px] text-[#71717a]">
              {intent === 'login' ? t('auth.switchToSignup') : t('auth.switchToLogin')}
            </p>
          </>
        )}

        {step === 'verify-email' && (
          <>
            <div className="mt-5 flex items-center gap-2">
              <div className="step-pill step-pill-active">{t('auth.stepEmail')}</div>
              <div className="h-px flex-1 bg-[#232329]" />
              <div className={`step-pill ${pendingAuth?.intent === 'signup' ? '' : 'step-pill-disabled'}`}>{t('auth.stepSms')}</div>
            </div>
            {pendingAuth?.delivered ? (
              <div className="mt-4 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
                {t('auth.codeSentTo')} <span className="text-white">{pendingAuth.email}</span>
              </div>
            ) : (
              <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-amber-100">
                <div className="micro text-[10px] text-amber-300">
                  {pendingAuth?.deliveryError ? t('auth.emailSendFailed') : t('auth.devModeMailer')}
                </div>
                <div className="mt-1 text-[12px] leading-snug text-amber-200">
                  {pendingAuth?.deliveryError
                    ? `Resend: ${pendingAuth.deliveryError}`
                    : <>{t('auth.codeGeneratedFor')} <span className="text-white">{pendingAuth?.email}</span></>}
                </div>
              </div>
            )}
            {ENABLE_TEST_LOGIN && pendingAuth?.devCode && (
              <div className="mt-3 rounded-xl border border-[#232329] bg-[#0c0c10] px-4 py-3">
                <div className="micro text-[10px] text-[#71717a]">{t('auth.backupCode')}</div>
                <div className="num mt-1 text-2xl font-bold tracking-[0.45em] text-white">{pendingAuth.devCode}</div>
              </div>
            )}
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              value={otp}
              onChange={(event) => onOtp(event.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="123456"
              className="input-field input-otp mt-5"
              autoFocus
            />
            {error && <div className="mt-3 text-sm text-[#fca5a5]">{error}</div>}
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button type="button" onClick={onVerify} disabled={busy || otp.length < 6} className="blood-cta flex-1 px-5 py-4 text-sm">
                {busy ? t('auth.verifying') : t('common.validate')}
              </button>
              <button type="button" onClick={onBack} className="ghost-cta px-4 py-3 text-sm">
                {t('auth.editEmail')}
              </button>
            </div>
            <button type="button" onClick={onRequest} disabled={busy} className="mt-3 w-full text-center text-xs text-[#fca5a5] transition-colors hover:text-white disabled:opacity-50">
              {t('auth.resendCode')}
            </button>
          </>
        )}

        {step === 'verify-phone' && (
          <>
            <div className="mt-5 flex items-center gap-2">
              <div className="step-pill step-pill-done">{t('auth.stepEmail')}</div>
              <div className="h-px flex-1 bg-[#dc2626]/40" />
              <div className="step-pill step-pill-active">{t('auth.stepSms')}</div>
            </div>
            {pendingAuth?.smsDelivered ? (
              <div className="mt-4 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
                {t('auth.smsSentTo')} <span className="text-white">{pendingAuth?.phoneMasked}</span>
              </div>
            ) : (
              <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-amber-100">
                <div className="micro text-[10px] text-amber-300">
                  {pendingAuth?.smsError ? t('auth.smsSendFailed') : t('auth.devModeTwilio')}
                </div>
                <div className="mt-1 text-[12px] leading-snug text-amber-200">
                  {pendingAuth?.smsError
                    ? `Twilio: ${pendingAuth.smsError}`
                    : <>{t('auth.smsNotSent')}</>}
                </div>
              </div>
            )}
            {pendingAuth?.devSmsCode && (
              <div className="mt-3 rounded-xl border border-[#232329] bg-[#0c0c10] px-4 py-3">
                <div className="micro text-[10px] text-[#71717a]">{t('auth.backupCode')}</div>
                <div className="num mt-1 text-2xl font-bold tracking-[0.45em] text-white">{pendingAuth.devSmsCode}</div>
              </div>
            )}
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              value={smsOtp}
              onChange={(event) => onSmsOtp(event.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="123456"
              className="input-field input-otp mt-5"
              autoFocus
            />
            {error && <div className="mt-3 text-sm text-[#fca5a5]">{error}</div>}
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button type="button" onClick={onVerifyPhone} disabled={busy || smsOtp.length < 6} className="blood-cta flex-1 px-5 py-4 text-sm">
                {busy ? t('auth.verifying') : t('auth.confirmAccount')}
              </button>
              <button type="button" onClick={onBack} className="ghost-cta px-4 py-3 text-sm">
                {t('common.cancel')}
              </button>
            </div>
            <p className="mt-3 text-center text-[11px] text-[#71717a]">
              {t('auth.smsNotReceived')}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function StatTile({
  label,
  value,
  tone = 'neutral',
  delayClass,
}: {
  label: string;
  value: string;
  tone?: 'pos' | 'neg' | 'neutral';
  delayClass?: string;
}) {
  const cardCls = `metric ${tone === 'pos' ? 'metric-pos' : tone === 'neg' ? 'metric-neg' : ''} card-shine rise-in ${delayClass || ''}`;
  const valueCls = `metric-value ${tone === 'pos' ? 'is-pos' : tone === 'neg' ? 'is-neg' : ''}`;
  return (
    <div className={cardCls}>
      <div className="metric-label">
        <span className="truncate">{label}</span>
      </div>
      <div className={valueCls}>{value}</div>
    </div>
  );
}

function formatWinRate(stats: UserStats | null): string {
  if (!stats || stats.wins + stats.losses === 0) return '—';
  return `${(stats.winRate * 100).toFixed(1)}%`;
}

function formatAvgRR(stats: UserStats | null): string {
  if (!stats || stats.avgRR == null) return '—';
  return stats.avgRR.toFixed(2);
}

function formatProfitFactor(stats: UserStats | null): string {
  if (!stats || stats.closedTrades === 0) return '—';
  if (stats.profitFactor == null) return stats.wins > 0 ? '∞' : '—';
  return stats.profitFactor.toFixed(2);
}

function HexAvatar({ src, name, size = 112 }: { src?: string | null; name: string; size?: number }) {
  const hex = 'polygon(30% 0%, 70% 0%, 100% 30%, 100% 70%, 70% 100%, 30% 100%, 0% 70%, 0% 30%)';
  return (
    <span
      className="relative shrink-0"
      style={{
        width: size,
        height: size,
        filter: 'drop-shadow(0 10px 18px rgba(0,0,0,.45)) drop-shadow(0 0 10px rgba(220,38,38,.28))',
      }}
    >
      <i className="absolute inset-0" style={{ clipPath: hex, background: 'linear-gradient(160deg, #ff6b7a, #7f1d1d 55%, #ff4655)' }} />
      <span
        className="absolute inset-[4px] grid place-items-center overflow-hidden bg-gradient-to-br from-[#dc263e] to-[#711423] text-2xl font-black uppercase text-white"
        style={{ clipPath: hex }}
      >
        {src ? (
          <AvatarImage key={src} src={src} alt="" className="h-full w-full object-cover" sizePx={size} />
        ) : (
          name.slice(0, 2)
        )}
      </span>
    </span>
  );
}

function UserSummary({ user, pnlUsd, avgPnlPct, count, stats, badges, rating }: { user: SessionUser; pnlUsd: number; avgPnlPct: number; count: number; stats: UserStats | null; badges: UserBadge[]; rating?: PlayerRating | null }) {
  const { t } = useTranslation();
  const pnlTone = pnlUsd > 0 ? 'pos' : pnlUsd < 0 ? 'neg' : 'neutral';
  const hasTrades = Boolean(stats && stats.closedTrades > 0);
  const pfTone: 'pos' | 'neg' | 'neutral' =
    hasTrades && stats!.profitFactor != null ? (stats!.profitFactor >= 1 ? 'pos' : 'neg') : hasTrades && stats!.profitFactor == null && stats!.wins > 0 ? 'pos' : 'neutral';
  const visibleRating: PlayerRating = rating ?? {
    points: 0,
    division: { id: 'bronze', label: 'Bronze', tier: 0 },
    next: { label: 'Silver', pointsNeeded: 100 },
    worldRank: null,
    totalPlayers: 0,
    recentEvents: [],
  };
  const divisionColor = DIVISION_COLORS[visibleRating.division.id] || '#c2724a';
  const progress = divisionProgress(visibleRating);
  const flag = countryFlag(user.country);
  const chips = [
    { label: t('user.totalPnl'), value: `${formatCompactSigned(pnlUsd)} $`, tone: pnlTone },
    { label: t('user.profitFactor'), value: formatProfitFactor(stats), tone: pfTone },
    {
      label: t('rating.worldRankLabel'),
      value: visibleRating.worldRank != null
        ? `#${visibleRating.worldRank}${visibleRating.totalPlayers > 0 ? ` / ${visibleRating.totalPlayers}` : ''}`
        : '—',
      tone: 'neutral' as const,
    },
    { label: t('user.arenas'), value: String(count), tone: 'neutral' as const },
    { label: t('user.avgPnl'), value: `${formatPercent(avgPnlPct)}%`, tone: avgPnlPct >= 0 ? 'pos' as const : 'neg' as const },
    { label: t('user.winRate'), value: formatWinRate(stats), tone: 'neutral' as const },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="glass-card card-shine relative overflow-hidden p-5 sm:p-7"
      style={{
        borderColor: `${divisionColor}55`,
        background: `
          radial-gradient(60% 100% at 100% 0%, ${divisionColor}20, transparent 68%),
          repeating-linear-gradient(115deg, rgba(255,255,255,.018) 0 2px, transparent 2px 7px),
          linear-gradient(145deg, #111016, #08080b)
        `,
      }}
    >
      <div className="hero-scanline" />
      <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full blur-3xl hero-glow" style={{ background: `${divisionColor}20` }} />
      <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-5 sm:gap-6">
            <HexAvatar src={user.avatarUrl} name={user.name} size={148} />
            <div className="min-w-0">
              <div className="micro text-[11px] text-[#dc2626]">{t('user.myProfile')}</div>
              <h1 className="display mt-1 flex flex-wrap items-center gap-2 text-3xl font-black leading-none text-white sm:text-4xl">
                {flag && <span className="text-[28px] leading-none" title={user.country || undefined}>{flag}</span>}
                {t('user.greeting', { name: user.name })}
                <NameBadges badges={badges} />
              </h1>
              <p className="mt-2 truncate text-sm text-[#71717a]">{user.email}</p>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-3 gap-2.5 sm:gap-3">
            {chips.map((chip) => (
              <div key={chip.label} className="rounded-2xl border border-white/[0.08] bg-black/30 px-3 py-3.5 sm:px-4 sm:py-4">
                <div className="micro truncate text-[9px] text-[#8b8490]">{chip.label}</div>
                <div className={`num mt-1.5 truncate text-lg font-black sm:text-xl ${
                  chip.tone === 'pos' ? 'text-emerald-400' : chip.tone === 'neg' ? 'text-rose-400' : 'text-white'
                }`}>
                  {chip.value}
                </div>
              </div>
            ))}
          </div>
        </div>

        <Link
          to="/compete/rank#rating"
          className="group relative mx-auto flex w-[200px] shrink-0 flex-col items-center text-center lg:mx-0 lg:-mr-2 lg:w-[220px]"
          style={{ perspective: 520 }}
        >
          <div className="pointer-events-none absolute inset-x-2 inset-y-6 rounded-full blur-2xl" style={{ background: `${divisionColor}28` }} />
          <div
            className="relative transition-transform duration-500 group-hover:translate-y-[-4px]"
            style={{
              transform: 'rotateY(-18deg) rotateX(6deg) rotate(2.5deg)',
              transformOrigin: '60% 45%',
              filter: `drop-shadow(-14px 18px 20px rgba(0,0,0,.55)) drop-shadow(0 0 16px ${divisionColor}66)`,
            }}
          >
            <DivisionBadge division={visibleRating.division} size={210} />
          </div>
          <div className="relative mt-1 w-full">
            <div className="display text-xl font-black uppercase text-white">{divisionDisplayName(visibleRating.division)}</div>
            <div className="num text-sm font-bold" style={{ color: divisionColor }}>{visibleRating.points} pts</div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full" style={{ width: `${progress}%`, background: `linear-gradient(90deg, ${divisionColor}, #fff)` }} />
            </div>
            <div className="mt-1.5 text-[10px] leading-snug text-[#8b8490]">
              {visibleRating.next
                ? t('rating.nextAt', { label: visibleRating.next.label, points: visibleRating.next.pointsNeeded })
                : t('rating.maxDivision')}
            </div>
          </div>
        </Link>
      </div>
    </motion.div>
  );
}

type ArenaEventCompetition = {
  id: string;
  title: string;
  executionMode: 'paper' | 'real';
  startAt: number;
  endAt: number;
  registrationEndsAt?: number;
  dailyDrawdownPercent?: number | null;
  status: 'registration' | 'starting_soon' | 'live' | 'ended';
  canJoin?: boolean;
  cashPrize?: CashPrize | null;
  participants?: number;
  sponsor?: string | null;
  sponsorName?: string | null;
  sponsorLogoUrl?: string | null;
  bannerImageUrl?: string | null;
  bannerHref?: string | null;
};

function ArenaEventCard({
  competition,
  joined,
  busy = false,
  canTrade = false,
  onJoin,
  onTrade,
  index,
}: {
  competition: ArenaEventCompetition;
  joined: boolean;
  busy?: boolean;
  canTrade?: boolean;
  onJoin?: () => void;
  onTrade?: () => void;
  index?: number;
}) {
  const { t } = useTranslation();
  const isLive = competition.status === 'live';
  const isEnded = competition.status === 'ended';
  const canJoin = competition.canJoin ?? competition.status === 'registration';
  const brand = resolveArenaBrand(competition, resolveMediaUrl);
  const accent = brand?.accent ?? '#dc2626';
  const banner = resolveMediaUrl(competition.bannerImageUrl) || ninjaTraderCupBanner(competition);
  const prize = getPrizeTitle(competition.cashPrize) || t('publicCard.freeEntry');
  const countdown = useCountdown(isLive ? competition.endAt : competition.startAt);
  const prizeItems = competition.cashPrize?.items || [];
  const prizeGroups = groupPrizeItems(prizeItems);
  const breakdown = prizeItems.length === 0 ? competition.cashPrize?.breakdown || [] : [];
  const prizeRankLabel = (rank: number) => (
    rank === 1
      ? t('leaderboard.rankTier1')
      : rank === 2
        ? t('leaderboard.rankTier2')
        : rank === 3
          ? t('leaderboard.rankTier3')
          : t('leaderboard.rankTierN', { rank })
  );
  const prizeRows = breakdown.length > 0
    ? breakdown.map((item) => ({
        key: `cash-${item.rank}`,
        rank: prizeRankLabel(item.rank),
        label: formatPrizeAmount(item.amount, competition.cashPrize?.currency || 'USD'),
      }))
    : prizeGroups.map((group, groupIndex) => {
        const first = group.ranks[0] || 0;
        const last = group.ranks[group.ranks.length - 1] || first;
        return {
          key: `${prizeItemKey(group.item)}-${groupIndex}`,
          rank: group.ranks.length > 1 ? `${first}–${last}` : prizeRankLabel(first),
          label: group.item.title || t('prize.rewardAlt'),
        };
      });
  const prizeCount = prizeItems.length || breakdown.length;
  const prizeParts = prize.match(/^([\d\s.,\u00a0]+(?:\$|€|USD|EUR))\s*(.*)$/i);
  const prizeTotal = prizeParts?.[1]?.trim() || prize;
  const prizeSubtitle = prizeParts?.[2]?.trim() || '';
  const statusLabel = isLive
    ? t('publicCard.liveNow')
    : competition.status === 'registration' && canJoin
      ? t('publicCard.arenaOpen')
      : competition.status === 'starting_soon'
        ? t('status.startingSoon')
        : t('publicCard.arenaClosed');

  return (
    <motion.article
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.06 * (index ?? 0), ease: [0.22, 1, 0.36, 1] }}
      className="arena-event-card group relative isolate w-full overflow-hidden rounded-[28px] border bg-[#08080b]"
      style={{ borderColor: `${accent}55`, boxShadow: `0 30px 90px -55px ${accent}` }}
    >
      {banner ? (
        <div className="relative border-b border-white/10 bg-black">
          {brand?.bannerHref ? (
            <a href={brand.bannerHref} target="_blank" rel="noopener noreferrer" className="block">
              <img
                src={encodeURI(banner)}
                alt={competition.title}
                className="block aspect-[16/4.5] w-full object-contain object-center"
                loading="lazy"
                decoding="async"
                draggable={false}
              />
            </a>
          ) : (
            <img
              src={encodeURI(banner)}
              alt={competition.title}
              className="block aspect-[16/4.5] w-full object-contain object-center"
              loading="lazy"
              decoding="async"
              draggable={false}
            />
          )}
        </div>
      ) : (
        <img
          src="/assets/pictures/btf-arena-seo.webp"
          alt=""
          className="pointer-events-none absolute inset-y-0 right-0 -z-20 h-full w-full object-contain object-right opacity-30 md:w-[58%]"
          loading="lazy"
          decoding="async"
          draggable={false}
        />
      )}

      <div className="relative p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span
            className="micro inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[9px] text-white"
            style={{ borderColor: `${accent}88`, backgroundColor: `${accent}22` }}
          >
            <i className={`h-1.5 w-1.5 rounded-full ${isEnded ? 'bg-zinc-500' : 'animate-pulse bg-[#ff435c] shadow-[0_0_12px_#ef233c]'}`} />
            {statusLabel}
          </span>
          {brand && (brand.logoUrl || brand.name !== 'Sponsor') && (
            <div className="flex items-center gap-2 rounded-full border border-white/10 bg-black/45 px-3 py-1.5 backdrop-blur-md">
              <span className="micro text-[8px] text-[#77717a]">{t('sponsor.sponsoredBy', { name: brand.name })}</span>
              {brand.logoUrl && (
                <img src={brand.logoUrl} alt={brand.name} className="h-4 w-auto object-contain" />
              )}
            </div>
          )}
        </div>

        <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(230px,.85fr)] lg:items-start">
          <div className="min-w-0">
            <h3 className="display max-w-2xl text-3xl font-black uppercase leading-[0.95] text-white sm:text-4xl">
              {competition.title}
            </h3>
            <p className="mt-2 text-xs text-[#8f8b93]">
              {competition.executionMode === 'paper' ? t('publicCard.paperCompetition') : t('publicCard.realCompetition')}
            </p>

            {!isEnded && (
              <div className="mt-4 w-fit rounded-xl border border-white/[0.07] bg-white/[0.025] px-3 py-2.5">
                <div className="micro text-[8px] text-[#77717a]">
                  {isLive ? t('publicCard.endsIn') : t('publicCard.startsIn')}
                </div>
                <div className="num mt-1 text-xl font-black tabular-nums text-white">{countdown}</div>
                {!isLive && <div className="mt-1 text-[10px] text-[#77717a]">{fmtDateTime(competition.startAt)}</div>}
              </div>
            )}
            <div className="mt-3 grid gap-2">
              <span className="inline-flex min-w-0 items-center gap-2 rounded-xl border border-white/[0.07] bg-white/[0.025] px-3 py-2.5 text-xs text-[#d4d4d8]">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="text-[#ef5267]" aria-hidden="true">
                  <circle cx="9" cy="8" r="4" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0M17 11a4 4 0 0 1 4.5 4v5" />
                </svg>
                <b className="font-semibold text-white">{competition.participants ?? 0}</b> {t('publicCard.registeredTraders')}
              </span>
              <span className="inline-flex min-w-0 items-center gap-2 rounded-xl border border-white/[0.07] bg-white/[0.025] px-3 py-2.5 text-xs text-[#d4d4d8]">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="text-[#ef5267]" aria-hidden="true">
                  <rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" />
                </svg>
                <span className="truncate">{fmtDateShort(competition.startAt)} → {fmtDateShort(competition.endAt)}</span>
              </span>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-amber-400/15 bg-[linear-gradient(135deg,rgba(245,179,0,.09),rgba(0,0,0,.35))]">
            <div className="p-4">
              <div className="micro text-[9px] text-[#f5b300]">{t('publicCard.prizeToWin')}</div>
              <div className="display mt-1 text-2xl font-black uppercase leading-[0.95] text-white sm:text-3xl">{prizeTotal}</div>
              {prizeSubtitle && <div className="mt-1 text-[11px] font-semibold text-amber-100/65">{prizeSubtitle}</div>}
              {prizeRows.length > 0 && (
                <div className="mt-3 overflow-hidden rounded-xl border border-amber-400/10 bg-black/20">
                  {prizeRows.map((item) => (
                    <div key={item.key} className="grid grid-cols-[44px_minmax(0,1fr)] gap-2 border-b border-white/[0.06] px-3 py-2 last:border-b-0">
                      <span className="num text-[10px] font-black text-[#f5b300]">{item.rank}</span>
                      <span className="truncate text-[10px] font-semibold text-white" title={item.label}>{item.label}</span>
                    </div>
                  ))}
                  {prizeCount > 0 && (
                    <div className="px-3 py-2 text-[9px] font-semibold uppercase tracking-[0.12em] text-amber-200/50">
                      {t('leaderboard.lotsTotal', { count: prizeCount })}
                    </div>
                  )}
              </div>
              )}
            </div>
          </div>
        </div>

        <div className="mt-5 flex flex-col gap-4 border-t border-white/[0.07] pt-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="grid gap-2">
            <div className="flex flex-wrap items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#8b8490]">
              <span>{competition.executionMode === 'paper' ? t('mode.paper') : t('mode.real')}</span>
              <i className="h-1 w-1 rounded-full bg-[#4f4a52]" />
              <span>{t('publicCard.freeEntry')}</span>
              {competition.dailyDrawdownPercent != null && competition.dailyDrawdownPercent > 0 && (
                <>
                  <i className="h-1 w-1 rounded-full bg-[#4f4a52]" />
                  <span>{t('publicCard.dailyDrawdown')} {competition.dailyDrawdownPercent}%</span>
                </>
              )}
            </div>
            <Link
              to="/reglement"
              className="w-fit text-[10px] font-semibold text-[#77717a] underline decoration-white/20 underline-offset-4 transition-colors hover:text-white"
            >
              {t('publicCard.viewRules')}
            </Link>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            {joined ? (
              canTrade && onTrade ? (
                <button type="button" onClick={onTrade} disabled={busy} className="blood-cta min-w-44 px-5 py-3 text-xs">
                  {busy ? '...' : t('myCard.trade')}
                </button>
              ) : (
                <span className="inline-flex min-w-44 items-center justify-center gap-2 rounded-xl border border-[#10b981]/35 bg-[#10b981]/12 px-5 py-3 text-[11px] font-black uppercase tracking-[0.13em] text-[#6ee7b7]">
                  ✓ {t('publicCard.youAreJoined')}
                </span>
              )
            ) : (
              <button
                type="button"
                onClick={onJoin}
                disabled={isEnded || !canJoin}
                className="blood-cta min-w-48 px-6 py-3 text-xs"
                style={!isEnded && canJoin ? { background: accent, boxShadow: `0 16px 42px -20px ${accent}` } : undefined}
              >
                {isEnded ? t('publicCard.arenaClosed') : !canJoin ? t('publicCard.joinClosed') : t('publicCard.joinArena')}
              </button>
            )}
            <Link
              to={`/compete/leaderboard/${competition.id}`}
              className="ghost-cta flex items-center justify-center px-5 py-3 text-[11px] uppercase tracking-[0.12em]"
            >
              {t('publicCard.viewArena')} →
            </Link>
          </div>
        </div>
      </div>
    </motion.article>
  );
}

function MyCompetitionCard({
  competition, busy, onTrade, onStart, index,
}: {
  competition: CompetitionMine;
  busy: boolean;
  onTrade: () => void;
  onStart?: () => void;
  index?: number;
}) {
  const isLive = competition.status === 'live';
  const isEnded = competition.status === 'ended';
  const startReached = !isLive && !isEnded && Date.now() >= competition.startAt;
  const canTrade = (competition.canTrade ?? isLive) || startReached;
  const startSyncedRef = useRef(false);

  useEffect(() => {
    if (startReached && !startSyncedRef.current) {
      startSyncedRef.current = true;
      onStart?.();
    }
  }, [startReached, onStart]);

  return (
    <ArenaEventCard
      competition={competition}
      joined
      busy={busy}
      canTrade={canTrade}
      onTrade={onTrade}
      index={index}
    />
  );
}

function PublicCompetitionCard({
  competition, alreadyJoined, onJoin, index,
}: {
  competition: CompetitionPublic;
  alreadyJoined: boolean;
  onJoin: () => void;
  index?: number;
}) {
  return (
    <ArenaEventCard
      competition={competition}
      joined={alreadyJoined}
      onJoin={onJoin}
      index={index}
    />
  );
}

export function JoinCompetitionModal({
  competition, code, onCode, sponsorId, onSponsorId, error, busy, onClose, onSubmit,
}: {
  competition: {
    id: string;
    title: string;
    code: string;
    startAt: number;
    endAt: number;
    registrationEndsAt?: number;
    dailyDrawdownPercent?: number | null;
    status: 'registration' | 'starting_soon' | 'live' | 'ended';
    sponsor?: string | null;
    sponsorReferralUrl?: string | null;
    sponsorName?: string | null;
    sponsorLogoUrl?: string | null;
  };
  code: string;
  onCode: (value: string) => void;
  sponsorId: string;
  onSponsorId: (value: string) => void;
  error: string;
  busy: boolean;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const { t } = useTranslation();
  const sponsor = getSponsor(competition.sponsor);
  const brand = resolveArenaBrand(competition, resolveMediaUrl);
  const accent = sponsor?.accent ?? brand?.accent ?? '#dc2626';
  const accentSoft = sponsor?.accentSoft ?? '#fca5a5';
  const referralUrl = competition.sponsorReferralUrl || sponsor?.referralUrl || '';
  const needsSponsorId = Boolean(sponsor?.requiresAccountId);
  const isIntroGate = sponsor?.gateFlow === 'intro';
  const isEmailId = sponsor?.accountIdType === 'email';
  const [step, setStep] = useState<'intro' | 'account' | 'confirm'>(isIntroGate ? 'intro' : 'confirm');
  const [accountMode, setAccountMode] = useState<'existing' | 'new'>('existing');
  const [localError, setLocalError] = useState('');

  const sponsorIdFormatInvalid = Boolean(
    needsSponsorId && sponsorId.trim() && sponsor?.validateAccountId && !sponsor.validateAccountId(sponsorId),
  );
  const needsCode = Boolean(competition.code);
  const displayError = localError || error;

  function handleSponsorIdChange(value: string) {
    onSponsorId(isEmailId ? value : value.toUpperCase());
    setLocalError('');
  }

  function goToAccount(mode: 'existing' | 'new') {
    setAccountMode(mode);
    setStep('account');
    setLocalError('');
  }

  function handleSignUpAndContinue() {
    if (referralUrl) window.open(referralUrl, '_blank', 'noopener,noreferrer');
    goToAccount('new');
  }

  function handleAccountContinue() {
    if (!sponsorId.trim()) {
      setLocalError(t('sponsor.missingEmail', { name: sponsor?.name || '' }));
      return;
    }
    if (sponsor?.validateAccountId && !sponsor.validateAccountId(sponsorId)) {
      setLocalError(t('sponsor.emailInvalid'));
      return;
    }
    setLocalError('');
    setStep('confirm');
  }

  const submitDisabled =
    busy ||
    (needsCode && !code.trim()) ||
    (needsSponsorId && !sponsorId.trim()) ||
    sponsorIdFormatInvalid;

  return createPortal(
    <div
      className="fixed inset-0 z-[80] overflow-y-auto overscroll-contain bg-black/70 backdrop-blur-md"
      onClick={onClose}
    >
      <div className="flex min-h-dvh items-end justify-center sm:items-center sm:p-4">
      <div
        className="compete compete-modal relative max-h-[92dvh] w-full max-w-lg overflow-y-auto overscroll-contain rounded-t-2xl border bg-gradient-to-b from-[#140a14] to-[#0a0a0d] p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:max-h-[min(90dvh,880px)] sm:rounded-2xl sm:p-7"
        style={{ borderColor: `${accent}4d`, boxShadow: `0 30px 80px -20px ${accent}66` }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="pointer-events-none absolute -right-20 -top-20 h-48 w-48 rounded-full blur-3xl" style={{ backgroundColor: `${accent}4d` }} />
        <div className="relative">
          <div className="flex items-start justify-between gap-3">
            <div>
              {brand?.logoUrl ? (
                <div className="flex items-center gap-2">
                  <img src={brand.logoUrl} alt={brand.name} className="h-5 w-auto object-contain" />
                  <span className="micro text-[10px] text-[#71717a]">{t('sponsor.partnerTag')}</span>
                </div>
              ) : (
                <div className="micro text-[10px]" style={{ color: accentSoft }}>{t('joinModal.eyebrow')}</div>
              )}
              {step === 'confirm' && (
                <>
                  <h3 className="display mt-2 text-2xl font-bold text-white">{competition.title}</h3>
                  <div className="mt-1 text-xs text-[#71717a]">{fmtDateTime(competition.startAt)} → {fmtDateTime(competition.endAt)}</div>
                </>
              )}
            </div>
            <button type="button" onClick={onClose} className="text-[#71717a] hover:text-white" aria-label={t('common.close')}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M6 18L18 6" /></svg>
            </button>
          </div>

          {/* —— Étape 1 : intro sponsor (NinjaTrader) —— */}
          {isIntroGate && step === 'intro' && sponsor && (
            <div className="mt-5">
              <h3 className="display text-xl font-bold leading-tight text-white sm:text-2xl">
                {t('sponsor.introTitle', { name: sponsor.name })}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-[#b8b8c2]">
                {t('sponsor.introSubtitle', { name: sponsor.name })}
              </p>
              <p className="mt-3 text-[13px] leading-relaxed text-[#9a9aa6]">
                {t('sponsor.ninjatraderAbout')}
              </p>

              {sponsor.platformImageUrl && (
                <div className="mt-4 overflow-hidden rounded-xl border border-white/10 ring-1 ring-inset ring-white/5">
                  <img
                    src={sponsor.platformImageUrl}
                    alt={sponsor.name}
                    className="block h-36 w-full object-cover object-top sm:h-auto sm:max-h-56"
                    loading="lazy"
                  />
                </div>
              )}

              <div className="mt-5 flex flex-col gap-2.5">
                <button
                  type="button"
                  onClick={handleSignUpAndContinue}
                  className="blood-cta w-full px-4 py-3.5 text-sm"
                  style={{ background: accent, boxShadow: `0 16px 40px -18px ${accent}` }}
                >
                  {t('sponsor.signUpFree')}
                </button>
                <button
                  type="button"
                  onClick={() => goToAccount('existing')}
                  className="ghost-cta w-full px-4 py-3 text-sm"
                >
                  {t('sponsor.alreadyHaveAccount')}
                </button>
              </div>
            </div>
          )}

          {/* —— Étape 2 : email du compte sponsor —— */}
          {isIntroGate && step === 'account' && sponsor && (
            <div className="mt-5">
              <h3 className="display text-xl font-bold text-white">
                {accountMode === 'new' ? t('sponsor.creatingAccount') : t('sponsor.alreadyHaveAccount')}
              </h3>

              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  onClick={() => { setAccountMode('existing'); setLocalError(''); }}
                  className={`flex-1 rounded-lg border px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.1em] transition-colors ${
                    accountMode === 'existing'
                      ? 'border-white/20 bg-white/10 text-white'
                      : 'border-white/8 bg-transparent text-[#71717a] hover:text-white'
                  }`}
                >
                  {t('sponsor.alreadyHaveAccount')}
                </button>
                <button
                  type="button"
                  onClick={() => { setAccountMode('new'); setLocalError(''); }}
                  className={`flex-1 rounded-lg border px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.1em] transition-colors ${
                    accountMode === 'new'
                      ? 'border-white/20 bg-white/10 text-white'
                      : 'border-white/8 bg-transparent text-[#71717a] hover:text-white'
                  }`}
                >
                  {t('sponsor.creatingAccount')}
                </button>
              </div>

              {accountMode === 'existing' ? (
                <>
                  <label className="mt-5 block text-[11px] font-semibold uppercase tracking-[0.12em] text-[#9a9aa6]">
                    {t('sponsor.emailLabel', { name: sponsor.name })}
                  </label>
                  <p className="mt-1 text-[11px] leading-snug text-[#8a8a94]">
                    {t('sponsor.emailHint', { name: sponsor.name })}
                  </p>
                  <input
                    type="email"
                    value={sponsorId}
                    onChange={(event) => handleSponsorIdChange(event.target.value)}
                    placeholder={t('sponsor.emailPlaceholder')}
                    autoFocus
                    className="input-field mt-2"
                    aria-invalid={sponsorIdFormatInvalid}
                    style={sponsorIdFormatInvalid ? { borderColor: '#f87171' } : undefined}
                  />
                  {sponsorIdFormatInvalid && (
                    <div className="mt-1.5 text-[12px] text-[#fca5a5]">{t('sponsor.emailInvalid')}</div>
                  )}

                  <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/8 px-3 py-2.5 text-[11px] leading-snug text-[#f5b86b]">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0">
                      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
                      <line x1="12" y1="9" x2="12" y2="13" />
                      <line x1="12" y1="17" x2="12.01" y2="17" />
                    </svg>
                    <span>{t('sponsor.emailVerifyWarning')}</span>
                  </div>
                </>
              ) : (
                <div className="mt-5">
                  <p className="text-sm leading-relaxed text-[#b8b8c2]">
                    {t('sponsor.signUpViaAffiliate')}
                  </p>
                  {referralUrl && (
                    <a
                      href={referralUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3.5 text-sm font-bold uppercase tracking-[0.12em] text-white transition-transform hover:scale-[1.02]"
                      style={{ background: accent, boxShadow: `0 16px 40px -18px ${accent}` }}
                    >
                      <img src={sponsor.logoUrl} alt="" aria-hidden className="h-4 w-auto object-contain" />
                      {t('sponsor.signUpFree')}
                    </a>
                  )}
                  <p className="mt-4 text-[12px] leading-relaxed text-[#8a8a94]">
                    {t('sponsor.afterSignUpNote')}
                  </p>
                </div>
              )}

              {displayError && <div className="mt-3 text-sm" style={{ color: accentSoft }}>{displayError}</div>}

              <div className="mt-5 grid grid-cols-[1fr_1.4fr] gap-3">
                <button type="button" onClick={() => setStep('intro')} className="ghost-cta px-4 py-3 text-sm">
                  {t('sponsor.back')}
                </button>
                {accountMode === 'existing' ? (
                  <button
                    type="button"
                    onClick={handleAccountContinue}
                    className="blood-cta px-4 py-3 text-sm"
                    style={{ background: accent, boxShadow: `0 16px 40px -18px ${accent}` }}
                  >
                    {t('sponsor.continue')}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => { setAccountMode('existing'); setLocalError(''); }}
                    className="blood-cta px-4 py-3 text-sm"
                    style={{ background: accent, boxShadow: `0 16px 40px -18px ${accent}` }}
                  >
                    {t('sponsor.accountCreated')}
                  </button>
                )}
              </div>
            </div>
          )}

          {step === 'confirm' && (
            <>
              {isIntroGate && sponsor && (
                <div className="mt-4 rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2 text-[12px] text-[#a1a1aa]">
                  <span className="font-semibold text-white">{sponsor.name}</span>
                  {' · '}
                  <span className="num">{sponsorId}</span>
                </div>
              )}

              <ScheduleInfo
                startAt={competition.startAt}
                registrationEndsAt={competition.registrationEndsAt}
                status={competition.status}
                className="mt-4"
              />

              {competition.dailyDrawdownPercent != null && competition.dailyDrawdownPercent > 0 && (
                <div className="mt-4">
                  <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#71717a]">
                    {t('joinModal.rulesTitle')}
                  </div>
                  <DrawdownRule percent={competition.dailyDrawdownPercent} variant="block" />
                </div>
              )}

              {!isIntroGate && needsSponsorId && sponsor && (
                <div className="mt-5 rounded-xl border p-4" style={{ borderColor: `${accent}4d`, backgroundColor: `${accent}14` }}>
                  <div className="text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: accentSoft }}>
                    {t('sponsor.gateTitle')}
                  </div>
                  <ol className="mt-2 list-decimal space-y-1 pl-4 text-[13px] text-[#cfd0d8]">
                    <li>{t('sponsor.gateStep1', { name: sponsor.name })}</li>
                    <li>{t('sponsor.gateStep2', { name: sponsor.name })}</li>
                  </ol>
                  {referralUrl && (
                    <a
                      href={referralUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-3 inline-flex items-center gap-2 rounded-lg px-3 py-2 text-[12px] font-bold uppercase tracking-[0.12em] text-white transition-transform hover:scale-[1.02]"
                      style={{ background: accent }}
                    >
                      <img src={sponsor.logoUrl} alt="" aria-hidden className="h-3.5 w-auto object-contain" />
                      {t('sponsor.signUpShort')}
                    </a>
                  )}
                  <label className="mt-4 block text-[11px] font-semibold uppercase tracking-[0.12em] text-[#9a9aa6]">
                    {t('sponsor.idLabel', { name: sponsor.name })}
                  </label>
                  <p className="mt-1 flex items-start gap-1.5 text-[11px] leading-snug text-[#8a8a94]">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0" aria-hidden="true">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="12" y1="16" x2="12" y2="12" />
                      <line x1="12" y1="8" x2="12.01" y2="8" />
                    </svg>
                    <span>{t('sponsor.idHint', { name: sponsor.name })}</span>
                  </p>
                  <input
                    type="text"
                    value={sponsorId}
                    onChange={(event) => handleSponsorIdChange(event.target.value)}
                    placeholder={sponsor.accountIdExample || t('sponsor.idPlaceholder', { name: sponsor.name })}
                    className="input-field mt-1.5 font-mono tracking-[0.12em]"
                    aria-invalid={sponsorIdFormatInvalid}
                    style={sponsorIdFormatInvalid ? { borderColor: '#f87171' } : undefined}
                  />
                  {sponsorIdFormatInvalid && (
                    <div className="mt-1.5 text-[12px] text-[#fca5a5]">
                      {t('sponsor.idInvalid', { name: sponsor.name, example: sponsor.accountIdExample || '' })}
                    </div>
                  )}
                  <div className="mt-3 flex items-start gap-1.5 text-[11px] font-medium text-[#f5b86b]">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0">
                      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
                      <line x1="12" y1="9" x2="12" y2="13" />
                      <line x1="12" y1="17" x2="12.01" y2="17" />
                    </svg>
                    <span>{t('sponsor.disqualifyWarning')}</span>
                  </div>
                </div>
              )}

              {needsCode && (
                <>
                  <p className="mt-5 text-sm text-[#b8b8c2]">{t('joinModal.instruction')}</p>
                  <input
                    type="text"
                    value={code}
                    onChange={(event) => onCode(event.target.value.toUpperCase())}
                    placeholder={t('joinModal.codePlaceholder')}
                    autoFocus={!needsSponsorId}
                    className="input-field mt-3 text-center font-mono text-lg tracking-[0.32em]"
                  />
                </>
              )}

              {displayError && step === 'confirm' && (
                <div className="mt-3 text-sm" style={{ color: accentSoft }}>{displayError}</div>
              )}

              <div className="mt-5 grid grid-cols-[1fr_1.4fr] gap-3">
                {isIntroGate ? (
                  <button type="button" onClick={() => setStep('account')} className="ghost-cta px-4 py-3 text-sm">
                    {t('sponsor.back')}
                  </button>
                ) : (
                  <button type="button" onClick={onClose} className="ghost-cta px-4 py-3 text-sm">{t('joinModal.cancel')}</button>
                )}
                <button
                  type="button"
                  onClick={onSubmit}
                  disabled={submitDisabled}
                  className="blood-cta px-4 py-3 text-sm"
                  style={sponsor ? { background: accent, boxShadow: `0 16px 40px -18px ${accent}` } : undefined}
                >
                  {busy ? '...' : t('joinModal.join')}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
      </div>
    </div>,
    document.body,
  );
}
