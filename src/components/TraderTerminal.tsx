import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import PlayerAvatar from './PlayerAvatar';
import { useWebSocket } from '../hooks/useWebSocket';
import { useGameStore } from '../stores/useGameStore';
import { formatPercent, formatPnl, formatUSD, timeAgo } from '../utils/formatters';

const SESSION_KEY = 'btf-paper-session';

interface PaperMeta {
  enabled: boolean;
  eventStarted: boolean;
  startingBalance: number;
  marketDataSource: 'kraken' | 'binance';
  pairs: string[];
}

interface SessionPlayer {
  id: string;
  name: string;
  color: string;
  avatar: string | null;
}

export default function TraderTerminal() {
  useWebSocket();

  const players = useGameStore((state) => state.players);
  const recentTrades = useGameStore((state) => state.recentTrades);
  const eventStarted = useGameStore((state) => state.eventStarted);
  const platformMode = useGameStore((state) => state.platformMode);
  const paperStartingBalance = useGameStore((state) => state.paperStartingBalance);

  const [meta, setMeta] = useState<PaperMeta>({
    enabled: false,
    eventStarted: false,
    startingBalance: 10000,
    marketDataSource: 'kraken',
    pairs: [],
  });
  const [session, setSession] = useState<{ token: string; player: SessionPlayer } | null>(null);
  const [accessCode, setAccessCode] = useState('');
  const [selectedPair, setSelectedPair] = useState('BTC/USD');
  const [side, setSide] = useState<'long' | 'short'>('long');
  const [size, setSize] = useState('0.05');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const player = useMemo(
    () => (session ? players.find((entry) => entry.id === session.player.id) || null : null),
    [players, session],
  );

  const playerTrades = useMemo(
    () => recentTrades.filter((trade) => trade.playerName === player?.name).slice(0, 8),
    [player?.name, recentTrades],
  );

  useEffect(() => {
    fetch('/api/paper/meta')
      .then((response) => response.json())
      .then((data: PaperMeta) => {
        setMeta(data);
        if (data.pairs.length > 0) setSelectedPair((current) => data.pairs.includes(current) ? current : data.pairs[0]);
      });
  }, []);

  useEffect(() => {
    const token = window.localStorage.getItem(SESSION_KEY);
    if (!token) return;

    fetch('/api/paper/me', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (response) => {
        if (!response.ok) {
          window.localStorage.removeItem(SESSION_KEY);
          return null;
        }
        return response.json();
      })
      .then((data) => {
        if (!data?.player) return;
        setSession({ token, player: data.player });
      });
  }, []);

  async function login() {
    setSubmitting(true);
    setError('');
    try {
      const response = await fetch('/api/paper/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessCode }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Connexion impossible');
      }
      window.localStorage.setItem(SESSION_KEY, data.token);
      setSession({ token: data.token, player: data.player });
      setAccessCode('');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function submitOrder() {
    if (!session) return;
    setSubmitting(true);
    setError('');
    try {
      const response = await fetch('/api/paper/order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.token}`,
        },
        body: JSON.stringify({
          pair: selectedPair,
          side,
          size: Number(size),
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Ordre refusé');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function closePosition(pair: string) {
    if (!session) return;
    setSubmitting(true);
    setError('');
    try {
      const response = await fetch('/api/paper/close', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.token}`,
        },
        body: JSON.stringify({ pair }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Clôture refusée');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  function logout() {
    window.localStorage.removeItem(SESSION_KEY);
    setSession(null);
  }

  const livePaperMode = platformMode === 'paper' || meta.enabled;

  return (
    <div className="min-h-screen bg-[#020617] px-5 py-8 text-slate-100">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mb-2 flex items-center gap-4">
              <img src="/assets/pictures/logoBTF.png" alt="BTF" className="h-10 w-10 rounded-lg object-contain" />
              <h1 className="font-rajdhani text-4xl font-bold text-white">Trader Terminal</h1>
            </div>
            <p className="text-sm text-slate-400">
              Connexion par code trader, ordres au marché uniquement, exécution simulée côté serveur.
            </p>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-900/80 px-4 py-3 text-sm text-slate-300">
            Capital standard: <span className="font-semibold text-white">${formatUSD(paperStartingBalance || meta.startingBalance)}</span>
          </div>
        </div>

        {!livePaperMode && (
          <div className="rounded-2xl border border-yellow-500/20 bg-yellow-500/10 p-5 text-sm text-yellow-200">
            Le mode paper n’est pas actif. Passe d’abord par <a className="underline" href="/admin">/admin</a> pour basculer la room en paper trading.
          </div>
        )}

        {livePaperMode && !session && (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="mx-auto mt-10 max-w-md rounded-3xl border border-slate-800 bg-slate-900/80 p-8 shadow-2xl shadow-black/20">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-green-400">Accès trader</p>
            <h2 className="mb-3 font-rajdhani text-3xl font-bold text-white">Connexion rapide</h2>
            <p className="mb-6 text-sm text-slate-400">
              Entre le code communiqué dans l’admin pour rejoindre la room active.
            </p>
            <div className="space-y-4">
              <input
                type="text"
                value={accessCode}
                onChange={(event) => setAccessCode(event.target.value.toUpperCase())}
                placeholder="Ex: A7K9Q2"
                className="w-full rounded-2xl border border-slate-700 bg-slate-800 px-4 py-4 text-center font-mono text-xl tracking-[0.3em] text-white outline-none transition-colors focus:border-green-500"
              />
              {error && <p className="text-sm text-red-400">{error}</p>}
              <button
                type="button"
                onClick={login}
                disabled={submitting || !accessCode.trim()}
                className="w-full rounded-2xl bg-green-600 px-4 py-4 font-semibold text-white transition-colors hover:bg-green-500 disabled:bg-slate-700"
              >
                {submitting ? 'Connexion...' : 'Rejoindre la room'}
              </button>
            </div>
          </motion.div>
        )}

        {livePaperMode && session && (
          <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
            <div className="space-y-6">
              <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-6">
                <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <PlayerAvatar name={session.player.name} color={session.player.color} avatar={session.player.avatar} size="lg" glow />
                    <div>
                      <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Trader actif</p>
                      <h2 className="font-rajdhani text-3xl font-bold text-white">{session.player.name}</h2>
                      <p className="text-sm text-slate-400">
                        {eventStarted ? 'Room en direct' : 'En attente du lancement admin'}
                      </p>
                    </div>
                  </div>
                  <button type="button" onClick={logout} className="rounded-xl border border-slate-700 px-3 py-2 text-sm text-slate-300 transition-colors hover:border-slate-600 hover:text-white">
                    Changer de trader
                  </button>
                </div>

                <div className="mb-6 grid gap-4 sm:grid-cols-3">
                  <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Equity</p>
                    <p className="mt-2 text-2xl font-semibold text-white">${formatUSD(player?.currentBalance || 0)}</p>
                  </div>
                  <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-500">PnL</p>
                    <p className={`mt-2 text-2xl font-semibold ${player && player.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {formatPnl(player?.pnl || 0)}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Perf</p>
                    <p className={`mt-2 text-2xl font-semibold ${player && player.pnlPercent >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {formatPercent(player?.pnlPercent || 0)}
                    </p>
                  </div>
                </div>

                <div className="rounded-3xl border border-slate-800 bg-slate-950/60 p-5">
                  <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Order Ticket</p>
                      <h3 className="font-rajdhani text-2xl font-bold text-white">Ordre au marché</h3>
                    </div>
                    <span className="rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-400">
                      Une position max par paire
                    </span>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <label className="mb-2 block text-sm text-slate-300">Paire</label>
                      <select
                        value={selectedPair}
                        onChange={(event) => setSelectedPair(event.target.value)}
                        className="w-full rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 text-white outline-none transition-colors focus:border-green-500"
                      >
                        {meta.pairs.map((pair) => (
                          <option key={pair} value={pair}>{pair}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-2 block text-sm text-slate-300">Taille (quantité)</label>
                      <input
                        type="number"
                        min="0.001"
                        step="0.001"
                        value={size}
                        onChange={(event) => setSize(event.target.value)}
                        className="w-full rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 text-white outline-none transition-colors focus:border-green-500"
                      />
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => setSide('long')}
                      className={`rounded-2xl border px-4 py-3 text-left transition-colors ${side === 'long' ? 'border-green-500 bg-green-500/10 text-green-300' : 'border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-600'}`}
                    >
                      <span className="block text-xs uppercase tracking-[0.2em] text-slate-500">Direction</span>
                      <span className="mt-1 block text-lg font-semibold">Long</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setSide('short')}
                      className={`rounded-2xl border px-4 py-3 text-left transition-colors ${side === 'short' ? 'border-red-500 bg-red-500/10 text-red-300' : 'border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-600'}`}
                    >
                      <span className="block text-xs uppercase tracking-[0.2em] text-slate-500">Direction</span>
                      <span className="mt-1 block text-lg font-semibold">Short</span>
                    </button>
                  </div>

                  {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

                  <button
                    type="button"
                    onClick={submitOrder}
                    disabled={submitting || !eventStarted}
                    className="mt-5 w-full rounded-2xl bg-green-600 px-4 py-4 font-semibold text-white transition-colors hover:bg-green-500 disabled:bg-slate-700"
                  >
                    {eventStarted ? (submitting ? 'Envoi en cours...' : 'Exécuter l’ordre') : 'Attente du lancement admin'}
                  </button>
                </div>
              </div>

              <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-6">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Positions</p>
                    <h3 className="font-rajdhani text-2xl font-bold text-white">Book ouvert</h3>
                  </div>
                  <span className="text-sm text-slate-500">{player?.openPositions.length || 0} active(s)</span>
                </div>

                <div className="space-y-3">
                  {(player?.openPositions || []).map((position) => (
                    <div key={position.pair} className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
                      <div className="mb-2 flex items-center justify-between gap-4">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-white">{position.pair}</span>
                            <span className={`rounded-full px-2 py-0.5 text-xs ${position.side === 'long' ? 'bg-green-500/10 text-green-300' : 'bg-red-500/10 text-red-300'}`}>
                              {position.side}
                            </span>
                          </div>
                          <p className="mt-1 text-sm text-slate-500">
                            Entrée ${formatUSD(position.entryPrice)} • Mark ${formatUSD(position.markPrice)} • Qty {position.size}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className={`text-lg font-semibold ${position.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {formatPnl(position.pnl)}
                          </p>
                          <button type="button" onClick={() => closePosition(position.pair)} className="mt-2 rounded-xl border border-slate-700 px-3 py-2 text-sm text-slate-300 transition-colors hover:border-slate-600 hover:text-white">
                            Clôturer
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                  {(player?.openPositions.length || 0) === 0 && (
                    <div className="rounded-2xl border border-dashed border-slate-800 py-8 text-center text-sm text-slate-500">
                      Aucune position ouverte.
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-6">
              <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-6">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Activité récente</p>
                <h3 className="mb-4 font-rajdhani text-2xl font-bold text-white">Mes trades</h3>
                <div className="space-y-3">
                  {playerTrades.map((trade) => (
                    <div key={trade.id} className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-white">{trade.pair}</span>
                            <span className={`rounded-full px-2 py-0.5 text-[11px] ${trade.side === 'long' ? 'bg-green-500/10 text-green-300' : 'bg-red-500/10 text-red-300'}`}>
                              {trade.action}
                            </span>
                          </div>
                          <p className="mt-1 text-sm text-slate-500">
                            {trade.side} • Qty {trade.size} • {timeAgo(trade.time)}
                          </p>
                        </div>
                        <span className={`text-sm font-semibold ${trade.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {formatPnl(trade.pnl)}
                        </span>
                      </div>
                    </div>
                  ))}
                  {playerTrades.length === 0 && (
                    <div className="rounded-2xl border border-dashed border-slate-800 py-8 text-center text-sm text-slate-500">
                      Aucun trade personnel pour le moment.
                    </div>
                  )}
                </div>
              </div>

              <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-6">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Rappel MVP</p>
                <ul className="mt-4 space-y-3 text-sm text-slate-300">
                  <li>Ordres au marché uniquement.</li>
                  <li>Une position maximum par paire.</li>
                  <li>Les prix sont alimentés par le flux public {meta.marketDataSource === 'binance' ? 'Binance Futures' : 'Kraken'}.</li>
                  <li>Le classement global reste visible sur le dashboard principal.</li>
                </ul>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
