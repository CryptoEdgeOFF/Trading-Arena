import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import AdvancedChart from './AdvancedChart';
import type { MarketTicker, Player, Position, Trade } from '../stores/useGameStore';
import { formatPnl } from '../utils/formatters';
import { fmtMarketPrice } from '../utils/positionSizing';
import { ADMIN_BASE } from '../lib/adminPath';

const ADMIN_TOKEN_KEY = 'btf-admin-token';
const DEFAULT_PLAYER = 'SnorkyFab';

type PaperMeta = {
  pairs: string[];
  market: Record<string, MarketTicker>;
  marketMetadata: Record<string, {
    pair: string;
    name?: string;
    imageUrl?: string | null;
    category?: string;
  }>;
};

type ReviewArena = {
  id: string;
  title: string;
  status: 'registration' | 'starting_soon' | 'live' | 'ended';
  startAt: number;
  endAt: number;
  paperPlayerId: string | null;
  rank: number | null;
  pnlUsd: number;
  pnlPercent: number;
  tradesCount: number;
  participants: number;
};

type ReviewPayload = {
  user: { id: string; name: string; avatarUrl: string | null };
  competition: ReviewArena;
  arenas: ReviewArena[];
  player: Player;
  startingBalance: number;
  missingPaper?: boolean;
};

function fmt(value: number | null | undefined, frac = 1): string {
  if (value == null || !Number.isFinite(value)) return '–';
  return value.toLocaleString('en-US', {
    minimumFractionDigits: frac,
    maximumFractionDigits: frac,
  });
}

function isBuyFill(trade: Trade): boolean {
  return (trade.action === 'open' && trade.side === 'long')
    || (trade.action === 'close' && trade.side === 'short');
}

function actionLabel(action: Trade['action']): string {
  if (action === 'open') return 'Ouverture';
  if (action === 'close') return 'Clôture';
  return 'Update';
}

function formatTradeClock(time: number): string {
  return new Date(time).toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function reviewTimeAgo(time: number): string {
  const diff = Date.now() - time;
  if (diff < 60_000) return 'à l\'instant';
  if (diff < 3_600_000) return `il y a ${Math.floor(diff / 60_000)}m`;
  if (diff < 24 * 3_600_000) return `il y a ${Math.floor(diff / 3_600_000)}h`;
  return `il y a ${Math.floor(diff / (24 * 3_600_000))}j`;
}

function defaultInterval(startAt: number, endAt: number): number {
  const duration = Math.max(0, endAt - startAt);
  if (duration <= 4 * 60 * 60 * 1000) return 1;
  if (duration <= 24 * 60 * 60 * 1000) return 5;
  if (duration <= 4 * 24 * 60 * 60 * 1000) return 15;
  return 60;
}

function toUnixSec(time: number): number {
  if (!Number.isFinite(time) || time <= 0) return 0;
  return time > 1e12 ? Math.floor(time / 1000) : Math.floor(time);
}

export default function PlayerTerminalReview() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [adminToken, setAdminToken] = useState(() => localStorage.getItem(ADMIN_TOKEN_KEY) || '');
  const [adminCode, setAdminCode] = useState('');
  const [adminBusy, setAdminBusy] = useState(false);
  const [adminError, setAdminError] = useState('');
  const [adminOk, setAdminOk] = useState(false);

  const initialName = searchParams.get('player')?.trim() || DEFAULT_PLAYER;
  const [nameInput, setNameInput] = useState(initialName);
  const playerName = searchParams.get('player')?.trim() || DEFAULT_PLAYER;
  const competitionId = searchParams.get('competitionId')?.trim() || '';

  const [meta, setMeta] = useState<PaperMeta | null>(null);
  const [review, setReview] = useState<ReviewPayload | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [pair, setPair] = useState('BTC/USD');
  const [interval, setInterval] = useState(5);
  const [tab, setTab] = useState<'positions' | 'historique'>('historique');

  useEffect(() => {
    if (!adminToken) {
      setAdminOk(false);
      return;
    }
    let cancelled = false;
    fetch('/api/admin/check', { headers: { Authorization: `Bearer ${adminToken}` } })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!data?.ok) {
          localStorage.removeItem(ADMIN_TOKEN_KEY);
          setAdminToken('');
          setAdminOk(false);
          return;
        }
        setAdminOk(true);
      })
      .catch(() => {
        if (!cancelled) setAdminOk(false);
      });
    return () => {
      cancelled = true;
    };
  }, [adminToken]);

  const loadReview = useCallback(async (token: string, name: string, arenaId: string) => {
    setLoading(true);
    setError('');
    try {
      const query = new URLSearchParams({ name });
      if (arenaId) query.set('competitionId', arenaId);
      const [metaRes, reviewRes] = await Promise.all([
        fetch('/api/paper/meta'),
        fetch(`/api/admin/competition/player-terminal?${query.toString()}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);
      const metaData = await metaRes.json().catch(() => null);
      const reviewData = await reviewRes.json().catch(() => ({}));
      if (metaRes.ok && metaData) {
        setMeta({
          pairs: Array.isArray(metaData.pairs) ? metaData.pairs : [],
          market: metaData.market || {},
          marketMetadata: metaData.marketMetadata || {},
        });
      }
      if (!reviewRes.ok) {
        throw new Error(reviewData.error || 'Impossible de charger le terminal');
      }
      setReview(reviewData as ReviewPayload);
      const trades = (reviewData.player?.trades || []) as Trade[];
      const lastTrade = [...trades].sort((a, b) => b.time - a.time)[0];
      const counts = new Map<string, number>();
      for (const trade of trades) {
        counts.set(trade.pair, (counts.get(trade.pair) || 0) + 1);
      }
      const mostTraded = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      setPair(lastTrade?.pair || mostTraded || 'BTC/USD');
      const arena = reviewData.competition as ReviewArena;
      setInterval(defaultInterval(arena.startAt, arena.endAt));
    } catch (err) {
      setReview(null);
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!adminOk || !adminToken) return;
    void loadReview(adminToken, playerName, competitionId);
  }, [adminOk, adminToken, playerName, competitionId, loadReview]);

  async function loginAdmin(event: React.FormEvent) {
    event.preventDefault();
    setAdminBusy(true);
    setAdminError('');
    try {
      const response = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: adminCode }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Code invalide');
      localStorage.setItem(ADMIN_TOKEN_KEY, data.token);
      setAdminToken(data.token);
      setAdminCode('');
    } catch (err) {
      setAdminError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setAdminBusy(false);
    }
  }

  function applyPlayer(name: string, arenaId = '') {
    const next = new URLSearchParams();
    next.set('player', name.trim() || DEFAULT_PLAYER);
    if (arenaId) next.set('competitionId', arenaId);
    setSearchParams(next, { replace: true });
  }

  const player = review?.player ?? null;
  const trades = useMemo(
    () => [...(player?.trades ?? [])].filter((trade) => trade.action === 'open' || trade.action === 'close').sort((a, b) => b.time - a.time),
    [player?.trades],
  );
  const positions: Position[] = player?.openPositions ?? [];
  const tradedPairs = useMemo(() => {
    const seen: string[] = [];
    for (const trade of trades) {
      if (!seen.includes(trade.pair)) seen.push(trade.pair);
    }
    return seen;
  }, [trades]);
  const pairs = tradedPairs.length > 0 ? tradedPairs : (meta?.pairs?.length ? meta.pairs.slice(0, 8) : [pair]);
  const pairLabels = useMemo(() => {
    const out: Record<string, string> = {};
    for (const item of pairs) {
      out[item] = meta?.marketMetadata?.[item]?.name || item;
    }
    return out;
  }, [meta?.marketMetadata, pairs]);
  const pairCategories = useMemo(() => {
    const out: Record<string, string> = {};
    for (const item of pairs) {
      out[item] = meta?.marketMetadata?.[item]?.category || 'crypto';
    }
    return out;
  }, [meta?.marketMetadata, pairs]);

  const focusRangeSec = useMemo(() => {
    const arena = review?.competition;
    if (!arena) return null;
    const tradeTimes = trades.map((trade) => trade.time).filter((time) => time > 0);
    const fromMs = tradeTimes.length ? Math.min(arena.startAt, ...tradeTimes) : arena.startAt;
    const toMs = tradeTimes.length ? Math.max(arena.endAt, ...tradeTimes) : arena.endAt;
    const pad = Math.max(15 * 60 * 1000, Math.round((toMs - fromMs) * 0.08));
    return {
      from: toUnixSec(fromMs - pad),
      to: toUnixSec(toMs + pad),
    };
  }, [review?.competition, trades]);

  const ticker = meta?.market?.[pair];
  const balance = player?.currentBalance ?? 0;
  const pnl = player?.pnl ?? review?.competition.pnlUsd ?? 0;
  const pnlPct = player?.pnlPercent ?? review?.competition.pnlPercent ?? 0;
  const pnlPos = pnl >= 0;
  const rank = review?.competition.rank ?? null;
  const participants = review?.competition.participants ?? null;

  if (!adminToken || !adminOk) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#020107] p-6 text-[#e0e2ea]">
        <form
          onSubmit={loginAdmin}
          className="w-full max-w-md rounded-2xl border border-[#2a2236] bg-[#10091c] p-7 shadow-2xl"
        >
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.25em] text-[#dc2626]">Revue terminal</div>
          <h1 className="font-rajdhani text-3xl font-bold text-white">Terminal de {DEFAULT_PLAYER}</h1>
          <p className="mt-3 text-[13px] text-[#9498a4]">
            Relire les fills et l’historique d’un joueur. Accès admin requis.
          </p>
          <label className="mb-1 mt-5 block text-[12px] text-[#c4c0ce]">Code d’accès admin</label>
          <input
            type="password"
            autoFocus
            value={adminCode}
            onChange={(event) => setAdminCode(event.target.value)}
            placeholder="Entre le code"
            className="w-full rounded-xl border border-[#2a2236] bg-[#0b0711] px-4 py-3 font-mono text-white outline-none focus:border-[#dc2626]"
          />
          {adminError && <div className="mt-3 text-[12px] text-[#fda4af]">{adminError}</div>}
          <button
            type="submit"
            disabled={adminBusy || !adminCode.trim()}
            className="mt-4 w-full rounded-xl bg-[#dc2626] px-4 py-3 text-[13px] font-bold uppercase tracking-[0.16em] text-white disabled:opacity-50"
          >
            {adminBusy ? 'Vérification…' : 'Ouvrir le terminal'}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div
      className="terminal flex h-[100dvh] min-h-[100dvh] flex-col overflow-hidden bg-[#020107] text-[12px] text-[#e0e2ea]"
      style={{
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 p-2 sm:p-3">
        <header className="relative flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1.5 rounded-2xl border border-[#2a2236] bg-[#0b0711]/95 px-2 py-1.5 backdrop-blur md:px-3">
          <img
            src="/assets/pictures/BTFarenaLOGOTERMINAL.webp"
            alt="BTF Arena"
            className="pointer-events-none absolute left-1/2 top-1/2 hidden h-14 w-auto max-w-[36%] -translate-x-1/2 -translate-y-1/2 object-contain md:block lg:h-16"
          />
          <div className="flex min-w-0 items-center gap-2">
            {review?.user.avatarUrl ? (
              <img src={review.user.avatarUrl} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" />
            ) : (
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#dc2626] text-[11px] font-bold text-white">
                {(review?.user.name || playerName).slice(0, 1).toUpperCase()}
              </span>
            )}
            <div className="min-w-0">
              <div className="truncate text-[13px] font-semibold text-white">{review?.user.name || playerName}</div>
              <div className="truncate text-[10px] uppercase tracking-[0.12em] text-[#7a8090]">
                Revue · {review?.competition.title || 'Dernière compétition'}
              </div>
            </div>
          </div>

          <div className="grid min-w-[280px] flex-1 grid-cols-3 overflow-hidden rounded-xl border border-[#241e30] bg-[#15121f] md:max-w-[420px]">
            <div className="border-r border-[#241e30] px-3 py-1.5">
              <div className="text-[9px] uppercase tracking-[0.16em] text-[#7a8090]">Balance</div>
              <div className="num truncate text-[13px] font-semibold text-white">{fmt(balance, 2)} <span className="text-[10px] text-[#7a8090]">USD</span></div>
            </div>
            <div className="border-r border-[#241e30] px-3 py-1.5">
              <div className="text-[9px] uppercase tracking-[0.16em] text-[#7a8090]">PNL</div>
              <span className="num block truncate text-[13px] font-semibold" style={{ color: pnlPos ? '#15c990' : '#f43f6e' }}>
                {pnlPos ? '+' : ''}{pnl.toFixed(2)} <span className="text-[10px]">({pnlPos ? '+' : ''}{pnlPct.toFixed(2)}%)</span>
              </span>
            </div>
            <div className="px-3 py-1.5">
              <div className="text-[9px] uppercase tracking-[0.16em] text-[#7a8090]">Rank</div>
              <div className="num truncate text-[13px] font-semibold text-white">
                {rank ? `#${rank}` : '–'} {participants != null && <span className="text-[10px] text-[#7a8090]">/ {participants}</span>}
              </div>
            </div>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <form
              className="flex items-center gap-1"
              onSubmit={(event) => {
                event.preventDefault();
                applyPlayer(nameInput, '');
              }}
            >
              <input
                value={nameInput}
                onChange={(event) => setNameInput(event.target.value)}
                className="h-8 w-[120px] rounded-lg border border-[#241e30] bg-[#181517] px-2 text-[11px] text-white outline-none focus:border-[#dc2626]"
                placeholder="Pseudo"
              />
              <button type="submit" className="h-8 rounded-lg border border-[#241e30] bg-[#181517] px-2 text-[11px] font-semibold text-white hover:border-[#dc2626]/50">
                Voir
              </button>
            </form>
            {review && review.arenas.length > 1 && (
              <select
                value={review.competition.id}
                onChange={(event) => applyPlayer(review.user.name, event.target.value)}
                className="h-8 max-w-[220px] rounded-lg border border-[#241e30] bg-[#181517] px-2 text-[11px] text-white"
              >
                {review.arenas.map((arena) => (
                  <option key={arena.id} value={arena.id}>
                    {arena.title} · {arena.status === 'ended' ? 'terminée' : arena.status}
                  </option>
                ))}
              </select>
            )}
            <a href={ADMIN_BASE} className="h-8 rounded-lg border border-[#241e30] bg-[#181517] px-2.5 text-[11px] font-semibold leading-8 text-white hover:border-[#dc2626]/50">
              Admin
            </a>
          </div>
        </header>

        {review?.missingPaper && (
          <div className="rounded-md border border-[#3a2c08] bg-[#241a05] px-3 py-2 text-[12px] text-[#f4b400]">
            Le compte paper de cette arène n’est plus en mémoire. Les stats d’arène sont affichées, mais les fills B/S sont vides.
          </div>
        )}
        {error && (
          <div className="rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[12px] text-[#fda4af]">{error}</div>
        )}

        {loading && !review ? (
          <div className="flex flex-1 items-center justify-center text-[#9498a4]">
            <div className="flex flex-col items-center gap-3">
              <div className="h-7 w-7 animate-spin rounded-full border-2 border-[#dc2626] border-t-transparent" />
              <div className="text-[12px] uppercase tracking-[0.25em]">Chargement du terminal</div>
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-2">
            <div className="flex min-h-0 flex-1 flex-col gap-2 lg:flex-row">
              <section className="flex max-h-[280px] min-h-0 w-full shrink-0 flex-col overflow-hidden rounded-2xl border border-[#2a2236] bg-[#10091c] lg:max-h-none lg:w-[360px]">
                <div className="flex h-10 shrink-0 items-center justify-between border-b border-[#171321] px-3 text-[11px] text-[#7f778d]">
                  <span className="font-semibold uppercase tracking-[0.14em] text-[#c4c0ce]">Fills B / S</span>
                  <span className="rounded bg-[#2a2335] px-1.5 py-px text-[9px] text-[#9498a4]">{trades.length}</span>
                </div>
                <div className="min-h-0 flex-1 space-y-1.5 overflow-auto p-2">
                  {trades.length === 0 ? (
                    <div className="flex h-full items-center justify-center text-[12px] text-[#7a8090]">Aucun fill enregistré</div>
                  ) : (
                    trades.map((trade) => {
                      const buy = isBuyFill(trade);
                      return (
                        <button
                          key={trade.id}
                          type="button"
                          onClick={() => setPair(trade.pair)}
                          className={`flex w-full items-start gap-2 rounded-xl border px-2.5 py-2 text-left transition-colors ${
                            pair === trade.pair
                              ? 'border-[#3a314c] bg-[#181320]'
                              : 'border-transparent bg-[#0e0a16] hover:border-[#2a2236] hover:bg-[#15101f]'
                          }`}
                        >
                          <span
                            className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
                            style={{ background: buy ? '#18c98e' : '#f43f6e' }}
                          >
                            {buy ? 'B' : 'S'}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center justify-between gap-2">
                              <span className="truncate font-semibold text-white">{trade.pair}</span>
                              <span className="num shrink-0 text-[11px] text-[#e0e2ea]">{fmt(trade.price, 1)}</span>
                            </span>
                            <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[10px] text-[#7a8090]">
                              <span style={{ color: trade.side === 'long' ? '#15c990' : '#c026d3' }}>
                                {trade.side === 'long' ? 'Long' : 'Short'}
                              </span>
                              <span>{actionLabel(trade.action)}</span>
                              <span>{formatTradeClock(trade.time)}</span>
                              {trade.action === 'close' && (
                                <span style={{ color: trade.pnl >= 0 ? '#15c990' : '#f43f6e' }}>{formatPnl(trade.pnl)}</span>
                              )}
                            </span>
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              </section>

              <section className="relative flex min-h-[320px] min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-[#2a2236] bg-[#10091c]">
                <AdvancedChart
                  pair={pair}
                  pairs={pairs}
                  pairLabels={pairLabels}
                  pairCategories={pairCategories}
                  ticker={ticker}
                  market={meta?.market}
                  positions={positions}
                  trades={player?.trades}
                  intervalMinutes={interval}
                  onIntervalChange={setInterval}
                  onPairChange={(next) => {
                    if (pairs.includes(next)) setPair(next);
                  }}
                  focusRangeSec={focusRangeSec}
                />
              </section>
            </div>

            <section className="flex min-h-[180px] shrink-0 flex-col overflow-hidden rounded-2xl border border-[#2a2236] bg-[#10091c] lg:h-[240px]">
              <div className="flex h-10 shrink-0 items-center gap-1.5 border-b border-[#171321] px-2 text-[11px] text-[#7f778d]">
                {[
                  { id: 'historique' as const, label: 'Historique', count: trades.length },
                  { id: 'positions' as const, label: 'Positions', count: positions.length },
                ].map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setTab(item.id)}
                    className={`flex h-7 items-center gap-1.5 rounded-md px-3 ${tab === item.id ? 'bg-[#201a2b] text-white' : 'hover:bg-[#15121f] hover:text-[#e0e2ea]'}`}
                  >
                    <span>{item.label}</span>
                    <span className="rounded bg-[#2a2335] px-1 py-px text-[9px] text-[#9498a4]">{item.count}</span>
                  </button>
                ))}
                <span className="ml-auto hidden text-[10px] text-[#7a8090] sm:inline">
                  {review?.competition.title} · {trades.length} fills · lecture seule
                </span>
              </div>
              <div className="flex-1 overflow-auto">
                {tab === 'positions' && (
                  positions.length === 0 ? (
                    <div className="flex h-full items-center justify-center text-[12px] text-[#7a8090]">Aucune position ouverte</div>
                  ) : (
                    <table className="w-full text-left text-[11.5px]">
                      <thead className="text-[10px] uppercase tracking-[0.05em] text-[#7a8090]">
                        <tr className="border-b border-[#231f22]">
                          <th className="px-3 py-2 font-medium">Marché</th>
                          <th className="px-3 py-2 font-medium">Sens</th>
                          <th className="px-3 py-2 font-medium">Taille</th>
                          <th className="px-3 py-2 font-medium">Entrée</th>
                          <th className="px-3 py-2 font-medium">Mark</th>
                          <th className="px-3 py-2 font-medium">PnL</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#1c181a] text-[#e0e2ea]">
                        {positions.map((position) => (
                          <tr key={position.id} className="hover:bg-[#181517]">
                            <td className="px-3 py-2">
                              <button type="button" onClick={() => setPair(position.pair)} className="text-white hover:underline">{position.pair}</button>
                            </td>
                            <td className="px-3 py-2" style={{ color: position.side === 'long' ? '#15c990' : '#c026d3' }}>
                              {position.side === 'long' ? 'Long' : 'Short'}
                            </td>
                            <td className="px-3 py-2">{position.size.toFixed(5)}</td>
                            <td className="px-3 py-2">{fmtMarketPrice(position.entryPrice, pairCategories[position.pair])}</td>
                            <td className="px-3 py-2">{fmtMarketPrice(position.markPrice, pairCategories[position.pair])}</td>
                            <td className="px-3 py-2" style={{ color: position.pnl >= 0 ? '#15c990' : '#f43f6e' }}>{formatPnl(position.pnl)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )
                )}
                {tab === 'historique' && (
                  trades.length === 0 ? (
                    <div className="flex h-full items-center justify-center text-[12px] text-[#7a8090]">Aucun trade</div>
                  ) : (
                    <table className="w-full text-left text-[11.5px]">
                      <thead className="text-[10px] uppercase tracking-[0.05em] text-[#7a8090]">
                        <tr className="border-b border-[#231f22]">
                          <th className="px-3 py-2 font-medium">Heure</th>
                          <th className="px-3 py-2 font-medium">Marché</th>
                          <th className="px-3 py-2 font-medium">Sens</th>
                          <th className="px-3 py-2 font-medium">Action</th>
                          <th className="px-3 py-2 font-medium">Fill</th>
                          <th className="px-3 py-2 font-medium">Prix</th>
                          <th className="px-3 py-2 font-medium">Qté</th>
                          <th className="px-3 py-2 font-medium">Frais</th>
                          <th className="px-3 py-2 font-medium">PnL</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#1c181a] text-[#e0e2ea]">
                        {trades.map((trade) => {
                          const buy = isBuyFill(trade);
                          return (
                            <tr key={trade.id} className="hover:bg-[#181517]">
                              <td className="px-3 py-2 text-[#9498a4]">
                                <div>{formatTradeClock(trade.time)}</div>
                                <div className="text-[10px]">{reviewTimeAgo(trade.time)}</div>
                              </td>
                              <td className="px-3 py-2">
                                <button type="button" onClick={() => setPair(trade.pair)} className="text-white hover:underline">{trade.pair}</button>
                              </td>
                              <td className="px-3 py-2" style={{ color: trade.side === 'long' ? '#15c990' : '#c026d3' }}>
                                {trade.side === 'long' ? 'Long' : 'Short'}
                              </td>
                              <td className="px-3 py-2 capitalize">{actionLabel(trade.action)}</td>
                              <td className="px-3 py-2">
                                <span
                                  className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white"
                                  style={{ background: buy ? '#18c98e' : '#f43f6e' }}
                                >
                                  {buy ? 'B' : 'S'}
                                </span>
                              </td>
                              <td className="px-3 py-2">{fmt(trade.price, 1)}</td>
                              <td className="px-3 py-2">{trade.size.toFixed(5)}</td>
                              <td className="px-3 py-2">{fmt(trade.fee, 4)}</td>
                              <td className="px-3 py-2" style={{ color: trade.pnl >= 0 ? '#15c990' : '#f43f6e' }}>
                                {trade.action === 'close' ? formatPnl(trade.pnl) : '–'}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )
                )}
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
