/**
 * Onglet admin "Replay" — reconstitution d'une partie live passée.
 *
 * L'admin saisit la fenêtre du match, les joueurs présents et le détail des
 * trades (marché, heure, taille, fermeture). On télécharge ensuite les bougies
 * 1m de la fenêtre (endpoint admin), on emballe le tout dans localStorage et
 * on ouvre le lecteur replay qui rejoue la partie sur le vrai dashboard.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { REPLAY_PACKAGE_KEY, type ReplayConfig, type ReplayPlayerInput, type ReplayTradeInput } from '../lib/replay';
import { ADMIN_BASE } from '../lib/adminPath';
import { isLotBased } from '../utils/positionSizing';
import PlayerAvatar from './PlayerAvatar';

const DRAFT_KEY = 'btf-replay-draft';

const PAIR_OPTIONS = [
  'NAS100/USD', 'SP500/USD', 'US30/USD',
  'GOLD/USD', 'SILVER/USD', 'WTI/USD',
  'EUR/USD', 'GBP/USD', 'USD/JPY', 'USD/CHF',
  'BTC/USD', 'ETH/USD', 'SOL/USD',
];

const PLAYER_COLORS = [
  '#ef4444', '#3b82f6', '#22c55e', '#eab308', '#a855f7',
  '#06b6d4', '#f97316', '#ec4899', '#84cc16', '#14b8a6',
];

type EventModeOption = '1v1' | '1v1v1' | '1v1v1v1' | '4v4';

interface DraftPlayer {
  id: string;
  name: string;
  color: string;
  avatar: string | null;
  team: 'A' | 'B';
}

interface RosterPlayer {
  id: string;
  name: string;
  color: string;
  avatar: string | null;
  active: boolean;
}

interface EventConfigSnapshot {
  mode?: string;
  teams?: [{ name: string; color: string; playerIds: string[] }, { name: string; color: string; playerIds: string[] }];
  paperStartingBalance?: number;
}

interface DraftTrade {
  id: string;
  playerId: string;
  pair: string;
  side: 'long' | 'short';
  entry: string;       // datetime-local
  entryPrice: string;  // optionnel
  size: string;
  leverage: string;
  exit: string;        // datetime-local optionnel
  exitPrice: string;   // optionnel
}

interface Draft {
  start: string;
  end: string;
  mode: EventModeOption;
  teamA: string;
  teamB: string;
  balance: string;
  players: DraftPlayer[];
  trades: DraftTrade[];
}

const EMPTY_DRAFT: Draft = {
  start: '',
  end: '',
  mode: '1v1v1v1',
  teamA: 'Équipe A',
  teamB: 'Équipe B',
  balance: '10000',
  players: [],
  trades: [],
};

function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** datetime-local (heure de Paris affichée par le navigateur) → ms epoch. */
function localToMs(value: string): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

export default function ReplayAdmin({
  adminToken,
  adminFetch,
}: {
  adminToken: string;
  adminFetch: (url: string, init?: RequestInit) => Promise<Response>;
}) {
  const normalizeDraftPlayers = (players: DraftPlayer[]): DraftPlayer[] =>
    players.map((player, index) => ({
      ...player,
      color: /^#[0-9a-fA-F]{6}$/.test(player.color || '') ? player.color : PLAYER_COLORS[index % PLAYER_COLORS.length],
      avatar: player.avatar ?? null,
    }));

  const [draft, setDraft] = useState<Draft>(() => {
    try {
      const raw = window.localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const parsed = { ...EMPTY_DRAFT, ...(JSON.parse(raw) as Draft) };
        parsed.players = normalizeDraftPlayers(parsed.players || []);
        return parsed;
      }
    } catch { /* draft corrompu → repart à vide */ }
    return EMPTY_DRAFT;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showJson, setShowJson] = useState(false);
  const [jsonText, setJsonText] = useState('');
  const [roster, setRoster] = useState<RosterPlayer[]>([]);
  const [eventConfig, setEventConfig] = useState<EventConfigSnapshot | null>(null);
  const [rosterLoading, setRosterLoading] = useState(true);

  useEffect(() => {
    try {
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch { /* stockage plein : draft non persisté */ }
  }, [draft]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setRosterLoading(true);
      try {
        const [rosterRes, configRes] = await Promise.all([
          adminFetch('/api/roster'),
          adminFetch('/api/event/config'),
        ]);
        if (cancelled) return;
        const rosterData = await rosterRes.json();
        setRoster(Array.isArray(rosterData) ? rosterData : []);
        if (configRes.ok) {
          setEventConfig(await configRes.json());
        }
      } catch {
        if (!cancelled) setRoster([]);
      } finally {
        if (!cancelled) setRosterLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [adminFetch]);

  const patch = useCallback((partial: Partial<Draft>) => {
    setDraft((current) => ({ ...current, ...partial }));
  }, []);

  const rosterPlayerToDraft = useCallback((player: RosterPlayer, team: 'A' | 'B'): DraftPlayer => ({
    id: player.id,
    name: player.name,
    color: /^#[0-9a-fA-F]{6}$/.test(player.color || '') ? player.color : PLAYER_COLORS[0],
    avatar: player.avatar ?? null,
    team,
  }), []);

  const importRosterPlayers = useCallback((entries: Array<{ player: RosterPlayer; team: 'A' | 'B' }>, replace = false) => {
    const next = replace ? [] as DraftPlayer[] : [...draft.players];
    const known = new Set(next.map((player) => player.id));
    for (const { player, team } of entries) {
      if (known.has(player.id)) {
        const idx = next.findIndex((entry) => entry.id === player.id);
        if (idx >= 0) next[idx] = rosterPlayerToDraft(player, team);
      } else {
        next.push(rosterPlayerToDraft(player, team));
        known.add(player.id);
      }
    }
    patch({ players: next });
    setNotice(`${entries.length} joueur(s) importé(s) depuis le roster live.`);
    setError('');
  }, [draft.players, patch, rosterPlayerToDraft]);

  const importActiveRoster = () => {
    const active = roster.filter((player) => player.active);
    if (active.length === 0) {
      setError('Aucun joueur actif dans le roster live.');
      return;
    }
    importRosterPlayers(
      active.map((player, index) => ({ player, team: index % 2 === 0 ? 'A' : 'B' })),
      true,
    );
  };

  const importFullRoster = () => {
    if (roster.length === 0) {
      setError('Le roster live est vide.');
      return;
    }
    importRosterPlayers(
      roster.map((player, index) => ({ player, team: index % 2 === 0 ? 'A' : 'B' })),
      true,
    );
  };

  const importTeamsFromLiveConfig = () => {
    const teams = eventConfig?.teams;
    if (!teams || teams.length < 2) {
      setError('Aucune configuration d’équipes dans la room live (onglet Room live → format 4v4).');
      return;
    }
    const byId = new Map(roster.map((player) => [player.id, player]));
    const entries: Array<{ player: RosterPlayer; team: 'A' | 'B' }> = [];
    for (const playerId of teams[0].playerIds) {
      const player = byId.get(playerId);
      if (player) entries.push({ player, team: 'A' });
    }
    for (const playerId of teams[1].playerIds) {
      const player = byId.get(playerId);
      if (player) entries.push({ player, team: 'B' });
    }
    if (entries.length === 0) {
      setError('Les équipes configurées ne contiennent aucun joueur du roster.');
      return;
    }
    patch({
      mode: '4v4',
      teamA: teams[0].name || 'Équipe A',
      teamB: teams[1].name || 'Équipe B',
    });
    importRosterPlayers(entries, true);
  };

  const toggleRosterPlayer = (player: RosterPlayer) => {
    const exists = draft.players.some((entry) => entry.id === player.id);
    if (exists) {
      patch({
        players: draft.players.filter((entry) => entry.id !== player.id),
        trades: draft.trades.filter((trade) => trade.playerId !== player.id),
      });
      return;
    }
    const team: 'A' | 'B' = draft.players.length % 2 === 0 ? 'A' : 'B';
    patch({ players: [...draft.players, rosterPlayerToDraft(player, team)] });
  };

  /* ------------------------------ Joueurs ------------------------------- */

  const addPlayer = () => {
    const index = draft.players.length;
    patch({
      players: [...draft.players, {
        id: newId(),
        name: '',
        color: PLAYER_COLORS[index % PLAYER_COLORS.length],
        avatar: null,
        team: index % 2 === 0 ? 'A' : 'B',
      }],
    });
  };

  const updatePlayer = (id: string, partial: Partial<DraftPlayer>) => {
    patch({ players: draft.players.map((player) => (player.id === id ? { ...player, ...partial } : player)) });
  };

  const removePlayer = (id: string) => {
    patch({
      players: draft.players.filter((player) => player.id !== id),
      trades: draft.trades.filter((trade) => trade.playerId !== id),
    });
  };

  /* ------------------------------- Trades ------------------------------- */

  const addTrade = () => {
    patch({
      trades: [...draft.trades, {
        id: newId(),
        playerId: draft.players[0]?.id || '',
        pair: 'NAS100/USD',
        side: 'long',
        entry: draft.start,
        entryPrice: '',
        size: '1',
        leverage: '10',
        exit: '',
        exitPrice: '',
      }],
    });
  };

  const updateTrade = (id: string, partial: Partial<DraftTrade>) => {
    patch({ trades: draft.trades.map((trade) => (trade.id === id ? { ...trade, ...partial } : trade)) });
  };

  const removeTrade = (id: string) => {
    patch({ trades: draft.trades.filter((trade) => trade.id !== id) });
  };

  /* --------------------------- Validation/config ------------------------ */

  const buildConfig = useCallback((): { config?: ReplayConfig; error?: string } => {
    const startMs = localToMs(draft.start);
    const endMs = localToMs(draft.end);
    if (!startMs || !endMs) return { error: 'Renseigne le début et la fin de la partie.' };
    if (endMs <= startMs) return { error: 'La fin doit être après le début.' };
    if (endMs - startMs > 24 * 60 * 60 * 1000) return { error: 'Fenêtre limitée à 24h.' };

    const balance = Number(draft.balance);
    if (!Number.isFinite(balance) || balance <= 0) return { error: 'Capital initial invalide.' };

    const players: ReplayPlayerInput[] = [];
    for (let i = 0; i < draft.players.length; i += 1) {
      const player = draft.players[i];
      const name = player.name.trim();
      if (!name) return { error: `Joueur #${i + 1} : nom manquant.` };
      const color = /^#[0-9a-fA-F]{6}$/.test(player.color || '')
        ? player.color
        : PLAYER_COLORS[i % PLAYER_COLORS.length];
      players.push({
        id: player.id,
        name,
        color,
        avatar: player.avatar ?? null,
        team: player.team,
      });
    }
    if (players.length < 2) return { error: 'Ajoute au moins 2 joueurs.' };

    const trades: ReplayTradeInput[] = [];
    for (let i = 0; i < draft.trades.length; i += 1) {
      const trade = draft.trades[i];
      const label = `Trade #${i + 1}`;
      if (!trade.playerId || !players.some((player) => player.id === trade.playerId)) {
        return { error: `${label} : joueur invalide.` };
      }
      const entryTime = localToMs(trade.entry);
      if (!entryTime) return { error: `${label} : heure d'entrée manquante.` };
      if (entryTime < startMs || entryTime > endMs) return { error: `${label} : entrée hors de la fenêtre du match.` };
      const size = Number(trade.size);
      if (!Number.isFinite(size) || size <= 0) return { error: `${label} : taille invalide.` };
      const leverage = Number(trade.leverage) || 1;
      const exitTime = localToMs(trade.exit);
      if (exitTime != null && exitTime <= entryTime) return { error: `${label} : la sortie doit être après l'entrée.` };
      const entryPrice = trade.entryPrice ? Number(trade.entryPrice) : null;
      const exitPrice = trade.exitPrice ? Number(trade.exitPrice) : null;
      trades.push({
        id: trade.id,
        playerId: trade.playerId,
        pair: trade.pair,
        side: trade.side,
        entryTime,
        entryPrice: entryPrice && entryPrice > 0 ? entryPrice : null,
        size,
        leverage: Math.max(1, Math.min(50, leverage)),
        exitTime,
        exitPrice: exitPrice && exitPrice > 0 ? exitPrice : null,
      });
    }
    if (trades.length === 0) return { error: 'Ajoute au moins un trade.' };

    return {
      config: {
        startMs,
        endMs,
        eventMode: draft.mode,
        teamNames: { a: draft.teamA.trim() || 'Équipe A', b: draft.teamB.trim() || 'Équipe B' },
        startingBalance: balance,
        players,
        trades,
      },
    };
  }, [draft]);

  /* ------------------------ Préparation du replay ----------------------- */

  const prepareReplay = async () => {
    setError('');
    setNotice('');
    const { config, error: validationError } = buildConfig();
    if (!config || validationError) {
      setError(validationError || 'Configuration invalide.');
      return;
    }

    setBusy(true);
    try {
      const pairs = [...new Set(config.trades.map((trade) => trade.pair))];
      const response = await fetch('/api/admin/replay/candles', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ pairs, fromMs: config.startMs, toMs: config.endMs }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Erreur serveur');

      const candles = data.candles as Record<string, unknown[]>;
      const missing = pairs.filter((pair) => !candles[pair]?.length);
      if (missing.length === pairs.length) {
        throw new Error(`Aucune bougie récupérée (${Object.values(data.errors || {}).join(' | ') || 'fenêtre invalide ?'})`);
      }

      window.localStorage.setItem(REPLAY_PACKAGE_KEY, JSON.stringify({ config, candles }));
      const warn = missing.length ? ` (⚠ pas de données pour ${missing.join(', ')})` : '';
      setNotice(`Replay prêt : ${pairs.length - missing.length}/${pairs.length} marchés chargés${warn}. Ouverture du lecteur…`);
      window.open(`${ADMIN_BASE}/replay`, '_blank');
    } catch (err) {
      setError((err as Error).message || 'Erreur lors de la préparation.');
    } finally {
      setBusy(false);
    }
  };

  /* --------------------------- Import / export -------------------------- */

  const exportJson = () => {
    setJsonText(JSON.stringify(draft, null, 2));
    setShowJson(true);
  };

  const importJson = () => {
    try {
      const parsed = JSON.parse(jsonText) as Draft;
      if (!Array.isArray(parsed.players) || !Array.isArray(parsed.trades)) throw new Error('format');
      parsed.players = normalizeDraftPlayers(parsed.players);
      setDraft({ ...EMPTY_DRAFT, ...parsed });
      setNotice('Configuration importée.');
      setError('');
    } catch {
      setError('JSON invalide.');
    }
  };

  const inputClass = 'rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-sm text-white outline-none transition-colors focus:border-red-500';
  const playerName = useMemo(
    () => new Map(draft.players.map((player) => [player.id, player.name || '(sans nom)'])),
    [draft.players],
  );

  return (
    <div className="space-y-6">
      {/* Fenêtre + format */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6">
        <p className="mb-4 text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">Fenêtre de la partie</p>
        <div className="grid gap-4 md:grid-cols-4">
          <label className="block">
            <span className="mb-1 block text-xs text-slate-400">Début</span>
            <input type="datetime-local" step={1} value={draft.start} onChange={(event) => patch({ start: event.target.value })} className={`${inputClass} w-full`} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-slate-400">Fin</span>
            <input type="datetime-local" step={1} value={draft.end} onChange={(event) => patch({ end: event.target.value })} className={`${inputClass} w-full`} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-slate-400">Capital initial (USD)</span>
            <input type="number" min={100} step={100} value={draft.balance} onChange={(event) => patch({ balance: event.target.value })} className={`${inputClass} w-full font-mono`} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-slate-400">Format</span>
            <select value={draft.mode} onChange={(event) => patch({ mode: event.target.value as EventModeOption })} className={`${inputClass} w-full`}>
              <option value="1v1">1 vs 1</option>
              <option value="1v1v1">1 vs 1 vs 1</option>
              <option value="1v1v1v1">Battle royale</option>
              <option value="4v4">Équipes (4v4)</option>
            </select>
          </label>
        </div>
        {draft.mode === '4v4' && (
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs text-blue-300">Nom équipe A</span>
              <input value={draft.teamA} onChange={(event) => patch({ teamA: event.target.value })} className={`${inputClass} w-full`} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-red-300">Nom équipe B</span>
              <input value={draft.teamB} onChange={(event) => patch({ teamB: event.target.value })} className={`${inputClass} w-full`} />
            </label>
          </div>
        )}
      </div>

      {/* Import roster live */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6">
        <p className="mb-2 text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">Importer depuis la room live</p>
        <p className="mb-4 text-xs text-slate-500">
          Reprend les joueurs du roster avec leur couleur et leur photo — identiques au dashboard live.
        </p>
        <div className="mb-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={importActiveRoster}
            disabled={rosterLoading || roster.length === 0}
            className="rounded-lg border border-green-500/30 bg-green-500/10 px-3 py-1.5 text-sm font-semibold text-green-300 hover:bg-green-500/20 disabled:opacity-50"
          >
            Importer joueurs actifs
          </button>
          <button
            type="button"
            onClick={importFullRoster}
            disabled={rosterLoading || roster.length === 0}
            className="rounded-lg border border-slate-600 px-3 py-1.5 text-sm font-semibold text-slate-300 hover:border-slate-500 disabled:opacity-50"
          >
            Importer tout le roster
          </button>
          <button
            type="button"
            onClick={importTeamsFromLiveConfig}
            disabled={rosterLoading}
            className="rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-3 py-1.5 text-sm font-semibold text-indigo-300 hover:bg-indigo-500/20 disabled:opacity-50"
          >
            Importer équipes 4v4 (config live)
          </button>
        </div>
        {rosterLoading ? (
          <p className="text-sm text-slate-500">Chargement du roster…</p>
        ) : roster.length === 0 ? (
          <p className="text-sm text-slate-500">Aucun joueur dans le roster live.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {roster.map((player) => {
              const selected = draft.players.some((entry) => entry.id === player.id);
              return (
                <button
                  key={player.id}
                  type="button"
                  onClick={() => toggleRosterPlayer(player)}
                  className={`flex items-center gap-2 rounded-xl border px-2.5 py-1.5 text-left transition-colors ${
                    selected
                      ? 'border-red-500/50 bg-red-500/10 text-white'
                      : 'border-slate-700 bg-slate-950/60 text-slate-300 hover:border-slate-500'
                  }`}
                >
                  <PlayerAvatar name={player.name} color={player.color} avatar={player.avatar} size="sm" glow={player.active} />
                  <span className="text-sm font-medium">{player.name}</span>
                  {player.active && <span className="text-[10px] uppercase tracking-wider text-green-400">actif</span>}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Joueurs */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">Joueurs présents ({draft.players.length})</p>
          <button type="button" onClick={addPlayer} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-500">
            + Joueur manuel
          </button>
        </div>
        <div className="space-y-2">
          {draft.players.map((player) => (
            <div key={player.id} className="flex items-center gap-3">
              <PlayerAvatar name={player.name} color={player.color} avatar={player.avatar} size="sm" glow />
              <input
                value={player.name}
                onChange={(event) => updatePlayer(player.id, { name: event.target.value })}
                placeholder="Nom du joueur"
                className={`${inputClass} flex-1`}
              />
              <input
                type="color"
                value={/^#[0-9a-fA-F]{6}$/.test(player.color) ? player.color : '#6366f1'}
                onChange={(event) => updatePlayer(player.id, { color: event.target.value })}
                className="h-9 w-10 shrink-0 cursor-pointer rounded-lg border border-slate-700 bg-slate-950"
                title="Couleur"
              />
              {draft.mode === '4v4' && (
                <select value={player.team} onChange={(event) => updatePlayer(player.id, { team: event.target.value as 'A' | 'B' })} className={inputClass}>
                  <option value="A">Équipe A</option>
                  <option value="B">Équipe B</option>
                </select>
              )}
              <button type="button" onClick={() => removePlayer(player.id)} className="text-sm text-slate-500 hover:text-rose-400">✕</button>
            </div>
          ))}
          {draft.players.length === 0 && <p className="text-sm text-slate-500">Aucun joueur — importe depuis le roster ou ajoute manuellement.</p>}
        </div>
      </div>

      {/* Trades */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">Trades ({draft.trades.length})</p>
          <button type="button" onClick={addTrade} disabled={draft.players.length === 0} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50">
            + Trade
          </button>
        </div>
        <div className="space-y-3">
          {draft.trades.map((trade) => (
            <div key={trade.id} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
              <div className="grid gap-2 md:grid-cols-5">
                <label className="block">
                  <span className="mb-1 block text-[11px] text-slate-500">Joueur</span>
                  <select value={trade.playerId} onChange={(event) => updateTrade(trade.id, { playerId: event.target.value })} className={`${inputClass} w-full`}>
                    {draft.players.map((player) => (
                      <option key={player.id} value={player.id}>{playerName.get(player.id)}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] text-slate-500">Marché</span>
                  <select value={trade.pair} onChange={(event) => updateTrade(trade.id, { pair: event.target.value })} className={`${inputClass} w-full`}>
                    {PAIR_OPTIONS.map((pair) => <option key={pair} value={pair}>{pair}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] text-slate-500">Sens</span>
                  <select value={trade.side} onChange={(event) => updateTrade(trade.id, { side: event.target.value as 'long' | 'short' })} className={`${inputClass} w-full`}>
                    <option value="long">Long</option>
                    <option value="short">Short</option>
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] text-slate-500">{isLotBased(trade.pair) ? 'Taille (lots)' : 'Taille (unités)'}</span>
                  <input type="number" min={0} step="any" value={trade.size} onChange={(event) => updateTrade(trade.id, { size: event.target.value })} className={`${inputClass} w-full font-mono`} />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] text-slate-500">Levier</span>
                  <input type="number" min={1} max={50} value={trade.leverage} onChange={(event) => updateTrade(trade.id, { leverage: event.target.value })} className={`${inputClass} w-full font-mono`} />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] text-slate-500">Entrée</span>
                  <input type="datetime-local" step={1} value={trade.entry} onChange={(event) => updateTrade(trade.id, { entry: event.target.value })} className={`${inputClass} w-full`} />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] text-slate-500">Prix entrée (optionnel)</span>
                  <input type="number" min={0} step="any" value={trade.entryPrice} onChange={(event) => updateTrade(trade.id, { entryPrice: event.target.value })} placeholder="auto" className={`${inputClass} w-full font-mono`} />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] text-slate-500">Sortie (vide = garde jusqu'à la fin)</span>
                  <input type="datetime-local" step={1} value={trade.exit} onChange={(event) => updateTrade(trade.id, { exit: event.target.value })} className={`${inputClass} w-full`} />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] text-slate-500">Prix sortie (optionnel)</span>
                  <input type="number" min={0} step="any" value={trade.exitPrice} onChange={(event) => updateTrade(trade.id, { exitPrice: event.target.value })} placeholder="auto" className={`${inputClass} w-full font-mono`} />
                </label>
                <div className="flex items-end justify-end">
                  <button type="button" onClick={() => removeTrade(trade.id)} className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-400 hover:border-rose-500/40 hover:text-rose-300">
                    Supprimer
                  </button>
                </div>
              </div>
            </div>
          ))}
          {draft.trades.length === 0 && <p className="text-sm text-slate-500">Aucun trade saisi.</p>}
        </div>
      </div>

      {/* Actions */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={prepareReplay}
            disabled={busy}
            className="rounded-xl bg-red-600 px-6 py-3 text-sm font-bold uppercase tracking-wider text-white hover:bg-red-500 disabled:opacity-50"
          >
            {busy ? 'Préparation…' : '▶ Préparer et ouvrir le replay'}
          </button>
          <button type="button" onClick={exportJson} className="rounded-xl border border-slate-700 px-4 py-3 text-sm text-slate-300 hover:border-slate-500">
            Exporter JSON
          </button>
          <button type="button" onClick={() => setShowJson((value) => !value)} className="rounded-xl border border-slate-700 px-4 py-3 text-sm text-slate-300 hover:border-slate-500">
            {showJson ? 'Masquer JSON' : 'Importer JSON'}
          </button>
        </div>
        {error && <p className="mt-3 text-sm text-rose-400">{error}</p>}
        {notice && <p className="mt-3 text-sm text-emerald-400">{notice}</p>}
        {showJson && (
          <div className="mt-4">
            <textarea
              value={jsonText}
              onChange={(event) => setJsonText(event.target.value)}
              rows={10}
              spellCheck={false}
              className="w-full rounded-xl border border-slate-700 bg-slate-950 p-3 font-mono text-xs text-slate-200 outline-none focus:border-red-500"
              placeholder="Colle ici une configuration exportée…"
            />
            <button type="button" onClick={importJson} className="mt-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500">
              Charger cette configuration
            </button>
          </div>
        )}
        <p className="mt-4 text-xs text-slate-500">
          Les prix d'entrée/sortie laissés en « auto » sont interpolés depuis les bougies 1m du marché.
          Le PnL affiché évolue seconde par seconde (parcours intra-bougie simulé, reproductible au seek — pas le vrai tick historique).
        </p>
      </div>
    </div>
  );
}
