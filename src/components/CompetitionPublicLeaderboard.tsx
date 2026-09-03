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
import OptimizedImage, { AvatarImage } from './OptimizedImage';
import { NameBadges, type UserBadge } from './playerBadges';
import { resolveArenaBrand, safeHttpHref } from '../lib/sponsors';
import { resolveMediaUrl } from '../utils/imageUrl';
import ShareCardModal from './ShareCardModal';
import type { ShareCardData } from '../lib/shareCard';
import Seo, { SITE_URL } from './Seo';
import { formatDHMS } from '../utils/formatters';
import { buildArenaEventJsonLd } from '../lib/structuredData';
import ArenaChat from './ArenaChat';
import PnlRaceChart, {
  mergePnlSamples,
  type PnlHistorySample,
  type PnlHistoryTrader,
  type PnlMoment,
} from './PnlRaceChart';
import './SpectateBroadcast.css';

const REFRESH_MS = 2000;
const SESSION_KEY = 'btf-comp-session';

interface LeaderboardRow {
  rank: number;
  userId: string;
  name: string;
  avatarUrl?: string | null;
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
    sponsorName?: string | null;
    sponsorLogoUrl?: string | null;
    bannerImageUrl?: string | null;
    bannerHref?: string | null;
    promoTitle?: string | null;
    promoSubtitle?: string | null;
    promoHref?: string | null;
    promoCta?: string | null;
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

function prizeItemKey(item: CashPrizeItem): string {
  return `${item.title || ''}\n${item.imageUrl || ''}\n${item.description || ''}`;
}

function formatRankSpan(ranks: number[], t: TFunction): string {
  if (ranks.length === 0) return '';
  const sorted = [...ranks].sort((a, b) => a - b);
  if (sorted.length === 1) return rankTierLabel(sorted[0], t);
  const consecutive = sorted.every((rank, index) => index === 0 || rank === sorted[index - 1] + 1);
  if (consecutive) {
    return t('leaderboard.rankRange', {
      from: rankTierLabel(sorted[0], t),
      to: rankTierLabel(sorted[sorted.length - 1], t),
    });
  }
  return sorted.map((rank) => rankTierLabel(rank, t)).join(', ');
}

type PrizeGroup = { item: CashPrizeItem; ranks: number[] };

function groupPrizeItems(items: CashPrizeItem[]): PrizeGroup[] {
  const ranked = items
    .filter((item) => Number(item.rank) > 0)
    .sort((a, b) => Number(a.rank) - Number(b.rank));
  const unranked = items.filter((item) => !Number(item.rank));
  const ordered = ranked.length > 0 ? [...ranked, ...unranked] : items;
  const groups: PrizeGroup[] = [];
  for (const item of ordered) {
    const last = groups[groups.length - 1];
    if (last && prizeItemKey(last.item) === prizeItemKey(item)) {
      if (item.rank) last.ranks.push(item.rank);
    } else {
      groups.push({ item, ranks: item.rank ? [item.rank] : [] });
    }
  }
  return groups;
}

function PrizeGiftIcon({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 12v8H4v-8" />
      <path d="M2 7h20v5H2z" />
      <path d="M12 22V7" />
      <path d="M12 7H7.5a2.5 2.5 0 1 1 2.1-3.85C10.6 4.55 12 7 12 7Z" />
      <path d="M12 7h4.5a2.5 2.5 0 1 0-2.1-3.85C13.4 4.55 12 7 12 7Z" />
    </svg>
  );
}

function PrizeThumb({ src, alt, size = 56 }: { src?: string | null; alt: string; size?: number }) {
  return (
    <div
      className="flex shrink-0 items-center justify-center overflow-hidden rounded-xl border border-amber-400/20 bg-[#16120a] text-amber-200/80"
      style={{ width: size, height: size }}
    >
      {src ? (
        <OptimizedImage src={src} alt={alt} className="h-full w-full object-contain p-1" displayWidth={Math.max(size * 2, 128)} />
      ) : (
        <PrizeGiftIcon size={Math.round(size * 0.48)} />
      )}
    </div>
  );
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
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const isLive = data?.competition.status === 'live';
  const isEnded = data?.competition.status === 'ended';
  const showRace = Boolean(isLive || isEnded);

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
        if (next.competition.status === 'live' && id) {
          applyPnlSnapshot(id, next.leaderboard);
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

  const applyPnlSnapshot = (competitionId: string, rows: LeaderboardRow[], moments?: PnlMoment[]) => {
    const rankedRows = rows.filter((row) => row.rank > 0).sort((a, b) => a.rank - b.rank).slice(0, 40);
    if (rankedRows.length === 0) return;
    const now = Date.now();
    const rowsSnapshot = rankedRows.map((row) => ({ userId: row.userId, pnlPercent: row.pnlPercent }));
    const sample: PnlHistorySample = { t: now, rows: rowsSnapshot };
    const traders: PnlHistoryTrader[] = rankedRows.map((row) => ({
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

  useEffect(() => {
    if (!id || !showRace) {
      setPnlHistory(null);
      pnlBufferRef.current = { competitionId: '', samples: [] };
      return;
    }
    const competitionId = id;
    let cancelled = false;

    async function loadHistory() {
      try {
        const response = await fetch(`/api/competition/leaderboard/${competitionId}/pnl-history`);
        if (!response.ok) return;
        const payload = await response.json() as {
          samples?: PnlHistorySample[];
          traders?: PnlHistoryTrader[];
          moments?: PnlMoment[];
        };
        if (cancelled || !payload.samples?.length || !payload.traders?.length) return;
        const buffer = pnlBufferRef.current;
        const merged = buffer.competitionId === competitionId
          ? mergePnlSamples(buffer.samples, payload.samples)
          : mergePnlSamples([], payload.samples);
        pnlBufferRef.current = { competitionId, samples: merged };
        setPnlHistory({ samples: merged, traders: payload.traders, moments: payload.moments });
      } catch {
        // Le snapshot leaderboard reste un fallback.
      }
    }

    void loadHistory();
    const timer = isLive ? window.setInterval(() => void loadHistory(), 10_000) : 0;
    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
    };
  }, [id, isLive, showRace]);

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

  const brand = data ? resolveArenaBrand(data.competition, resolveMediaUrl) : null;

  return (
    <div className="compete min-h-dvh-safe bg-[#050507]">
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
              {brand?.bannerUrl && (
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                  className="mb-6 overflow-hidden rounded-2xl border border-[#232329] bg-black shadow-[0_20px_60px_-20px_rgba(0,0,0,0.85)]"
                >
                  {brand.bannerHref ? (
                    <a
                      href={brand.bannerHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400"
                    >
                      <img
                        src={brand.bannerUrl}
                        alt={data.competition.title}
                        className="h-[110px] w-full object-contain object-center sm:h-[170px] lg:h-[210px]"
                        loading="lazy"
                      />
                    </a>
                  ) : (
                    <img
                      src={brand.bannerUrl}
                      alt={data.competition.title}
                      className="h-[110px] w-full object-contain object-center sm:h-[170px] lg:h-[210px]"
                      loading="lazy"
                    />
                  )}
                </motion.div>
              )}

              <section className="relative overflow-hidden rounded-3xl border border-white/[0.08] bg-[#09090d] px-5 py-6 md:px-8 md:py-8">
                <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill status={data.competition.status} />
                  {id && <ArenaChat competitionId={id} title={data.competition.title} />}
                  <span className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[11px] font-semibold text-[#cfcfd6]">
                    <span className={`h-2 w-2 rounded-full ${paused ? 'bg-[#71717a]' : 'live-dot'}`} />
                    {paused ? t('leaderboard.paused') : data.competition.status === 'ended' ? t('leaderboard.ended') : t('leaderboard.live')}
                    {lastRefresh && data.competition.status === 'live' && (
                      <span className="font-normal text-[#71717a]">· {fmtTime(lastRefresh)}</span>
                    )}
                  </span>
                  {brand && (brand.logoUrl || brand.name !== 'Sponsor') && (
                    <span
                      className="ml-auto flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-semibold text-white"
                      style={{ borderColor: `${brand.accent}80`, backgroundColor: `${brand.accent}26` }}
                    >
                      {brand.logoUrl && (
                        <img src={brand.logoUrl} alt={brand.name} className="h-3.5 w-auto object-contain" />
                      )}
                      {brand.name}
                    </span>
                  )}
                </div>
                <h1 className="display mt-4 text-4xl font-black uppercase leading-[0.95] text-white md:text-6xl">
                  {data.competition.title}
                </h1>
                <div className="mt-3 text-sm text-[#8f8b93]">
                  {fmtDate(data.competition.startAt)} <span className="text-[#4b4b53]">→</span> {fmtDate(data.competition.endAt)}
                </div>
                <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <div className="rounded-2xl border border-white/[0.07] bg-black/30 px-3.5 py-3">
                    <div className="micro text-[9px] text-[#71717a]">
                      {data.competition.status === 'live' ? t('leaderboard.endsIn') : data.competition.status === 'ended' ? t('leaderboard.statusLabel') : t('leaderboard.startsIn')}
                    </div>
                    <div className="num mt-1 text-lg font-bold text-white md:text-xl">
                      {data.competition.status === 'ended' ? t('leaderboard.ended') : countdown}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-white/[0.07] bg-black/30 px-3.5 py-3">
                    <div className="micro text-[9px] text-[#71717a]">{t('leaderboard.participants')}</div>
                    <div className="num mt-1 text-lg font-bold text-white md:text-xl">{formatCompactUnsigned(data.competition.participants)}</div>
                  </div>
                  <div className="rounded-2xl border border-white/[0.07] bg-black/30 px-3.5 py-3">
                    <div className="micro text-[9px] text-[#71717a]">{t('leaderboard.avgPnl')}</div>
                    <div className={`num mt-1 text-lg font-bold md:text-xl ${aggregates.avgPnl > 0 ? 'text-[#34d399]' : aggregates.avgPnl < 0 ? 'text-[#f87171]' : 'text-white'}`}>
                      {formatPercent(aggregates.avgPnl)}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-white/[0.07] bg-black/30 px-3.5 py-3">
                    <div className="micro text-[9px] text-[#71717a]">{t('leaderboard.totalTrades')}</div>
                    <div className="num mt-1 text-lg font-bold text-white md:text-xl">{formatCompactUnsigned(aggregates.totalTrades)}</div>
                  </div>
                </div>
              </section>

              {hasPrize(data.competition.cashPrize) && (
                <CashPrizeSection prize={data.competition.cashPrize} />
              )}

              <PromoCtaSection
                title={data.competition.promoTitle}
                subtitle={data.competition.promoSubtitle}
                href={data.competition.promoHref}
                cta={data.competition.promoCta}
                logoUrl={brand?.logoUrl}
                accent={brand?.accent}
              />

              {myRow && (
                <section className="mt-6 overflow-hidden rounded-2xl border border-[#dc2626]/30 bg-[#dc2626]/8">
                  <div className="flex items-center justify-between gap-3 px-4 pt-3">
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

              {showRace && pnlHistory && (
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
                      ended={isEnded}
                    />
                  </div>
                </motion.section>
              )}

              <section className="mt-10">
                <div className="flex items-end justify-between gap-4 border-b border-white/[0.08] pb-4">
                  <div>
                    <div className="micro text-[10px] text-[#dc2626]">{t('leaderboard.fullRanking')}</div>
                    <h2 className="display mt-1 text-2xl font-black uppercase text-white md:text-3xl">{t('leaderboard.allTraders')}</h2>
                  </div>
                  {ranked.length > 0 && (
                    <div className="text-[12px] text-[#71717a]">{ranked.length} · {t('leaderboard.thRank')}</div>
                  )}
                </div>

                {top3.length > 0 && (
                  <div className="mt-6 grid gap-3 md:grid-cols-3 md:items-end">
                    <div className="md:order-2"><PodiumCard row={top3[0]} place={1} /></div>
                    <div className="md:order-1"><PodiumCard row={top3[1]} place={2} /></div>
                    <div className="md:order-3"><PodiumCard row={top3[2]} place={3} /></div>
                  </div>
                )}

                {data.leaderboard.length === 0 ? (
                  <div className="glass-card mt-6 p-10 text-center text-sm text-[#b8b8c2]">
                    {t('leaderboard.noTraderYet')}
                  </div>
                ) : (
                  <>
                    {ranked.length > 0 ? (
                      rest.length > 0 ? (
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
                          {rest.map((row, idx) => (
                            <RankRow key={row.userId} row={row} index={idx} isMe={row.userId === currentUserId} />
                          ))}
                        </div>
                      </div>
                      ) : null
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
    </div>
  );
}

/* ----------------------------- SUB COMPONENTS ----------------------------- */

function PromoCtaSection({
  title,
  subtitle,
  href,
  cta,
  logoUrl,
  accent,
}: {
  title?: string | null;
  subtitle?: string | null;
  href?: string | null;
  cta?: string | null;
  logoUrl?: string | null;
  accent?: string;
}) {
  const { t } = useTranslation();
  const heading = String(title || '').trim();
  const line = String(subtitle || '').trim();
  const link = safeHttpHref(href);
  if (!heading && !line) return null;
  const color = accent || '#f5b300';
  const inner = (
    <>
      <div className="min-w-0 flex-1">
        <div className="micro text-[10px]" style={{ color }}>{t('leaderboard.promoOffer')}</div>
        {heading && (
          <h2 className="display mt-2 text-2xl font-black uppercase leading-tight text-white md:text-3xl">{heading}</h2>
        )}
        {line && (
          <p className="mt-2 text-sm font-semibold leading-relaxed text-amber-100/90 md:text-base">{line}</p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {logoUrl && (
          <img src={logoUrl} alt="" className="hidden h-8 w-auto max-w-[88px] object-contain sm:block" />
        )}
        {link && (
          <span
            className="inline-flex items-center rounded-xl px-4 py-2.5 text-[11px] font-black uppercase tracking-[0.14em] text-black"
            style={{ background: color }}
          >
            {cta?.trim() || t('leaderboard.promoCta')}
          </span>
        )}
      </div>
    </>
  );

  const className = 'relative mt-6 flex flex-col gap-4 overflow-hidden rounded-3xl border px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-7 sm:py-6';
  const style = {
    borderColor: `${color}55`,
    background: `linear-gradient(135deg, ${color}22 0%, #0c0904 55%, #09090d 100%)`,
  };

  if (link) {
    return (
      <a href={link} target="_blank" rel="noopener noreferrer" className={`${className} transition-transform hover:scale-[1.01]`} style={style}>
        <div className="pointer-events-none absolute -right-16 -top-20 h-44 w-44 rounded-full opacity-30 blur-3xl" style={{ background: color }} />
        {inner}
      </a>
    );
  }

  return (
    <section className={className} style={style}>
      <div className="pointer-events-none absolute -right-16 -top-20 h-44 w-44 rounded-full opacity-30 blur-3xl" style={{ background: color }} />
      {inner}
    </section>
  );
}

function CashPrizeSection({ prize }: { prize: CashPrize }) {
  const { t } = useTranslation();
  const items = prize.items && prize.items.length > 0 ? prize.items : null;
  const groups = items ? groupPrizeItems(items) : [];
  const breakdown = !items && prize.breakdown && prize.breakdown.length > 0 ? prize.breakdown : null;
  const prizeTitle = getPrizeTitle(prize, t);
  const itemCount = items?.length ?? breakdown?.length ?? 0;
  const hasRows = groups.length > 0 || Boolean(breakdown);
  if (!hasRows && !prize.label && !prize.imageUrl && !(prize.total > 0)) return null;

  return (
    <section className="relative mt-6 overflow-hidden rounded-3xl border border-amber-400/20 bg-[#0c0904]">
      <div className="pointer-events-none absolute -right-20 -top-24 h-52 w-52 rounded-full bg-amber-400/10 blur-3xl" />
      <div className="relative flex items-center justify-between gap-4 border-b border-amber-400/10 px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          {prize.imageUrl && <PrizeThumb src={prize.imageUrl} alt={prizeTitle} size={48} />}
          <div className="min-w-0">
            <div className="micro text-[10px] text-amber-300/90">{t('leaderboard.toWin')}</div>
            {(prize.label || prize.total > 0) && (
              <h2 className="display mt-0.5 truncate text-xl font-black uppercase text-white md:text-2xl">{prizeTitle}</h2>
            )}
          </div>
        </div>
        {itemCount > 0 && (
          <div className="shrink-0 rounded-full border border-amber-400/25 bg-amber-400/10 px-3 py-1 text-[11px] font-semibold text-amber-200">
            {t('leaderboard.prizeCount', { count: itemCount })}
          </div>
        )}
      </div>

      {groups.length > 0 && (
        <div className="relative divide-y divide-white/[0.05]">
          {groups.map((group, index) => {
            const firstRank = group.ranks[0] || 0;
            const tier = firstRank === 1 ? 'gold' : firstRank === 2 ? 'silver' : firstRank === 3 ? 'bronze' : '';
            const span = formatRankSpan(group.ranks, t);
            return (
              <div key={`${prizeItemKey(group.item)}-${index}`} className="flex items-center gap-3 px-5 py-3">
                {group.ranks.length === 1 ? (
                  <span className={`rank-circle ${tier} h-8 w-8 text-sm`}>{firstRank}</span>
                ) : (
                  <span className="flex h-8 min-w-[2.5rem] items-center justify-center rounded-full border border-amber-400/25 bg-amber-400/8 px-2 text-[10px] font-bold text-amber-200">
                    {group.ranks.length > 1 ? `${group.ranks[0]}–${group.ranks[group.ranks.length - 1]}` : '•'}
                  </span>
                )}
                <PrizeThumb src={group.item.imageUrl} alt={group.item.title || t('leaderboard.rewardAlt')} size={36} />
                <div className="min-w-0 flex-1">
                  {span && <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#8b8b96]">{span}</div>}
                  <div className="truncate text-sm font-semibold text-white">{group.item.title || t('leaderboard.rewardAlt')}</div>
                </div>
                {group.ranks.length > 1 && (
                  <span className="shrink-0 text-[11px] text-[#71717a]">×{group.ranks.length}</span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {breakdown && (
        <div className="relative divide-y divide-white/[0.05]">
          {breakdown.map((row) => {
            const tier = row.rank === 1 ? 'gold' : row.rank === 2 ? 'silver' : row.rank === 3 ? 'bronze' : '';
            return (
              <div key={row.rank} className="flex items-center gap-3 px-5 py-3">
                <span className={`rank-circle ${tier} h-8 w-8 text-sm`}>{row.rank}</span>
                <span className="text-sm font-semibold text-[#e0e2ea]">{rankTierLabel(row.rank, t)}</span>
                <span className="num ml-auto text-base font-bold text-white">
                  {formatPrizeAmount(row.amount, prize.currency)}
                </span>
              </div>
            );
          })}
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
        <span className="truncate underline-offset-2 group-hover:underline">{row.name}</span>
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
          <span className="truncate underline-offset-2 group-hover:underline">{row.name}</span>
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
          <span className="truncate underline-offset-2 group-hover:underline">{row.name}</span>
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
