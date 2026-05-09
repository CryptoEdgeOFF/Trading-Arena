import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  AnimatedNumber,
  MetricCard,
  formatCompactSigned,
  formatCompactUnsigned,
  formatPercent,
} from './competeMetrics';

const REFRESH_MS = 2000;
const CONTACT_EMAIL = 'breakout.pro.tv@gmail.com';
const SESSION_KEY = 'btf-comp-session';

interface LeaderboardRow {
  rank: number;
  userId: string;
  name: string;
  pnlPercent: number;
  pnlUsd: number;
  tradesCount: number;
  updatedAt: number;
}

interface CashPrize {
  currency: string;
  total: number;
  breakdown?: Array<{ rank: number; amount: number }>;
}

interface LeaderboardResponse {
  competition: {
    id: string;
    title: string;
    code: string;
    startAt: number;
    endAt: number;
    status: 'upcoming' | 'live' | 'ended';
    participants: number;
    cashPrize?: CashPrize | null;
  };
  leaderboard: LeaderboardRow[];
}

function fmtDate(value: number): string {
  return new Date(value).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
}

function fmtTime(value: number): string {
  return new Date(value).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
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

function StatusPill({ status }: { status: 'upcoming' | 'live' | 'ended' }) {
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

function formatPrizeAmount(amount: number, currency: string): string {
  const value = Math.round(amount).toLocaleString('en-US').replace(/,/g, ' ');
  return `${value} ${currency}`;
}

const RANK_TIER_LABEL: Record<number, string> = {
  1: '1er',
  2: '2eme',
  3: '3eme',
};

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
  const { id } = useParams();
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [error, setError] = useState('');
  const [lastRefresh, setLastRefresh] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

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
        if (!response.ok) throw new Error(payload.error || 'Leaderboard indisponible');
        setData(payload as LeaderboardResponse);
        setLastRefresh(Date.now());
        setError('');
      } catch (err: unknown) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Erreur inconnue');
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
  }, [id]);

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

  const top3 = useMemo(() => (data ? data.leaderboard.slice(0, 3) : []), [data]);
  const rest = useMemo(() => (data ? data.leaderboard.slice(3) : []), [data]);
  const myRow = useMemo(() => (
    data && currentUserId ? data.leaderboard.find((row) => row.userId === currentUserId) || null : null
  ), [currentUserId, data]);

  const targetCountdown = data ? (data.competition.status === 'live' ? data.competition.endAt : data.competition.startAt) : Date.now();
  const countdown = useCountdown(targetCountdown);

  const aggregates = useMemo(() => {
    if (!data || data.leaderboard.length === 0) {
      return { avgPnl: 0, bestPnl: 0, totalTrades: 0 };
    }
    const totalPct = data.leaderboard.reduce((acc, row) => acc + row.pnlPercent, 0);
    const totalTrades = data.leaderboard.reduce((acc, row) => acc + row.tradesCount, 0);
    const bestPnl = Math.max(...data.leaderboard.map((row) => row.pnlPercent));
    return {
      avgPnl: totalPct / data.leaderboard.length,
      bestPnl,
      totalTrades,
    };
  }, [data]);

  return (
    <div className="compete h-screen overflow-y-auto">
      <header className="sticky top-0 z-40 border-b border-[#1a1a20] bg-[rgba(5,5,7,0.85)] backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4 md:px-10">
          <Link to="/compete" className="flex items-center gap-3">
            <img src="/assets/pictures/logoBTF.png" alt="BTF" className="h-9 w-9 rounded-lg object-contain" />
            <div className="flex items-baseline gap-2">
              <span className="display text-xl font-bold text-white">BTF</span>
              <span className="micro text-xs text-[#dc2626]">Arena</span>
            </div>
          </Link>
          <Link to="/compete" className="ghost-cta px-4 py-2 text-sm">
            Retour competitions
          </Link>
        </div>
      </header>

      <main className="compete-bg pb-20">
        <div className="mx-auto max-w-6xl px-6 pt-10 md:px-10 md:pt-14">
          {error && (
            <div className="rounded-2xl border border-[#dc2626]/30 bg-[#dc2626]/10 px-5 py-4 text-sm text-[#fca5a5]">
              {error}
            </div>
          )}

          {!error && !data && (
            <div className="glass-card p-10 text-center text-sm text-[#b8b8c2]">
              Chargement du leaderboard...
            </div>
          )}

          {data && (
            <>
              {/* HERO */}
              <section className="grid gap-6 lg:grid-cols-[1.4fr_1fr] lg:items-end">
                <div>
                  <div className="flex flex-wrap items-center gap-3">
                    <StatusPill status={data.competition.status} />
                    <span className="flex items-center gap-2 rounded-full border border-[#dc2626]/30 bg-[#dc2626]/10 px-3 py-1 text-[11px] font-semibold text-[#fca5a5]">
                      <span className={`h-2 w-2 rounded-full ${paused ? 'bg-[#71717a]' : 'live-dot'}`} />
                      {paused ? 'En pause' : 'Live'}
                      {lastRefresh && (
                        <span className="font-normal text-[#fda4af]/70">· maj {fmtTime(lastRefresh)}</span>
                      )}
                    </span>
                  </div>
                  <h1 className="display mt-4 text-4xl font-bold leading-[1.05] text-white md:text-6xl">
                    {data.competition.title}
                  </h1>
                  <div className="mt-3 text-sm text-[#b8b8c2]">
                    {fmtDate(data.competition.startAt)} <span className="text-[#71717a]">→</span> {fmtDate(data.competition.endAt)}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
                  <motion.div
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                    className={`metric metric-pnl-big ${data.competition.status === 'live' ? 'ticker-glow' : ''}`}
                  >
                    <div className="metric-label">
                      {data.competition.status === 'live' ? 'Fin dans' : data.competition.status === 'upcoming' ? 'Démarre dans' : 'Status'}
                      {data.competition.status === 'live' && <span className="live-dot" />}
                    </div>
                    <div className="metric-value" style={{ fontSize: 'clamp(1.3rem, 5.5vw, 1.9rem)' }}>
                      {data.competition.status === 'ended' ? 'Terminée' : countdown}
                    </div>
                  </motion.div>
                  <MetricCard
                    label="Participants"
                    value={data.competition.participants}
                    format={(v) => formatCompactUnsigned(v)}
                    tone="neutral"
                    delayClass="rise-in-1"
                  />
                  <MetricCard
                    label="PnL moyen"
                    value={aggregates.avgPnl}
                    format={(v) => formatPercent(v)}
                    unit="%"
                    tone={aggregates.avgPnl > 0 ? 'pos' : aggregates.avgPnl < 0 ? 'neg' : 'neutral'}
                    delayClass="rise-in-2"
                  />
                  <MetricCard
                    label="Total trades"
                    value={aggregates.totalTrades}
                    format={(v) => formatCompactUnsigned(v)}
                    tone="neutral"
                    delayClass="rise-in-3"
                  />
                </div>
              </section>

              {/* CASH PRIZE */}
              {data.competition.cashPrize && data.competition.cashPrize.total > 0 && (
                <CashPrizeSection prize={data.competition.cashPrize} />
              )}

              {myRow && (
                <section className="mt-8 rounded-2xl border border-[#dc2626]/35 bg-[#dc2626]/10 p-4 shadow-[0_20px_70px_-45px_rgba(220,38,38,0.9)]">
                  <div className="micro text-[10px] text-[#fca5a5]">Ta position</div>
                  <RankRow row={myRow} index={0} isMe compact />
                </section>
              )}

              {/* PODIUM */}
              {top3.length > 0 && (
                <section className="mt-12">
                  <div className="border-b border-[#1a1a20] pb-4">
                    <div className="micro text-[10px] text-[#dc2626]">Podium en direct</div>
                    <h2 className="display mt-1 text-2xl font-bold text-white md:text-3xl">Top 3</h2>
                  </div>
                  <div className="mt-8 grid gap-5 md:grid-cols-3 md:items-end">
                    <PodiumCard row={top3[1]} place={2} />
                    <PodiumCard row={top3[0]} place={1} />
                    <PodiumCard row={top3[2]} place={3} />
                  </div>
                </section>
              )}

              {/* RANKING TABLE */}
              <section className="mt-14">
                <div className="border-b border-[#1a1a20] pb-4">
                  <div className="micro text-[10px] text-[#dc2626]">Classement complet</div>
                  <h2 className="display mt-1 text-2xl font-bold text-white md:text-3xl">Tous les traders</h2>
                </div>

                {data.leaderboard.length === 0 ? (
                  <div className="glass-card mt-6 p-10 text-center text-sm text-[#b8b8c2]">
                    Aucun trader inscrit pour le moment.
                  </div>
                ) : (
                  <div className="glass-card mt-6 overflow-hidden">
                    <div className="grid grid-cols-[44px_1.4fr_1fr_0.9fr_0.6fr] items-center gap-2 border-b border-[#232329] bg-[#0c0c10] px-3 py-3 text-[9px] uppercase tracking-[0.16em] text-[#71717a] sm:grid-cols-[60px_1.6fr_0.9fr_0.9fr_0.6fr_0.9fr] sm:gap-3 sm:px-5 sm:text-[10px] md:grid-cols-[80px_1.6fr_1fr_1fr_0.7fr_1fr]">
                      <div>Rank</div>
                      <div>Trader</div>
                      <div className="text-right">PnL %</div>
                      <div className="text-right">PnL USD</div>
                      <div className="text-right">Trades</div>
                      <div className="hidden text-right md:block">Dernière maj</div>
                    </div>
                    <div className="divide-y divide-[#1a1a20]">
                      {rest.length > 0 ? (
                        rest.map((row, idx) => <RankRow key={row.userId} row={row} index={idx} isMe={row.userId === currentUserId} />)
                      ) : (
                        <div className="px-5 py-6 text-center text-xs text-[#71717a]">
                          Podium uniquement — pas encore de challenger en dehors du top 3.
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </main>

      <footer className="border-t border-[#1a1a20] bg-[#050507]">
        <div className="mx-auto flex max-w-6xl flex-col gap-5 px-6 py-7 md:flex-row md:items-end md:justify-between md:px-10">
          <div>
            <div className="display text-sm font-bold tracking-wide text-white">BTF Arena</div>
            <div className="text-[11px] text-[#71717a]">Trading arena platform</div>
            <div className="mt-2 text-[11px] text-[#71717a]">© {new Date().getFullYear()} BTF · All rights reserved.</div>
          </div>
          <div className="flex flex-col gap-2 text-[11px] text-[#71717a] md:items-end">
            <a className="transition-colors hover:text-white" href={`mailto:${CONTACT_EMAIL}`}>
              {CONTACT_EMAIL}
            </a>
            <nav className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] font-semibold uppercase tracking-[0.14em]">
              <Link className="transition-colors hover:text-white" to="/cgu?from=compete">CGU</Link>
              <Link className="transition-colors hover:text-white" to="/confidentialite?from=compete">Confidentialité</Link>
              <Link className="transition-colors hover:text-white" to="/mentions-legales?from=compete">Mentions légales</Link>
              <Link className="transition-colors hover:text-white" to="/risques?from=compete">Risques</Link>
            </nav>
          </div>
        </div>
      </footer>
    </div>
  );
}

/* ----------------------------- SUB COMPONENTS ----------------------------- */

function CashPrizeSection({ prize }: { prize: CashPrize }) {
  const breakdown = prize.breakdown && prize.breakdown.length > 0 ? prize.breakdown.slice(0, 6) : null;
  return (
    <section className="mt-12">
      <div className="border-b border-[#1a1a20] pb-4">
        <div className="micro text-[10px] text-amber-400/90">Cash Prize</div>
        <h2 className="display mt-1 text-2xl font-bold text-white md:text-3xl">A gagner</h2>
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-[1.05fr_1fr]">
        <div className="relative overflow-hidden rounded-2xl border border-amber-500/30 bg-gradient-to-br from-[#241a05] via-[#0f0a04] to-[#0a0a0d] p-7 md:p-9">
          <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-amber-500/15 blur-3xl" />
          <div className="pointer-events-none absolute -left-24 -bottom-24 h-72 w-72 rounded-full bg-[#dc2626]/15 blur-3xl" />
          <div className="relative">
            <div className="micro text-[10px] text-amber-300/80">Pool total</div>
            <div className="mt-2 flex items-baseline gap-3">
              <span className="display text-5xl font-bold leading-none text-white md:text-6xl">
                {Math.round(prize.total).toLocaleString('en-US').replace(/,/g, ' ')}
              </span>
              <span className="display text-2xl font-bold text-amber-300/80 md:text-3xl">{prize.currency}</span>
            </div>
            <p className="mt-4 max-w-md text-sm text-[#b8b8c2]">
              Distribue aux meilleurs traders a la fin de la competition. Plus tu grimpes dans le ranking, plus la part est grosse.
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-[#232329] bg-[#0c0c10] p-6">
          <div className="micro text-[10px] text-[#71717a]">Repartition</div>
          {breakdown ? (
            <div className="mt-4 space-y-2.5">
              {breakdown.map((row) => {
                const tier = row.rank === 1 ? 'gold' : row.rank === 2 ? 'silver' : row.rank === 3 ? 'bronze' : '';
                const label = RANK_TIER_LABEL[row.rank] || `${row.rank}eme`;
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
              Repartition annoncee a la fin de la competition.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function PodiumCard({ row, place }: { row?: LeaderboardRow; place: 1 | 2 | 3 }) {
  if (!row) {
    return (
      <div className="glass-card flex h-44 items-center justify-center text-sm text-[#71717a]">
        En attente du #{place}
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
      <div className="mx-auto mt-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[#1a0a0a] to-[#0a0a0d] text-base font-bold text-white shadow-inner">
        {getInitials(row.name)}
      </div>
      <div className="display mt-3 truncate text-base font-bold text-white sm:text-lg">{row.name}</div>
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
        <span><span className="text-[#b8b8c2]">{row.tradesCount}</span> trades</span>
        <span>·</span>
        <span>maj {fmtTime(row.updatedAt)}</span>
      </div>
    </motion.div>
  );
}

function RankRow({ row, index, isMe = false, compact = false }: { row: LeaderboardRow; index: number; isMe?: boolean; compact?: boolean }) {
  const pos = row.pnlPercent >= 0;
  const tier = row.rank === 1 ? 'gold' : row.rank === 2 ? 'silver' : row.rank === 3 ? 'bronze' : '';
  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.4, delay: Math.min(index, 12) * 0.025, ease: [0.22, 1, 0.36, 1] }}
      className={`row-hover grid grid-cols-[44px_1.4fr_1fr_0.9fr_0.6fr] items-center gap-2 border-l px-3 text-sm sm:grid-cols-[60px_1.6fr_0.9fr_0.9fr_0.6fr_0.9fr] sm:gap-3 sm:px-5 md:grid-cols-[80px_1.6fr_1fr_1fr_0.7fr_1fr] ${compact ? 'py-2 sm:py-2' : 'py-3 sm:py-3.5'} ${isMe ? 'border-[#dc2626] bg-[#dc2626]/10' : 'border-transparent'}`}
    >
      <div>
        <span className={`rank-circle ${tier}`}>{row.rank}</span>
      </div>
      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#1a0a0a] to-[#0a0a0d] text-[10px] font-bold uppercase text-white sm:h-8 sm:w-8 sm:text-[11px]">
          {getInitials(row.name)}
        </span>
        <span className="display flex min-w-0 items-center gap-2 text-sm font-semibold text-white sm:text-base">
          <span className="truncate">{row.name}</span>
          {isMe && (
            <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[#dc2626]/45 bg-[#dc2626]/18 text-[#fca5a5]" title="Ton classement" aria-label="Ton classement">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 21a8 8 0 0 0-16 0" />
                <circle cx="12" cy="7" r="4" />
              </svg>
            </span>
          )}
        </span>
      </div>
      <div className={`num truncate text-right font-bold ${pos ? 'text-[#10b981]' : 'text-[#ef4444]'}`}>
        <AnimatedNumber value={row.pnlPercent} format={(v) => formatPercent(v)} />
        <span className="ml-0.5 text-[0.7em] text-[#52525b]">%</span>
      </div>
      <div className={`num truncate text-right ${pos ? 'text-[#34d399]' : 'text-[#fca5a5]'}`}>
        <AnimatedNumber value={row.pnlUsd} format={(v) => formatCompactSigned(v)} />
      </div>
      <div className="num truncate text-right text-[#b8b8c2]">{row.tradesCount}</div>
      <div className="hidden truncate text-right text-[11px] text-[#71717a] md:block">{fmtTime(row.updatedAt)}</div>
    </motion.div>
  );
}
