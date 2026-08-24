import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';
import CompeteHeader from './CompeteHeader';
import { formatCompactSigned } from './competeMetrics';
import ShareCardModal from './ShareCardModal';
import { readCachedCompeteUser } from '../lib/competeSession';
import type { ShareCardData } from '../lib/shareCard';

const SESSION_KEY = 'btf-comp-session';

interface JournalTrade {
  id: string;
  competitionId: string;
  competitionTitle: string;
  pair: string;
  side: 'long' | 'short';
  action: 'open' | 'close';
  size: number;
  price: number;
  entryPrice?: number;
  leverage: number;
  fee: number;
  pnl: number;
  time: number;
}

/**
 * PnL net d'un trade fermé = PnL prix - frais de clôture. Les frais
 * d'ouverture (portés par les trades 'open') sont déduits séparément dans la
 * courbe d'équité et le total net.
 */
function netPnl(trade: JournalTrade): number {
  return trade.pnl - trade.fee;
}

function dateLocale(): string {
  return i18n.resolvedLanguage === 'fr' ? 'fr-FR' : 'en-US';
}

function fmtDateTime(value: number): string {
  return new Date(value).toLocaleString(dateLocale(), { dateStyle: 'short', timeStyle: 'short' });
}

function fmtPnl(value: number): string {
  return `${formatCompactSigned(value)} $`;
}

/**
 * Courbe d'équité (PnL réalisé cumulé, frais déduits) en SVG pur.
 * Chaque événement compte : open → -frais d'entrée, close → PnL - frais de
 * sortie. x = index de l'événement (espacement régulier), y = cumul.
 */
function EquityCurve({ trades }: { trades: JournalTrade[] }) {
  const { t } = useTranslation();
  const closedCount = useMemo(() => trades.filter((trade) => trade.action === 'close').length, [trades]);
  const { path, areaPath, zeroY, lastValue, w, h } = useMemo(() => {
    const w = 720;
    const h = 220;
    const pad = 10;
    const cumulative: number[] = [0];
    let acc = 0;
    for (const trade of trades) {
      acc += trade.action === 'close' ? netPnl(trade) : -trade.fee;
      cumulative.push(acc);
    }
    const min = Math.min(0, ...cumulative);
    const max = Math.max(0, ...cumulative);
    const range = max - min || 1;
    const stepX = (w - pad * 2) / Math.max(1, cumulative.length - 1);
    const toX = (i: number) => pad + i * stepX;
    const toY = (v: number) => pad + (max - v) / range * (h - pad * 2);
    const points = cumulative.map((v, i) => `${toX(i).toFixed(2)},${toY(v).toFixed(2)}`);
    const path = `M${points.join(' L')}`;
    const areaPath = `${path} L${toX(cumulative.length - 1).toFixed(2)},${toY(min).toFixed(2)} L${toX(0).toFixed(2)},${toY(min).toFixed(2)} Z`;
    return { path, areaPath, zeroY: toY(0), lastValue: acc, w, h };
  }, [trades]);

  const pos = lastValue >= 0;
  const stroke = pos ? '#34d399' : '#fb7185';
  const fillId = pos ? 'equityFillPos' : 'equityFillNeg';

  return (
    <div className="flex h-full min-h-[280px] flex-col rounded-2xl border border-[#232329] bg-[#0c0c10] p-5 md:p-6">
      <div className="flex items-center justify-between gap-3">
        <div className="micro text-[10px] text-[#71717a]">{t('journal.equityCurve')}</div>
        <div className={`num text-lg font-bold ${pos ? 'text-emerald-400' : 'text-rose-400'}`}>{fmtPnl(lastValue)}</div>
      </div>
      {/* preserveAspectRatio="none" : le graphe remplit toute la hauteur de la
          carte (alignée sur la colonne de droite) ; vector-effect garde des
          traits d'épaisseur constante malgré l'étirement. */}
      <svg
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        className="mt-3 w-full flex-1"
        role="img"
        aria-label={t('journal.equityCurve')}
      >
        <defs>
          <linearGradient id="equityFillPos" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#34d399" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#34d399" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="equityFillNeg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fb7185" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#fb7185" stopOpacity="0" />
          </linearGradient>
        </defs>
        <line x1="0" x2={w} y1={zeroY} y2={zeroY} stroke="#2a2a32" strokeWidth="1" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
        <path d={areaPath} fill={`url(#${fillId})`} />
        <path d={path} fill="none" stroke={stroke} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="mt-2 text-right text-[10px] uppercase tracking-[0.16em] text-[#71717a]">
        {t('journal.tradesCount', { count: closedCount })}
      </div>
    </div>
  );
}

function TradeHighlightCard({ trade, kind, onShare }: { trade: JournalTrade; kind: 'best' | 'worst'; onShare: (trade: JournalTrade) => void }) {
  const { t } = useTranslation();
  const net = netPnl(trade);
  const pos = net >= 0;
  return (
    <div className={`group relative rounded-xl border px-4 py-3 ${pos ? 'border-emerald-500/25 bg-emerald-500/[0.06]' : 'border-rose-500/25 bg-rose-500/[0.06]'}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-bold text-white">{trade.pair}</span>
        <span className={`num text-sm font-bold ${pos ? 'text-emerald-400' : 'text-rose-400'}`}>{fmtPnl(net)}</span>
      </div>
      <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-[#9a9aa6]">
        <span>
          <span className={`font-semibold uppercase ${trade.side === 'long' ? 'text-emerald-300/80' : 'text-rose-300/80'}`}>
            {t(trade.side === 'long' ? 'journal.long' : 'journal.short')}
          </span>
          {' · x'}{trade.leverage}
        </span>
        <span>{fmtDateTime(trade.time)}</span>
      </div>
      <div className="mt-0.5 flex items-center justify-between gap-2">
        <span className="truncate text-[10px] uppercase tracking-[0.12em] text-[#71717a]">{trade.competitionTitle}</span>
        <button
          type="button"
          onClick={() => onShare(trade)}
          title={t('share.cta')}
          aria-label={t('share.cta')}
          className="flex shrink-0 items-center gap-1 rounded-md border border-[#dc2626]/30 bg-[#dc2626]/10 px-2 py-1 text-[9px] font-bold uppercase tracking-[0.1em] text-[#fca5a5] transition-colors hover:border-[#dc2626]/60 hover:bg-[#dc2626]/20 hover:text-white"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13" />
          </svg>
          {t('share.cta')}
        </button>
      </div>
      <span className="sr-only">{kind}</span>
    </div>
  );
}

interface JournalStats {
  count: number;
  wins: number;
  losses: number;
  /** PnL net total : closes nets de frais de sortie - frais d'ouverture. */
  netPnl: number;
  /** Total des frais payés (ouvertures + clôtures). */
  totalFees: number;
  winRate: number | null;
  avgRR: number | null;
  profitFactor: number | null;
  /** null = aucune perte mais des gains (PF "infini"). */
  profitFactorInfinite: boolean;
  maxWinStreak: number;
  maxLossStreak: number;
}

/**
 * Stats complètes sur une liste d'événements (opens + closes, triés par date
 * croissante). Toutes les métriques sont nettes de frais : un close compte
 * pour pnl - frais de sortie, les frais d'ouverture s'ajoutent au coût total.
 */
function computeJournalStats(trades: JournalTrade[]): JournalStats {
  let count = 0;
  let wins = 0;
  let losses = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  let openFees = 0;
  let totalFees = 0;
  let closesNet = 0;
  let winStreak = 0;
  let lossStreak = 0;
  let maxWinStreak = 0;
  let maxLossStreak = 0;

  for (const trade of trades) {
    totalFees += trade.fee;
    if (trade.action !== 'close') {
      openFees += trade.fee;
      continue;
    }
    const net = netPnl(trade);
    count += 1;
    closesNet += net;
    if (net > 0) {
      wins += 1;
      grossProfit += net;
      winStreak += 1;
      lossStreak = 0;
      if (winStreak > maxWinStreak) maxWinStreak = winStreak;
    } else if (net < 0) {
      losses += 1;
      grossLoss += -net;
      lossStreak += 1;
      winStreak = 0;
      if (lossStreak > maxLossStreak) maxLossStreak = lossStreak;
    } else {
      winStreak = 0;
      lossStreak = 0;
    }
  }

  const decided = wins + losses;
  const avgWin = wins > 0 ? grossProfit / wins : 0;
  const avgLoss = losses > 0 ? grossLoss / losses : 0;
  return {
    count,
    wins,
    losses,
    netPnl: closesNet - openFees,
    totalFees,
    winRate: decided > 0 ? wins / decided : null,
    avgRR: avgLoss > 0 && wins > 0 ? avgWin / avgLoss : null,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : null,
    profitFactorInfinite: grossLoss === 0 && grossProfit > 0,
    maxWinStreak,
    maxLossStreak,
  };
}

function StatBox({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'pos' | 'neg' | 'neutral' }) {
  const color = tone === 'pos' ? 'text-emerald-400' : tone === 'neg' ? 'text-rose-400' : 'text-white';
  return (
    <div className="rounded-lg border border-[#1a1a20] bg-[#0a0a0d] px-2 py-2.5 text-center">
      <div className={`num text-base font-bold leading-none ${color}`}>{value}</div>
      <div className="mt-1.5 text-[8.5px] uppercase tracking-[0.12em] text-[#71717a]">{label}</div>
    </div>
  );
}

export default function CompetitionTradeJournal() {
  const { t } = useTranslation();
  const [trades, setTrades] = useState<JournalTrade[]>([]);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState(false);
  const [arenaFilter, setArenaFilter] = useState<string>('all');
  const [shareData, setShareData] = useState<ShareCardData | null>(null);

  function shareTrade(trade: JournalTrade) {
    const playerName = readCachedCompeteUser()?.name ?? 'Trader';
    const exitPrice = trade.price;
    // Prix d'entrée : valeur exacte renvoyée par le serveur si dispo, sinon
    // reconstituée depuis le PnL prix (pnl = (sortie-entrée)*taille pour un
    // long, l'inverse pour un short).
    let entryPrice = trade.entryPrice;
    if ((entryPrice == null || !Number.isFinite(entryPrice)) && trade.size > 0) {
      entryPrice = trade.side === 'long'
        ? exitPrice - trade.pnl / trade.size
        : exitPrice + trade.pnl / trade.size;
    }
    setShareData({
      kind: 'trade',
      playerName,
      pair: trade.pair,
      side: trade.side,
      pnlUsd: netPnl(trade),
      entryPrice: entryPrice != null && Number.isFinite(entryPrice) ? entryPrice : undefined,
      exitPrice,
      leverage: trade.leverage,
      time: trade.time,
      contextLabel: trade.competitionTitle,
    });
  }

  useEffect(() => {
    const token = window.localStorage.getItem(SESSION_KEY);
    if (!token) {
      setAuthError(true);
      setLoading(false);
      return;
    }
    let cancelled = false;
    fetch('/api/competition/my-trades', { headers: { Authorization: `Bearer ${token}` } })
      .then((response) => {
        if (response.status === 401) {
          if (!cancelled) setAuthError(true);
          return null;
        }
        return response.ok ? response.json() : null;
      })
      .then((data) => {
        if (cancelled || !data) return;
        setTrades((data.trades as JournalTrade[]) || []);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const arenas = useMemo(() => {
    const byId = new Map<string, string>();
    for (const trade of trades) {
      if (!byId.has(trade.competitionId)) byId.set(trade.competitionId, trade.competitionTitle);
    }
    return Array.from(byId.entries()).map(([id, title]) => ({ id, title }));
  }, [trades]);

  const filteredTrades = useMemo(
    () => (arenaFilter === 'all' ? trades : trades.filter((trade) => trade.competitionId === arenaFilter)),
    [trades, arenaFilter],
  );

  const { bestTrades, worstTrades, stats } = useMemo(() => {
    const closes = filteredTrades.filter((trade) => trade.action === 'close');
    const sorted = closes.slice().sort((a, b) => netPnl(b) - netPnl(a));
    const bestTrades = sorted.filter((trade) => netPnl(trade) > 0).slice(0, 3);
    const worstTrades = sorted.filter((trade) => netPnl(trade) < 0).slice(-3).reverse();
    return { bestTrades, worstTrades, stats: computeJournalStats(filteredTrades) };
  }, [filteredTrades]);

  const recentFirst = useMemo(
    () => filteredTrades.filter((trade) => trade.action === 'close').slice().reverse(),
    [filteredTrades],
  );

  return (
    <div className="compete min-h-dvh-safe bg-[#050507]">
      <div className="compete-bg min-h-dvh-safe">
        <CompeteHeader />

        <main className="mx-auto max-w-6xl px-5 py-10 md:px-8">
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            className="border-b border-[#1a1a20] pb-5"
          >
            <div className="micro text-[10px] text-[#dc2626]">{t('journal.eyebrow')}</div>
            <h1 className="display mt-1 text-3xl font-bold text-white md:text-4xl">{t('journal.title')}</h1>
            <p className="mt-2 text-sm text-[#71717a]">{t('journal.subtitle')}</p>
          </motion.div>

          {loading ? (
            <div className="mt-10 text-center text-sm text-[#71717a]">{t('journal.loading')}</div>
          ) : authError ? (
            <div className="mt-10 rounded-2xl border border-dashed border-[#232329] bg-[#0a0a0d] px-6 py-12 text-center text-sm text-[#71717a]">
              {t('journal.loginRequired')}{' '}
              <Link to="/compete" className="font-semibold text-[#dc2626] hover:underline">{t('journal.backToHome')}</Link>
            </div>
          ) : trades.length === 0 ? (
            <div className="mt-10 rounded-2xl border border-dashed border-[#232329] bg-[#0a0a0d] px-6 py-12 text-center text-sm text-[#71717a]">
              {t('journal.empty')}
            </div>
          ) : (
            <>
              {/* Sélecteur d'arène : journal global ou par arène */}
              <div className="mt-6 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setArenaFilter('all')}
                  className={`rounded-lg border px-3.5 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] transition-colors ${
                    arenaFilter === 'all'
                      ? 'border-[#dc2626]/50 bg-[#dc2626]/15 text-white'
                      : 'border-[#232329] bg-[#0c0c10] text-[#9a9aa6] hover:border-[#3a3a44] hover:text-white'
                  }`}
                >
                  {t('journal.allArenas')}
                </button>
                {arenas.map((arena) => (
                  <button
                    key={arena.id}
                    type="button"
                    onClick={() => setArenaFilter(arena.id)}
                    className={`max-w-[220px] truncate rounded-lg border px-3.5 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] transition-colors ${
                      arenaFilter === arena.id
                        ? 'border-[#dc2626]/50 bg-[#dc2626]/15 text-white'
                        : 'border-[#232329] bg-[#0c0c10] text-[#9a9aa6] hover:border-[#3a3a44] hover:text-white'
                    }`}
                  >
                    {arena.title}
                  </button>
                ))}
              </div>

              <div className="mt-5 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
                <EquityCurve trades={filteredTrades} />

                <div className="grid content-start gap-3">
                  <div className="rounded-2xl border border-[#232329] bg-[#0c0c10] p-4">
                    <div className="micro text-[10px] text-[#71717a]">{t('journal.summary')}</div>
                    <div className="mt-3 grid grid-cols-3 gap-2">
                      <StatBox
                        label={t('journal.realizedPnl')}
                        value={fmtPnl(stats.netPnl)}
                        tone={stats.netPnl > 0 ? 'pos' : stats.netPnl < 0 ? 'neg' : 'neutral'}
                      />
                      <StatBox label={t('journal.wins')} value={String(stats.wins)} tone="pos" />
                      <StatBox label={t('journal.losses')} value={String(stats.losses)} tone="neg" />
                      <StatBox
                        label={t('journal.winRate')}
                        value={stats.winRate == null ? '—' : `${(stats.winRate * 100).toFixed(1)}%`}
                        tone={stats.winRate == null ? 'neutral' : stats.winRate >= 0.5 ? 'pos' : 'neg'}
                      />
                      <StatBox
                        label={t('journal.avgRR')}
                        value={stats.avgRR == null ? '—' : stats.avgRR.toFixed(2)}
                        tone={stats.avgRR == null ? 'neutral' : stats.avgRR >= 1 ? 'pos' : 'neg'}
                      />
                      <StatBox
                        label={t('journal.profitFactor')}
                        value={stats.profitFactorInfinite ? '∞' : stats.profitFactor == null ? '—' : stats.profitFactor.toFixed(2)}
                        tone={
                          stats.profitFactorInfinite
                            ? 'pos'
                            : stats.profitFactor == null
                              ? 'neutral'
                              : stats.profitFactor >= 1
                                ? 'pos'
                                : 'neg'
                        }
                      />
                      <StatBox label={t('journal.maxWinStreak')} value={String(stats.maxWinStreak)} tone={stats.maxWinStreak > 0 ? 'pos' : 'neutral'} />
                      <StatBox label={t('journal.maxLossStreak')} value={String(stats.maxLossStreak)} tone={stats.maxLossStreak > 0 ? 'neg' : 'neutral'} />
                      <StatBox label={t('journal.totalFees')} value={fmtPnl(-stats.totalFees)} tone={stats.totalFees > 0 ? 'neg' : 'neutral'} />
                    </div>
                  </div>

                  {bestTrades.length > 0 && (
                    <div>
                      <div className="micro mb-2 text-[10px] text-emerald-400/90">{t('journal.bestTrades')}</div>
                      <div className="grid gap-2">
                        {bestTrades.map((trade) => (
                          <TradeHighlightCard key={trade.id} trade={trade} kind="best" onShare={shareTrade} />
                        ))}
                      </div>
                    </div>
                  )}

                  {worstTrades.length > 0 && (
                    <div>
                      <div className="micro mb-2 text-[10px] text-rose-400/90">{t('journal.worstTrades')}</div>
                      <div className="grid gap-2">
                        {worstTrades.map((trade) => (
                          <TradeHighlightCard key={trade.id} trade={trade} kind="worst" onShare={shareTrade} />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-8">
                <div className="micro mb-3 text-[10px] text-[#71717a]">{t('journal.allTrades')}</div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[680px] border-separate border-spacing-y-1.5">
                    <thead>
                      <tr className="text-left text-[10px] uppercase tracking-[0.16em] text-[#71717a]">
                        <th className="px-3 py-1.5 font-semibold">{t('journal.date')}</th>
                        <th className="px-3 py-1.5 font-semibold">{t('journal.arena')}</th>
                        <th className="px-3 py-1.5 font-semibold">{t('journal.pair')}</th>
                        <th className="px-3 py-1.5 font-semibold">{t('journal.side')}</th>
                        <th className="px-3 py-1.5 text-right font-semibold">{t('journal.leverage')}</th>
                        <th className="px-3 py-1.5 text-right font-semibold">{t('journal.feesCol')}</th>
                        <th className="px-3 py-1.5 text-right font-semibold">{t('journal.netPnlCol')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentFirst.map((trade) => {
                        const net = netPnl(trade);
                        const pos = net >= 0;
                        return (
                          <tr key={trade.id} className="bg-[#0c0c10] transition-colors hover:bg-[#101016]">
                            <td className="num rounded-l-lg border-y border-l border-[#1a1a20] px-3 py-2.5 text-xs text-[#9a9aa6]">
                              {fmtDateTime(trade.time)}
                            </td>
                            <td className="max-w-[180px] truncate border-y border-[#1a1a20] px-3 py-2.5 text-xs text-[#9a9aa6]">
                              {trade.competitionTitle}
                            </td>
                            <td className="border-y border-[#1a1a20] px-3 py-2.5 text-sm font-semibold text-white">
                              {trade.pair}
                            </td>
                            <td className="border-y border-[#1a1a20] px-3 py-2.5">
                              <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] ${trade.side === 'long' ? 'bg-emerald-500/10 text-emerald-300' : 'bg-rose-500/10 text-rose-300'}`}>
                                {t(trade.side === 'long' ? 'journal.long' : 'journal.short')}
                              </span>
                            </td>
                            <td className="num border-y border-[#1a1a20] px-3 py-2.5 text-right text-xs text-[#9a9aa6]">
                              x{trade.leverage}
                            </td>
                            <td className="num border-y border-[#1a1a20] px-3 py-2.5 text-right text-xs text-[#9a9aa6]">
                              {trade.fee > 0 ? fmtPnl(-trade.fee) : '—'}
                            </td>
                            <td className={`num rounded-r-lg border-y border-r border-[#1a1a20] px-3 py-2.5 text-right text-sm font-bold ${pos ? 'text-emerald-400' : 'text-rose-400'}`}>
                              {fmtPnl(net)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </main>
      </div>
      <ShareCardModal open={shareData != null} data={shareData} onClose={() => setShareData(null)} />
    </div>
  );
}
