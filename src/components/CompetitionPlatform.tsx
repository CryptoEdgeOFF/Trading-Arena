import { useEffect, useMemo, useState } from 'react';
import type { MouseEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  AnimatedNumber,
  MetricCard,
  formatCompactSigned,
  formatCompactUnsigned,
  formatPercent,
} from './competeMetrics';

const SESSION_KEY = 'btf-comp-session';
const SESSION_USER_KEY = 'btf-comp-user';
const PAPER_SESSION_KEY = 'btf-paper-session';

function readCachedUser(): SessionUser | null {
  try {
    const raw = window.localStorage.getItem(SESSION_USER_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as SessionUser;
  } catch {
    return null;
  }
}

function writeCachedUser(user: SessionUser | null) {
  try {
    if (user) window.localStorage.setItem(SESSION_USER_KEY, JSON.stringify(user));
    else window.localStorage.removeItem(SESSION_USER_KEY);
  } catch {
    // ignore quota errors
  }
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
interface CashPrize {
  currency: string;
  total: number;
  breakdown?: Array<{ rank: number; amount: number }>;
  label?: string;
  imageUrl?: string;
}

interface CompetitionPublic {
  id: string;
  title: string;
  code: string;
  executionMode: 'paper' | 'real';
  startAt: number;
  endAt: number;
  isPublic: boolean;
  participants: number;
  status: 'upcoming' | 'live' | 'ended';
  cashPrize?: CashPrize | null;
}

interface CompetitionMine {
  id: string;
  title: string;
  code: string;
  executionMode: 'paper' | 'real';
  startAt: number;
  endAt: number;
  status: 'upcoming' | 'live' | 'ended';
  myEntry: {
    pnlUsd: number;
    pnlPercent: number;
    tradesCount: number;
  };
  cashPrize?: CashPrize | null;
}

interface SessionUser {
  id: string;
  email: string;
  name: string;
  phone?: string | null;
  phoneVerifiedAt?: number | null;
  avatarUrl?: string | null;
  socials?: {
    x?: string;
    instagram?: string;
    discord?: string;
    website?: string;
  };
}

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

function fmtDateShort(value: number): string {
  return new Date(value).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
}

function fmtDateTime(value: number): string {
  return new Date(value).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
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
  return Boolean(prize && (prize.label || prize.imageUrl || prize.total > 0));
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
  if (!hasPrize(prize)) return null;
  const title = getPrizeTitle(prize);
  return (
    <div className={`flex items-center gap-3 rounded-2xl border border-amber-500/20 bg-amber-500/8 ${compact ? 'mt-3 p-2.5' : 'mt-4 p-3'}`}>
      {prize.imageUrl ? (
        <img
          src={prize.imageUrl}
          alt={title || 'Récompense'}
          className={`${compact ? 'h-12 w-12' : 'h-16 w-16'} shrink-0 rounded-xl border border-amber-400/25 object-cover`}
          loading="lazy"
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
        <div className="micro text-[9px] text-amber-300/85">À gagner</div>
        <div className="truncate text-sm font-bold text-white sm:text-base">{title}</div>
        {prize.total > 0 && prize.label && (
          <div className="mt-0.5 text-[11px] text-amber-100/60">{formatPrizeAmount(prize.total, prize.currency)}</div>
        )}
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: CompetitionPublic['status'] }) {
  if (status === 'live') {
    return (
      <span className="pill pill-live">
        <span className="live-dot" />
        Live
      </span>
    );
  }
  if (status === 'upcoming') return <span className="pill pill-coming">A venir</span>;
  return <span className="pill pill-ended">Terminee</span>;
}

function ModePill({ mode }: { mode: 'paper' | 'real' }) {
  return <span className={`pill ${mode === 'real' ? 'pill-real' : 'pill-paper'}`}>{mode === 'paper' ? 'Paper' : 'Reel'}</span>;
}

function scrollToCompeteSection(event: MouseEvent<HTMLAnchorElement>, targetId: string) {
  event.preventDefault();
  const target = document.getElementById(targetId);
  const container = target?.closest('.compete') as HTMLElement | null;
  if (!target || !container) return;

  const containerRect = container.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const nextTop = container.scrollTop + targetRect.top - containerRect.top - 16;

  container.scrollTo({
    top: Math.max(nextTop, 0),
    behavior: 'smooth',
  });
  window.history.replaceState(null, '', `#${targetId}`);
}

function CompeteHeader({ user, onLogout }: { user: SessionUser | null; onLogout?: () => void }) {
  return (
    <header className="relative z-50 bg-[#050507] sm:bg-transparent sm:px-5 sm:pt-3">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-2 border-b border-white/10 bg-[#050507] px-3 py-2 shadow-[0_18px_60px_-42px_rgba(220,38,38,0.65)] sm:rounded-2xl sm:border sm:border-white/10 sm:bg-[#060609]/85 sm:px-4 sm:py-3 sm:backdrop-blur-2xl md:px-6">
        <Link to="/compete" className="group flex min-w-0 items-center gap-2 sm:gap-3">
          <span className="relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[#dc2626]/30 bg-[#120506] sm:h-10 sm:w-10">
            <span className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(220,38,38,0.35),transparent_62%)] opacity-80 transition-opacity group-hover:opacity-100" />
            <img src="/assets/pictures/logoBTF.webp" alt="BTF" className="relative h-7 w-7 object-contain sm:h-8 sm:w-8" />
          </span>
          <div className="flex min-w-0 items-baseline gap-1.5 sm:gap-2">
            <span className="display text-lg font-bold text-white sm:text-xl">BTF</span>
            <span className="micro text-[10px] text-[#dc2626] sm:text-xs">Arena</span>
          </div>
        </Link>
        <nav className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <a className="ghost-cta px-2.5 py-1.5 text-[10px] sm:px-4 sm:py-2 sm:text-xs" href="#arenas" onClick={(event) => scrollToCompeteSection(event, 'arenas')}>Arènes</a>
          {user ? (
            <>
              <div className="hidden items-center gap-2 rounded-full border border-[#232329] bg-[#0c0c10] px-3 py-1.5 md:flex">
                <div tabIndex={0} className="group relative flex items-center gap-2 outline-none">
                  {user.avatarUrl ? (
                    <img src={user.avatarUrl} alt="" className="h-6 w-6 rounded-full object-cover" />
                  ) : (
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-[#dc2626] to-[#7f1d1d] text-[11px] font-bold uppercase">
                      {user.name.slice(0, 2)}
                    </span>
                  )}
                  <span className="text-sm text-[#b8b8c2] transition-colors group-hover:text-white">{user.name}</span>
                  <div className="invisible absolute right-0 top-[calc(100%+10px)] z-50 w-44 rounded-xl border border-[#232329] bg-[#08080b] p-1.5 opacity-0 shadow-[0_20px_60px_-30px_rgba(0,0,0,0.9)] transition-all group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100">
                    <Link to="/compete/settings" className="block rounded-lg px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.14em] text-[#b8b8c2] transition-colors hover:bg-[#dc2626]/10 hover:text-white">
                      Settings
                    </Link>
                  </div>
                </div>
              </div>
              <Link to="/compete/settings" className="ghost-cta px-2.5 py-1.5 text-[10px] md:hidden">Settings</Link>
              <button type="button" onClick={onLogout} className="ghost-cta px-2.5 py-1.5 text-[10px] sm:px-4 sm:py-2 sm:text-sm">Deconnexion</button>
            </>
          ) : (
            <span className="hidden" aria-hidden="true" />
          )}
        </nav>
      </div>
    </header>
  );
}

export default function CompetitionPlatform() {
  const navigate = useNavigate();
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
  const [pendingAuth, setPendingAuth] = useState<PendingAuth | null>(null);

  // Hydrate competition lists from localStorage too so the page renders
  // populated even before the bootstrap response arrives.
  const [publicCompetitions, setPublicCompetitions] = useState<CompetitionPublic[]>(
    () => readCachedJSON<CompetitionPublic[]>(PUBLIC_CACHE_KEY) || [],
  );
  const [myCompetitions, setMyCompetitions] = useState<CompetitionMine[]>(
    () => readCachedJSON<CompetitionMine[]>(MINE_CACHE_KEY) || [],
  );

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [joinTarget, setJoinTarget] = useState<CompetitionPublic | null>(null);
  const [joinCode, setJoinCode] = useState('');
  const [joinError, setJoinError] = useState('');

  // Single bootstrap call on mount: returns user + public + mine in one
  // round-trip, eliminating the cascade of cold starts that used to slow
  // down the page after a refresh.
  useEffect(() => {
    let cancelled = false;
    const token = window.localStorage.getItem(SESSION_KEY);
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;

    fetch('/api/competition/bootstrap', { headers })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        const publicComps: CompetitionPublic[] = data.publicCompetitions || [];
        const mineComps: CompetitionMine[] = data.myCompetitions || [];
        setPublicCompetitions(publicComps);
        setMyCompetitions(mineComps);
        writeCachedJSON(PUBLIC_CACHE_KEY, publicComps);
        writeCachedJSON(MINE_CACHE_KEY, mineComps);

        if (token) {
          if (data.user) {
            setSession({ token, user: data.user });
            writeCachedUser(data.user);
          } else {
            // Token rejected by server -> clear the optimistic session.
            window.localStorage.removeItem(SESSION_KEY);
            writeCachedUser(null);
            setSession(null);
            setMyCompetitions([]);
            writeCachedJSON(MINE_CACHE_KEY, []);
          }
        }
      })
      .catch(() => {
        // Network failure: keep the optimistic state so the UI stays usable.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Keep the cached user in sync if it changes (e.g. profile update).
  useEffect(() => {
    if (session?.user) writeCachedUser(session.user);
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
      const response = await fetch('/api/competition/auth/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, name, phone: intent === 'signup' ? phone : undefined, intent }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Demande impossible');
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
      setError(err.message || 'Erreur inconnue');
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
      if (!response.ok) throw new Error(data.error || 'Verification impossible');

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
      void refreshMyCompetitions(data.token);
      resetAuth();
    } catch (err: any) {
      setError(err.message || 'Erreur inconnue');
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
      if (!response.ok) throw new Error(data.error || 'Verification SMS impossible');
      window.localStorage.setItem(SESSION_KEY, data.token);
      writeCachedUser(data.user);
      setSession({ token: data.token, user: data.user });
      void refreshMyCompetitions(data.token);
      resetAuth();
    } catch (err: any) {
      setError(err.message || 'Erreur inconnue');
    } finally {
      setBusy(false);
    }
  }

  function logout() {
    window.localStorage.removeItem(SESSION_KEY);
    writeCachedUser(null);
    writeCachedJSON(MINE_CACHE_KEY, []);
    setSession(null);
    setMyCompetitions([]);
  }

  function openJoinModal(competition: CompetitionPublic) {
    if (!session) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      setError('Connecte-toi pour rejoindre une competition');
      return;
    }
    setJoinTarget(competition);
    setJoinCode('');
    setJoinError('');
  }

  function closeJoinModal() {
    setJoinTarget(null);
    setJoinCode('');
    setJoinError('');
  }

  async function submitJoin() {
    if (!session || !joinTarget) return;
    setBusy(true);
    setJoinError('');
    try {
      const response = await fetch('/api/competition/join', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.token}`,
        },
        body: JSON.stringify({ code: joinCode }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Join impossible');
      if (data.competitionId !== joinTarget.id) {
        throw new Error('Le code ne correspond pas a cette competition');
      }
      await Promise.all([refreshPublicCompetitions(), refreshMyCompetitions(session.token)]);
      closeJoinModal();
    } catch (err: any) {
      setJoinError(err.message || 'Erreur inconnue');
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
      if (!response.ok) throw new Error(data.error || 'Acces trading impossible');
      window.localStorage.setItem(PAPER_SESSION_KEY, data.token);
      // Cache the player snapshot returned by /trade/session so the
      // ExchangeTerminal can render immediately on mount without waiting
      // for the /api/paper/me round-trip. The terminal still revalidates
      // in the background and patches via WebSocket.
      if (data.player) {
        try {
          window.localStorage.setItem(
            'btf-paper-bootstrap',
            JSON.stringify({
              token: data.token,
              player: data.player,
              competition: data.competition || null,
              market: data.market || null,
              canTrade: typeof data.canTrade === 'boolean' ? data.canTrade : null,
              cachedAt: Date.now(),
            }),
          );
        } catch {
          // localStorage quota or privacy mode: terminal will fall back to /me.
        }
      }
      // SPA navigation keeps the React tree alive (no full reload, no JS
      // re-parse). Combined with the bootstrap cache above, the terminal
      // mounts already populated.
      navigate(buildTradeUrl(competition));
    } catch (err: any) {
      setError(err.message || 'Erreur inconnue');
    } finally {
      setBusy(false);
    }
  }

  const totalPnl = useMemo(() => myCompetitions.reduce((acc, entry) => acc + entry.myEntry.pnlUsd, 0), [myCompetitions]);
  const avgPnlPct = useMemo(() => {
    if (myCompetitions.length === 0) return 0;
    return myCompetitions.reduce((acc, entry) => acc + entry.myEntry.pnlPercent, 0) / myCompetitions.length;
  }, [myCompetitions]);

  return (
    <div className="compete h-screen overflow-y-auto">
      <CompeteHeader user={session?.user || null} onLogout={logout} />

      <main className="compete-bg pb-20">
        {/* HERO */}
        <section id="signup" className="relative -mt-[58px] overflow-hidden pt-[58px] sm:-mt-[76px] sm:pt-[76px]">
          {/* Background trader silhouette */}
          <div aria-hidden className="pointer-events-none absolute inset-0 -z-0">
            <img
              src="/assets/pictures/Traderpng.webp"
              alt=""
              className="absolute inset-y-0 right-0 h-full w-[92%] object-cover object-[right_top] opacity-65 md:w-[68%] lg:w-[58%]"
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
                  Une plateforme de compétition trading organisée comme un vrai event : inscription sécurisée, arènes publiques, cash prize, ranking live et accès direct au terminal.
                </motion.p>

                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, delay: 0.22, ease: [0.22, 1, 0.36, 1] }}
                  className="mt-7 flex flex-col gap-3 sm:flex-row"
                >
                  <a href="#arenas" onClick={(event) => scrollToCompeteSection(event, 'arenas')} className="blood-cta flex items-center justify-center px-6 py-4 text-sm">
                    Voir les arènes
                  </a>
                  <a href="#process" onClick={(event) => scrollToCompeteSection(event, 'process')} className="ghost-cta flex items-center justify-center px-6 py-4 text-sm uppercase tracking-[0.14em]">
                    Comment ça marche
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
                    busy={busy}
                    error={error}
                    pendingAuth={pendingAuth}
                    onSwitch={switchIntent}
                    onEmail={setEmail}
                    onName={setName}
                    onPhone={setPhone}
                    onOtp={setOtp}
                    onSmsOtp={setSmsOtp}
                    onRequest={requestCode}
                    onVerify={verifyCode}
                    onVerifyPhone={verifyPhoneCode}
                    onBack={() => { setStep('request'); setError(''); }}
                  />
                ) : (
                  <UserSummary user={session.user} pnlUsd={totalPnl} avgPnlPct={avgPnlPct} count={myCompetitions.length} />
                )}
              </div>
            </div>
          </div>
        </section>

        {/* MES COMPETITIONS */}
        {session && (
          <section className="mx-auto max-w-7xl px-6 pt-6 md:px-10">
            <SectionHeader eyebrow="Mes competitions" title="Tes arenes actives" />
            {myCompetitions.length === 0 ? (
              <div className="glass-card mt-6 p-10 text-center">
                <p className="text-[#b8b8c2]">Tu n&apos;as encore rejoint aucune competition.</p>
                <p className="mt-2 text-sm text-[#71717a]">Choisis-en une dans la liste publique ci-dessous.</p>
              </div>
            ) : (
              <div className="mt-6 grid gap-5 md:grid-cols-2">
                {myCompetitions.map((competition) => (
                  <MyCompetitionCard
                    key={competition.id}
                    competition={competition}
                    busy={busy}
                    onTrade={() => startCompetitionTrading(competition)}
                  />
                ))}
              </div>
            )}
          </section>
        )}

        <ProcessSection />

        {/* PUBLIC COMPETITIONS */}
        <section id="arenas" className="mx-auto max-w-7xl px-6 pt-16 md:px-10">
          <SectionHeader
            eyebrow="Competitions publiques"
            title="Rejoins une arene"
            sub="Code requis pour participer. Demande-le a l'organisateur."
          />
          {publicCompetitions.length === 0 ? (
            <div className="glass-card mt-6 p-10 text-center text-sm text-[#b8b8c2]">
              Aucune competition publique disponible pour le moment.
            </div>
          ) : (
            <div className="mt-6 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
              {publicCompetitions.map((competition, idx) => {
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

      </main>

      {joinTarget && (
        <JoinCompetitionModal
          competition={joinTarget}
          code={joinCode}
          onCode={setJoinCode}
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
  const steps = [
    { icon: 'user', title: 'Crée un compte', text: 'Inscris-toi rapidement avec ton email, ton pseudo et une vérification téléphone.' },
    { icon: 'arena', title: 'Rejoins une arène', text: 'Choisis une compétition publique et entre le code donné par l’organisateur.' },
    { icon: 'prize', title: 'Trade et remporte des prizes', text: 'Trade sur la plateforme, suis ton classement et vise les récompenses.' },
  ];

  return (
    <section id="process" className="mx-auto max-w-7xl px-6 pt-10 md:px-10">
      <SectionHeader
        eyebrow="Comment ça marche"
        title="3 étapes pour participer"
        sub="Le parcours doit être simple : créer son compte, rejoindre une arène, trader pour monter au classement."
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
  intent, step, email, name, phone, otp, smsOtp, busy, error, pendingAuth,
  onSwitch, onEmail, onName, onPhone, onOtp, onSmsOtp, onRequest, onVerify, onVerifyPhone, onBack,
}: {
  intent: AuthIntent;
  step: AuthStep;
  email: string;
  name: string;
  phone: string;
  otp: string;
  smsOtp: string;
  busy: boolean;
  error: string;
  pendingAuth: PendingAuth | null;
  onSwitch: (next: AuthIntent) => void;
  onEmail: (value: string) => void;
  onName: (value: string) => void;
  onPhone: (value: string) => void;
  onOtp: (value: string) => void;
  onSmsOtp: (value: string) => void;
  onRequest: () => void;
  onVerify: () => void;
  onVerifyPhone: () => void;
  onBack: () => void;
}) {
  const title = step === 'verify-phone'
    ? 'Verification SMS'
    : step === 'verify-email'
      ? 'Verifie ton email'
      : intent === 'login' ? 'Se connecter' : 'Creer un compte';
  const subtitle = step === 'verify-phone'
    ? 'Derniere etape : saisis le code recu par SMS pour valider ton numero.'
    : step === 'verify-email'
      ? 'Saisis le code a 6 chiffres recu par email.'
      : 'Inscription par email + verification telephone (anti multi-comptes).';

  return (
    <div className="glass-card relative overflow-hidden p-7 md:p-8">
      <div className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-[#dc2626]/15 blur-3xl" />
      <div className="relative">
        <div className="micro text-[10px] text-[#dc2626]">Acces trader</div>
        <h3 className="display mt-2 text-2xl font-bold text-white">{title}</h3>
        <p className="mt-1 text-sm text-[#b8b8c2]">{subtitle}</p>

        {step === 'request' && (
          <>
            <div className="mt-5 flex gap-1 rounded-2xl border border-[#232329] bg-[#0c0c10] p-1">
              <button type="button" onClick={() => onSwitch('login')} className={`tab-btn ${intent === 'login' ? 'active' : ''}`}>Connexion</button>
              <button type="button" onClick={() => onSwitch('signup')} className={`tab-btn ${intent === 'signup' ? 'active' : ''}`}>Inscription</button>
            </div>

            <div className="mt-5 space-y-3">
              <div>
                <label className="mb-1.5 block text-xs uppercase tracking-[0.18em] text-[#71717a]">Email</label>
                <input
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => onEmail(event.target.value)}
                  placeholder="trader@exemple.com"
                  className="input-field"
                />
              </div>
              {intent === 'signup' && (
                <>
                  <div>
                    <label className="mb-1.5 block text-xs uppercase tracking-[0.18em] text-[#71717a]">Pseudo</label>
                    <input
                      type="text"
                      value={name}
                      onChange={(event) => onName(event.target.value)}
                      placeholder="Ton nom de trader"
                      className="input-field"
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs uppercase tracking-[0.18em] text-[#71717a]">Telephone</label>
                    <input
                      type="tel"
                      autoComplete="tel"
                      value={phone}
                      onChange={(event) => onPhone(event.target.value)}
                      placeholder="+33 6 12 34 56 78"
                      className="input-field"
                    />
                    <p className="mt-1.5 text-[10px] text-[#71717a]">
                      Verification SMS unique a l&apos;inscription (anti multi-comptes). Format international.
                    </p>
                  </div>
                </>
              )}
            </div>
            {error && <div className="mt-3 text-sm text-[#fca5a5]">{error}</div>}
            <button
              type="button"
              onClick={onRequest}
              disabled={busy || !email.trim() || (intent === 'signup' && (!name.trim() || !phone.trim()))}
              className="blood-cta mt-5 w-full px-5 py-4 text-sm"
            >
              {busy ? 'Envoi du code...' : 'Recevoir mon code'}
            </button>
            <p className="mt-3 text-center text-[11px] text-[#71717a]">
              {intent === 'login' ? 'Pas encore inscrit ? Bascule sur Inscription.' : 'Deja un compte ? Bascule sur Connexion.'}
            </p>
          </>
        )}

        {step === 'verify-email' && (
          <>
            <div className="mt-5 flex items-center gap-2">
              <div className="step-pill step-pill-active">1. Email</div>
              <div className="h-px flex-1 bg-[#232329]" />
              <div className={`step-pill ${pendingAuth?.intent === 'signup' ? '' : 'step-pill-disabled'}`}>2. SMS</div>
            </div>
            {pendingAuth?.delivered ? (
              <div className="mt-4 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
                Code envoye a <span className="text-white">{pendingAuth.email}</span>
              </div>
            ) : (
              <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-amber-100">
                <div className="micro text-[10px] text-amber-300">
                  {pendingAuth?.deliveryError ? 'Envoi email echoue' : 'Mode dev (mailer non configure)'}
                </div>
                <div className="mt-1 text-[12px] leading-snug text-amber-200">
                  {pendingAuth?.deliveryError
                    ? `Resend: ${pendingAuth.deliveryError}`
                    : <>Code genere pour <span className="text-white">{pendingAuth?.email}</span></>}
                </div>
              </div>
            )}
            {pendingAuth?.devCode && (
              <div className="mt-3 rounded-xl border border-[#232329] bg-[#0c0c10] px-4 py-3">
                <div className="micro text-[10px] text-[#71717a]">Code de secours</div>
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
                {busy ? 'Verification...' : 'Valider'}
              </button>
              <button type="button" onClick={onBack} className="ghost-cta px-4 py-3 text-sm">
                Modifier email
              </button>
            </div>
            <button type="button" onClick={onRequest} disabled={busy} className="mt-3 w-full text-center text-xs text-[#fca5a5] transition-colors hover:text-white disabled:opacity-50">
              Renvoyer un code
            </button>
          </>
        )}

        {step === 'verify-phone' && (
          <>
            <div className="mt-5 flex items-center gap-2">
              <div className="step-pill step-pill-done">1. Email</div>
              <div className="h-px flex-1 bg-[#dc2626]/40" />
              <div className="step-pill step-pill-active">2. SMS</div>
            </div>
            {pendingAuth?.smsDelivered ? (
              <div className="mt-4 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
                SMS envoye au <span className="text-white">{pendingAuth?.phoneMasked}</span>
              </div>
            ) : (
              <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-amber-100">
                <div className="micro text-[10px] text-amber-300">
                  {pendingAuth?.smsError ? 'Envoi SMS echoue' : 'Mode dev (Twilio non configure)'}
                </div>
                <div className="mt-1 text-[12px] leading-snug text-amber-200">
                  {pendingAuth?.smsError
                    ? `Twilio: ${pendingAuth.smsError}`
                    : <>SMS non envoye, utilise le code ci-dessous</>}
                </div>
              </div>
            )}
            {pendingAuth?.devSmsCode && (
              <div className="mt-3 rounded-xl border border-[#232329] bg-[#0c0c10] px-4 py-3">
                <div className="micro text-[10px] text-[#71717a]">Code de secours</div>
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
                {busy ? 'Verification...' : 'Confirmer mon compte'}
              </button>
              <button type="button" onClick={onBack} className="ghost-cta px-4 py-3 text-sm">
                Annuler
              </button>
            </div>
            <p className="mt-3 text-center text-[11px] text-[#71717a]">
              Tu n&apos;as pas recu le SMS ? Verifie le format du numero, ou redemande un code email pour redemarrer.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function UserSummary({ user, pnlUsd, avgPnlPct, count }: { user: SessionUser; pnlUsd: number; avgPnlPct: number; count: number }) {
  const pnlTone = pnlUsd > 0 ? 'pos' : pnlUsd < 0 ? 'neg' : 'neutral';
  const avgTone = avgPnlPct > 0 ? 'pos' : avgPnlPct < 0 ? 'neg' : 'neutral';
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
            <img
              src={user.avatarUrl}
              alt=""
              className="h-9 w-9 shrink-0 rounded-xl object-cover shadow-[0_8px_24px_-8px_rgba(220,38,38,0.6)]"
            />
          ) : (
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#dc2626] to-[#7f1d1d] text-sm font-bold uppercase text-white shadow-[0_8px_24px_-8px_rgba(220,38,38,0.6)]">
              {user.name.slice(0, 2)}
            </span>
          )}
          <div className="min-w-0">
            <div className="micro text-[10px] text-[#dc2626]">Mon profil</div>
            <h3 className="display break-words text-xl font-bold leading-tight text-white sm:text-2xl">Salut {user.name}</h3>
          </div>
        </div>
        <p className="mt-1 break-all text-xs text-[#71717a] sm:text-sm">{user.email}</p>

        <div className="mt-5 grid grid-cols-3 gap-2 sm:gap-3">
          <MetricCard
            label="PnL total"
            value={pnlUsd}
            format={(v) => formatCompactSigned(v)}
            unit="$"
            tone={pnlTone}
            delayClass="rise-in-1"
          />
          <MetricCard
            label="PnL moy."
            value={avgPnlPct}
            format={(v) => formatPercent(v)}
            unit="%"
            tone={avgTone}
            delayClass="rise-in-2"
          />
          <MetricCard
            label="Arènes"
            value={count}
            format={(v) => formatCompactUnsigned(v)}
            tone="neutral"
            delayClass="rise-in-3"
          />
        </div>
      </div>
    </motion.div>
  );
}

function MyCompetitionCard({
  competition, busy, onTrade,
}: {
  competition: CompetitionMine;
  busy: boolean;
  onTrade: () => void;
}) {
  const pnlPercent = competition.myEntry.pnlPercent;
  const pnlUsd = competition.myEntry.pnlUsd;
  const pos = pnlPercent >= 0;
  const isLive = competition.status === 'live';
  const isEnded = competition.status === 'ended';
  const targetTs = isLive ? competition.endAt : competition.startAt;
  const countdown = useCountdown(targetTs);
  const fillRatio = Math.min(1, Math.abs(pnlPercent) / 100);

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

        {/* Big PnL hero block */}
        <div
          className={`metric metric-pnl-big mt-5 ${pos ? 'metric-pos' : 'metric-neg'} ${
            pnlPercent === 0 ? '' : ''
          }`}
        >
          <div className="metric-label">
            <span>Mon PnL</span>
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
            <div className="metric-label">{isLive ? 'Fin dans' : isEnded ? 'Status' : 'Démarre dans'}</div>
            <div className="metric-value" style={{ fontSize: 'clamp(1rem, 4.2vw, 1.3rem)' }}>
              {isEnded ? 'Terminée' : countdown}
            </div>
          </div>
          <div className="metric">
            <div className="metric-label">Trades</div>
            <div className="metric-value" style={{ fontSize: 'clamp(1rem, 4.2vw, 1.3rem)' }}>
              <AnimatedNumber value={competition.myEntry.tradesCount} format={(v) => formatCompactUnsigned(v)} />
            </div>
          </div>
        </div>

        <div className="mt-5 grid gap-2.5 sm:grid-cols-[2.2fr_1fr]">
          <button
            type="button"
            onClick={onTrade}
            disabled={busy || isEnded}
            className="blood-cta px-6 py-4 text-base sm:text-lg"
          >
            {busy ? '...' : isEnded ? 'Arène fermée' : 'TRADER'}
          </button>
          <Link
            to={`/compete/leaderboard/${competition.id}`}
            className="ghost-cta flex items-center justify-center px-4 py-3 text-xs uppercase tracking-[0.16em] sm:py-4"
          >
            Leaderboard
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
  const isEnded = competition.status === 'ended';
  const isLive = competition.status === 'live';
  return (
    <motion.article
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.05 * (index ?? 0), ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ y: -3 }}
      className="glass-card card-shine lift group relative overflow-hidden p-5 sm:p-6"
    >
      {isLive && <div className="hero-scanline" />}
      <div className={`pointer-events-none absolute -right-20 -top-20 h-48 w-48 rounded-full blur-3xl transition-opacity duration-300 ${isLive ? 'bg-[#dc2626]/18' : 'bg-[#dc2626]/8'} group-hover:bg-[#dc2626]/22`} />
      <div className="relative">
        <div className="flex items-start justify-between gap-3">
          <StatusPill status={competition.status} />
          <ModePill mode={competition.executionMode} />
        </div>

        <h3 className="display mt-4 break-words text-lg font-bold leading-tight text-white sm:text-xl">{competition.title}</h3>
        <PrizePreview prize={competition.cashPrize} />

        <div className="mt-5 grid grid-cols-2 gap-2.5 sm:gap-3">
          <div className="metric">
            <div className="metric-label">Traders</div>
            <div className="metric-value" style={{ fontSize: 'clamp(1rem, 4.2vw, 1.35rem)' }}>
              <AnimatedNumber value={competition.participants} format={(v) => formatCompactUnsigned(v)} />
            </div>
          </div>
          <div className="metric">
            <div className="metric-label">Période</div>
            <div className="metric-value" style={{ fontSize: 'clamp(0.85rem, 3vw, 0.95rem)' }}>
              <span className="truncate">{fmtDateShort(competition.startAt)} → {fmtDateShort(competition.endAt)}</span>
            </div>
          </div>
        </div>

        <div className="mt-5 grid gap-2.5 sm:grid-cols-[1.4fr_1fr]">
          {alreadyJoined ? (
            <span className="flex items-center justify-center gap-2 rounded-xl border border-[#10b981]/30 bg-[#10b981]/10 px-4 py-3 text-xs font-semibold uppercase tracking-[0.16em] text-[#34d399]">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
              Inscrit
            </span>
          ) : (
            <button
              type="button"
              onClick={onJoin}
              disabled={isEnded}
              className="blood-cta px-4 py-3 text-sm"
            >
              {isEnded ? 'Arène fermée' : 'Rejoindre'}
            </button>
          )}
          <Link
            to={`/compete/leaderboard/${competition.id}`}
            className="ghost-cta flex items-center justify-center px-4 py-3 text-xs uppercase tracking-[0.14em]"
          >
            Leaderboard
          </Link>
        </div>
      </div>
    </motion.article>
  );
}

function JoinCompetitionModal({
  competition, code, onCode, error, busy, onClose, onSubmit,
}: {
  competition: CompetitionPublic;
  code: string;
  onCode: (value: string) => void;
  error: string;
  busy: boolean;
  onClose: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-md" onClick={onClose}>
      <div
        className="compete compete-modal relative w-full max-w-md overflow-hidden rounded-2xl border border-[#dc2626]/30 bg-gradient-to-b from-[#1a0a0a] to-[#0a0a0d] p-7 shadow-[0_30px_80px_-20px_rgba(220,38,38,0.4)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="pointer-events-none absolute -right-20 -top-20 h-48 w-48 rounded-full bg-[#dc2626]/30 blur-3xl" />
        <div className="relative">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="micro text-[10px] text-[#fca5a5]">Rejoindre l&apos;arene</div>
              <h3 className="display mt-2 text-2xl font-bold text-white">{competition.title}</h3>
              <div className="mt-1 text-xs text-[#71717a]">{fmtDateTime(competition.startAt)} → {fmtDateTime(competition.endAt)}</div>
            </div>
            <button type="button" onClick={onClose} className="text-[#71717a] hover:text-white" aria-label="Fermer">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M6 18L18 6" /></svg>
            </button>
          </div>

          <p className="mt-5 text-sm text-[#b8b8c2]">
            Saisis le code communique par l&apos;organisateur.
          </p>
          <input
            type="text"
            value={code}
            onChange={(event) => onCode(event.target.value.toUpperCase())}
            placeholder="CODE COMPETITION"
            autoFocus
            className="input-field mt-3 text-center font-mono text-lg tracking-[0.32em]"
          />
          {error && <div className="mt-3 text-sm text-[#fca5a5]">{error}</div>}

          <div className="mt-5 grid grid-cols-[1fr_1.4fr] gap-3">
            <button type="button" onClick={onClose} className="ghost-cta px-4 py-3 text-sm">Annuler</button>
            <button type="button" onClick={onSubmit} disabled={busy || !code.trim()} className="blood-cta px-4 py-3 text-sm">
              {busy ? '...' : 'Rejoindre'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
