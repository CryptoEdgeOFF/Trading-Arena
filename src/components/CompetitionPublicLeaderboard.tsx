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
import { AvatarImage } from './OptimizedImage';
import { NameBadges, type UserBadge } from './playerBadges';
import { resolveArenaBrand, safeHttpHref } from '../lib/sponsors';
import { resolveMediaUrl } from '../utils/imageUrl';
import ShareCardModal from './ShareCardModal';
import type { ShareCardData } from '../lib/shareCard';
import Seo, { SITE_URL } from './Seo';
import { dateLocale, fmtAgo, formatDHMS, getInitials } from '../utils/formatters';
import { buildArenaEventJsonLd } from '../lib/structuredData';
import ArenaChat from './ArenaChat';
import ArenaActivityFeed from './ArenaActivityFeed';
import CompeteHeader from './CompeteHeader';
import PnlRaceChart, {
  mergePnlSamples,
  type PnlHistorySample,
  type PnlHistoryTrader,
  type PnlMoment,
} from './PnlRaceChart';
import './SpectateBroadcast.css';
import './ArenaLeaderboard.css';

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
  const myRow = useMemo(() => (
    data && currentUserId ? data.leaderboard.find((row) => row.userId === currentUserId) || null : null
  ), [currentUserId, data]);
  const top3 = useMemo(() => ranked.slice(0, 3), [ranked]);
  // Le classement liste les rangs 4+ ; ma ligne est épinglée en bas, jamais dupliquée.
  const listRows = useMemo(
    () => ranked.slice(3).filter((row) => !myRow || row.userId !== myRow.userId),
    [myRow, ranked],
  );

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
      <CompeteHeader />

      <main className="compete-bg pb-10">
        <div className="mx-auto max-w-[1440px] px-4 sm:px-6 md:px-8">
          {error && (
            <div className="mt-6 rounded-2xl border border-[#dc2626]/30 bg-[#dc2626]/10 px-5 py-4 text-sm text-[#fca5a5]">
              {error}
            </div>
          )}

          {!error && !data && (
            <div className="mt-10 text-center text-sm text-[#b8b8c2]">
              {t('leaderboard.loading')}
            </div>
          )}

          {data && (
            <>
              {/* ------------------------------- HERO ------------------------------ */}
              <section className="lb-hero">
                <div className="lb-hero__id">
                  <h1 className="lb-hero__title">{data.competition.title}</h1>
                  <div className="lb-hero__meta">
                    <span className={`lb-live ${isLive ? '' : 'lb-live--off'}`}>
                      <i />
                      {isLive
                        ? t('leaderboard.arenaLive')
                        : isEnded
                          ? t('leaderboard.arenaEnded')
                          : t('leaderboard.arenaSoon')}
                    </span>
                    {!isEnded && (
                      <span className="lb-hero__clock">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                          <circle cx="12" cy="12" r="9" /><path d="M12 7.5V12l3.2 2" />
                        </svg>
                        {isLive ? t('leaderboard.endsIn') : t('leaderboard.startsIn')}
                        <b>{countdown}</b>
                      </span>
                    )}
                  </div>
                </div>

                {brand?.bannerUrl && (
                  brand.bannerHref ? (
                    <a href={brand.bannerHref} target="_blank" rel="noopener noreferrer" className="min-w-0">
                      <img src={brand.bannerUrl} alt={brand.name} className="lb-hero__art" loading="lazy" />
                    </a>
                  ) : (
                    <img src={brand.bannerUrl} alt="" className="lb-hero__art" loading="lazy" />
                  )
                )}

                <Link to="/trade" className="lb-terminal">
                  <span className="lb-terminal__ico">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M5 8l3.5 3.5L5 15M11 16h8" />
                    </svg>
                  </span>
                  {t('leaderboard.openTerminal')}
                  <span className="lb-terminal__dot" />
                </Link>
              </section>

              {/* ------------------------------ CONTENU ---------------------------- */}
              <div className="lb-grid">
                <div className="lb-col">
                  {showRace && pnlHistory && (
                    <PnlRaceChart
                      samples={pnlHistory.samples}
                      traders={pnlHistory.traders}
                      moments={pnlHistory.moments}
                      currentUserId={currentUserId}
                      ended={isEnded}
                    />
                  )}

                  {top3.length > 0 && (
                    <div className="lb-podium">
                      <div className="order-2 md:order-1"><PodiumCard row={top3[1]} place={2} /></div>
                      <div className="order-1 md:order-2"><PodiumCard row={top3[0]} place={1} /></div>
                      <div className="order-3"><PodiumCard row={top3[2]} place={3} /></div>
                    </div>
                  )}

                  <section className="lb-panel">
                    <div className="lb-panel__head">
                      <div>
                        <div className="lb-panel__title">{t('leaderboard.liveRanking')}</div>
                      </div>
                      {ranked.length > 0 && (
                        <span className="num text-[11px] text-[#6f6f7a]">
                          {ranked.length} · {t('leaderboard.thTrader')}
                        </span>
                      )}
                    </div>

                    {data.leaderboard.length === 0 ? (
                      <EmptyArena label={t('leaderboard.noTraderYet')} />
                    ) : listRows.length === 0 && !myRow ? (
                      <EmptyArena label={ranked.length > 0 ? t('leaderboard.podiumOnly') : t('leaderboard.noRankedYet')} />
                    ) : (
                      <div className="lb-table">
                        <RankHeader />
                        {listRows.map((row) => (
                          <RankRow key={row.userId} row={row} isMe={row.userId === currentUserId} />
                        ))}
                        {myRow && (
                          <RankRow
                            row={myRow}
                            isMe
                            pinned
                            onShare={() =>
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
                          />
                        )}
                      </div>
                    )}
                  </section>

                  {breachedRows.length > 0 && (
                    <section className="lb-panel lb-panel--danger">
                      <div className="lb-panel__head">
                        <div>
                          <div className="lb-panel__title text-[#fca5a5]">{t('leaderboard.breachedSectionTitle')}</div>
                          <div className="lb-panel__sub">{t('leaderboard.breachedSectionHint')}</div>
                        </div>
                        <span className="num text-[11px] text-[#6f6f7a]">{breachedRows.length}</span>
                      </div>
                      <div className="lb-table">
                        <RankHeader />
                        {breachedRows.map((row) => (
                          <RankRow key={row.userId} row={row} isMe={row.userId === currentUserId} />
                        ))}
                      </div>
                    </section>
                  )}

                  {notTraded.length > 0 && (
                    <section className="lb-panel">
                      <div className="lb-panel__head">
                        <div>
                          <div className="lb-panel__title">{t('leaderboard.enrolledNoTrade')}</div>
                          <div className="lb-panel__sub">{t('leaderboard.enrolledNoTradeHint')}</div>
                        </div>
                        <span className="num text-[11px] text-[#6f6f7a]">{notTraded.length}</span>
                      </div>
                      <div className="lb-table">
                        {notTraded.map((row) => (
                          <EnrolledRow key={row.userId} row={row} isMe={row.userId === currentUserId} />
                        ))}
                      </div>
                    </section>
                  )}
                </div>

                {/* ----------------------------- SIDEBAR ---------------------------- */}
                <aside className="lb-side">
                  {hasPrize(data.competition.cashPrize) && (
                    <PrizePanel prize={data.competition.cashPrize} />
                  )}

                  {(data.competition.promoTitle || data.competition.promoSubtitle) && (
                    <PromoPanel
                      title={data.competition.promoTitle}
                      subtitle={data.competition.promoSubtitle}
                      href={data.competition.promoHref}
                      cta={data.competition.promoCta}
                      brandName={brand?.name}
                      logoUrl={brand?.logoUrl}
                      artUrl={brand?.bannerUrl}
                      accent={brand?.accent}
                    />
                  )}

                  <section className="lb-panel lb-status">
                    <div className="flex items-center justify-between gap-3">
                      <span className={`micro text-[9px] ${isLive ? 'text-[#ff6274]' : 'text-[#6f6f7a]'}`}>
                        {isLive ? t('leaderboard.eventOngoing') : t('leaderboard.statusLabel')}
                      </span>
                      {isLive && <span className="lb-pill-live"><i className="lb-dot lb-dot--on" />{t('leaderboard.live')}</span>}
                    </div>
                    <div className={`lb-live mt-2.5 ${isLive ? '' : 'lb-live--off'}`}>
                      <i />
                      {isLive ? t('leaderboard.arenaLive') : isEnded ? t('leaderboard.arenaEnded') : t('leaderboard.arenaSoon')}
                    </div>
                    <p className="mt-1.5 text-[11px] leading-snug text-[#8b8b96]">{t('leaderboard.liveUpdateHint')}</p>
                    <div className="lb-status__row">
                      <span className="micro text-[8px] text-[#6f6f7a]">
                        {paused ? t('leaderboard.paused') : t('leaderboard.lastUpdate')}
                      </span>
                      <span className="num text-[13px] font-bold text-white">
                        {lastRefresh ? fmtTime(lastRefresh) : '—'}
                      </span>
                    </div>
                    <div className="lb-status__row">
                      <span className="micro text-[8px] text-[#6f6f7a]">
                        {isLive ? t('leaderboard.endsIn') : t('leaderboard.startsIn')}
                      </span>
                      <span className="text-right text-[11px] text-[#b8b8c2]">
                        {fmtDate(isLive ? data.competition.endAt : data.competition.startAt)}
                      </span>
                    </div>
                    <div className="lb-status__row">
                      <span className="micro text-[8px] text-[#6f6f7a]">{t('leaderboard.participants')}</span>
                      <span className="num text-[13px] font-bold text-white">
                        {formatCompactUnsigned(data.competition.participants)}
                      </span>
                    </div>
                    <div className="lb-status__row">
                      <span className="micro text-[8px] text-[#6f6f7a]">{t('leaderboard.avgPnl')}</span>
                      <span
                        className="num text-[13px] font-bold"
                        style={{ color: aggregates.avgPnl > 0 ? '#10b981' : aggregates.avgPnl < 0 ? '#ef4444' : '#fff' }}
                      >
                        {formatPercent(aggregates.avgPnl)}
                      </span>
                    </div>
                  </section>

                  {id && <ArenaActivityFeed competitionId={id} live={isLive} />}
                </aside>
              </div>
            </>
          )}
        </div>
      </main>
      {id && data && <ArenaChat competitionId={id} title={data.competition.title} />}
      <ShareCardModal open={shareData != null} data={shareData} onClose={() => setShareData(null)} />
    </div>
  );
}

/* ----------------------------- SUB COMPONENTS ----------------------------- */

/** Arène déserte : podium vide sous les projecteurs, l'image se fond dans le fond noir. */
function EmptyArena({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center pt-2">
      <img
        src="/assets/pictures/arena-empty.webp"
        alt=""
        width={840}
        height={560}
        className="w-full max-w-[380px] select-none"
        loading="lazy"
        decoding="async"
        draggable={false}
      />
      <p className="-mt-8 pb-5 text-center text-[13px] text-[#8b8b96]">{label}</p>
    </div>
  );
}

/** Voyant d'activité : vert récent, ambre tiède, gris froid. */
function activityDotClass(value: number): string {
  const minutes = (Date.now() - value) / 60_000;
  if (minutes <= 10) return 'lb-dot lb-dot--on';
  if (minutes <= 60) return 'lb-dot lb-dot--idle';
  return 'lb-dot lb-dot--off';
}

function Avatar({ row, size = 40, className = '' }: { row: LeaderboardRow; size?: number; className?: string }) {
  return (
    <span className={className} style={{ width: size, height: size }}>
      {row.avatarUrl ? (
        <AvatarImage src={row.avatarUrl} alt={row.name} className="h-full w-full object-cover" sizePx={size * 2} />
      ) : (
        getInitials(row.name)
      )}
    </span>
  );
}

/** Carte de podium : rang, avatar, PnL et performance côte à côte. */
function PodiumCard({ row, place }: { row?: LeaderboardRow; place: 1 | 2 | 3 }) {
  const { t } = useTranslation();
  if (!row) {
    return (
      <div className="lb-pod h-full justify-center text-[12px] text-[#52525b]">
        {t('leaderboard.waitingFor', { place })}
      </div>
    );
  }
  const pos = row.pnlPercent >= 0;
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay: 0.05 * place, ease: [0.22, 1, 0.36, 1] }}
      className={`lb-pod lb-pod--${place} h-full`}
    >
      <span className="lb-pod__rank">{place}</span>
      <Avatar row={row} size={40} className="lb-pod__av" />
      <div className="min-w-0 flex-1">
        <Link to={`/compete/player/${row.userId}`} className="flex min-w-0 items-center gap-1.5" title={t('playerProfile.viewProfile')}>
          <span className="lb-pod__name truncate underline-offset-2 hover:underline">{row.name}</span>
          <NameBadges badges={row.badges} compact />
        </Link>
        <div className="lb-pod__k mt-1.5">{t('leaderboard.thPnlUsd')}</div>
        <div className={`lb-pod__v ${pos ? 'text-[#10b981]' : 'text-[#ef4444]'}`}>
          <AnimatedNumber value={row.pnlUsd} format={(v) => formatCompactSigned(v)} /> $
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div className="lb-pod__k">{t('leaderboard.performance')}</div>
        <div className={`lb-pod__v ${pos ? 'text-[#10b981]' : 'text-[#ef4444]'}`}>
          <AnimatedNumber value={row.pnlPercent} format={(v) => formatPercent(v)} /> %
        </div>
      </div>
    </motion.div>
  );
}

function RankHeader() {
  const { t } = useTranslation();
  return (
    <div className="lb-tr lb-tr--head">
      <div>{t('leaderboard.thRank')}</div>
      <div>{t('leaderboard.thTrader')}</div>
      <div className="text-right">{t('leaderboard.thPnlUsd')}</div>
      <div className="text-right">{t('leaderboard.performance')}</div>
      <div className="hidden text-right min-[900px]:block">{t('leaderboard.thTrades')}</div>
      <div className="hidden text-right min-[900px]:block">{t('leaderboard.lastActivity')}</div>
    </div>
  );
}

/** Ligne de classement. `pinned` = ma position, épinglée en bas du tableau. */
function RankRow({
  row,
  isMe = false,
  pinned = false,
  onShare,
}: {
  row: LeaderboardRow;
  isMe?: boolean;
  pinned?: boolean;
  onShare?: () => void;
}) {
  const { t } = useTranslation();
  const noTrade = row.rank === 0 && !row.breached;
  const pos = row.pnlPercent >= 0;
  return (
    <div className={`lb-tr ${isMe ? 'lb-tr--me' : ''} ${pinned ? 'lb-tr--pinned' : ''}`}>
      <div className="flex min-w-0 items-center gap-2">
        {pinned && <span className="lb-tag">{t('leaderboard.yourPosition')}</span>}
        <span className="lb-tr__num">{noTrade ? '—' : row.rank}</span>
      </div>

      <div className="flex min-w-0 items-center gap-2.5">
        <Link
          to={`/compete/player/${row.userId}`}
          className="group flex min-w-0 items-center gap-2.5"
          title={t('playerProfile.viewProfile')}
        >
          <Avatar
            row={row}
            size={28}
            className="flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gradient-to-br from-[#1a0a0a] to-[#0a0a0d] text-[10px] font-bold uppercase text-white"
          />
          <span className="display flex min-w-0 items-center gap-1.5 text-[13px] font-semibold text-white">
            <span className="truncate underline-offset-2 group-hover:underline">{row.name}</span>
            <NameBadges badges={row.badges} compact />
          </span>
        </Link>
        {isMe && <span className="lb-tag">{t('leaderboard.you')}</span>}
        {row.breached && (
          <span className="lb-tag" title={t('leaderboard.breachedTitle')}>{t('leaderboard.breached')}</span>
        )}
        {pinned && onShare && (
          <button
            type="button"
            onClick={onShare}
            title={t('share.cta')}
            className="ml-auto shrink-0 text-[#fca5a5] transition-colors hover:text-white"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13" />
            </svg>
          </button>
        )}
      </div>

      {noTrade ? (
        <div className="col-span-2 text-right text-[11px] font-medium uppercase tracking-[0.12em] text-[#6f6f7a] min-[900px]:col-span-4">
          {t('leaderboard.noTrade')}
        </div>
      ) : (
        <>
          <div className={`num truncate text-right text-[13px] font-bold ${pos ? 'text-[#10b981]' : 'text-[#ef4444]'}`}>
            <AnimatedNumber value={row.pnlUsd} format={(v) => formatCompactSigned(v)} /> $
          </div>
          <div className={`num truncate text-right text-[13px] font-bold ${pos ? 'text-[#34d399]' : 'text-[#fca5a5]'}`}>
            <AnimatedNumber value={row.pnlPercent} format={(v) => formatPercent(v)} /> %
          </div>
          <div className="num hidden truncate text-right text-[13px] text-[#b8b8c2] min-[900px]:block">{row.tradesCount}</div>
          <div className="hidden items-center justify-end gap-2 text-right text-[11px] text-[#6f6f7a] min-[900px]:flex">
            {fmtAgo(row.updatedAt)}
            <i className={activityDotClass(row.updatedAt)} />
          </div>
        </>
      )}
    </div>
  );
}

/** Inscrit sans trade : visible dans la liste mais hors classement (pas de rang). */
function EnrolledRow({ row, isMe = false }: { row: LeaderboardRow; isMe?: boolean }) {
  const { t } = useTranslation();
  return (
    <div className={`lb-tr ${isMe ? 'lb-tr--me' : ''}`} style={{ gridTemplateColumns: 'minmax(0,1.6fr) 80px minmax(0,1fr)' }}>
      <Link
        to={`/compete/player/${row.userId}`}
        className="group flex min-w-0 items-center gap-2.5"
        title={t('playerProfile.viewProfile')}
      >
        <Avatar
          row={row}
          size={28}
          className="flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gradient-to-br from-[#1a0a0a] to-[#0a0a0d] text-[10px] font-bold uppercase text-white"
        />
        <span className="display flex min-w-0 items-center gap-1.5 text-[13px] font-semibold text-white">
          <span className="truncate underline-offset-2 group-hover:underline">{row.name}</span>
          <NameBadges badges={row.badges} compact />
        </span>
      </Link>
      <div className="num text-right text-[13px] text-[#6f6f7a]">{row.tradesCount}</div>
      <div className="text-right text-[11px] text-[#6f6f7a]">{fmtAgo(row.updatedAt)}</div>
    </div>
  );
}

/** Coupe du podium : or, argent, bronze. */
function TrophyIcon({ place, size = 20 }: { place: number; size?: number }) {
  const id = `lb-trophy-${place}`;
  const stops = place === 1
    ? ['#ffe08a', '#f5b300', '#a86b00']
    : place === 2
      ? ['#f1f5f9', '#cbd5e1', '#8a94a4']
      : ['#f0c39a', '#d08a5a', '#8a5330'];
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="shrink-0">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stops[0]} />
          <stop offset="55%" stopColor={stops[1]} />
          <stop offset="100%" stopColor={stops[2]} />
        </linearGradient>
      </defs>
      <path
        fill={`url(#${id})`}
        d="M7 3h10v1.6h3.2A1.8 1.8 0 0 1 22 6.4c0 2.9-2 5.3-4.8 5.9a6 6 0 0 1-4.2 3.5V18h2.6a1 1 0 0 1 1 1v1.2H7.4V19a1 1 0 0 1 1-1H11v-2.2a6 6 0 0 1-4.2-3.5C4 11.7 2 9.3 2 6.4c0-1 .8-1.8 1.8-1.8H7V3Zm0 3.2H4.2c.1 1.7 1.2 3.1 2.8 3.6V6.2Zm10 3.6c1.6-.5 2.7-1.9 2.8-3.6H17v3.6Z"
      />
    </svg>
  );
}

/** Panneau des lots (sidebar) : total en tête, une ligne par palier. */
function PrizePanel({ prize }: { prize: CashPrize }) {
  const { t } = useTranslation();
  const items = prize.items && prize.items.length > 0 ? prize.items : null;
  const groups = items ? groupPrizeItems(items) : [];
  const breakdown = !items && prize.breakdown && prize.breakdown.length > 0 ? prize.breakdown : null;
  const itemCount = items?.length ?? breakdown?.length ?? 0;
  const label = getPrizeTitle(prize, t);

  const rows = breakdown
    ? breakdown.map((row) => ({
        key: `cash-${row.rank}`,
        rank: rankTierLabel(row.rank, t),
        label: formatPrizeAmount(row.amount, prize.currency),
        place: row.rank,
      }))
    : groups.map((group, index) => {
        const first = group.ranks[0] || 0;
        return {
          key: `${prizeItemKey(group.item)}-${index}`,
          rank: group.ranks.length > 1
            ? `${first}–${group.ranks[group.ranks.length - 1]}`
            : rankTierLabel(first, t),
          label: group.item.title || t('leaderboard.rewardAlt'),
          place: group.ranks.length > 1 ? 0 : first,
        };
      });

  // Le libellé contient souvent déjà le montant ("210 000 $ Challenges Propfirms") :
  // on l'isole pour le mettre en avant sans le répéter dans la description.
  const labelParts = label.match(/^([\d\s.,\u00a0]+(?:\$|€|USD|EUR))\s*(.*)$/i);
  const total = labelParts
    ? labelParts[1].trim()
    : prize.total > 0
      ? formatPrizeAmount(prize.total, prize.currency)
      : null;
  const subtitle = labelParts
    ? (labelParts[2].trim() || t('leaderboard.toWin'))
    : total
      ? label
      : t('leaderboard.toWin');

  return (
    <section className="lb-panel lb-panel--gold">
      <div className="lb-prize-head">
        <TrophyIcon place={1} size={30} />
        <div className="min-w-0">
          <div className="lb-prize-total">{total || label}</div>
          <div className="lb-panel__sub">{subtitle}</div>
        </div>
      </div>
      {rows.map((row) => (
        <div key={row.key} className={`lb-prize-row ${row.place > 0 && row.place <= 3 ? 'lb-prize-row--top' : ''}`}>
          <span className="lb-prize-rank">{row.rank}</span>
          <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-white" title={row.label}>
            {row.label}
          </span>
          {row.place > 0 && row.place <= 3 && <TrophyIcon place={row.place} size={18} />}
        </div>
      ))}
      {itemCount > 0 && <div className="lb-prize-foot">{t('leaderboard.lotsTotal', { count: itemCount })}</div>}
    </section>
  );
}

/** Panneau offre partenaire (sidebar) : marque, accroche et CTA pleine largeur. */
function PromoPanel({
  title,
  subtitle,
  href,
  cta,
  brandName,
  logoUrl,
  artUrl,
  accent,
}: {
  title?: string | null;
  subtitle?: string | null;
  href?: string | null;
  cta?: string | null;
  brandName?: string | null;
  logoUrl?: string | null;
  artUrl?: string | null;
  accent?: string;
}) {
  const { t } = useTranslation();
  const heading = String(title || '').trim();
  const line = String(subtitle || '').trim();
  const link = safeHttpHref(href);
  if (!heading && !line) return null;
  const color = accent || '#ff7a3c';

  const inner = (
    <>
      {artUrl && <img src={artUrl} alt="" className="lb-promo__art" loading="lazy" />}
      <div className="relative z-[2]">
        <div className="micro text-[8px]" style={{ color }}>{t('leaderboard.promoOffer')}</div>
        <div className="mt-2 flex items-center gap-2.5">
          {logoUrl && (
            <span className="lb-promo__logo"><img src={logoUrl} alt="" /></span>
          )}
          <span className="display truncate text-[14px] font-bold uppercase text-white">{brandName || heading}</span>
        </div>
        {heading && brandName && (
          <p className="mt-2 max-w-[190px] text-[11px] font-semibold leading-snug text-[#d4d4d8]">{heading}</p>
        )}
        {line && <p className="mt-1 max-w-[190px] text-[11px] leading-snug text-[#8b8b96]">{line}</p>}
        {link && (
          <span className="lb-btn" style={{ background: `linear-gradient(180deg, ${color}, ${color}bb)` }}>
            {cta?.trim() || t('leaderboard.promoCta')}
            <span className="lb-btn__arrow">→</span>
          </span>
        )}
      </div>
    </>
  );

  if (link) {
    return (
      <a href={link} target="_blank" rel="noopener noreferrer" className="lb-panel lb-promo" style={{ borderColor: `${color}4d` }}>
        {inner}
      </a>
    );
  }
  return <section className="lb-panel lb-promo" style={{ borderColor: `${color}4d` }}>{inner}</section>;
}
