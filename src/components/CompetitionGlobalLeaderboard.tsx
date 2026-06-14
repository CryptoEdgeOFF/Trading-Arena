import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import Seo from './Seo';
import CompeteHeader from './CompeteHeader';
import { AvatarImage } from './OptimizedImage';
import { NameBadges, type UserBadge } from './playerBadges';
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

export default function CompetitionGlobalLeaderboard() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<GlobalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [shareData, setShareData] = useState<ShareCardData | null>(null);
  const currentUserId = readCachedCompeteUser()?.id ?? null;

  useEffect(() => {
    let cancelled = false;
    fetch('/api/competition/global-leaderboard')
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setRows((data.rows as GlobalRow[]) || []);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="compete min-h-dvh-safe bg-[#050507]">
      <Seo
        title={t('seo.leaderboardTitle')}
        description={t('seo.leaderboardDesc')}
        path="/compete/global-leaderboard"
      />
      <div className="compete-bg min-h-dvh-safe">
        <CompeteHeader />

        <main className="mx-auto max-w-6xl px-5 py-10 md:px-8">
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

          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.05, ease: [0.22, 1, 0.36, 1] }}
            className="relative mt-6 overflow-hidden rounded-2xl border border-amber-500/30 bg-gradient-to-br from-[#241a05] via-[#0f0a04] to-[#0a0a0d] p-5 md:p-6"
          >
            <div className="pointer-events-none absolute -right-20 -top-20 h-56 w-56 rounded-full bg-amber-500/15 blur-3xl" />
            <div className="relative flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-amber-400/30 bg-amber-400/10 text-amber-200">
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M8 21h8M12 17v4M7 4h10v4a5 5 0 0 1-10 0V4Z" />
                  <path d="M17 5h2a2 2 0 0 1 2 2 4 4 0 0 1-4 4M7 5H5a2 2 0 0 0-2 2 4 4 0 0 0 4 4" />
                </svg>
              </div>
              <div className="min-w-0">
                <div className="micro text-[10px] text-amber-400/90">{t('globalLeaderboard.rewardEyebrow')}</div>
                <h2 className="display mt-1 text-lg font-bold text-white md:text-xl">{t('globalLeaderboard.rewardTitle')}</h2>
                <p className="mt-1.5 text-sm leading-relaxed text-amber-100/70">{t('globalLeaderboard.rewardDesc')}</p>
              </div>
            </div>
          </motion.div>

          {loading ? (
            <div className="mt-10 text-center text-sm text-[#71717a]">{t('globalLeaderboard.loading')}</div>
          ) : rows.length === 0 ? (
            <div className="mt-10 rounded-2xl border border-dashed border-[#232329] bg-[#0a0a0d] px-6 py-12 text-center text-sm text-[#71717a]">
              {t('globalLeaderboard.empty')}
            </div>
          ) : (
            <div className="mt-6 overflow-x-auto">
              <table className="w-full min-w-[760px] border-separate border-spacing-y-2">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-[0.16em] text-[#71717a]">
                    <th className="px-3 py-2 font-semibold">{t('globalLeaderboard.rank')}</th>
                    <th className="px-3 py-2 font-semibold">{t('globalLeaderboard.trader')}</th>
                    <th className="px-3 py-2 text-right font-semibold">{t('globalLeaderboard.totalPnl')}</th>
                    <th className="px-3 py-2 text-right font-semibold">{t('globalLeaderboard.winRate')}</th>
                    <th className="px-3 py-2 text-right font-semibold">{t('globalLeaderboard.avgRR')}</th>
                    <th className="px-3 py-2 text-right font-semibold">{t('globalLeaderboard.profitFactor')}</th>
                    <th className="px-3 py-2 text-right font-semibold">{t('globalLeaderboard.trades')}</th>
                    <th className="px-3 py-2 text-right font-semibold">{t('globalLeaderboard.arenas')}</th>
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
                    const qualifies = rank <= 5;
                    const rowBg = qualifies ? 'bg-amber-500/[0.06] hover:bg-amber-500/10' : 'bg-[#0c0c10] hover:bg-[#101016]';
                    const borderCol = qualifies ? 'border-amber-500/25' : 'border-[#1a1a20]';
                    return (
                      <tr key={row.userId} className={`${rowBg} transition-colors`}>
                        <td className={`rounded-l-xl border-y border-l ${borderCol} px-3 py-3`}>
                          <span className={`rank-circle ${tier} h-8 w-8 text-sm`}>{rank}</span>
                        </td>
                        <td className={`border-y ${borderCol} px-3 py-3`}>
                          <div className="flex items-center gap-3">
                            <Link
                              to={`/compete/player/${row.userId}`}
                              className="group flex min-w-0 items-center gap-3 overflow-hidden"
                              title={t('playerProfile.viewProfile')}
                            >
                              {row.avatarUrl ? (
                                <AvatarImage
                                  src={row.avatarUrl}
                                  alt=""
                                  className="h-9 w-9 shrink-0 rounded-lg object-cover"
                                  sizePx={36}
                                />
                              ) : (
                                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#dc2626] to-[#7f1d1d] text-xs font-bold uppercase text-white">
                                  {getInitials(row.name)}
                                </span>
                              )}
                              <div className="min-w-0">
                                <div className="flex min-w-0 items-center gap-1.5">
                                  <span className="truncate text-sm font-semibold text-white underline-offset-2 group-hover:underline">{row.name}</span>
                                  <NameBadges badges={row.badges} compact />
                                </div>
                                {noTrades && (
                                  <div className="text-[10px] text-[#71717a]">{t('globalLeaderboard.noTrades')}</div>
                                )}
                              </div>
                            </Link>
                            {isMe && (
                              <button
                                type="button"
                                onClick={() =>
                                  setShareData({
                                    kind: 'rank',
                                    playerName: row.name,
                                    rank,
                                    participants: rows.length,
                                    contextLabel: t('globalLeaderboard.title'),
                                    pnlUsd: row.pnlUsd,
                                    avatarUrl: row.avatarUrl,
                                    badges: row.badges,
                                  })
                                }
                                title={t('share.cta')}
                                aria-label={t('share.cta')}
                                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#dc2626]/40 bg-[#dc2626]/15 text-[#fca5a5] transition-colors hover:border-[#dc2626]/70 hover:bg-[#dc2626]/25 hover:text-white"
                              >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                  <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13" />
                                </svg>
                              </button>
                            )}
                          </div>
                        </td>
                        <td className={`num border-y ${borderCol} px-3 py-3 text-right text-sm font-bold ${pos ? 'text-emerald-400' : neg ? 'text-rose-400' : 'text-white'}`}>
                          {formatCompactSigned(row.pnlUsd)} $
                        </td>
                        <td className={`num border-y ${borderCol} px-3 py-3 text-right text-sm text-[#e0e2ea]`}>
                          {fmtWinRate(row.stats)}
                        </td>
                        <td className={`num border-y ${borderCol} px-3 py-3 text-right text-sm text-[#e0e2ea]`}>
                          {fmtRR(row.stats)}
                        </td>
                        <td className={`num border-y ${borderCol} px-3 py-3 text-right text-sm text-[#e0e2ea]`}>
                          {fmtProfitFactor(row.stats)}
                        </td>
                        <td className={`num border-y ${borderCol} px-3 py-3 text-right text-sm text-[#9a9aa6]`}>
                          {row.stats.closedTrades}
                        </td>
                        <td className={`num rounded-r-xl border-y border-r ${borderCol} px-3 py-3 text-right text-sm text-[#9a9aa6]`}>
                          {row.arenas}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </main>
      </div>
      <ShareCardModal open={shareData != null} data={shareData} onClose={() => setShareData(null)} />
    </div>
  );
}
