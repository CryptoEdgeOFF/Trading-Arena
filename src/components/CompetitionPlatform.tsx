import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';
import Seo from './Seo';
import CompeteHeader from './CompeteHeader';
import {
  AnimatedNumber,
  MetricCard,
  formatCompactSigned,
  formatCompactUnsigned,
  formatPercent,
} from './competeMetrics';
import OptimizedImage, { AvatarImage } from './OptimizedImage';
import { NameBadges, type UserBadge } from './playerBadges';
import { getSponsor } from '../lib/sponsors';
import { analytics } from '../lib/analytics';
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
  isPublic: boolean;
  participants: number;
  status: 'registration' | 'starting_soon' | 'live' | 'ended';
  canJoin?: boolean;
  canTrade?: boolean;
  cashPrize?: CashPrize | null;
  sponsor?: string | null;
  sponsorReferralUrl?: string | null;
}

interface CompetitionMine {
  id: string;
  title: string;
  code: string;
  executionMode: 'paper' | 'real';
  startAt: number;
  endAt: number;
  registrationEndsAt?: number;
  status: 'registration' | 'starting_soon' | 'live' | 'ended';
  canJoin?: boolean;
  canTrade?: boolean;
  myEntry: {
    pnlUsd: number;
    pnlPercent: number;
    tradesCount: number;
  };
  cashPrize?: CashPrize | null;
  participants?: number;
  rank?: number | null;
  sponsor?: string | null;
}

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

function useCountdown(target: number): string {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const delta = target - now;
  if (delta <= 0) return '00:00:00';
  const totalSec = Math.floor(delta / 1000);
  const hours = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
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

function CashPrizePill({ prize }: { prize: CashPrize | null | undefined }) {
  if (!hasPrize(prize)) return null;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/25 bg-amber-500/8 px-2 py-1 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-amber-200/90">
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="8" r="6" />
        <path d="M8.21 13.89L7 22l5-3 5 3-1.21-8.11" />
      </svg>
      {getPrizeTitle(prize)}
    </span>
  );
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
  const { t } = useTranslation();
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
      if (intent === 'login' && trimmedEmail === 'ARTEMTEST987') {
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
        setJoinError(t('sponsor.missingId', { name: sponsor.name }));
        return;
      }
      if (sponsor.validateAccountId && !sponsor.validateAccountId(joinSponsorId)) {
        setJoinError(t('sponsor.idInvalid', { name: sponsor.name, example: sponsor.accountIdExample || '' }));
        return;
      }
    }
    setBusy(true);
    setJoinError('');
    try {
      const response = await fetch('/api/competition/join', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.token}`,
        },
        body: JSON.stringify({
          code: joinCode,
          competitionId: joinTarget.id,
          ...(sponsor?.requiresAccountId ? { sponsorAccountId: joinSponsorId.trim() } : {}),
        }),
      });
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
      await Promise.all([refreshPublicCompetitions(), refreshMyCompetitions(session.token)]);
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
  const endedMyCompetitions = useMemo(
    () => myCompetitions.filter((competition) => competition.status === 'ended'),
    [myCompetitions],
  );
  const joinablePublicCompetitions = useMemo(
    () => publicCompetitions.filter((competition) => competition.status !== 'ended'),
    [publicCompetitions],
  );
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

  return (
    <div className="compete min-h-dvh-safe bg-[#050507]">
      <Seo
        title={t('seo.homeTitle')}
        description={t('seo.homeDesc')}
        keywords={t('seo.homeKeywords')}
        path="/compete"
      />
      <CompeteHeader user={session?.user || null} onLogout={logout} />

      <main className="compete-bg pb-8">
        {/* HERO — pas de marge négative sur mobile : évite que le contenu passe sous le header / la barre d'URL Safari */}
        <section id="signup" className="relative overflow-hidden pt-2 sm:-mt-[76px] sm:pt-[76px]">
          {/* Background trader silhouette */}
          <div aria-hidden className="pointer-events-none absolute inset-0 -z-0">
            <img
              src="/assets/pictures/Traderpng.webp"
              alt=""
              className="absolute inset-y-0 right-0 h-full w-[92%] object-cover object-[right_top] opacity-65 md:w-[68%] lg:w-[58%]"
              loading="lazy"
              decoding="async"
              fetchPriority="low"
            />
            <div className="absolute inset-0 bg-[radial-gradient(90%_60%_at_85%_30%,rgba(220,38,38,0.18),transparent_60%)]" />
            <div className="absolute inset-0 bg-gradient-to-r from-[#050507] from-10% via-[#050507]/88 via-50% to-[#050507]/10" />
            <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-[#050507] to-transparent" />
            <div className="absolute inset-x-0 bottom-0 h-56 bg-gradient-to-t from-[#050507] to-transparent" />
          </div>

          <div className="relative z-10 mx-auto max-w-7xl px-5 pb-14 pt-14 sm:px-6 sm:pt-20 md:px-10 md:pb-20 md:pt-24 lg:pt-28">
            <div className="grid gap-12 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
              <div>
                <motion.h1
                  initial={{ opacity: 0, y: 18 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.7, delay: 0.05, ease: [0.22, 1, 0.36, 1] }}
                  className="display max-w-3xl text-[clamp(3.25rem,12vw,7.6rem)] font-bold leading-[0.9] tracking-tight"
                >
                  TRADE.
                  <br />
                  RANK.
                  <br />
                  <span className="bg-gradient-to-r from-[#ff4b4b] via-[#dc2626] to-[#7f1d1d] bg-clip-text text-transparent">WIN.</span>
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
              </div>

              {/* AUTH PANEL */}
              <div className="grid gap-5">
                {!session ? (
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
                ) : (
                  <UserSummary user={session.user} pnlUsd={totalPnl} avgPnlPct={avgPnlPct} count={statsCompetitions.length} stats={myStats} badges={myBadges} />
                )}
              </div>
            </div>
          </div>
        </section>

        <ProcessSection />

        {/* MES COMPETITIONS */}
        {session && (
          <section className="mx-auto max-w-7xl px-6 pt-6 md:px-10">
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
              <div className="mt-6 grid gap-5 md:grid-cols-2">
                {activeMyCompetitions.map((competition) => (
                  <MyCompetitionCard
                    key={competition.id}
                    competition={competition}
                    busy={busy}
                    onTrade={() => startCompetitionTrading(competition)}
                    onStart={refreshData}
                  />
                ))}
              </div>
            )}
          </section>
        )}

        {session && endedMyCompetitions.length > 0 && (
          <section className="mx-auto max-w-7xl px-6 pt-12 md:px-10">
            <SectionHeader
              eyebrow={t('sections.historyEyebrow')}
              title={t('sections.historyTitle')}
              sub={t('sections.historySub')}
            />
            <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {endedMyCompetitions.map((competition) => (
                <ArchivedCompetitionCard
                  key={competition.id}
                  competition={competition}
                />
              ))}
            </div>
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
            <div className="mt-6 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
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

        {/* TRADE LIVE BONUS — accès aux liens d'affiliation / promos partenaires */}
        <section className="mx-auto max-w-7xl px-6 pt-16 md:px-10">
          <Link
            to="/compete/bonus"
            className="group relative block overflow-hidden rounded-3xl border border-[#dc2626]/25 bg-gradient-to-br from-[#1a0709] via-[#0c0508] to-[#0a0a0d] p-6 transition-colors hover:border-[#dc2626]/55 md:p-9"
          >
            <div className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-[#dc2626]/20 blur-3xl transition-opacity duration-300 group-hover:opacity-100" />
            <div className="relative flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
              <div className="flex items-start gap-4">
                <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-[#dc2626]/30 bg-[#dc2626]/12 text-[#fca5a5]">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M20 12v8H4v-8M2 7h20v5H2zM12 22V7M12 7H7.5a2.5 2.5 0 1 1 2.1-3.85M12 7h4.5a2.5 2.5 0 1 0-2.1-3.85" />
                  </svg>
                </span>
                <div>
                  <div className="micro text-[10px] text-[#dc2626]">{t('bonus.eyebrow')}</div>
                  <h2 className="display mt-1 text-2xl font-bold text-white sm:text-3xl">{t('bonus.title')}</h2>
                  <p className="mt-2 max-w-xl text-sm text-[#b8b8c2]">{t('bonus.homeSub')}</p>
                </div>
              </div>
              <span className="blood-cta flex shrink-0 items-center justify-center gap-2 px-6 py-4 text-sm uppercase tracking-[0.14em]">
                {t('bonus.homeCta')}
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </span>
            </div>
          </Link>
        </section>

      </main>

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
      <div className="mt-6 grid gap-4 md:grid-cols-3">
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
            <h3 className="display mt-5 text-xl font-bold text-white">{step.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-[#a1a1aa]">{step.text}</p>
          </motion.article>
        ))}
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

function SectionHeader({ eyebrow, title, sub }: { eyebrow: string; title: string; sub?: string }) {
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
      <h2 className="display mt-2 text-2xl font-bold text-white sm:text-3xl md:text-4xl">{title}</h2>
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
            {pendingAuth?.devCode && (
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

function UserSummary({ user, pnlUsd, avgPnlPct, count, stats, badges }: { user: SessionUser; pnlUsd: number; avgPnlPct: number; count: number; stats: UserStats | null; badges: UserBadge[] }) {
  const { t } = useTranslation();
  const pnlTone = pnlUsd > 0 ? 'pos' : pnlUsd < 0 ? 'neg' : 'neutral';
  const avgTone = avgPnlPct > 0 ? 'pos' : avgPnlPct < 0 ? 'neg' : 'neutral';
  const hasTrades = Boolean(stats && stats.closedTrades > 0);
  const winTone: 'pos' | 'neg' | 'neutral' = hasTrades ? (stats!.winRate >= 0.5 ? 'pos' : 'neg') : 'neutral';
  const rrTone: 'pos' | 'neg' | 'neutral' = stats && stats.avgRR != null ? (stats.avgRR >= 1 ? 'pos' : 'neg') : 'neutral';
  const pfTone: 'pos' | 'neg' | 'neutral' =
    hasTrades && stats!.profitFactor != null ? (stats!.profitFactor >= 1 ? 'pos' : 'neg') : hasTrades && stats!.profitFactor == null && stats!.wins > 0 ? 'pos' : 'neutral';
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="glass-card card-shine relative overflow-hidden p-5 sm:p-7 md:p-8"
    >
      <div className="hero-scanline" />
      <div className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-[#dc2626]/15 blur-3xl hero-glow" />
      <div className="relative">
        <div className="flex items-center gap-2">
          {user.avatarUrl ? (
            <AvatarImage
              key={user.avatarUrl}
              src={user.avatarUrl}
              alt=""
              className="h-9 w-9 shrink-0 rounded-xl object-cover shadow-[0_8px_24px_-8px_rgba(220,38,38,0.6)]"
              sizePx={36}
            />
          ) : (
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#dc2626] to-[#7f1d1d] text-sm font-bold uppercase text-white shadow-[0_8px_24px_-8px_rgba(220,38,38,0.6)]">
              {user.name.slice(0, 2)}
            </span>
          )}
          <div className="min-w-0">
            <div className="micro text-[10px] text-[#dc2626]">{t('user.myProfile')}</div>
            <h3 className="display flex flex-wrap items-center gap-1.5 break-words text-xl font-bold leading-tight text-white sm:text-2xl">
              {t('user.greeting', { name: user.name })}
              <NameBadges badges={badges} />
            </h3>
          </div>
        </div>
        <p className="mt-1 break-all text-xs text-[#71717a] sm:text-sm">{user.email}</p>

        <div className="mt-5 grid grid-cols-3 gap-2 sm:gap-3">
          <MetricCard
            label={t('user.totalPnl')}
            value={pnlUsd}
            format={(v) => formatCompactSigned(v)}
            unit="$"
            tone={pnlTone}
            delayClass="rise-in-1"
          />
          <MetricCard
            label={t('user.avgPnl')}
            value={avgPnlPct}
            format={(v) => formatPercent(v)}
            unit="%"
            tone={avgTone}
            delayClass="rise-in-2"
          />
          <MetricCard
            label={t('user.arenas')}
            value={count}
            format={(v) => formatCompactUnsigned(v)}
            tone="neutral"
            delayClass="rise-in-3"
          />
          <StatTile label={t('user.winRate')} value={formatWinRate(stats)} tone={winTone} delayClass="rise-in-1" />
          <StatTile label={t('user.avgRR')} value={formatAvgRR(stats)} tone={rrTone} delayClass="rise-in-2" />
          <StatTile label={t('user.profitFactor')} value={formatProfitFactor(stats)} tone={pfTone} delayClass="rise-in-3" />
        </div>

      </div>
    </motion.div>
  );
}

function ArchivedCompetitionCard({ competition }: { competition: CompetitionMine }) {
  const { t } = useTranslation();
  const pnlUsd = competition.myEntry.pnlUsd;
  const pnlPercent = competition.myEntry.pnlPercent;
  const pos = pnlPercent >= 0;
  const rank = competition.rank ?? null;
  const participants = competition.participants ?? null;

  return (
    <motion.article
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="archived-card group relative overflow-hidden rounded-xl border border-white/[0.07] bg-[#0a0a0d] px-4 py-3.5"
    >
      {/* Bande latérale grisée + filigrane "archive" pour différencier des arènes actives */}
      <div className="pointer-events-none absolute inset-y-0 left-0 w-[3px] bg-gradient-to-b from-white/25 to-white/5" />
      <div className="pointer-events-none absolute -right-6 top-1/2 -translate-y-1/2 select-none text-[64px] font-black uppercase leading-none tracking-tighter text-white/[0.03]">
        ✓
      </div>

      <div className="relative flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.18em] text-[#9a9aa6]">
            {t('archived.ended')}
          </span>
          {hasPrize(competition.cashPrize) && (
            <span className="truncate text-[10px] font-semibold uppercase tracking-[0.1em] text-amber-200/70">
              🏆 {getPrizeTitle(competition.cashPrize)}
            </span>
          )}
        </div>
        <Link
          to={`/compete/leaderboard/${competition.id}`}
          className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#71717a] transition-colors hover:text-white"
        >
          {t('archived.leaderboard')}
        </Link>
      </div>

      <h3 className="display mt-2 break-words text-base font-bold leading-tight text-[#d4d4dc]">
        {competition.title}
      </h3>

      <div className="mt-3 flex items-end justify-between gap-3">
        <div>
          <div className="micro text-[9px] text-[#71717a]">{t('archived.myRank')}</div>
          <div className="display text-2xl font-bold leading-none text-white">
            {rank ? `#${rank}` : '—'}
            {participants != null && (
              <span className="ml-1 text-[11px] font-medium text-[#71717a]">/ {participants}</span>
            )}
          </div>
        </div>
        <div className="text-right">
          <div className="micro text-[9px] text-[#71717a]">{t('archived.myPnl')}</div>
          <div className={`num text-xl font-bold leading-none ${pos ? 'text-[#34d399]' : 'text-[#f87171]'}`}>
            {formatPercent(pnlPercent)}%
          </div>
          <div className={`num mt-0.5 text-[11px] ${pos ? 'text-[#34d399]/70' : 'text-[#f87171]/70'}`}>
            {formatCompactSigned(pnlUsd)} USD
          </div>
        </div>
      </div>
    </motion.article>
  );
}

function MyCompetitionCard({
  competition, busy, onTrade, onStart,
}: {
  competition: CompetitionMine;
  busy: boolean;
  onTrade: () => void;
  onStart?: () => void;
}) {
  const { t } = useTranslation();
  const pnlPercent = competition.myEntry.pnlPercent;
  const pnlUsd = competition.myEntry.pnlUsd;
  const pos = pnlPercent >= 0;
  const isLive = competition.status === 'live';
  const isEnded = competition.status === 'ended';
  const targetTs = isLive ? competition.endAt : competition.startAt;
  const countdown = useCountdown(targetTs);
  // L'horloge locale ré-évalue à chaque tick (useCountdown re-render chaque seconde) :
  // dès que l'heure de départ est atteinte, on débloque le bouton sans rafraîchir.
  const startReached = !isLive && !isEnded && Date.now() >= competition.startAt;
  const canTrade = (competition.canTrade ?? isLive) || startReached;
  const fillRatio = Math.min(1, Math.abs(pnlPercent) / 100);

  // Quand le compte à rebours franchit 0, on resynchronise une fois l'état serveur
  // (statut, PnL, accès) pour que la carte reflète la compétition désormais en cours.
  const startSyncedRef = useRef(false);
  useEffect(() => {
    if (startReached && !startSyncedRef.current) {
      startSyncedRef.current = true;
      onStart?.();
    }
  }, [startReached, onStart]);

  return (
    <motion.article
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ y: -3 }}
      className={`relative overflow-hidden card-shine lift ${
        isLive ? 'blood-card ticker-glow' : 'glass-card'
      } p-5 sm:p-6`}
    >
      {isLive && (
        <>
          <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-[#dc2626]/22 blur-3xl hero-glow" />
          <div className="hero-scanline" />
        </>
      )}
      <div className="relative">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill status={competition.status} />
          <ModePill mode={competition.executionMode} />
          <CashPrizePill prize={competition.cashPrize} />
        </div>
        <h3 className="display mt-3 break-words text-lg font-bold leading-tight text-white sm:text-2xl">
          {competition.title}
        </h3>
        <PrizePreview prize={competition.cashPrize} compact />
        <div className="mt-1 text-[11px] text-[#71717a] sm:text-xs">
          {fmtDateShort(competition.startAt)} <span className="text-[#52525b]">→</span> {fmtDateShort(competition.endAt)}
        </div>

        <ScheduleInfo
          startAt={competition.startAt}
          registrationEndsAt={competition.registrationEndsAt}
          status={competition.status}
          className="mt-3"
        />

        {/* Big PnL hero block */}
        <div
          className={`metric metric-pnl-big mt-5 ${pos ? 'metric-pos' : 'metric-neg'} ${
            pnlPercent === 0 ? '' : ''
          }`}
        >
          <div className="metric-label">
            <span>{t('myCard.myPnl')}</span>
            <span className={`metric-trend ${pos ? 'up' : 'down'}`}>
              {pos ? '▲' : '▼'} arena
            </span>
          </div>
          <div className={`metric-value ${pos ? 'is-pos' : 'is-neg'}`}>
            <AnimatedNumber value={pnlPercent} format={(v) => formatPercent(v)} />
            <span className="unit">%</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className={`pnl-pill ${pos ? 'up' : 'down'}`}>
              <AnimatedNumber value={pnlUsd} format={(v) => formatCompactSigned(v)} />
              <span className="text-[#71717a]">USD</span>
            </span>
            <div className="progress-track w-full max-w-[140px] sm:max-w-[180px]">
              <div
                className={`progress-fill ${pos ? 'up' : 'down'}`}
                style={{ width: `${fillRatio * 100}%` }}
              />
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 sm:gap-3">
          <div className="metric">
            <div className="metric-label">{isLive ? t('myCard.endsIn') : isEnded ? t('myCard.statusLabel') : t('myCard.startsIn')}</div>
            <div className="metric-value" style={{ fontSize: 'clamp(1rem, 4.2vw, 1.3rem)' }}>
              {isEnded ? t('myCard.ended') : countdown}
            </div>
          </div>
          <div className="metric">
            <div className="metric-label">{t('myCard.trades')}</div>
            <div className="metric-value" style={{ fontSize: 'clamp(1rem, 4.2vw, 1.3rem)' }}>
              <AnimatedNumber value={competition.myEntry.tradesCount} format={(v) => formatCompactUnsigned(v)} />
            </div>
          </div>
        </div>

        <div className="mt-5 grid gap-2.5 sm:grid-cols-[2.2fr_1fr]">
          <button
            type="button"
            onClick={onTrade}
            disabled={busy || isEnded || !canTrade}
            className="blood-cta px-6 py-4 text-base sm:text-lg"
          >
            {busy
              ? '...'
              : isEnded
                ? t('myCard.arenaClosed')
                : !canTrade
                  ? t('myCard.opensIn', { countdown })
                  : t('myCard.trade')}
          </button>
          <Link
            to={`/compete/leaderboard/${competition.id}`}
            className="ghost-cta flex items-center justify-center px-4 py-3 text-xs uppercase tracking-[0.16em] sm:py-4"
          >
            {t('myCard.leaderboard')}
          </Link>
        </div>
      </div>
    </motion.article>
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
  const { t } = useTranslation();
  const isEnded = competition.status === 'ended';
  const isLive = competition.status === 'live';
  const canJoin = competition.canJoin ?? (competition.status === 'registration');
  const sponsor = getSponsor(competition.sponsor);
  return (
    <motion.article
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.05 * (index ?? 0), ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ y: -3 }}
      className="glass-card card-shine lift group relative overflow-hidden p-5 sm:p-6"
      style={sponsor ? { borderColor: `${sponsor.accent}66` } : undefined}
    >
      {isLive && <div className="hero-scanline" />}
      <div
        className="pointer-events-none absolute -right-20 -top-20 h-48 w-48 rounded-full blur-3xl transition-opacity duration-300"
        style={{ backgroundColor: `${sponsor ? sponsor.accent : '#dc2626'}${isLive ? '2e' : '14'}` }}
      />
      {sponsor && (
        <div
          className="absolute right-3 top-3 z-10 flex items-center rounded-full border px-2.5 py-1.5 backdrop-blur-sm"
          style={{ borderColor: `${sponsor.accent}80`, backgroundColor: `${sponsor.accent}26` }}
        >
          <img src={sponsor.logoUrl} alt={sponsor.name} className="h-4 w-auto object-contain" />
        </div>
      )}
      <div className="relative">
        <div className="flex items-start justify-between gap-3">
          <StatusPill status={competition.status} />
          {!sponsor && <ModePill mode={competition.executionMode} />}
        </div>

        <h3 className="display mt-4 break-words text-lg font-bold leading-tight text-white sm:text-xl">{competition.title}</h3>
        {sponsor && (
          <div className="mt-1 text-[11px] font-medium" style={{ color: sponsor.accentSoft }}>
            {t('sponsor.sponsoredBy', { name: sponsor.name })}
          </div>
        )}
        <PrizePreview prize={competition.cashPrize} />

        <div className="mt-5 grid grid-cols-2 gap-2.5 sm:gap-3">
          <div className="metric">
            <div className="metric-label">{t('publicCard.traders')}</div>
            <div className="metric-value" style={{ fontSize: 'clamp(1rem, 4.2vw, 1.35rem)' }}>
              <AnimatedNumber value={competition.participants} format={(v) => formatCompactUnsigned(v)} />
            </div>
          </div>
          <div className="metric">
            <div className="metric-label">{t('publicCard.period')}</div>
            <div className="metric-value" style={{ fontSize: 'clamp(0.85rem, 3vw, 0.95rem)' }}>
              <span className="truncate">{fmtDateShort(competition.startAt)} → {fmtDateShort(competition.endAt)}</span>
            </div>
          </div>
        </div>

        <ScheduleInfo
          startAt={competition.startAt}
          registrationEndsAt={competition.registrationEndsAt}
          status={competition.status}
          className="mt-4"
        />

        <div className="mt-5 grid gap-2.5 sm:grid-cols-[1.4fr_1fr]">
          {alreadyJoined ? (
            <span className="flex items-center justify-center gap-2 rounded-xl border border-[#10b981]/30 bg-[#10b981]/10 px-4 py-3 text-xs font-semibold uppercase tracking-[0.16em] text-[#34d399]">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
              {t('publicCard.joined')}
            </span>
          ) : (
            <button
              type="button"
              onClick={onJoin}
              disabled={isEnded || !canJoin}
              className="blood-cta px-4 py-3 text-sm"
              style={sponsor && canJoin ? { background: sponsor.accent, boxShadow: `0 16px 40px -18px ${sponsor.accent}` } : undefined}
            >
              {isEnded
                ? t('publicCard.arenaClosed')
                : !canJoin
                  ? t('publicCard.joinClosed')
                  : t('publicCard.join')}
            </button>
          )}
          <Link
            to={`/compete/leaderboard/${competition.id}`}
            className="ghost-cta flex items-center justify-center px-4 py-3 text-xs uppercase tracking-[0.14em]"
          >
            {t('publicCard.leaderboard')}
          </Link>
        </div>
      </div>
    </motion.article>
  );
}

function JoinCompetitionModal({
  competition, code, onCode, sponsorId, onSponsorId, error, busy, onClose, onSubmit,
}: {
  competition: CompetitionPublic;
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
  const accent = sponsor?.accent ?? '#dc2626';
  const accentSoft = sponsor?.accentSoft ?? '#fca5a5';
  const referralUrl = competition.sponsorReferralUrl || sponsor?.referralUrl || '';
  const needsSponsorId = Boolean(sponsor?.requiresAccountId);
  const sponsorIdFormatInvalid = Boolean(
    needsSponsorId && sponsorId.trim() && sponsor?.validateAccountId && !sponsor.validateAccountId(sponsorId),
  );
  // Une arène sans code est accessible librement : on ne demande pas de code.
  const needsCode = Boolean(competition.code);
  const submitDisabled = busy || (needsCode && !code.trim()) || (needsSponsorId && !sponsorId.trim()) || sponsorIdFormatInvalid;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-md" onClick={onClose}>
      <div
        className="compete compete-modal relative w-full max-w-md overflow-hidden rounded-2xl border bg-gradient-to-b from-[#140a14] to-[#0a0a0d] p-7"
        style={{ borderColor: `${accent}4d`, boxShadow: `0 30px 80px -20px ${accent}66` }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="pointer-events-none absolute -right-20 -top-20 h-48 w-48 rounded-full blur-3xl" style={{ backgroundColor: `${accent}4d` }} />
        <div className="relative">
          <div className="flex items-start justify-between gap-3">
            <div>
              {sponsor ? (
                <div className="flex items-center gap-2">
                  <img src={sponsor.logoUrl} alt={sponsor.name} className="h-4 w-auto object-contain" />
                  <span className="micro text-[10px] text-[#71717a]">{t('sponsor.partnerTag')}</span>
                </div>
              ) : (
                <div className="micro text-[10px]" style={{ color: accentSoft }}>{t('joinModal.eyebrow')}</div>
              )}
              <h3 className="display mt-2 text-2xl font-bold text-white">{competition.title}</h3>
              <div className="mt-1 text-xs text-[#71717a]">{fmtDateTime(competition.startAt)} → {fmtDateTime(competition.endAt)}</div>
            </div>
            <button type="button" onClick={onClose} className="text-[#71717a] hover:text-white" aria-label={t('common.close')}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M6 18L18 6" /></svg>
            </button>
          </div>

          <ScheduleInfo
            startAt={competition.startAt}
            registrationEndsAt={competition.registrationEndsAt}
            status={competition.status}
            className="mt-4"
          />

          {needsSponsorId && sponsor && (
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
                onChange={(event) => onSponsorId(event.target.value.toUpperCase())}
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
              <p className="mt-5 text-sm text-[#b8b8c2]">
                {t('joinModal.instruction')}
              </p>
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
          {error && <div className="mt-3 text-sm" style={{ color: accentSoft }}>{error}</div>}

          <div className="mt-5 grid grid-cols-[1fr_1.4fr] gap-3">
            <button type="button" onClick={onClose} className="ghost-cta px-4 py-3 text-sm">{t('joinModal.cancel')}</button>
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
        </div>
      </div>
    </div>
  );
}
