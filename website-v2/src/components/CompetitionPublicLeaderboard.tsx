import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import i18n from '../i18n';
import {
  AnimatedNumber,
  formatCompactSigned,
  formatCompactUnsigned,
  formatPercent,
} from './competeMetrics';
import './SpectateBroadcast.css';
import OptimizedImage, { AvatarImage } from './OptimizedImage';
import { NameBadges, type UserBadge } from './playerBadges';
import { getSponsor } from '../lib/sponsors';
import ShareCardModal from './ShareCardModal';
import type { ShareCardData } from '../lib/shareCard';
import Seo, { SITE_URL } from './Seo';
import { formatDHMS } from '../utils/formatters';
import { resolveMediaUrl } from '../utils/imageUrl';
import { countryFlag } from '../lib/country';
import { buildArenaEventJsonLd } from '../lib/structuredData';
import ArenaChat from './ArenaChat';
import PnlRaceChart, {
  mergePnlSamples,
  type PnlHistorySample,
  type PnlHistoryTrader,
  type PnlMoment,
} from './PnlRaceChart';

const REFRESH_MS = 2000;
const SESSION_KEY = 'btf-comp-session';

interface LeaderboardRow {
  rank: number;
  userId: string;
  name: string;
  avatarUrl?: string | null;
  country?: string | null;
  badges?: UserBadge[];
  pnlPercent: number;
  pnlUsd: number;
  tradesCount: number;
  updatedAt: number;
  breached?: boolean;
}

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

interface LeaderboardResponse {
  competition: {
    id: string;
    title: string;
    code?: string;
    startAt: number;
    endAt: number;
    status: 'registration' | 'starting_soon' | 'live' | 'ended';
    participants: number;
    cashPrize?: CashPrize | null;
    sponsor?: string | null;
    bannerImageUrl?: string | null;
  };
  leaderboard: LeaderboardRow[];
}

function dateLocale(): string {
  return i18n.resolvedLanguage === 'fr' ? 'fr-FR' : 'en-US';
}

function fmtDate(value: number): string {
  return new Date(value).toLocaleString(dateLocale(), { dateStyle: 'medium', timeStyle: 'short' });
}

function fmtTime(value: number): string {
  return new Date(value).toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function useCountdown(target: number): string {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return formatDHMS(target - now, i18n.language.startsWith('fr') ? 'j' : 'd');
}

function StatusPill({ status }: { status: 'registration' | 'starting_soon' | 'live' | 'ended' }) {
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

function formatPrizeAmount(amount: number, currency: string): string {
  const value = Math.round(amount).toLocaleString('en-US').replace(/,/g, ' ');
  return `${value} ${currency}`;
}

function getPrizeTitle(prize: CashPrize, t: TFunction): string {
  return prize.label || (prize.total > 0 ? formatPrizeAmount(prize.total, prize.currency) : t('leaderboard.rewardAlt'));
}

function hasPrize(prize: CashPrize | null | undefined): prize is CashPrize {
  return Boolean(
    prize && (prize.label || prize.imageUrl || prize.total > 0 || (prize.items && prize.items.length > 0)),
  );
}

function rankTierLabel(rank: number, t: TFunction): string {
  if (rank === 1) return t('leaderboard.rankTier1');
  if (rank === 2) return t('leaderboard.rankTier2');
  if (rank === 3) return t('leaderboard.rankTier3');
  return t('leaderboard.rankTierN', { rank });
}

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase() || '?';
}

export default function CompetitionPublicLeaderboard() {
  const { t } = useTranslation();
  const { id } = useParams();
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [error, setError] = useState('');
  const [lastRefresh, setLastRefresh] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [shareData, setShareData] = useState<ShareCardData | null>(null);
  const [pnlHistory, setPnlHistory] = useState<{
    samples: PnlHistorySample[];
    traders: PnlHistoryTrader[];
    moments?: PnlMoment[];
  } | null>(null);
  const pnlBufferRef = useRef<{ competitionId: string; samples: PnlHistorySample[] }>({ competitionId: '', samples: [] });
  const pnlHistoryApiRef = useRef<'unknown' | 'ok' | 'missing'>('unknown');
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const isLive = data?.competition.status === 'live';

  const applyPnlSnapshot = (competitionId: string, rows: LeaderboardRow[], moments?: PnlMoment[]) => {
    const ranked = rows.filter((row) => row.rank > 0).sort((a, b) => a.rank - b.rank).slice(0, 10);
    if (ranked.length === 0) return;
    const now = Date.now();
    const rowsSnapshot = ranked.map((row) => ({ userId: row.userId, pnlPercent: row.pnlPercent }));
    const sample: PnlHistorySample = { t: now, rows: rowsSnapshot };
    const traders: PnlHistoryTrader[] = ranked.map((row) => ({
      userId: row.userId,
      name: row.name,
      avatarUrl: row.avatarUrl,
      rank: row.rank,
      pnlPercent: row.pnlPercent,
      breached: row.breached,
    }));
    const buffer = pnlBufferRef.current;
    const seed = buffer.competitionId === competitionId
      ? [sample]
      : [{ t: now - 30_000, rows: rowsSnapshot }, sample];
    const merged = mergePnlSamples(
      buffer.competitionId === competitionId ? buffer.samples : [],
      seed,
    );
    pnlBufferRef.current = { competitionId, samples: merged };
    setPnlHistory({ samples: merged, traders, moments });
  };

  // Course au PnL : historique serveur si dispo, sinon accumulation depuis le leaderboard live.
  useEffect(() => {
    if (!id || !isLive) {
      setPnlHistory(null);
      pnlHistoryApiRef.current = 'unknown';
      pnlBufferRef.current = { competitionId: '', samples: [] };
      return;
    }
    const competitionId = id;
    let cancelled = false;

    async function loadHistory() {
      try {
        const response = await fetch(`/api/competition/leaderboard/${competitionId}/pnl-history`);
        if (!response.ok) {
          pnlHistoryApiRef.current = 'missing';
          return;
        }
        const payload = await response.json() as {
          samples?: PnlHistorySample[];
          traders?: PnlHistoryTrader[];
          moments?: PnlMoment[];
        };
        if (cancelled || !payload.samples?.length || !payload.traders?.length) {
          pnlHistoryApiRef.current = 'missing';
          return;
        }
        pnlHistoryApiRef.current = 'ok';
        const buffer = pnlBufferRef.current;
        const merged = buffer.competitionId === competitionId
          ? mergePnlSamples(buffer.samples, payload.samples)
          : mergePnlSamples([], payload.samples);
        pnlBufferRef.current = { competitionId, samples: merged };
        setPnlHistory({ samples: merged, traders: payload.traders, moments: payload.moments });
      } catch {
        pnlHistoryApiRef.current = 'missing';
      }
    }

    void loadHistory();
    const timer = window.setInterval(() => void loadHistory(), 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [id, isLive]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function tick() {
      if (cancelled) return;
      if (pausedRef.current) {
        timer = setTimeout(tick, REFRESH_MS);
        return;
      }
      try {
        const response = await fetch(`/api/competition/leaderboard/${id}`);
        const payload = await response.json();
        if (cancelled) return;
        if (!response.ok) throw new Error(payload.error || t('leaderboard.unavailable'));
        const next = payload as LeaderboardResponse;
        setData(next);
        setLastRefresh(Date.now());
        setError('');
        if (next.competition.status === 'live' && pnlHistoryApiRef.current !== 'ok') {
          applyPnlSnapshot(next.competition.id, next.leaderboard);
        }
      } catch (err: unknown) {
        if (!cancelled) setError(err instanceof Error ? err.message : t('common.unknownError'));
      } finally {
        if (!cancelled) timer = setTimeout(tick, REFRESH_MS);
      }
    }

    tick();
    const onVisibility = () => setPaused(document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [id, t]);

  useEffect(() => {
    const token = window.localStorage.getItem(SESSION_KEY);
    if (!token) return;
    fetch('/api/competition/me', { headers: { Authorization: `Bearer ${token}` } })
      .then(async (response) => {
        if (!response.ok) return null;
        return response.json();
      })
      .then((payload) => {
        if (payload?.user?.id) setCurrentUserId(String(payload.user.id));
      })
      .catch(() => undefined);
  }, []);

  // Podium + classement : rank > 0 uniquement (jamais les comptes éliminés).
  // Comptes éliminés (drawdown atteint) : section dédiée. Inscrits sans trade : liste séparée.
  const ranked = useMemo(() => (data ? data.leaderboard.filter((row) => row.rank > 0) : []), [data]);
  const breachedRows = useMemo(() => (data ? data.leaderboard.filter((row) => row.breached) : []), [data]);
  const notTraded = useMemo(() => (data ? data.leaderboard.filter((row) => row.rank === 0 && !row.breached) : []), [data]);
  const top3 = useMemo(() => ranked.slice(0, 3), [ranked]);
  const rest = useMemo(() => ranked.slice(3), [ranked]);
  const myRow = useMemo(() => (
    data && currentUserId ? data.leaderboard.find((row) => row.userId === currentUserId) || null : null
  ), [currentUserId, data]);

  const targetCountdown = data ? (data.competition.status === 'live' ? data.competition.endAt : data.competition.startAt) : Date.now();
  const countdown = useCountdown(targetCountdown);

  const aggregates = useMemo(() => {
    if (!data || data.leaderboard.length === 0) {
      return { avgPnl: 0, bestPnl: 0, totalTrades: 0 };
    }
    const traders = data.leaderboard.filter((row) => row.rank > 0);
    if (traders.length === 0) {
      return { avgPnl: 0, bestPnl: 0, totalTrades: 0 };
    }
    const totalPct = traders.reduce((acc, row) => acc + row.pnlPercent, 0);
    const totalTrades = traders.reduce((acc, row) => acc + row.tradesCount, 0);
    const bestPnl = Math.max(...traders.map((row) => row.pnlPercent));
    return {
      avgPnl: totalPct / traders.length,
      bestPnl,
      totalTrades,
    };
  }, [data]);

  async function sharePublicSpectate() {
    if (!id || !data) return;
    const url = `${window.location.origin}/spectate/${encodeURIComponent(id)}`;
    const payload = { title: data.competition.title, text: t('share.publicSpectateText', { title: data.competition.title }), url };
    if (navigator.share) {
      await navigator.share(payload).catch(() => undefined);
      return;
    }
    await navigator.clipboard?.writeText(url).catch(() => undefined);
  }

  return (
    <div className="compete spectate-cast min-h-dvh-safe bg-[#050507]">
      {data && (
        <Seo
          title={data.competition.title}
          description={t('seo.arenaDesc', { title: data.competition.title })}
          path={`/compete/leaderboard/${data.competition.id}`}
          image={
            data.competition.bannerImageUrl
              ? (data.competition.bannerImageUrl.startsWith('http')
                  ? data.competition.bannerImageUrl
                  : `${SITE_URL}${data.competition.bannerImageUrl}`)
              : undefined
          }
          jsonLd={buildArenaEventJsonLd({
            id: data.competition.id,
            title: data.competition.title,
            startAt: data.competition.startAt,
            endAt: data.competition.endAt,
            status: data.competition.status,
            bannerImageUrl: data.competition.bannerImageUrl ?? null,
            prizeLabel: hasPrize(data.competition.cashPrize)
              ? (data.competition.cashPrize?.label || undefined)
              : null,
          })}
        />
      )}
      <header
        className="compete-header sticky top-0 z-40 border-b border-[#1a1a20] bg-[rgba(5,5,7,0.92)] backdrop-blur-xl"
        style={{ paddingTop: 'max(0px, env(safe-area-inset-top))' }}
      >
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4 md:px-10">
          <Link to="/compete" className="flex items-center gap-3">
            <img src="/assets/pictures/BTF_ARENA_logo.png" alt="BTF Arena" className="h-9 w-auto object-contain" />
          </Link>
          <div className="flex items-center gap-2">
            {data && (
              <button type="button" className="ghost-cta px-4 py-2 text-sm" onClick={() => void sharePublicSpectate()}>
                {t('share.publicSpectate')}
              </button>
            )}
            <Link to="/compete" className="ghost-cta px-4 py-2 text-sm">
              {t('leaderboard.backToCompetitions')}
            </Link>
          </div>
        </div>
      </header>

      <main className="compete-bg pb-8">
        <div className="mx-auto max-w-6xl px-6 pt-10 md:px-10 md:pt-14">
          {error && (
            <div className="rounded-2xl border border-[#dc2626]/30 bg-[#dc2626]/10 px-5 py-4 text-sm text-[#fca5a5]">
              {error}
            </div>
          )}

          {!error && !data && (
            <div className="glass-card p-10 text-center text-sm text-[#b8b8c2]">
              {t('leaderboard.loading')}
            </div>
          )}

          {data && (
            <>
              {/* HERO "STADE" : bannière en fond, HUD de match par-dessus */}
              <motion.section
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                className="spec-hero"
              >
                {data.competition.bannerImageUrl && (
                  <img src={resolveMediaUrl(data.competition.bannerImageUrl)} alt="" className="spec-hero__banner" />
                )}
                <div className="spec-hero__shade" />
                <div className="spec-hero__floor" />
                <div className="spec-hero__scan" />
                <div className="spec-hero__inner">
                  <div className="flex flex-wrap items-center gap-3">
                    <StatusPill status={data.competition.status} />
                    <span className="flex items-center gap-2 rounded-full border border-[#dc2626]/30 bg-[#dc2626]/10 px-3 py-1 text-[11px] font-semibold text-[#fca5a5]">
                      <span className={`h-2 w-2 rounded-full ${paused ? 'bg-[#71717a]' : 'live-dot'}`} />
                      {paused ? t('leaderboard.paused') : t('leaderboard.live')}
                      {lastRefresh && (
                        <span className="font-normal text-[#fda4af]/70">· {t('leaderboard.updatedAt', { time: fmtTime(lastRefresh) })}</span>
                      )}
                    </span>
                    {(() => {
                      const sponsor = getSponsor(data.competition.sponsor);
                      if (!sponsor) return null;
                      return (
                        <span
                          className="flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-semibold text-white"
                          style={{ borderColor: `${sponsor.accent}80`, backgroundColor: `${sponsor.accent}26` }}
                        >
                          <img src={sponsor.logoUrl} alt={sponsor.name} className="h-3.5 w-auto object-contain" />
                          {t('sponsor.sponsoredBy', { name: sponsor.name })}
                        </span>
                      );
                    })()}
                  </div>
                  <h1 className="spec-hero__title">{data.competition.title}</h1>
                  <div className="spec-hero__dates">
                    {fmtDate(data.competition.startAt)} <span className="text-[#71717a]">→</span> {fmtDate(data.competition.endAt)}
                  </div>

                  <div className="spec-hud">
                    <div className={`spec-hud__chip ${data.competition.status === 'live' ? 'is-hot' : ''}`}>
                      <div className="spec-hud__label">
                        {data.competition.status === 'live'
                          ? t('leaderboard.endsIn')
                          : data.competition.status === 'ended'
                            ? t('leaderboard.statusLabel')
                            : t('leaderboard.startsIn')}
                        {data.competition.status === 'live' && <span className="live-dot" />}
                      </div>
                      <div className="spec-hud__value">
                        {data.competition.status === 'ended' ? t('leaderboard.ended') : countdown}
                      </div>
                    </div>
                    <div className="spec-hud__chip">
                      <div className="spec-hud__label">{t('leaderboard.participants')}</div>
                      <div className="spec-hud__value">
                        <AnimatedNumber value={data.competition.participants} format={(v) => formatCompactUnsigned(v)} />
                      </div>
                    </div>
                    <div className="spec-hud__chip">
                      <div className="spec-hud__label">{t('leaderboard.avgPnl')}</div>
                      <div className={`spec-hud__value ${aggregates.avgPnl > 0 ? 'is-pos' : aggregates.avgPnl < 0 ? 'is-neg' : ''}`}>
                        <AnimatedNumber value={aggregates.avgPnl} format={(v) => formatPercent(v)} />%
                      </div>
                    </div>
                    <div className="spec-hud__chip">
                      <div className="spec-hud__label">{t('leaderboard.totalTrades')}</div>
                      <div className="spec-hud__value">
                        <AnimatedNumber value={aggregates.totalTrades} format={(v) => formatCompactUnsigned(v)} />
                      </div>
                    </div>
                    {hasPrize(data.competition.cashPrize) && (
                      <div className="spec-hud__chip">
                        <div className="spec-hud__label">{t('leaderboard.toWin')}</div>
                        <div className="spec-hud__value is-pos">
                          {getPrizeTitle(data.competition.cashPrize, t)}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </motion.section>

              {hasPrize(data.competition.cashPrize) && (
                <CashPrizeSection prize={data.competition.cashPrize} />
              )}

              {/* TICKER D'ÉVÉNEMENTS FAÇON RÉGIE */}
              <BroadcastTicker
                moments={pnlHistory?.moments}
                traders={pnlHistory?.traders}
                leader={top3[0] || null}
                participants={data.competition.participants}
                bestPnl={aggregates.bestPnl}
              />

              {myRow && (
                <section className="mt-8 rounded-2xl border border-[#dc2626]/35 bg-[#dc2626]/10 p-4 shadow-[0_20px_70px_-45px_rgba(220,38,38,0.9)]">
                  <div className="flex items-center justify-between gap-3">
                    <div className="micro text-[10px] text-[#fca5a5]">{t('leaderboard.yourPosition')}</div>
                    {myRow.rank > 0 && (
                      <button
                        type="button"
                        onClick={() =>
                          setShareData({
                            kind: 'rank',
                            playerName: myRow.name,
                            rank: myRow.rank,
                            participants: data.competition.participants,
                            contextLabel: data.competition.title,
                            pnlPercent: myRow.pnlPercent,
                            pnlUsd: myRow.pnlUsd,
                            avatarUrl: myRow.avatarUrl,
                            badges: myRow.badges,
                          })
                        }
                        title={t('share.cta')}
                        className="flex shrink-0 items-center gap-1.5 rounded-lg border border-[#dc2626]/40 bg-[#dc2626]/15 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-[#fca5a5] transition-colors hover:border-[#dc2626]/70 hover:bg-[#dc2626]/25 hover:text-white"
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13" />
                        </svg>
                        {t('share.cta')}
                      </button>
                    )}
                  </div>
                  <RankRow row={myRow} index={0} isMe compact />
                </section>
              )}

              {/* COURSE AU PNL EN DIRECT, encadrée façon observateur esport */}
              {isLive && pnlHistory && (
                <motion.section
                  initial={{ opacity: 0, y: 22 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
                  className="spec-stage"
                >
                  <div className="spec-stage__frame">
                    <i aria-hidden="true" />
                    <span className="spec-stage__tag"><i />{t('spectateHud.feed')}</span>
                    <PnlRaceChart
                      samples={pnlHistory.samples}
                      traders={pnlHistory.traders}
                      moments={pnlHistory.moments}
                      currentUserId={currentUserId}
                    />
                  </div>
                </motion.section>
              )}

              {/* DUEL EN TÊTE */}
              {top3.length >= 2 && <VersusStrip left={top3[0]} right={top3[1]} />}

              {/* PODIUM */}
              {top3.length > 0 && (
                <section className="spec-podium mt-12">
                  <div className="spec-section-head">
                    <div>
                      <div className="micro text-[10px] text-[#dc2626]">{t('leaderboard.livePodium')}</div>
                      <h2 className="display mt-1 text-2xl font-bold text-white md:text-3xl">{t('leaderboard.top3')}</h2>
                    </div>
                  </div>
                  <div className="mt-8 grid gap-5 md:grid-cols-3 md:items-end">
                    {/* Mobile follows DOM order (1, 2, 3 — natural reading
                        order). Desktop reorders to the classical podium
                        layout (2nd left, 1st centred, 3rd right). */}
                    <div className="md:order-2"><PodiumCard row={top3[0]} place={1} /></div>
                    <div className="md:order-1"><PodiumCard row={top3[1]} place={2} /></div>
                    <div className="md:order-3"><PodiumCard row={top3[2]} place={3} /></div>
                  </div>
                </section>
              )}

              {/* RANKING TABLE */}
              <section className="mt-14">
                <div className="border-b border-[#1a1a20] pb-4">
                  <div className="micro text-[10px] text-[#dc2626]">{t('leaderboard.fullRanking')}</div>
                  <h2 className="display mt-1 text-2xl font-bold text-white md:text-3xl">{t('leaderboard.allTraders')}</h2>
                </div>

                {data.leaderboard.length === 0 ? (
                  <div className="glass-card mt-6 p-10 text-center text-sm text-[#b8b8c2]">
                    {t('leaderboard.noTraderYet')}
                  </div>
                ) : (
                  <>
                    {ranked.length > 0 ? (
                      <div className="glass-card mt-6 overflow-hidden">
                        <div className="grid grid-cols-[40px_1.7fr_1fr_0.9fr_0.5fr] items-center gap-2 border-b border-[#232329] bg-[#0c0c10] px-3 py-3 text-[9px] uppercase tracking-[0.16em] text-[#71717a] sm:grid-cols-[60px_1.6fr_0.9fr_0.9fr_0.6fr_0.9fr] sm:gap-3 sm:px-5 sm:text-[10px] md:grid-cols-[80px_1.6fr_1fr_1fr_0.7fr_1fr]">
                          <div>{t('leaderboard.thRank')}</div>
                          <div>{t('leaderboard.thTrader')}</div>
                          <div className="text-right">{t('leaderboard.thPnlPct')}</div>
                          <div className="text-right">{t('leaderboard.thPnlUsd')}</div>
                          <div className="text-right">{t('leaderboard.thTrades')}</div>
                          <div className="hidden text-right md:block">{t('leaderboard.thLastUpdate')}</div>
                        </div>
                        <div className="divide-y divide-[#1a1a20]">
                          {rest.length === 0 && (
                            <div className="px-5 py-6 text-center text-xs text-[#71717a]">
                              {t('leaderboard.podiumOnly')}
                            </div>
                          )}
                          {rest.map((row, idx) => (
                            <RankRow key={row.userId} row={row} index={idx} isMe={row.userId === currentUserId} />
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="glass-card mt-6 px-5 py-6 text-center text-sm text-[#71717a]">
                        {t('leaderboard.noRankedYet')}
                      </div>
                    )}

                    {breachedRows.length > 0 && (
                      <div className="mt-10">
                        <div className="border-b border-[#ef4444]/20 pb-4">
                          <div className="micro text-[10px] text-[#ef4444]/80">{t('leaderboard.breachedList')}</div>
                          <h3 className="display mt-1 text-xl font-bold text-[#fca5a5] md:text-2xl">{t('leaderboard.breachedSectionTitle')}</h3>
                          <p className="mt-2 text-sm text-[#71717a]">{t('leaderboard.breachedSectionHint')}</p>
                        </div>
                        <div className="glass-card mt-5 overflow-hidden border border-[#ef4444]/20">
                          <div className="grid grid-cols-[40px_1.7fr_1fr_0.9fr_0.5fr] items-center gap-2 border-b border-[#232329] bg-[#0c0c10] px-3 py-3 text-[9px] uppercase tracking-[0.16em] text-[#71717a] sm:grid-cols-[60px_1.6fr_0.9fr_0.9fr_0.6fr_0.9fr] sm:gap-3 sm:px-5 sm:text-[10px] md:grid-cols-[80px_1.6fr_1fr_1fr_0.7fr_1fr]">
                            <div>{t('leaderboard.thRank')}</div>
                            <div>{t('leaderboard.thTrader')}</div>
                            <div className="text-right">{t('leaderboard.thPnlPct')}</div>
                            <div className="text-right">{t('leaderboard.thPnlUsd')}</div>
                            <div className="text-right">{t('leaderboard.thTrades')}</div>
                            <div className="hidden text-right md:block">{t('leaderboard.thLastUpdate')}</div>
                          </div>
                          <div className="divide-y divide-[#1a1a20]">
                            {breachedRows.map((row, idx) => (
                              <RankRow key={row.userId} row={row} index={idx} isMe={row.userId === currentUserId} />
                            ))}
                          </div>
                        </div>
                      </div>
                    )}

                    {notTraded.length > 0 && (
                      <div className="mt-10">
                        <div className="border-b border-[#1a1a20] pb-4">
                          <div className="micro text-[10px] text-[#71717a]">{t('leaderboard.enrolledList')}</div>
                          <h3 className="display mt-1 text-xl font-bold text-white md:text-2xl">{t('leaderboard.enrolledNoTrade')}</h3>
                          <p className="mt-2 text-sm text-[#71717a]">{t('leaderboard.enrolledNoTradeHint')}</p>
                        </div>
                        <div className="glass-card mt-5 overflow-hidden">
                          <div className="grid grid-cols-[1.6fr_0.9fr_0.6fr] items-center gap-2 border-b border-[#232329] bg-[#0c0c10] px-3 py-3 text-[9px] uppercase tracking-[0.16em] text-[#71717a] sm:grid-cols-[1.8fr_0.9fr_0.6fr] sm:gap-3 sm:px-5 sm:text-[10px]">
                            <div>{t('leaderboard.thTrader')}</div>
                            <div className="text-right">{t('leaderboard.thTrades')}</div>
                            <div className="hidden text-right sm:block">{t('leaderboard.thLastUpdate')}</div>
                          </div>
                          <div className="divide-y divide-[#1a1a20]">
                            {notTraded.map((row, idx) => (
                              <EnrolledRow key={row.userId} row={row} index={idx} isMe={row.userId === currentUserId} />
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </section>
            </>
          )}
        </div>
      </main>
      <ShareCardModal open={shareData != null} data={shareData} onClose={() => setShareData(null)} />
      {id && data && <ArenaChat competitionId={id} title={data.competition.title} />}
    </div>
  );
}

/* ----------------------------- SUB COMPONENTS ----------------------------- */

/** Bandeau défilant façon régie TV : moments forts + stats de l'arène. */
function BroadcastTicker({
  moments,
  traders,
  leader,
  participants,
  bestPnl,
}: {
  moments?: PnlMoment[];
  traders?: PnlHistoryTrader[];
  leader: LeaderboardRow | null;
  participants: number;
  bestPnl: number;
}) {
  const { t } = useTranslation();
  const items = useMemo(() => {
    const names = new Map((traders || []).map((trader) => [trader.userId, trader.name]));
    const list: Array<{ key: string; text: string; hot?: boolean }> = [];
    if (leader) {
      list.push({ key: 'leader', text: `👑 ${t('raceChart.dominates', { name: leader.name })}`, hot: true });
    }
    for (const moment of (moments || []).slice(-6).reverse()) {
      const name = names.get(moment.userId) || 'Trader';
      list.push({
        key: `${moment.t}-${moment.userId}-${moment.type}`,
        text: `${moment.type === 'leader' ? '⚡' : '▲'} ${t(moment.type === 'leader' ? 'raceChart.momentLeader' : 'raceChart.momentTop3', { name })}`,
      });
    }
    list.push({ key: 'traders', text: `${participants} ${t('leaderboard.participants')}` });
    if (Number.isFinite(bestPnl) && bestPnl !== 0) {
      list.push({ key: 'best', text: `${t('spectateHud.best')} ${bestPnl >= 0 ? '+' : ''}${bestPnl.toFixed(2)}%`, hot: bestPnl > 0 });
    }
    return list;
  }, [moments, traders, leader, participants, bestPnl, t]);

  if (items.length === 0) return null;
  const track = [...items, ...items];
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
  );
}

/** Duel en tête : n°1 contre n°2 avec barre de domination animée. */
function VersusStrip({ left, right }: { left: LeaderboardRow; right: LeaderboardRow }) {
  const { t } = useTranslation();
  // Répartition de la barre : parts relatives des deux PnL ramenés en positif.
  const leftScore = Math.max(0.0001, left.pnlPercent - Math.min(0, Math.min(left.pnlPercent, right.pnlPercent)) + 0.5);
  const rightScore = Math.max(0.0001, right.pnlPercent - Math.min(0, Math.min(left.pnlPercent, right.pnlPercent)) + 0.5);
  const leftShare = Math.round((leftScore / (leftScore + rightScore)) * 100);
  const gap = Math.abs(left.pnlPercent - right.pnlPercent);

  function side(row: LeaderboardRow, position: 'left' | 'right', label: string) {
    const pos = row.pnlPercent >= 0;
    return (
      <Link to={`/compete/player/${row.userId}`} className={`spec-vs__side ${position === 'right' ? 'is-right' : ''}`}>
        <span className="spec-vs__avatar">
          {row.avatarUrl
            ? <AvatarImage src={row.avatarUrl} alt={row.name} className="h-full w-full object-cover" sizePx={74} />
            : <b>{getInitials(row.name)}</b>}
        </span>
        <span className="spec-vs__meta">
          <small>{label}</small>
          <strong>{row.name}{countryFlag(row.country) ? ` ${countryFlag(row.country)}` : ''}</strong>
          <em className={pos ? 'is-pos' : 'is-neg'}>
            {pos ? '+' : ''}{row.pnlPercent.toFixed(2)}%
          </em>
        </span>
      </Link>
    );
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 22 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
      className="spec-vs"
      aria-label={t('spectateHud.faceoff')}
    >
      <div className="spec-vs__row">
        {side(left, 'left', t('leaderboard.rankTier1'))}
        <span className="spec-vs__badge">VS</span>
        {side(right, 'right', t('leaderboard.rankTier2'))}
      </div>
      <div className="spec-vs__bar">
        <i style={{ width: `${leftShare}%` }} />
        <i style={{ width: `${100 - leftShare}%` }} />
        <span className="spec-vs__gap">Δ {gap.toFixed(2)}%</span>
      </div>
    </motion.section>
  );
}

function PrizeItemCard({ item, index, t }: { item: CashPrizeItem; index: number; t: TFunction }) {
  const tier = item.rank === 1 ? 'gold' : item.rank === 2 ? 'silver' : item.rank === 3 ? 'bronze' : '';
  return (
    <div className="overflow-hidden rounded-2xl border border-[#232329] bg-gradient-to-br from-[#15151c] to-[#0a0a0d] transition-colors hover:border-amber-500/30">
      <div className="relative flex aspect-[4/3] w-full items-center justify-center p-4">
        {item.rank ? (
          <span className={`rank-circle ${tier} absolute left-3 top-3 z-10 h-8 w-8 text-sm shadow-lg`}>{item.rank}</span>
        ) : null}
        {item.imageUrl ? (
          <OptimizedImage
            src={item.imageUrl}
            alt={item.title || `Lot ${index + 1}`}
            className="max-h-full max-w-full object-contain"
            displayWidth={512}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-amber-200/70">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M20 12v8H4v-8" />
              <path d="M2 7h20v5H2z" />
              <path d="M12 22V7" />
              <path d="M12 7H7.5a2.5 2.5 0 1 1 2.1-3.85C10.6 4.55 12 7 12 7Z" />
              <path d="M12 7h4.5a2.5 2.5 0 1 0-2.1-3.85C13.4 4.55 12 7 12 7Z" />
            </svg>
          </div>
        )}
      </div>
      <div className="border-t border-[#1a1a20] p-4">
        {item.rank ? (
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-amber-300/85">
            {rankTierLabel(item.rank, t)}
          </div>
        ) : null}
        {item.title && <div className="mt-1 text-base font-bold text-white">{item.title}</div>}
        {item.description && (
          <p className="mt-1.5 whitespace-pre-line text-xs leading-relaxed text-[#b8b8c2]">{item.description}</p>
        )}
      </div>
    </div>
  );
}

function CashPrizeSection({ prize }: { prize: CashPrize }) {
  const { t } = useTranslation();
  const breakdown = prize.breakdown && prize.breakdown.length > 0 ? prize.breakdown.slice(0, 6) : null;
  const items = prize.items && prize.items.length > 0 ? prize.items : null;
  // Un vrai prix principal = un titre OU un montant cash. Une simple image
  // sans titre/montant n'est pas un "prix" en soi.
  const hasMainPrize = Boolean(prize.label || prize.total > 0);
  // On masque le bloc "lot principal + répartition" dès qu'il y a des lots
  // par place : ce sont eux la récompense. On garde le hero si un vrai prix
  // existe, une répartition cash existe, ou une image seule sans lots.
  const showHero = hasMainPrize || Boolean(breakdown) || (Boolean(prize.imageUrl) && !items);
  const prizeTitle = getPrizeTitle(prize, t);
  return (
    <section className="mt-6">
      <div className="border-b border-[#1a1a20] pb-4">
        <div className="micro text-[10px] text-amber-400/90">{t('leaderboard.reward')}</div>
        <h2 className="display mt-1 text-2xl font-bold text-white md:text-3xl">{t('leaderboard.toWin')}</h2>
      </div>

      {showHero && (
        <div className="mt-6 grid gap-5 lg:grid-cols-[1.05fr_1fr]">
          <div className="relative overflow-hidden rounded-2xl border border-amber-500/30 bg-gradient-to-br from-[#241a05] via-[#0f0a04] to-[#0a0a0d] p-7 md:p-9">
            <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-amber-500/15 blur-3xl" />
            <div className="pointer-events-none absolute -left-24 -bottom-24 h-72 w-72 rounded-full bg-[#dc2626]/15 blur-3xl" />
            <div className="relative grid gap-6 sm:grid-cols-[150px_1fr] sm:items-center">
              <div className="overflow-hidden rounded-2xl border border-amber-400/25 bg-[#0a0a0d] shadow-[0_24px_80px_-45px_rgba(245,158,11,0.9)]">
                {prize.imageUrl ? (
                  <OptimizedImage
                    src={prize.imageUrl}
                    alt={prizeTitle}
                    className="aspect-square w-full object-cover"
                    displayWidth={480}
                  />
                ) : (
                  <div className="flex aspect-square w-full items-center justify-center text-amber-200">
                    <svg width="58" height="58" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M20 12v8H4v-8" />
                      <path d="M2 7h20v5H2z" />
                      <path d="M12 22V7" />
                      <path d="M12 7H7.5a2.5 2.5 0 1 1 2.1-3.85C10.6 4.55 12 7 12 7Z" />
                      <path d="M12 7h4.5a2.5 2.5 0 1 0-2.1-3.85C13.4 4.55 12 7 12 7Z" />
                    </svg>
                  </div>
                )}
              </div>
              <div>
                <div className="micro text-[10px] text-amber-300/80">{t('leaderboard.mainPrize')}</div>
                <div className="display mt-2 text-4xl font-bold leading-tight text-white md:text-5xl">{prizeTitle}</div>
                {prize.total > 0 && prize.label && (
                  <div className="mt-3 inline-flex rounded-full border border-amber-400/25 bg-amber-400/10 px-3 py-1 text-sm font-semibold text-amber-200">
                    {t('leaderboard.cashValue', { amount: formatPrizeAmount(prize.total, prize.currency) })}
                  </div>
                )}
                <p className="mt-4 max-w-md whitespace-pre-line text-sm leading-relaxed text-[#b8b8c2]">
                  {prize.description?.trim()
                    ? prize.description
                    : t('leaderboard.defaultPrizeDesc')}
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-[#232329] bg-[#0c0c10] p-6">
            <div className="micro text-[10px] text-[#71717a]">{t('leaderboard.breakdown')}</div>
            {breakdown ? (
              <div className="mt-4 space-y-2.5">
                {breakdown.map((row) => {
                  const tier = row.rank === 1 ? 'gold' : row.rank === 2 ? 'silver' : row.rank === 3 ? 'bronze' : '';
                  const label = rankTierLabel(row.rank, t);
                  return (
                    <div key={row.rank} className="flex items-center gap-3 rounded-xl border border-[#1a1a20] bg-[#0a0a0d] px-3.5 py-2.5">
                      <span className={`rank-circle ${tier} h-9 w-9 text-sm`}>{row.rank}</span>
                      <span className="text-sm font-semibold text-[#e0e2ea]">{label}</span>
                      <span className="num ml-auto text-base font-bold text-white">
                        {formatPrizeAmount(row.amount, prize.currency)}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="mt-4 rounded-xl border border-dashed border-[#232329] bg-[#0a0a0d] px-4 py-6 text-center text-sm text-[#71717a]">
                {t('leaderboard.breakdownTba')}
              </div>
            )}
          </div>
        </div>
      )}

      {items && (
        <div className={showHero ? 'mt-8' : 'mt-6'}>
          {showHero && (
            <div className="micro mb-4 text-[10px] text-amber-400/90">{t('leaderboard.otherPrizes')}</div>
          )}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item, index) => (
              <PrizeItemCard key={index} item={item} index={index} t={t} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function PodiumCard({ row, place }: { row?: LeaderboardRow; place: 1 | 2 | 3 }) {
  const { t } = useTranslation();
  if (!row) {
    return (
      <div className="glass-card flex h-44 items-center justify-center text-sm text-[#71717a]">
        {t('leaderboard.waitingFor', { place })}
      </div>
    );
  }
  const pos = row.pnlPercent >= 0;
  const tier = place === 1 ? 'gold' : place === 2 ? 'silver' : 'bronze';
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.55, delay: 0.05 * place, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ y: place === 1 ? -16 : -4 }}
      className={`podium-card podium-${place} card-shine`}
    >
      <div className={`rank-circle ${tier} mx-auto`}>{place}</div>
      <div className="mx-auto mt-4 h-14 w-14 overflow-hidden rounded-2xl bg-gradient-to-br from-[#1a0a0a] to-[#0a0a0d] shadow-inner">
        {row.avatarUrl ? (
          <AvatarImage
            src={row.avatarUrl}
            alt={row.name}
            className="h-full w-full object-cover"
            sizePx={56}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-base font-bold text-white">
            {getInitials(row.name)}
          </div>
        )}
      </div>
      <Link
        to={`/compete/player/${row.userId}`}
        className="display group mt-3 flex items-center justify-center gap-1.5 text-base font-bold text-white sm:text-lg"
        title={t('playerProfile.viewProfile')}
      >
        <span className="truncate underline-offset-2 group-hover:underline">{row.name}{countryFlag(row.country) ? ` ${countryFlag(row.country)}` : ''}</span>
        <NameBadges badges={row.badges} />
        {row.breached && (
          <span
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-[#ef4444]/45 bg-[#ef4444]/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em] text-[#fca5a5]"
            title={t('leaderboard.breachedTitle')}
          >
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
            {t('leaderboard.breached')}
          </span>
        )}
      </Link>
      <div
        className={`metric-value mt-2 justify-center ${pos ? 'is-pos' : 'is-neg'}`}
        style={{ fontSize: 'clamp(1.6rem, 8vw, 2.2rem)' }}
      >
        <AnimatedNumber value={row.pnlPercent} format={(v) => formatPercent(v)} />
        <span className="unit">%</span>
      </div>
      <div className="mt-2 flex items-center justify-center">
        <span className={`pnl-pill ${pos ? 'up' : 'down'}`}>
          <AnimatedNumber value={row.pnlUsd} format={(v) => formatCompactSigned(v)} />
          <span className="text-[#71717a]">USD</span>
        </span>
      </div>
      <div className="mt-3 flex items-center justify-center gap-3 text-[11px] text-[#71717a]">
        <span><span className="text-[#b8b8c2]">{row.tradesCount}</span> {t('leaderboard.trades')}</span>
        <span>·</span>
        <span>{t('leaderboard.updatedAt', { time: fmtTime(row.updatedAt) })}</span>
      </div>
    </motion.div>
  );
}

function RankRow({ row, index, isMe = false, compact = false }: { row: LeaderboardRow; index: number; isMe?: boolean; compact?: boolean }) {
  const { t } = useTranslation();
  const noTrade = row.rank === 0 && !row.breached;
  const pos = row.pnlPercent >= 0;
  const tier = row.rank === 1 ? 'gold' : row.rank === 2 ? 'silver' : row.rank === 3 ? 'bronze' : '';
  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.4, delay: Math.min(index, 12) * 0.025, ease: [0.22, 1, 0.36, 1] }}
      className={`row-hover grid grid-cols-[40px_1.7fr_1fr_0.9fr_0.5fr] items-center gap-2 border-l px-3 text-sm sm:grid-cols-[60px_1.6fr_0.9fr_0.9fr_0.6fr_0.9fr] sm:gap-3 sm:px-5 md:grid-cols-[80px_1.6fr_1fr_1fr_0.7fr_1fr] ${compact ? 'py-2 sm:py-2' : 'py-3 sm:py-3.5'} ${isMe ? 'border-[#dc2626] bg-[#dc2626]/10' : 'border-transparent'} ${noTrade ? 'opacity-60' : ''}`}
    >
      <div>
        {noTrade ? (
          <span className="flex h-8 w-8 items-center justify-center text-base font-bold text-[#52525b]">—</span>
        ) : (
          <span className={`rank-circle ${tier}`}>{row.rank}</span>
        )}
      </div>
      <Link
        to={`/compete/player/${row.userId}`}
        className="group flex min-w-0 items-center gap-2 overflow-hidden sm:gap-3"
        title={t('playerProfile.viewProfile')}
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gradient-to-br from-[#1a0a0a] to-[#0a0a0d] text-[10px] font-bold uppercase text-white sm:h-8 sm:w-8 sm:text-[11px]">
          {row.avatarUrl ? (
            <AvatarImage
              src={row.avatarUrl}
              alt={row.name}
              className="h-full w-full object-cover"
              sizePx={32}
            />
          ) : (
            getInitials(row.name)
          )}
        </span>
        <span className="display flex min-w-0 items-center gap-1 text-sm font-semibold text-white sm:gap-2 sm:text-base">
          <span className="truncate underline-offset-2 group-hover:underline">{row.name}{countryFlag(row.country) ? ` ${countryFlag(row.country)}` : ''}</span>
          <NameBadges badges={row.badges} compact />
          {row.breached && (
            <span
              className="inline-flex shrink-0 items-center gap-1 rounded border border-[#ef4444]/45 bg-[#ef4444]/15 px-1 py-0.5 text-[9px] font-bold uppercase text-[#fca5a5] sm:rounded-md sm:px-1.5 sm:tracking-[0.1em]"
              title={t('leaderboard.breachedTitle')}
              aria-label={t('leaderboard.breachedTitle')}
            >
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
              <span className="hidden sm:inline">{t('leaderboard.breached')}</span>
            </span>
          )}
          {isMe && (
            <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[#dc2626]/45 bg-[#dc2626]/18 text-[#fca5a5]" title={t('leaderboard.yourRanking')} aria-label={t('leaderboard.yourRanking')}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 21a8 8 0 0 0-16 0" />
                <circle cx="12" cy="7" r="4" />
              </svg>
            </span>
          )}
        </span>
      </Link>
      {noTrade ? (
        <div className="col-span-3 text-right text-xs font-medium uppercase tracking-[0.12em] text-[#71717a] sm:col-span-4 md:col-span-3">
          {t('leaderboard.noTrade')}
        </div>
      ) : (
        <>
          <div className={`num truncate text-right font-bold ${pos ? 'text-[#10b981]' : 'text-[#ef4444]'}`}>
            <AnimatedNumber value={row.pnlPercent} format={(v) => formatPercent(v)} />
            <span className="ml-0.5 text-[0.7em] text-[#52525b]">%</span>
          </div>
          <div className={`num truncate text-right ${pos ? 'text-[#34d399]' : 'text-[#fca5a5]'}`}>
            <AnimatedNumber value={row.pnlUsd} format={(v) => formatCompactSigned(v)} />
          </div>
          <div className="num truncate text-right text-[#b8b8c2]">{row.tradesCount}</div>
        </>
      )}
      <div className="hidden truncate text-right text-[11px] text-[#71717a] md:block">{fmtTime(row.updatedAt)}</div>
    </motion.div>
  );
}

/** Inscrit sans trade : visible dans la liste mais hors classement (pas de rang). */
function EnrolledRow({ row, index, isMe = false }: { row: LeaderboardRow; index: number; isMe?: boolean }) {
  const { t } = useTranslation();
  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.4, delay: Math.min(index, 12) * 0.025, ease: [0.22, 1, 0.36, 1] }}
      className={`row-hover grid grid-cols-[1.6fr_0.9fr_0.6fr] items-center gap-2 border-l px-3 py-3 text-sm sm:grid-cols-[1.8fr_0.9fr_0.6fr] sm:gap-3 sm:px-5 ${isMe ? 'border-[#dc2626] bg-[#dc2626]/10' : 'border-transparent'}`}
    >
      <Link
        to={`/compete/player/${row.userId}`}
        className="group flex min-w-0 items-center gap-2 overflow-hidden sm:gap-3"
        title={t('playerProfile.viewProfile')}
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gradient-to-br from-[#1a0a0a] to-[#0a0a0d] text-[10px] font-bold uppercase text-white sm:h-8 sm:w-8 sm:text-[11px]">
          {row.avatarUrl ? (
            <AvatarImage src={row.avatarUrl} alt={row.name} className="h-full w-full object-cover" sizePx={32} />
          ) : (
            getInitials(row.name)
          )}
        </span>
        <span className="display flex min-w-0 items-center gap-1 text-sm font-semibold text-white sm:gap-2 sm:text-base">
          <span className="truncate underline-offset-2 group-hover:underline">{row.name}{countryFlag(row.country) ? ` ${countryFlag(row.country)}` : ''}</span>
          <NameBadges badges={row.badges} compact />
          {row.breached && (
            <span
              className="inline-flex shrink-0 items-center gap-1 rounded border border-[#ef4444]/45 bg-[#ef4444]/15 px-1 py-0.5 text-[9px] font-bold uppercase text-[#fca5a5] sm:rounded-md sm:px-1.5 sm:tracking-[0.1em]"
              title={t('leaderboard.breachedTitle')}
              aria-label={t('leaderboard.breachedTitle')}
            >
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
              <span className="hidden sm:inline">{t('leaderboard.breached')}</span>
            </span>
          )}
          {isMe && (
            <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[#dc2626]/45 bg-[#dc2626]/18 text-[#fca5a5]" title={t('leaderboard.yourRanking')} aria-label={t('leaderboard.yourRanking')}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 21a8 8 0 0 0-16 0" />
                <circle cx="12" cy="7" r="4" />
              </svg>
            </span>
          )}
        </span>
      </Link>
      <div className="num truncate text-right text-[#71717a]">{row.tradesCount}</div>
      <div className="hidden truncate text-right text-[11px] text-[#71717a] sm:block">{fmtTime(row.updatedAt)}</div>
    </motion.div>
  );
}
