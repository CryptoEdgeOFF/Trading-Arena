import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import PlayerAvatar from './PlayerAvatar';
import type { EventMode, MarketDataSource, PlatformMode, TeamInfo } from '../stores/useGameStore';

const ADMIN_TOKEN_KEY = 'btf-admin-token';

interface RosterPlayer {
  id: string;
  name: string;
  color: string;
  avatar: string | null;
  active: boolean;
  connected: boolean;
  traderCode: string;
}

interface AdminCompetitionEntry {
  userId: string;
  joinedAt: number;
  pnlUsd: number;
  pnlPercent: number;
  tradesCount: number;
  updatedAt: number;
  user: {
    id: string;
    email: string;
    name: string;
  } | null;
}

interface AdminCashPrize {
  currency: string;
  total: number;
  breakdown?: Array<{ rank: number; amount: number }>;
}

interface AdminCompetition {
  id: string;
  title: string;
  code: string;
  executionMode: 'paper' | 'real';
  startAt: number;
  endAt: number;
  isPublic: boolean;
  createdAt: number;
  status: 'upcoming' | 'live' | 'ended';
  participants: number;
  entriesDetailed: AdminCompetitionEntry[];
  cashPrize?: AdminCashPrize | null;
}

const MODE_LABELS: Record<EventMode, { label: string; desc: string; players: string }> = {
  '1v1': { label: '1 vs 1', desc: 'Duel entre deux traders', players: '2 joueurs' },
  '1v1v1': { label: '1 vs 1 vs 1', desc: 'Triple menace', players: '3 joueurs' },
  '1v1v1v1': { label: '1 vs 1 vs 1 vs 1', desc: 'Battle royale', players: '4 joueurs' },
  '4v4': { label: '4 vs 4', desc: 'Match par équipes', players: '8 joueurs' },
};

const PLATFORM_LABELS: Record<PlatformMode, { label: string; desc: string; accent: string }> = {
  kraken: {
    label: 'Kraken',
    desc: 'Lecture des comptes réels via API Futures',
    accent: 'border-indigo-500 bg-indigo-500/10 text-indigo-300',
  },
  paper: {
    label: 'Paper',
    desc: 'Trading simulé en simultané sur la plateforme',
    accent: 'border-green-500 bg-green-500/10 text-green-300',
  },
};

const DATA_SOURCE_LABELS: Record<MarketDataSource, { label: string; desc: string; accent: string }> = {
  kraken: {
    label: 'Kraken',
    desc: 'Flux prix + bougies depuis Kraken',
    accent: 'border-indigo-500 bg-indigo-500/10 text-indigo-300',
  },
  binance: {
    label: 'Binance Futures',
    desc: 'Flux prix + bougies depuis Binance USDT-M Futures',
    accent: 'border-yellow-500 bg-yellow-500/10 text-yellow-200',
  },
};

function AvatarUpload({ player, onUploaded, adminToken }: { player: RosterPlayer; onUploaded: () => void; adminToken: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const form = new FormData();
    form.append('avatar', file);
    try {
      await fetch(`/api/roster/${player.id}/avatar`, {
        method: 'POST',
        body: form,
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      onUploaded();
    } finally {
      setUploading(false);
    }
  }

  return (
    <>
      <input ref={inputRef} type="file" accept="image/*" onChange={handleFile} className="hidden" />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="relative group cursor-pointer"
        title="Changer la photo"
      >
        <PlayerAvatar name={player.name} color={player.color} avatar={player.avatar} size="sm" glow={player.active} dimmed={!player.active} />
        <div className="absolute inset-0 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </div>
      </button>
    </>
  );
}

function TraderCodePill({ code }: { code: string }) {
  return (
    <span className="rounded-full border border-green-500/20 bg-green-500/10 px-2 py-0.5 font-mono text-[11px] tracking-[0.2em] text-green-300">
      {code}
    </span>
  );
}

function PlayerPill({
  player,
  onRemove,
  onUpload,
  showCode,
  adminToken,
}: {
  player: RosterPlayer;
  onRemove: () => void;
  onUpload: () => void;
  showCode: boolean;
  adminToken: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-gray-700/50 bg-gray-800/60 px-3 py-2">
      <AvatarUpload player={player} onUploaded={onUpload} adminToken={adminToken} />
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-white">{player.name}</p>
        {showCode && <TraderCodePill code={player.traderCode} />}
      </div>
      <button onClick={onRemove} className="ml-auto text-xs text-gray-500 transition-colors hover:text-red-400">
        Retirer
      </button>
    </div>
  );
}

export default function AdminPanel() {
  const [adminToken, setAdminToken] = useState<string | null>(() => window.localStorage.getItem(ADMIN_TOKEN_KEY));
  const [adminCodeInput, setAdminCodeInput] = useState('');
  const [adminLoginBusy, setAdminLoginBusy] = useState(false);
  const [adminLoginError, setAdminLoginError] = useState('');

  const adminFetch = useCallback(async (url: string, init: RequestInit = {}): Promise<Response> => {
    const headers = new Headers(init.headers || {});
    if (adminToken) headers.set('Authorization', `Bearer ${adminToken}`);
    const response = await fetch(url, { ...init, headers });
    if (response.status === 401) {
      window.localStorage.removeItem(ADMIN_TOKEN_KEY);
      setAdminToken(null);
    }
    return response;
  }, [adminToken]);

  const [roster, setRoster] = useState<RosterPlayer[]>([]);
  const [name, setName] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [eventStarted, setEventStarted] = useState(false);
  const [mode, setMode] = useState<EventMode>('1v1');
  const [platformMode, setPlatformMode] = useState<PlatformMode>('kraken');
  const [marketDataSource, setMarketDataSource] = useState<MarketDataSource>('kraken');
  const [paperStartingBalance, setPaperStartingBalance] = useState(10000);
  const [teamA, setTeamA] = useState<TeamInfo>({ name: 'Équipe Alpha', color: '#6366f1', playerIds: [] });
  const [teamB, setTeamB] = useState<TeamInfo>({ name: 'Équipe Beta', color: '#f43f5e', playerIds: [] });
  const [adminCompetitions, setAdminCompetitions] = useState<AdminCompetition[]>([]);
  const [competitionTitle, setCompetitionTitle] = useState('');
  const [competitionCode, setCompetitionCode] = useState('');
  const [competitionStartAt, setCompetitionStartAt] = useState('');
  const [competitionEndAt, setCompetitionEndAt] = useState('');
  const [competitionIsPublic, setCompetitionIsPublic] = useState(true);
  const [competitionExecutionMode, setCompetitionExecutionMode] = useState<'paper' | 'real'>('paper');
  const [competitionPrizeCurrency, setCompetitionPrizeCurrency] = useState('USD');
  const [competitionPrizeTotal, setCompetitionPrizeTotal] = useState('');
  const [competitionPrizeFirst, setCompetitionPrizeFirst] = useState('');
  const [competitionPrizeSecond, setCompetitionPrizeSecond] = useState('');
  const [competitionPrizeThird, setCompetitionPrizeThird] = useState('');
  const [resultDrafts, setResultDrafts] = useState<Record<string, { pnlPercent: string; pnlUsd: string; tradesCount: string }>>({});
  const [editingCompetitionId, setEditingCompetitionId] = useState<string | null>(null);
  const [competitionEditDraft, setCompetitionEditDraft] = useState<{
    title: string;
    code: string;
    executionMode: 'paper' | 'real';
    startAt: string;
    endAt: string;
    isPublic: boolean;
    prizeCurrency: string;
    prizeTotal: string;
    prizeFirst: string;
    prizeSecond: string;
    prizeThird: string;
  } | null>(null);

  useEffect(() => {
    if (!adminToken) return;
    let cancelled = false;
    fetch('/api/admin/check', { headers: { Authorization: `Bearer ${adminToken}` } })
      .then(async (response) => {
        if (cancelled) return;
        const data = await response.json().catch(() => ({}));
        if (!data?.ok) {
          window.localStorage.removeItem(ADMIN_TOKEN_KEY);
          setAdminToken(null);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [adminToken]);

  useEffect(() => {
    if (!adminToken) return;
    fetchRoster();
    fetchStatus();
    fetchConfig();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminToken]);

  async function loginAdmin(event?: React.FormEvent) {
    event?.preventDefault();
    setAdminLoginBusy(true);
    setAdminLoginError('');
    try {
      const response = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: adminCodeInput }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Code invalide');
      window.localStorage.setItem(ADMIN_TOKEN_KEY, data.token);
      setAdminToken(data.token);
      setAdminCodeInput('');
    } catch (err: any) {
      setAdminLoginError(err.message || 'Erreur inconnue');
    } finally {
      setAdminLoginBusy(false);
    }
  }

  async function logoutAdmin() {
    if (adminToken) {
      try {
        await fetch('/api/admin/logout', {
          method: 'POST',
          headers: { Authorization: `Bearer ${adminToken}` },
        });
      } catch {
        /* noop */
      }
    }
    window.localStorage.removeItem(ADMIN_TOKEN_KEY);
    setAdminToken(null);
  }

  async function fetchRoster() {
    const res = await adminFetch('/api/roster');
    setRoster(await res.json());
  }

  async function fetchStatus() {
    const res = await adminFetch('/api/event/status');
    const data = await res.json();
    setEventStarted(Boolean(data.started));
    if (data.platformMode) setPlatformMode(data.platformMode);
    if (data.marketDataSource) setMarketDataSource(data.marketDataSource === 'hyperliquid' ? 'binance' : data.marketDataSource);
    if (data.paperStartingBalance) setPaperStartingBalance(data.paperStartingBalance);
  }

  async function fetchConfig() {
    const res = await adminFetch('/api/event/config');
    const data = await res.json();
    if (data.mode) setMode(data.mode);
    if (data.platformMode) setPlatformMode(data.platformMode);
    if (data.marketDataSource) setMarketDataSource(data.marketDataSource === 'hyperliquid' ? 'binance' : data.marketDataSource);
    if (data.paperStartingBalance) setPaperStartingBalance(data.paperStartingBalance);
    if (data.teams) {
      setTeamA(data.teams[0]);
      setTeamB(data.teams[1]);
    }
  }

  async function fetchAdminCompetitions() {
    const res = await adminFetch('/api/admin/competitions');
    if (!res.ok) return;
    const data = await res.json();
    setAdminCompetitions(data.competitions || []);
  }

  async function saveConfig(next?: Partial<{ mode: EventMode; platformMode: PlatformMode; paperStartingBalance: number; marketDataSource: MarketDataSource }>) {
    const body: any = {
      mode: next?.mode || mode,
      platformMode: next?.platformMode || platformMode,
      paperStartingBalance: next?.paperStartingBalance ?? paperStartingBalance,
      marketDataSource: next?.marketDataSource || marketDataSource,
    };
    if ((next?.mode || mode) === '4v4') {
      body.teams = [teamA, teamB];
    }

    const res = await adminFetch('/api/event/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Impossible de sauvegarder la configuration');
    }
  }

  async function registerPlayer(e: React.FormEvent, skipValidation = false) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const payload: Record<string, unknown> = { name, skipValidation };
      if (platformMode === 'kraken') {
        payload.apiKey = apiKey;
        payload.apiSecret = apiSecret;
      }

      const res = await adminFetch('/api/roster', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Erreur');
      }

      setName('');
      setApiKey('');
      setApiSecret('');
      await fetchRoster();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function removePlayer(id: string) {
    await adminFetch(`/api/roster/${id}`, { method: 'DELETE' });
    fetchRoster();
  }

  async function togglePlayer(id: string) {
    await adminFetch(`/api/roster/${id}/toggle`, { method: 'PATCH' });
    fetchRoster();
  }

  async function handleModeChange(newMode: EventMode) {
    setMode(newMode);
    setError('');
    await saveConfig({ mode: newMode });
    for (const player of roster) {
      if (player.active) await adminFetch(`/api/roster/${player.id}/toggle`, { method: 'PATCH' });
    }
    fetchRoster();
  }

  async function handlePlatformChange(nextPlatform: PlatformMode) {
    setPlatformMode(nextPlatform);
    setError('');
    await saveConfig({ platformMode: nextPlatform });
  }

  async function handleDataSourceChange(nextSource: MarketDataSource) {
    setMarketDataSource(nextSource);
    setError('');
    await saveConfig({ marketDataSource: nextSource });
  }

  async function handlePaperStartingBalanceBlur() {
    const safeBalance = Number.isFinite(paperStartingBalance) && paperStartingBalance > 0
      ? paperStartingBalance
      : 10000;
    if (safeBalance !== paperStartingBalance) setPaperStartingBalance(safeBalance);
    setError('');
    await saveConfig({ paperStartingBalance: safeBalance });
  }

  async function toggleEvent() {
    try {
      await saveConfig();
      const endpoint = eventStarted ? '/api/event/stop' : '/api/event/start';
      const res = await adminFetch(endpoint, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Erreur');
      }
      setEventStarted(!eventStarted);
      setError('');
    } catch (err: any) {
      setError(err.message);
    }
  }

  function buildCashPrizePayload(input: {
    currency: string;
    total: string;
    first: string;
    second: string;
    third: string;
  }): { currency: string; total: number; breakdown?: Array<{ rank: number; amount: number }> } | null {
    const total = Number(input.total);
    const first = Number(input.first);
    const second = Number(input.second);
    const third = Number(input.third);
    const currency = (input.currency || 'USD').trim().toUpperCase().slice(0, 6) || 'USD';
    const breakdown: Array<{ rank: number; amount: number }> = [];
    if (Number.isFinite(first) && first > 0) breakdown.push({ rank: 1, amount: first });
    if (Number.isFinite(second) && second > 0) breakdown.push({ rank: 2, amount: second });
    if (Number.isFinite(third) && third > 0) breakdown.push({ rank: 3, amount: third });

    if (!Number.isFinite(total) || total <= 0) {
      if (breakdown.length === 0) return null;
      const computed = breakdown.reduce((acc, row) => acc + row.amount, 0);
      return { currency, total: computed, breakdown };
    }
    return breakdown.length > 0
      ? { currency, total, breakdown }
      : { currency, total };
  }

  async function createCompetition(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const startMs = competitionStartAt ? new Date(competitionStartAt).getTime() : NaN;
    const endMs = competitionEndAt ? new Date(competitionEndAt).getTime() : NaN;
    const cashPrize = buildCashPrizePayload({
      currency: competitionPrizeCurrency,
      total: competitionPrizeTotal,
      first: competitionPrizeFirst,
      second: competitionPrizeSecond,
      third: competitionPrizeThird,
    });
    try {
      const res = await adminFetch('/api/admin/competitions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: competitionTitle,
          code: competitionCode,
          executionMode: competitionExecutionMode,
          startAt: startMs,
          endAt: endMs,
          isPublic: competitionIsPublic,
          cashPrize,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Creation competition impossible');
      setCompetitionTitle('');
      setCompetitionCode('');
      setCompetitionPrizeTotal('');
      setCompetitionPrizeFirst('');
      setCompetitionPrizeSecond('');
      setCompetitionPrizeThird('');
      await fetchAdminCompetitions();
    } catch (err: any) {
      setError(err.message);
    }
  }

  function toLocalInput(value: number): string {
    const date = new Date(value);
    const tzOffset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - tzOffset).toISOString().slice(0, 16);
  }

  function startEditCompetition(competition: AdminCompetition) {
    setEditingCompetitionId(competition.id);
    const breakdown = competition.cashPrize?.breakdown ?? [];
    const findAmount = (rank: number) => breakdown.find((row) => row.rank === rank)?.amount;
    setCompetitionEditDraft({
      title: competition.title,
      code: competition.code,
      executionMode: competition.executionMode,
      startAt: toLocalInput(competition.startAt),
      endAt: toLocalInput(competition.endAt),
      isPublic: competition.isPublic,
      prizeCurrency: competition.cashPrize?.currency || 'USD',
      prizeTotal: competition.cashPrize?.total ? String(competition.cashPrize.total) : '',
      prizeFirst: findAmount(1) != null ? String(findAmount(1)) : '',
      prizeSecond: findAmount(2) != null ? String(findAmount(2)) : '',
      prizeThird: findAmount(3) != null ? String(findAmount(3)) : '',
    });
  }

  function cancelEditCompetition() {
    setEditingCompetitionId(null);
    setCompetitionEditDraft(null);
  }

  async function saveCompetitionEdit(competitionId: string) {
    if (!competitionEditDraft) return;
    setError('');
    const startMs = competitionEditDraft.startAt ? new Date(competitionEditDraft.startAt).getTime() : NaN;
    const endMs = competitionEditDraft.endAt ? new Date(competitionEditDraft.endAt).getTime() : NaN;
    const cashPrize = buildCashPrizePayload({
      currency: competitionEditDraft.prizeCurrency,
      total: competitionEditDraft.prizeTotal,
      first: competitionEditDraft.prizeFirst,
      second: competitionEditDraft.prizeSecond,
      third: competitionEditDraft.prizeThird,
    });
    try {
      const res = await adminFetch(`/api/admin/competitions/${competitionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: competitionEditDraft.title,
          code: competitionEditDraft.code,
          executionMode: competitionEditDraft.executionMode,
          startAt: startMs,
          endAt: endMs,
          isPublic: competitionEditDraft.isPublic,
          cashPrize,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Mise a jour competition impossible');
      cancelEditCompetition();
      await fetchAdminCompetitions();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function deleteCompetition(competition: AdminCompetition) {
    const ok = window.confirm(`Supprimer definitivement la competition "${competition.title}" ?\nLes participants paper traders associes seront aussi retires.`);
    if (!ok) return;
    setError('');
    try {
      const res = await adminFetch(`/api/admin/competitions/${competition.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Suppression competition impossible');
      }
      if (editingCompetitionId === competition.id) cancelEditCompetition();
      await fetchAdminCompetitions();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function saveParticipantResult(competitionId: string, entry: AdminCompetitionEntry) {
    const key = `${competitionId}:${entry.userId}`;
    const draft = resultDrafts[key];
    const pnlPercent = Number(draft?.pnlPercent ?? entry.pnlPercent);
    const pnlUsd = Number(draft?.pnlUsd ?? entry.pnlUsd);
    const tradesCount = Number(draft?.tradesCount ?? entry.tradesCount);
    setError('');
    try {
      const res = await adminFetch('/api/admin/competitions/result', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          competitionId,
          userId: entry.userId,
          pnlPercent,
          pnlUsd,
          tradesCount,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Maj resultat impossible');
      await fetchAdminCompetitions();
    } catch (err: any) {
      setError(err.message);
    }
  }

  function addToTeam(playerId: string, team: 'A' | 'B') {
    if (team === 'A') {
      setTeamA((current) => ({ ...current, playerIds: [...current.playerIds.filter((id) => id !== playerId), playerId] }));
      setTeamB((current) => ({ ...current, playerIds: current.playerIds.filter((id) => id !== playerId) }));
    } else {
      setTeamB((current) => ({ ...current, playerIds: [...current.playerIds.filter((id) => id !== playerId), playerId] }));
      setTeamA((current) => ({ ...current, playerIds: current.playerIds.filter((id) => id !== playerId) }));
    }
  }

  function removeFromTeam(playerId: string) {
    setTeamA((current) => ({ ...current, playerIds: current.playerIds.filter((id) => id !== playerId) }));
    setTeamB((current) => ({ ...current, playerIds: current.playerIds.filter((id) => id !== playerId) }));
  }

  const activePlayers = roster.filter((player) => player.active);
  const inactivePlayers = roster.filter((player) => !player.active);
  const is4v4 = mode === '4v4';
  const teamAPlayers = roster.filter((player) => teamA.playerIds.includes(player.id));
  const teamBPlayers = roster.filter((player) => teamB.playerIds.includes(player.id));
  const unassigned = roster.filter((player) => !teamA.playerIds.includes(player.id) && !teamB.playerIds.includes(player.id));
  const expectedPlayers = mode === '1v1' ? 2 : mode === '1v1v1' ? 3 : mode === '1v1v1v1' ? 4 : 8;
  const currentCount = is4v4 ? teamA.playerIds.length + teamB.playerIds.length : activePlayers.length;
  const isReady = currentCount === expectedPlayers && (!is4v4 || (teamA.playerIds.length === 4 && teamB.playerIds.length === 4));
  const showTraderCodes = platformMode === 'paper';

  if (!adminToken) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#020617] p-6 text-slate-100">
        <form
          onSubmit={loginAdmin}
          className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900/80 p-7 shadow-2xl"
        >
          <div className="mb-5 flex items-center gap-3">
            <img src="/assets/pictures/logoBTF.png" alt="BTF" className="h-10 w-10 rounded-lg object-contain" />
            <div>
              <h1 className="font-rajdhani text-2xl font-bold text-white">Admin Panel</h1>
              <p className="text-xs text-slate-400">Acces protege</p>
            </div>
          </div>
          <label className="mb-1 block text-sm text-slate-300">Code d acces admin</label>
          <input
            type="password"
            autoFocus
            value={adminCodeInput}
            onChange={(event) => setAdminCodeInput(event.target.value)}
            placeholder="Entre le code"
            className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 font-mono text-white outline-none focus:border-indigo-500"
          />
          {adminLoginError && <div className="mt-3 text-sm text-rose-400">{adminLoginError}</div>}
          <button
            type="submit"
            disabled={adminLoginBusy || !adminCodeInput.trim()}
            className="mt-4 w-full rounded-xl bg-indigo-600 px-4 py-3 font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {adminLoginBusy ? 'Verification...' : 'Acceder'}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="h-screen overflow-y-auto bg-[#020617] p-8 text-slate-100">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8 flex items-start justify-between gap-6">
          <div>
            <div className="mb-2 flex items-center gap-4">
              <img src="/assets/pictures/logoBTF.png" alt="BTF" className="h-10 w-10 rounded-lg object-contain" />
              <h1 className="font-rajdhani text-4xl font-bold text-white">Admin Panel</h1>
            </div>
            <p className="text-sm text-slate-400">
              Configure le mode de jeu, active les traders puis lance la room live.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <a
              href="/btf-live-arena-2026"
              className="rounded-xl border border-indigo-500/20 bg-indigo-500/10 px-4 py-3 text-sm font-medium text-indigo-300 transition-colors hover:bg-indigo-500/15"
            >
              Ouvrir dashboard live
            </a>
            <a
              href="/trader"
              className="rounded-xl border border-green-500/20 bg-green-500/10 px-4 py-3 text-sm font-medium text-green-300 transition-colors hover:bg-green-500/15"
            >
              Ouvrir le terminal trader
            </a>
            <button
              type="button"
              onClick={logoutAdmin}
              className="rounded-xl border border-slate-700 px-3 py-3 text-sm text-slate-300 transition-colors hover:border-rose-500/40 hover:text-rose-300"
            >
              Verrouiller admin
            </button>
          </div>
        </div>

        <div className="mb-8 grid gap-6 lg:grid-cols-[1.3fr_1fr]">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6">
            <p className="mb-4 text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">Source d’exécution live</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {(['paper', 'kraken'] as PlatformMode[]).map((option) => {
                const isActive = platformMode === option;
                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => handlePlatformChange(option)}
                    disabled={eventStarted}
                    className={`cursor-pointer rounded-2xl border p-4 text-left transition-all ${isActive ? PLATFORM_LABELS[option].accent : 'border-slate-700 bg-slate-800/70 hover:border-slate-600'} ${eventStarted ? 'cursor-not-allowed opacity-60' : ''}`}
                  >
                    <div className="mb-1 font-rajdhani text-2xl font-bold text-white">{PLATFORM_LABELS[option].label}</div>
                    <p className="text-sm text-slate-400">{PLATFORM_LABELS[option].desc}</p>
                  </button>
                );
              })}
            </div>
            {platformMode === 'paper' && (
              <div className="mt-5 rounded-2xl border border-green-500/15 bg-green-500/5 p-4">
                <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-green-300">
                  Capital paper par trader
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    min={100}
                    step={100}
                    value={paperStartingBalance}
                    onChange={(event) => setPaperStartingBalance(Number(event.target.value))}
                    onBlur={handlePaperStartingBalanceBlur}
                    disabled={eventStarted}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 font-mono text-sm text-white outline-none transition-colors focus:border-green-500 disabled:opacity-60"
                  />
                  <span className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm font-semibold text-slate-300">USD</span>
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  Même logique que les arènes paper : les traders reçoivent un code et tradent en simulé sur le terminal live.
                </p>
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6">
            <p className="mb-4 text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">Source du datafeed</p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              {(['binance', 'kraken'] as MarketDataSource[]).map((option) => {
                const isActive = marketDataSource === option;
                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => handleDataSourceChange(option)}
                    disabled={eventStarted}
                    className={`cursor-pointer rounded-2xl border p-4 text-left transition-all ${isActive ? DATA_SOURCE_LABELS[option].accent : 'border-slate-700 bg-slate-800/70 hover:border-slate-600'} ${eventStarted ? 'cursor-not-allowed opacity-60' : ''}`}
                  >
                    <div className="mb-1 font-rajdhani text-2xl font-bold text-white">{DATA_SOURCE_LABELS[option].label}</div>
                    <p className="text-sm text-slate-400">{DATA_SOURCE_LABELS[option].desc}</p>
                  </button>
                );
              })}
            </div>
            <p className="mt-3 text-xs text-slate-500">
              Pour une room paper crypto, Binance Futures est recommandé pour une meilleure liquidité.
            </p>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6">
            <p className="mb-2 text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">Séparation des admins</p>
            <p className="text-sm text-slate-400">
              Cette page pilote uniquement la room live reliée au dashboard : paper trading événementiel ou lecture de comptes Kraken.
              Les arènes online, les règles d’inscription publiques et les lots se gèrent dans <a href="/compete/admin" className="font-semibold text-amber-300 hover:text-amber-200">/compete/admin</a>.
            </p>
          </div>
        </div>

        <div className="mb-8 rounded-2xl border border-slate-800 bg-slate-900/80 p-6">
          <p className="mb-4 text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">Format de la compétition</p>
          <div className="grid gap-3 md:grid-cols-4">
            {(Object.keys(MODE_LABELS) as EventMode[]).map((option) => {
              const isActive = mode === option;
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => handleModeChange(option)}
                  disabled={eventStarted}
                  className={`relative cursor-pointer rounded-2xl border-2 p-4 text-left transition-all ${isActive ? 'border-indigo-500 bg-indigo-500/10' : 'border-slate-700 bg-slate-800/70 hover:border-slate-600'} ${eventStarted ? 'cursor-not-allowed opacity-60' : ''}`}
                >
                  <div className={`mb-1 font-rajdhani text-xl font-bold ${isActive ? 'text-indigo-300' : 'text-white'}`}>
                    {MODE_LABELS[option].label}
                  </div>
                  <div className="text-xs text-slate-400">{MODE_LABELS[option].desc}</div>
                  <div className={`mt-2 text-xs ${isActive ? 'text-indigo-300/80' : 'text-slate-500'}`}>
                    {MODE_LABELS[option].players}
                  </div>
                  {isActive && <motion.div layoutId="mode-indicator" className="absolute right-3 top-3 h-2.5 w-2.5 rounded-full bg-indigo-400" />}
                </button>
              );
            })}
          </div>
        </div>

        <form onSubmit={registerPlayer} className="mb-8 rounded-2xl border border-slate-800 bg-slate-900/80 p-6">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-white">Enregistrer un joueur</h2>
              <p className="text-sm text-slate-500">
                {platformMode === 'paper'
                  ? 'Le serveur génère automatiquement un code d’accès trader.'
                  : 'Les identifiants Kraken servent uniquement à lire le compte réel.'}
              </p>
            </div>
            <span className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] ${platformMode === 'paper' ? 'bg-green-500/10 text-green-300' : 'bg-indigo-500/10 text-indigo-300'}`}>
              {PLATFORM_LABELS[platformMode].label}
            </span>
          </div>

          <div className="space-y-4">
            <input
              type="text"
              placeholder="Pseudo du joueur"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-white outline-none transition-colors focus:border-indigo-500"
              required
            />

            {platformMode === 'kraken' && (
              <div className="grid gap-4 md:grid-cols-2">
                <input
                  type="text"
                  placeholder="Clé API Kraken Futures"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 font-mono text-sm text-white outline-none transition-colors focus:border-indigo-500"
                  required
                />
                <input
                  type="password"
                  placeholder="Secret API Kraken Futures"
                  value={apiSecret}
                  onChange={(e) => setApiSecret(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 font-mono text-sm text-white outline-none transition-colors focus:border-indigo-500"
                  required
                />
              </div>
            )}

            {error && (
              <div className="text-sm">
                <p className="text-red-400">{error}</p>
                {platformMode === 'kraken' && error.includes('invalide') && (
                  <button type="button" onClick={(e) => registerPlayer(e as any, true)} className="mt-2 text-yellow-300 underline transition-colors hover:text-yellow-200">
                    Enregistrer quand même sans vérification
                  </button>
                )}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className={`w-full rounded-xl px-4 py-3 font-semibold text-white transition-colors ${platformMode === 'paper' ? 'bg-green-600 hover:bg-green-500' : 'bg-indigo-600 hover:bg-indigo-500'} disabled:bg-slate-700`}
            >
              {loading ? (platformMode === 'paper' ? 'Création du trader...' : 'Vérification de la clé API...') : 'Enregistrer le joueur'}
            </button>
          </div>
        </form>

        {is4v4 ? (
          <div className="mb-8 space-y-6">
            <div className="rounded-2xl border-2 bg-slate-900/80 p-6" style={{ borderColor: `${teamA.color}60` }}>
              <div className="mb-4 flex items-center gap-3">
                <div className="h-4 w-4 rounded-full" style={{ background: teamA.color }} />
                <input
                  type="text"
                  value={teamA.name}
                  onChange={(e) => setTeamA((current) => ({ ...current, name: e.target.value }))}
                  className="border-b border-transparent bg-transparent font-rajdhani text-xl font-bold text-white outline-none transition-colors hover:border-slate-600 focus:border-indigo-500"
                />
                <span className="ml-auto text-sm text-slate-500">{teamAPlayers.length}/4</span>
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                {teamAPlayers.map((player) => (
                  <PlayerPill key={player.id} player={player} onRemove={() => removeFromTeam(player.id)} onUpload={fetchRoster} showCode={showTraderCodes} adminToken={adminToken || ''} />
                ))}
                {Array.from({ length: Math.max(0, 4 - teamAPlayers.length) }).map((_, index) => (
                  <div key={`empty-a-${index}`} className="rounded-lg border-2 border-dashed border-slate-700 py-2 text-center text-sm text-slate-600">
                    Slot vide
                  </div>
                ))}
              </div>
            </div>

            <div className="text-center font-rajdhani text-3xl font-bold text-slate-600">VS</div>

            <div className="rounded-2xl border-2 bg-slate-900/80 p-6" style={{ borderColor: `${teamB.color}60` }}>
              <div className="mb-4 flex items-center gap-3">
                <div className="h-4 w-4 rounded-full" style={{ background: teamB.color }} />
                <input
                  type="text"
                  value={teamB.name}
                  onChange={(e) => setTeamB((current) => ({ ...current, name: e.target.value }))}
                  className="border-b border-transparent bg-transparent font-rajdhani text-xl font-bold text-white outline-none transition-colors hover:border-slate-600 focus:border-indigo-500"
                />
                <span className="ml-auto text-sm text-slate-500">{teamBPlayers.length}/4</span>
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                {teamBPlayers.map((player) => (
                  <PlayerPill key={player.id} player={player} onRemove={() => removeFromTeam(player.id)} onUpload={fetchRoster} showCode={showTraderCodes} adminToken={adminToken || ''} />
                ))}
                {Array.from({ length: Math.max(0, 4 - teamBPlayers.length) }).map((_, index) => (
                  <div key={`empty-b-${index}`} className="rounded-lg border-2 border-dashed border-slate-700 py-2 text-center text-sm text-slate-600">
                    Slot vide
                  </div>
                ))}
              </div>
            </div>

            {unassigned.length > 0 && (
              <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6">
                <h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">Non assignés</h3>
                <div className="space-y-2">
                  {unassigned.map((player) => (
                    <div key={player.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/60 py-2 last:border-0">
                      <div className="flex items-center gap-3">
                        <AvatarUpload player={player} onUploaded={fetchRoster} adminToken={adminToken || ''} />
                        <div>
                          <span className="text-slate-300">{player.name}</span>
                          {showTraderCodes && <div className="mt-1"><TraderCodePill code={player.traderCode} /></div>}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => addToTeam(player.id, 'A')}
                          disabled={teamAPlayers.length >= 4}
                          className="rounded-lg border px-3 py-1.5 text-xs transition-colors disabled:opacity-30"
                          style={{ borderColor: `${teamA.color}40`, color: teamA.color }}
                        >
                          {teamA.name}
                        </button>
                        <button
                          type="button"
                          onClick={() => addToTeam(player.id, 'B')}
                          disabled={teamBPlayers.length >= 4}
                          className="rounded-lg border px-3 py-1.5 text-xs transition-colors disabled:opacity-30"
                          style={{ borderColor: `${teamB.color}40`, color: teamB.color }}
                        >
                          {teamB.name}
                        </button>
                        <button type="button" onClick={() => removePlayer(player.id)} className="px-2 py-1.5 text-xs text-slate-500 transition-colors hover:text-red-400">
                          Supprimer
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="mb-8 rounded-2xl border border-slate-800 bg-slate-900/80 p-6">
              <h2 className="mb-1 text-lg font-semibold text-white">Dans la compétition ({activePlayers.length}/{expectedPlayers})</h2>
              <p className="mb-4 text-sm text-slate-500">Clique sur la photo pour mettre à jour l’avatar.</p>
              <AnimatePresence>
                {activePlayers.map((player) => (
                  <motion.div key={player.id} layout initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: -50 }} className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800/60 py-3 last:border-0">
                    <div className="flex items-center gap-3">
                      <AvatarUpload player={player} onUploaded={fetchRoster} adminToken={adminToken || ''} />
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-white">{player.name}</span>
                          <span className="rounded-full bg-green-500/10 px-2 py-0.5 text-xs text-green-300">Actif</span>
                          {showTraderCodes && <TraderCodePill code={player.traderCode} />}
                        </div>
                        <p className="text-xs text-slate-500">
                          {platformMode === 'paper'
                            ? 'Connexion trader via le terminal local'
                            : player.connected
                              ? 'Compte Kraken vérifié'
                              : 'En attente de synchronisation Kraken'}
                        </p>
                      </div>
                    </div>
                    <button type="button" onClick={() => togglePlayer(player.id)} className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-1.5 text-sm text-red-400 transition-colors hover:bg-red-500/20">
                      Retirer
                    </button>
                  </motion.div>
                ))}
              </AnimatePresence>
              {activePlayers.length === 0 && <p className="py-4 text-center text-sm text-slate-600">Ajoute des joueurs depuis le roster.</p>}
            </div>

            <div className="mb-8 rounded-2xl border border-slate-800 bg-slate-900/80 p-6">
              <h2 className="mb-1 text-lg font-semibold text-white">Roster ({roster.length})</h2>
              <p className="mb-4 text-sm text-slate-500">Joueurs disponibles pour la prochaine room.</p>
              <AnimatePresence>
                {inactivePlayers.map((player) => (
                  <motion.div key={player.id} layout initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 50 }} className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800/60 py-3 last:border-0">
                    <div className="flex items-center gap-3">
                      <AvatarUpload player={player} onUploaded={fetchRoster} adminToken={adminToken || ''} />
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-slate-300">{player.name}</span>
                          {showTraderCodes && <TraderCodePill code={player.traderCode} />}
                        </div>
                        <p className="text-xs text-slate-500">
                          {platformMode === 'paper' ? 'Code à communiquer au trader' : 'Compte prêt pour validation Kraken'}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => togglePlayer(player.id)} disabled={activePlayers.length >= expectedPlayers} className="rounded-lg border border-green-500/20 bg-green-500/10 px-3 py-1.5 text-sm text-green-400 transition-colors hover:bg-green-500/20 disabled:opacity-30">
                        Ajouter
                      </button>
                      <button type="button" onClick={() => removePlayer(player.id)} className="rounded-lg px-3 py-1.5 text-sm text-slate-500 transition-colors hover:bg-red-500/10 hover:text-red-400">
                        Supprimer
                      </button>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
              {roster.length === 0 && <p className="py-4 text-center text-sm text-slate-600">Aucun joueur enregistré.</p>}
            </div>
          </>
        )}

        <button
          onClick={toggleEvent}
          disabled={!eventStarted && !isReady}
          className={`w-full rounded-2xl px-6 py-4 text-lg font-bold text-white transition-all ${eventStarted ? 'bg-red-600 hover:bg-red-500' : isReady ? 'bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-400 hover:to-emerald-500' : 'cursor-not-allowed bg-slate-700 text-slate-500'}`}
        >
          {eventStarted
            ? "ARRÊTER L'ÉVÉNEMENT"
            : isReady
              ? `LANCER ${MODE_LABELS[mode].label} (${PLATFORM_LABELS[platformMode].label})`
              : `${MODE_LABELS[mode].label} — ${currentCount}/${expectedPlayers} joueurs`}
        </button>
      </div>
    </div>
  );
}
