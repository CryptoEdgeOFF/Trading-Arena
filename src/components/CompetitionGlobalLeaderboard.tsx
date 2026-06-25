import { Fragment, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import Seo from './Seo';
import CompeteHeader from './CompeteHeader';
import { AvatarImage } from './OptimizedImage';
import { NameBadges, BadgeShowcaseModal, getBadgeVisual, type UserBadge } from './playerBadges';
import { formatCompactSigned } from './competeMetrics';
import ShareCardModal from './ShareCardModal';
import { readCachedCompeteUser } from '../lib/competeSession';
import type { ShareCardData } from '../lib/shareCard';

interface GlobalStats {
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

interface GlobalRow {
  userId: string;
  name: string;
  avatarUrl?: string | null;
  badges?: UserBadge[];
  pnlUsd: number;
  arenas: number;
  stats: GlobalStats;
}

type SeasonTheme = 'summer' | 'autumn' | 'winter' | 'spring';
type SeasonStatus = 'upcoming' | 'active' | 'ended';

interface SeasonInfo {
  id: string;
  slug: string;
  nameKey: string;
  startAt: number;
  endAt: number;
  isActive: boolean;
  theme: SeasonTheme;
  championBadge: UserBadge;
  rewardEyebrowKey: string;
  rewardTitleKey: string;
  rewardDescKey: string;
  bannerImage?: string | null;
  shirtImage?: string | null;
  arenaImage?: string | null;
  status: SeasonStatus;
}

const GLOBAL_TAB = '__all__';

const THEME_STYLES: Record<
  SeasonTheme,
  { border: string; gradient: string; glow: string; accent: string; icon: string }
> = {
  summer: {
    border: 'border-amber-500/30',
    gradient: 'from-[#241a05] via-[#0f0a04] to-[#0a0a0d]',
    glow: 'bg-amber-500/15',
    accent: 'text-amber-400/90',
    icon: 'text-amber-200',
  },
  autumn: {
    border: 'border-orange-600/30',
    gradient: 'from-[#1f1208] via-[#100a06] to-[#0a0a0d]',
    glow: 'bg-orange-600/15',
    accent: 'text-orange-400/90',
    icon: 'text-orange-200',
  },
  winter: {
    border: 'border-sky-500/30',
    gradient: 'from-[#0a1520] via-[#080c12] to-[#0a0a0d]',
    glow: 'bg-sky-500/15',
    accent: 'text-sky-400/90',
    icon: 'text-sky-200',
  },
  spring: {
    border: 'border-emerald-500/30',
    gradient: 'from-[#0a1a12] via-[#080f0c] to-[#0a0a0d]',
    glow: 'bg-emerald-500/15',
    accent: 'text-emerald-400/90',
    icon: 'text-emerald-200',
  },
};

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .map((part) => part[0] || '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function fmtWinRate(stats: GlobalStats): string {
  if (stats.wins + stats.losses === 0) return '—';
  return `${(stats.winRate * 100).toFixed(1)}%`;
}

function fmtRR(stats: GlobalStats): string {
  if (stats.avgRR == null) return '—';
  return stats.avgRR.toFixed(2);
}

function fmtProfitFactor(stats: GlobalStats): string {
  if (stats.closedTrades === 0) return '—';
  if (stats.profitFactor == null) return stats.wins > 0 ? '∞' : '—';
  return stats.profitFactor.toFixed(2);
}

function fmtSeasonDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

const DAY_MS = 86_400_000;

/** Affichage voyant des dates de saison : pastille thémée + compte à rebours pulsant. */
function SeasonDatePill({
  startAt,
  endAt,
  status,
  theme,
}: {
  startAt: number;
  endAt: number;
  status: SeasonStatus;
  theme: { border: string; accent: string; icon: string };
}) {
  const { t } = useTranslation();
  const now = Date.now();
  let countdown: string | null = null;
  if (status === 'active') {
    const days = Math.ceil((endAt - now) / DAY_MS);
    countdown = days <= 0 ? t('seasons.lastDay') : t('seasons.daysLeft', { count: days });
  } else if (status === 'upcoming') {
    const days = Math.max(1, Math.ceil((startAt - now) / DAY_MS));
    countdown = t('seasons.startsIn', { count: days });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className={`inline-flex items-center gap-2 rounded-xl border ${theme.border} bg-black/55 px-3 py-1.5 shadow-[0_2px_12px_rgba(0,0,0,0.4)] backdrop-blur-sm`}>
        <svg className={theme.icon} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" />
        </svg>
        <span className="text-xs font-bold tracking-wide text-white">
          {fmtSeasonDate(startAt)} <span className={`px-0.5 ${theme.accent}`}>→</span> {fmtSeasonDate(endAt)}
        </span>
      </span>
      {countdown && (
        <span className={`inline-flex items-center gap-2 rounded-xl border ${theme.border} bg-black/55 px-3 py-1.5 backdrop-blur-sm ${theme.icon}`}>
          {status === 'active' ? (
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-current" />
            </span>
          ) : (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3 2" />
            </svg>
          )}
          <span className="text-xs font-bold uppercase tracking-[0.08em] text-white">{countdown}</span>
        </span>
      )}
    </div>
  );
}

function LeaderboardTable({
  rows,
  highlightTopN,
  contextLabel,
  compact,
  currentUserId,
  onShare,
}: {
  rows: GlobalRow[];
  highlightTopN: number;
  contextLabel: string;
  compact?: boolean;
  currentUserId: string | null;
  onShare: (row: GlobalRow, rank: number) => void;
}) {
  const { t } = useTranslation();

  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-[#232329] bg-[#0a0a0d] px-4 py-10 text-center text-sm text-[#71717a]">
        {t('globalLeaderboard.empty')}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className={`w-full border-separate border-spacing-y-1.5 ${compact ? 'min-w-[520px]' : 'min-w-[640px]'}`}>
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-[0.16em] text-[#71717a]">
            <th className="px-2 py-2 font-semibold">{t('globalLeaderboard.rank')}</th>
            <th className="px-2 py-2 font-semibold">{t('globalLeaderboard.trader')}</th>
            <th className="px-2 py-2 text-right font-semibold">{t('globalLeaderboard.totalPnl')}</th>
            {!compact && (
              <>
                <th className="px-2 py-2 text-right font-semibold">{t('globalLeaderboard.winRate')}</th>
                <th className="px-2 py-2 text-right font-semibold">{t('globalLeaderboard.trades')}</th>
              </>
            )}
            <th className="px-2 py-2 text-right font-semibold">{t('globalLeaderboard.arenas')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const rank = index + 1;
            const tier = rank === 1 ? 'gold' : rank === 2 ? 'silver' : rank === 3 ? 'bronze' : '';
            const pos = row.pnlUsd > 0;
            const neg = row.pnlUsd < 0;
            const noTrades = row.stats.closedTrades === 0;
            const isMe = currentUserId != null && row.userId === currentUserId;
            const qualifies = rank <= highlightTopN;
            const rowBg = qualifies ? 'bg-amber-500/[0.06] hover:bg-amber-500/10' : 'bg-[#0c0c10] hover:bg-[#101016]';
            const borderCol = qualifies ? 'border-amber-500/25' : 'border-[#1a1a20]';
            return (
              <tr key={`${contextLabel}-${row.userId}`} className={`${rowBg} transition-colors`}>
                <td className={`rounded-l-xl border-y border-l ${borderCol} px-2 py-2.5`}>
                  <span className={`rank-circle ${tier} h-7 w-7 text-xs`}>{rank}</span>
                </td>
                <td className={`border-y ${borderCol} px-2 py-2.5`}>
                  <div className="flex items-center gap-2">
                    <Link
                      to={`/compete/player/${row.userId}`}
                      className="group flex min-w-0 items-center gap-2 overflow-hidden"
                      title={t('playerProfile.viewProfile')}
                    >
                      {row.avatarUrl ? (
                        <AvatarImage src={row.avatarUrl} alt="" className="h-8 w-8 shrink-0 rounded-lg object-cover" sizePx={32} />
                      ) : (
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#dc2626] to-[#7f1d1d] text-[10px] font-bold uppercase text-white">
                          {getInitials(row.name)}
                        </span>
                      )}
                      <div className="min-w-0">
                        <div className="flex min-w-0 items-center gap-1">
                          <span className="truncate text-sm font-semibold text-white underline-offset-2 group-hover:underline">{row.name}</span>
                          <NameBadges badges={row.badges} compact />
                        </div>
                        {noTrades && !compact && (
                          <div className="text-[10px] text-[#71717a]">{t('globalLeaderboard.noTrades')}</div>
                        )}
                      </div>
                    </Link>
                    {isMe && (
                      <button
                        type="button"
                        onClick={() => onShare(row, rank)}
                        title={t('share.cta')}
                        aria-label={t('share.cta')}
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[#dc2626]/40 bg-[#dc2626]/15 text-[#fca5a5] transition-colors hover:border-[#dc2626]/70 hover:bg-[#dc2626]/25 hover:text-white"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13" />
                        </svg>
                      </button>
                    )}
                  </div>
                </td>
                <td className={`num border-y ${borderCol} px-2 py-2.5 text-right text-sm font-bold ${pos ? 'text-emerald-400' : neg ? 'text-rose-400' : 'text-white'}`}>
                  {formatCompactSigned(row.pnlUsd)} $
                </td>
                {!compact && (
                  <>
                    <td className={`num border-y ${borderCol} px-2 py-2.5 text-right text-sm text-[#e0e2ea]`}>
                      {fmtWinRate(row.stats)}
                    </td>
                    <td className={`num border-y ${borderCol} px-2 py-2.5 text-right text-sm text-[#9a9aa6]`}>
                      {row.stats.closedTrades}
                    </td>
                  </>
                )}
                <td className={`num rounded-r-xl border-y border-r ${borderCol} px-2 py-2.5 text-right text-sm text-[#9a9aa6]`}>
                  {row.arenas}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function CompetitionGlobalLeaderboard() {
  const { t } = useTranslation();
  const [seasons, setSeasons] = useState<SeasonInfo[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [seasonRows, setSeasonRows] = useState<GlobalRow[]>([]);
  const [allTimeRows, setAllTimeRows] = useState<GlobalRow[]>([]);
  const [loadingSeason, setLoadingSeason] = useState(true);
  const [loadingAllTime, setLoadingAllTime] = useState(true);
  const [shareData, setShareData] = useState<ShareCardData | null>(null);
  const [showcaseBadge, setShowcaseBadge] = useState<UserBadge | null>(null);
  const currentUserId = readCachedCompeteUser()?.id ?? null;

  useEffect(() => {
    let cancelled = false;
    fetch('/api/competition/seasons')
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        const list = ((data.seasons as SeasonInfo[]) || []).slice().sort((a, b) => a.startAt - b.startAt);
        setSeasons(list);
        const defaultId = data.activeSeasonId || list.find((s) => s.isActive)?.id || list[0]?.id || GLOBAL_TAB;
        setActiveTab(defaultId);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const loadAllTime = useCallback(async () => {
    setLoadingAllTime(true);
    try {
      const response = await fetch('/api/competition/global-leaderboard?scope=all');
      if (!response.ok) return;
      const data = await response.json();
      setAllTimeRows((data.rows as GlobalRow[]) || []);
    } catch {
      // ignore
    } finally {
      setLoadingAllTime(false);
    }
  }, []);

  const loadSeason = useCallback(async (seasonId: string) => {
    setLoadingSeason(true);
    try {
      const response = await fetch(`/api/competition/global-leaderboard?season=${encodeURIComponent(seasonId)}`);
      if (!response.ok) return;
      const data = await response.json();
      setSeasonRows((data.rows as GlobalRow[]) || []);
    } catch {
      // ignore
    } finally {
      setLoadingSeason(false);
    }
  }, []);

  useEffect(() => {
    void loadAllTime();
  }, [loadAllTime]);

  const activeSeason = activeTab && activeTab !== GLOBAL_TAB
    ? seasons.find((s) => s.id === activeTab) ?? null
    : null;
  const isGlobalTab = activeTab === GLOBAL_TAB;
  const isUpcomingTab = activeSeason?.status === 'upcoming';

  useEffect(() => {
    if (!activeSeason || activeSeason.status === 'upcoming') return;
    void loadSeason(activeSeason.id);
  }, [activeSeason, loadSeason]);

  const theme = activeSeason ? THEME_STYLES[activeSeason.theme] || THEME_STYLES.summer : THEME_STYLES.summer;
  // Tab bar order: seasons (chronological) first, Global Leaderboard pinned to the far right.
  const tabs: Array<{ id: string; label: string; upcoming: boolean }> = [
    ...seasons.map((s) => ({ id: s.id, label: t(s.nameKey), upcoming: s.status === 'upcoming' })),
    { id: GLOBAL_TAB, label: t('globalLeaderboard.globalTab'), upcoming: false },
  ];

  function handleShare(row: GlobalRow, rank: number, contextLabel: string, total: number) {
    setShareData({
      kind: 'rank',
      playerName: row.name,
      rank,
      participants: total,
      contextLabel,
      pnlUsd: row.pnlUsd,
      avatarUrl: row.avatarUrl,
      badges: row.badges,
    });
  }

  return (
    <div className="compete min-h-dvh-safe bg-[#050507]">
      <Seo
        title={t('seo.leaderboardTitle')}
        description={t('seo.leaderboardDesc')}
        path="/compete/global-leaderboard"
      />
      <div className="compete-bg min-h-dvh-safe">
        <CompeteHeader />

        <main className="mx-auto max-w-[1100px] px-5 py-10 md:px-8">
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            className="border-b border-[#1a1a20] pb-5"
          >
            <div className="micro text-[10px] text-[#dc2626]">{t('globalLeaderboard.title')}</div>
            <h1 className="display mt-1 text-3xl font-bold text-white md:text-4xl">{t('globalLeaderboard.title')}</h1>
            <p className="mt-2 text-sm text-[#71717a]">{t('globalLeaderboard.subtitle')}</p>
          </motion.div>

          {/* —— Onglets —— */}
          <div className="mt-6 flex flex-wrap items-center gap-2 border-b border-[#1a1a20] pb-3">
            {tabs.map((tab) => {
              const active = tab.id === activeTab;
              const pinRight = tab.id === GLOBAL_TAB;
              return (
                <button
                  key={tab.id}
                  type="button"
                  disabled={tab.upcoming}
                  onClick={() => {
                    if (tab.upcoming) return;
                    setActiveTab(tab.id);
                  }}
                  className={`relative rounded-xl border px-3.5 py-2 text-xs font-bold uppercase tracking-[0.08em] transition-colors ${
                    pinRight ? 'sm:ml-auto' : ''
                  } ${
                    active
                      ? 'border-[#dc2626]/60 bg-[#dc2626]/15 text-white'
                      : tab.upcoming
                        ? 'cursor-not-allowed border-[#232329] text-[#52525b] opacity-60'
                        : 'border-[#232329] text-[#71717a] hover:border-[#dc2626]/40 hover:text-white'
                  }`}
                >
                  {tab.label}
                  {tab.upcoming && (
                    <span className="ml-1.5 rounded-full bg-[#232329] px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-[0.1em] text-[#a1a1aa]">
                      {t('seasons.upcoming')}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* —— Contenu de l'onglet —— */}
          <motion.section
            key={activeTab ?? 'none'}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="mt-6"
          >
            {isGlobalTab ? (
              <>
                <div className="mb-4">
                  <div className="micro text-[10px] text-[#dc2626]">{t('globalLeaderboard.allTimeBoard')}</div>
                  <h2 className="display text-xl font-bold text-white md:text-2xl">{t('globalLeaderboard.allTimeTitle')}</h2>
                  <p className="mt-1 text-xs text-[#52525b]">{t('globalLeaderboard.allTimeDesc')}</p>
                </div>

                <div className="relative mb-4 overflow-hidden rounded-2xl border border-amber-500/30 bg-gradient-to-br from-[#241a05] via-[#0f0a04] to-[#0a0a0d] p-4">
                  <div className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-amber-500/15 blur-3xl" />
                  <div className="relative flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-amber-400/30 bg-amber-400/10 text-amber-200">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M8 21h8M12 17v4M7 4h10v4a5 5 0 0 1-10 0V4Z" />
                        <path d="M17 5h2a2 2 0 0 1 2 2 4 4 0 0 1-4 4M7 5H5a2 2 0 0 0-2 2 4 4 0 0 0 4 4" />
                      </svg>
                    </div>
                    <div>
                      <div className="micro text-[10px] text-amber-400/90">{t('globalLeaderboard.rewardEyebrow')}</div>
                      <h3 className="mt-1 text-sm font-bold text-white">{t('globalLeaderboard.rewardTitle')}</h3>
                      <p className="mt-1 text-xs leading-relaxed text-amber-100/65">{t('globalLeaderboard.rewardDesc')}</p>
                    </div>
                  </div>
                </div>

                {loadingAllTime ? (
                  <div className="py-10 text-center text-sm text-[#71717a]">{t('globalLeaderboard.loading')}</div>
                ) : (
                  <LeaderboardTable
                    rows={allTimeRows}
                    highlightTopN={5}
                    contextLabel={t('globalLeaderboard.allTimeTitle')}
                    currentUserId={currentUserId}
                    onShare={(row, rank) =>
                      handleShare(row, rank, t('globalLeaderboard.allTimeTitle'), allTimeRows.length)
                    }
                  />
                )}
              </>
            ) : (
              activeSeason && (
                <>
                  {/* Bannière de la saison */}
                  {activeSeason.bannerImage && (
                    <div className={`relative mb-5 overflow-hidden rounded-2xl border ${theme.border} bg-[#050507]`}>
                      <img
                        src={encodeURI(activeSeason.bannerImage)}
                        alt={t(activeSeason.nameKey)}
                        className="block h-auto w-full object-contain"
                      />
                      <div className="mt-1 flex flex-wrap items-end justify-between gap-3 px-4 pb-3">
                        <div>
                          <div className={`micro text-[10px] ${theme.accent}`}>{t('globalLeaderboard.seasonBoard')}</div>
                          <h2 className="display text-2xl font-bold text-white md:text-3xl">{t(activeSeason.nameKey)}</h2>
                        </div>
                        <SeasonDatePill
                          startAt={activeSeason.startAt}
                          endAt={activeSeason.endAt}
                          status={activeSeason.status}
                          theme={theme}
                        />
                      </div>
                    </div>
                  )}

                  {!activeSeason.bannerImage && (
                    <div className="mb-4">
                      <div className={`micro text-[10px] ${theme.accent}`}>{t('globalLeaderboard.seasonBoard')}</div>
                      <h2 className="display text-xl font-bold text-white md:text-2xl">{t(activeSeason.nameKey)}</h2>
                      <div className="mt-2">
                        <SeasonDatePill
                          startAt={activeSeason.startAt}
                          endAt={activeSeason.endAt}
                          status={activeSeason.status}
                          theme={theme}
                        />
                      </div>
                    </div>
                  )}

                  {/* —— Le grand prix —— */}
                  {(() => {
                    const seasonName = t(activeSeason.nameKey);
                    const badgeVisual = getBadgeVisual(activeSeason.championBadge);
                    const steps = [
                      t('globalLeaderboard.prize.step1'),
                      t('globalLeaderboard.prize.step2'),
                      t('globalLeaderboard.prize.step3'),
                    ];
                    const prizeCount = 1 + (activeSeason.shirtImage ? 1 : 0) + (activeSeason.arenaImage ? 1 : 0);
                    const prizeGridClass =
                      prizeCount >= 3 ? 'sm:grid-cols-2 lg:grid-cols-3' : prizeCount === 2 ? 'sm:grid-cols-2' : '';
                    return (
                      <div className={`relative mb-6 overflow-hidden rounded-3xl border ${theme.border} bg-gradient-to-br ${theme.gradient} p-5 sm:p-7`}>
                        <div className={`pointer-events-none absolute -right-24 -top-24 h-60 w-60 rounded-full ${theme.glow} blur-3xl`} />
                        <div className={`pointer-events-none absolute -bottom-28 -left-20 h-60 w-60 rounded-full ${theme.glow} opacity-60 blur-3xl`} />

                        <div className="relative">
                          <div className={`micro text-[10px] ${theme.accent}`}>
                            {t('globalLeaderboard.prize.eyebrow', { season: seasonName })}
                          </div>
                          <h3 className="display mt-1.5 max-w-2xl text-2xl font-bold leading-tight text-white sm:text-[2rem]">
                            {t('globalLeaderboard.prize.headline')}
                          </h3>
                          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/65">
                            {t('globalLeaderboard.prize.subtitle', { season: seasonName })}
                          </p>

                          {/* Parcours en 3 étapes */}
                          <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-2 text-[11px] font-semibold">
                            {steps.map((label, i) => (
                              <Fragment key={label}>
                                <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 text-white/85">
                                  <span className={`flex h-4 w-4 items-center justify-center rounded-full bg-white/15 text-[9px] font-bold ${theme.icon}`}>
                                    {i + 1}
                                  </span>
                                  {label}
                                </span>
                                {i < steps.length - 1 && (
                                  <svg className={theme.accent} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                    <path d="m9 18 6-6-6-6" />
                                  </svg>
                                )}
                              </Fragment>
                            ))}
                          </div>

                          {/* Les lots */}
                          <div className={`mt-6 grid gap-4 ${prizeGridClass}`}>
                            {/* Badge — cliquable */}
                            <button
                              type="button"
                              onClick={() => setShowcaseBadge(activeSeason.championBadge)}
                              title={t('globalLeaderboard.prize.badgeHint')}
                              className="group relative flex flex-col items-center overflow-hidden rounded-2xl border border-white/10 bg-black/30 p-5 text-center transition-all duration-300 hover:-translate-y-1 hover:border-white/30"
                            >
                              <div
                                className="pointer-events-none absolute inset-0 opacity-70 transition-opacity duration-300 group-hover:opacity-100"
                                style={{ background: `radial-gradient(circle at 50% 35%, ${badgeVisual.glow}33 0%, transparent 60%)` }}
                              />
                              <motion.img
                                src={badgeVisual.src}
                                alt={t(activeSeason.championBadge === 'summer-champion' ? 'badges.summerChampion' : 'badges.autumnChampion')}
                                draggable={false}
                                className="relative z-10 h-44 w-auto select-none sm:h-52"
                                style={{ filter: `drop-shadow(0 0 22px ${badgeVisual.glow}aa)` }}
                                animate={{ y: [0, -7, 0] }}
                                transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut' }}
                              />
                              <div className="relative z-10 mt-3">
                                <div className="text-sm font-bold uppercase tracking-[0.1em] text-white">
                                  {t('globalLeaderboard.prize.badgeLabel')}
                                </div>
                                <div className={`mt-1 inline-flex items-center gap-1 text-[11px] font-semibold ${theme.accent}`}>
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                    <path d="M15 3h6v6M10 14 21 3M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
                                  </svg>
                                  {t('globalLeaderboard.prize.badgeHint')}
                                </div>
                              </div>
                            </button>

                            {/* Maillot officiel */}
                            {activeSeason.shirtImage && (
                              <div className="group relative flex flex-col items-center overflow-hidden rounded-2xl border border-white/10 bg-black/30 p-5 text-center transition-all duration-300 hover:-translate-y-1 hover:border-white/30">
                                <div
                                  className="pointer-events-none absolute inset-0 opacity-70 transition-opacity duration-300 group-hover:opacity-100"
                                  style={{ background: `radial-gradient(circle at 50% 40%, ${badgeVisual.glow}2e 0%, transparent 60%)` }}
                                />
                                <motion.img
                                  src={encodeURI(activeSeason.shirtImage)}
                                  alt={t('globalLeaderboard.prize.shirtLabel')}
                                  draggable={false}
                                  className="relative z-10 h-44 w-auto select-none object-contain sm:h-52"
                                  style={{ filter: `drop-shadow(0 0 20px ${badgeVisual.glow}77)` }}
                                  animate={{ y: [0, -7, 0] }}
                                  transition={{ duration: 3.6, repeat: Infinity, ease: 'easeInOut', delay: 0.4 }}
                                />
                                <div className="relative z-10 mt-3">
                                  <div className="text-sm font-bold uppercase tracking-[0.1em] text-white">
                                    {t('globalLeaderboard.prize.shirtLabel')}
                                  </div>
                                </div>
                              </div>
                            )}

                            {/* Accès arène physique BTF 2027 */}
                            {activeSeason.arenaImage && (
                              <div className="group relative flex flex-col items-center overflow-hidden rounded-2xl border border-white/10 bg-black/30 p-5 text-center transition-all duration-300 hover:-translate-y-1 hover:border-white/30">
                                <div
                                  className="pointer-events-none absolute inset-0 opacity-70 transition-opacity duration-300 group-hover:opacity-100"
                                  style={{ background: `radial-gradient(circle at 50% 45%, ${badgeVisual.glow}33 0%, transparent 60%)` }}
                                />
                                <span className={`relative z-10 mb-1 self-center rounded-full border ${theme.border} bg-black/40 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] ${theme.icon}`}>
                                  BTF 2027 · Paris
                                </span>
                                <motion.img
                                  src={encodeURI(activeSeason.arenaImage)}
                                  alt={t('globalLeaderboard.prize.arenaLabel')}
                                  loading="lazy"
                                  draggable={false}
                                  className="relative z-10 h-40 w-auto select-none object-contain sm:h-48"
                                  style={{ filter: `drop-shadow(0 0 22px ${badgeVisual.glow}99)` }}
                                  animate={{ y: [0, -7, 0] }}
                                  transition={{ duration: 3.4, repeat: Infinity, ease: 'easeInOut', delay: 0.8 }}
                                />
                                <div className="relative z-10 mt-3">
                                  <div className="text-sm font-bold uppercase tracking-[0.1em] text-white">
                                    {t('globalLeaderboard.prize.arenaLabel')}
                                  </div>
                                  <div className={`mt-1 text-[11px] font-semibold ${theme.accent}`}>
                                    {t('globalLeaderboard.prize.arenaDesc')}
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>

                          <div className="mt-4 flex items-center gap-2 text-[11px] text-white/55">
                            <svg className={theme.accent} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <path d="M8 21h8M12 17v4M7 4h10v4a5 5 0 0 1-10 0V4Z" />
                              <path d="M17 5h2a2 2 0 0 1 2 2 4 4 0 0 1-4 4M7 5H5a2 2 0 0 0-2 2 4 4 0 0 0 4 4" />
                            </svg>
                            {t('globalLeaderboard.prize.winnerNote')}
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {isUpcomingTab ? (
                    <div className="rounded-2xl border border-dashed border-[#232329] bg-[#0a0a0d] px-4 py-12 text-center">
                      <div className="text-sm font-bold text-white">{t('globalLeaderboard.comingSoon')}</div>
                      <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-[#71717a]">
                        {t('globalLeaderboard.comingSoonDesc')}
                      </p>
                    </div>
                  ) : loadingSeason ? (
                    <div className="py-10 text-center text-sm text-[#71717a]">{t('globalLeaderboard.loading')}</div>
                  ) : (
                    <LeaderboardTable
                      rows={seasonRows}
                      highlightTopN={1}
                      contextLabel={t(activeSeason.nameKey)}
                      currentUserId={currentUserId}
                      onShare={(row, rank) =>
                        handleShare(row, rank, t(activeSeason.nameKey), seasonRows.length)
                      }
                    />
                  )}
                </>
              )
            )}
          </motion.section>
        </main>
      </div>
      <ShareCardModal open={shareData != null} data={shareData} onClose={() => setShareData(null)} />
      <BadgeShowcaseModal badge={showcaseBadge} earned onClose={() => setShowcaseBadge(null)} />
    </div>
  );
}
