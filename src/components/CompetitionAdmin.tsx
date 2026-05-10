import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

const ADMIN_TOKEN_KEY = 'btf-admin-token';

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

interface PrizeDraft {
  currency: string;
  total: string;
  first: string;
  second: string;
  third: string;
}

interface CompetitionDraft {
  title: string;
  code: string;
  executionMode: 'paper' | 'real';
  startAt: string;
  endAt: string;
  isPublic: boolean;
  prize: PrizeDraft;
}

const EMPTY_DRAFT: CompetitionDraft = {
  title: '',
  code: '',
  executionMode: 'paper',
  startAt: '',
  endAt: '',
  isPublic: true,
  prize: { currency: 'USD', total: '', first: '', second: '', third: '' },
};

function toLocalInput(value: number): string {
  if (!Number.isFinite(value)) return '';
  const date = new Date(value);
  const tzOffset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - tzOffset).toISOString().slice(0, 16);
}

function buildCashPrizePayload(input: PrizeDraft):
  | { currency: string; total: number; breakdown?: Array<{ rank: number; amount: number }> }
  | null {
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
  return breakdown.length > 0 ? { currency, total, breakdown } : { currency, total };
}

function formatDate(value: number): string {
  if (!value || !Number.isFinite(value)) return '—';
  return new Date(value).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

function formatUsd(value: number): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

function statusBadge(status: AdminCompetition['status']) {
  if (status === 'live') {
    return <span className="rounded-full border border-emerald-400/40 bg-emerald-400/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-emerald-300">Live</span>;
  }
  if (status === 'upcoming') {
    return <span className="rounded-full border border-sky-400/40 bg-sky-400/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-sky-300">À venir</span>;
  }
  return <span className="rounded-full border border-rose-400/40 bg-rose-400/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-rose-300">Terminée</span>;
}

export default function CompetitionAdmin() {
  const [adminToken, setAdminToken] = useState<string>(() => localStorage.getItem(ADMIN_TOKEN_KEY) || '');
  const [adminCode, setAdminCode] = useState('');
  const [loginError, setLoginError] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const [competitions, setCompetitions] = useState<AdminCompetition[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [createDraft, setCreateDraft] = useState<CompetitionDraft>(EMPTY_DRAFT);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<CompetitionDraft | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const adminFetch = useCallback(
    async (url: string, init: RequestInit = {}) => {
      const headers: Record<string, string> = { ...((init.headers as Record<string, string>) || {}) };
      if (adminToken) headers['Authorization'] = `Bearer ${adminToken}`;
      return fetch(url, { ...init, headers });
    },
    [adminToken],
  );

  const fetchCompetitions = useCallback(async () => {
    if (!adminToken) return;
    setLoadingList(true);
    try {
      const res = await adminFetch('/api/admin/competitions');
      if (res.status === 401) {
        localStorage.removeItem(ADMIN_TOKEN_KEY);
        setAdminToken('');
        return;
      }
      const data = await res.json();
      setCompetitions(data.competitions || []);
    } catch (err: any) {
      setError(err.message || 'Chargement impossible');
    } finally {
      setLoadingList(false);
    }
  }, [adminFetch, adminToken]);

  useEffect(() => {
    if (!adminToken) return;
    let cancelled = false;
    (async () => {
      const res = await fetch('/api/admin/check', { headers: { Authorization: `Bearer ${adminToken}` } });
      const data = await res.json().catch(() => ({ ok: false }));
      if (cancelled) return;
      if (!data.ok) {
        localStorage.removeItem(ADMIN_TOKEN_KEY);
        setAdminToken('');
      } else {
        fetchCompetitions();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [adminToken, fetchCompetitions]);

  async function loginAdmin(e: React.FormEvent) {
    e.preventDefault();
    setLoginError('');
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: adminCode.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Code admin incorrect');
      }
      const data = await res.json();
      localStorage.setItem(ADMIN_TOKEN_KEY, data.token);
      setAdminToken(data.token);
      setAdminCode('');
    } catch (err: any) {
      setLoginError(err.message);
    }
  }

  async function logoutAdmin() {
    try {
      await adminFetch('/api/admin/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    localStorage.removeItem(ADMIN_TOKEN_KEY);
    setAdminToken('');
    setCompetitions([]);
  }

  async function createCompetition(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setInfo('');
    setCreating(true);
    try {
      const startMs = createDraft.startAt ? new Date(createDraft.startAt).getTime() : NaN;
      const endMs = createDraft.endAt ? new Date(createDraft.endAt).getTime() : NaN;
      if (!createDraft.title.trim()) throw new Error('Titre requis');
      if (!createDraft.code.trim()) throw new Error('Code requis');
      if (!Number.isFinite(startMs)) throw new Error('Date de début invalide');
      if (!Number.isFinite(endMs)) throw new Error('Date de fin invalide');
      if (endMs <= startMs) throw new Error('La fin doit être après le début');

      const cashPrize = buildCashPrizePayload(createDraft.prize);
      const res = await adminFetch('/api/admin/competitions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: createDraft.title.trim(),
          code: createDraft.code.trim(),
          executionMode: createDraft.executionMode,
          startAt: startMs,
          endAt: endMs,
          isPublic: createDraft.isPublic,
          cashPrize,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Création impossible');
      setCreateDraft(EMPTY_DRAFT);
      setInfo('Arène créée');
      await fetchCompetitions();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  }

  function startEdit(competition: AdminCompetition) {
    setEditingId(competition.id);
    const breakdown = competition.cashPrize?.breakdown ?? [];
    const findAmount = (rank: number) => breakdown.find((row) => row.rank === rank)?.amount;
    setEditDraft({
      title: competition.title,
      code: competition.code,
      executionMode: competition.executionMode,
      startAt: toLocalInput(competition.startAt),
      endAt: toLocalInput(competition.endAt),
      isPublic: competition.isPublic,
      prize: {
        currency: competition.cashPrize?.currency || 'USD',
        total: competition.cashPrize?.total ? String(competition.cashPrize.total) : '',
        first: findAmount(1) != null ? String(findAmount(1)) : '',
        second: findAmount(2) != null ? String(findAmount(2)) : '',
        third: findAmount(3) != null ? String(findAmount(3)) : '',
      },
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setEditDraft(null);
  }

  async function saveEdit(competitionId: string) {
    if (!editDraft) return;
    setError('');
    setInfo('');
    try {
      const startMs = editDraft.startAt ? new Date(editDraft.startAt).getTime() : NaN;
      const endMs = editDraft.endAt ? new Date(editDraft.endAt).getTime() : NaN;
      if (!Number.isFinite(startMs)) throw new Error('Date de début invalide');
      if (!Number.isFinite(endMs)) throw new Error('Date de fin invalide');
      if (endMs <= startMs) throw new Error('La fin doit être après le début');

      const cashPrize = buildCashPrizePayload(editDraft.prize);
      const res = await adminFetch(`/api/admin/competitions/${competitionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: editDraft.title.trim(),
          code: editDraft.code.trim(),
          executionMode: editDraft.executionMode,
          startAt: startMs,
          endAt: endMs,
          isPublic: editDraft.isPublic,
          cashPrize,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Mise à jour impossible');
      cancelEdit();
      setInfo('Arène mise à jour');
      await fetchCompetitions();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function deleteCompetition(competition: AdminCompetition) {
    const ok = window.confirm(`Supprimer définitivement l'arène « ${competition.title} » ?\nLes participants seront retirés.`);
    if (!ok) return;
    setError('');
    setInfo('');
    try {
      const res = await adminFetch(`/api/admin/competitions/${competition.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Suppression impossible');
      }
      if (editingId === competition.id) cancelEdit();
      if (expandedId === competition.id) setExpandedId(null);
      setInfo('Arène supprimée');
      await fetchCompetitions();
    } catch (err: any) {
      setError(err.message);
    }
  }

  const sortedCompetitions = useMemo(() => {
    const order: Record<AdminCompetition['status'], number> = { live: 0, upcoming: 1, ended: 2 };
    return [...competitions].sort((a, b) => {
      const byStatus = order[a.status] - order[b.status];
      if (byStatus !== 0) return byStatus;
      return a.startAt - b.startAt;
    });
  }, [competitions]);

  if (!adminToken) {
    return (
      <main className="min-h-screen bg-[#020617] px-4 py-12 text-slate-100">
        <div className="mx-auto w-full max-w-md">
          <Link to="/compete" className="mb-6 inline-flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-slate-400 hover:text-white">
            <span aria-hidden>←</span> Retour à BTF Arena
          </Link>
          <form
            onSubmit={loginAdmin}
            className="rounded-2xl border border-slate-800 bg-slate-900/80 p-7 shadow-2xl"
          >
            <div className="mb-5 flex items-center gap-3">
              <img src="/assets/pictures/logoBTF.png" alt="BTF" className="h-10 w-10 rounded-lg object-contain" />
              <div>
                <h1 className="font-rajdhani text-2xl font-bold text-white">Admin Arènes</h1>
                <p className="text-xs text-slate-400">Gestion des compétitions en ligne</p>
              </div>
            </div>
            <label className="mb-1 block text-[11px] uppercase tracking-[0.2em] text-slate-500">Code admin</label>
            <input
              type="password"
              value={adminCode}
              onChange={(e) => setAdminCode(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white outline-none focus:border-amber-400"
              placeholder="••••••••"
              autoFocus
            />
            {loginError && <p className="mt-3 text-sm text-rose-400">{loginError}</p>}
            <button
              type="submit"
              className="mt-5 w-full rounded-lg bg-amber-500 px-4 py-3 text-sm font-semibold uppercase tracking-[0.2em] text-black hover:bg-amber-400"
            >
              Connexion
            </button>
          </form>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#020617] px-4 py-8 text-slate-100 md:px-8">
      <div className="mx-auto w-full max-w-6xl">
        <header className="mb-8 flex flex-col gap-4 border-b border-slate-800 pb-6 md:flex-row md:items-center md:justify-between">
          <div>
            <Link to="/compete" className="mb-2 inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-slate-400 hover:text-white">
              <span aria-hidden>←</span> BTF Arena
            </Link>
            <h1 className="font-rajdhani text-3xl font-bold text-white">Admin Arènes</h1>
            <p className="text-sm text-slate-400">Crée, ajuste et clôture les compétitions en ligne.</p>
          </div>
          <button
            type="button"
            onClick={logoutAdmin}
            className="self-start rounded-lg border border-slate-700 px-4 py-2 text-xs uppercase tracking-[0.2em] text-slate-300 hover:border-rose-400 hover:text-rose-300 md:self-auto"
          >
            Déconnexion
          </button>
        </header>

        {(error || info) && (
          <div className={`mb-6 rounded-xl border px-4 py-3 text-sm ${error ? 'border-rose-500/40 bg-rose-500/10 text-rose-200' : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'}`}>
            {error || info}
          </div>
        )}

        <section className="mb-8 rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
          <h2 className="font-rajdhani text-xl font-semibold text-white">Nouvelle arène</h2>
          <p className="mb-5 text-xs text-slate-400">Le code est utilisé comme identifiant unique pour rejoindre l'arène.</p>
          <form onSubmit={createCompetition} className="grid gap-4 md:grid-cols-2">
            <Field label="Titre">
              <input
                type="text"
                value={createDraft.title}
                onChange={(e) => setCreateDraft({ ...createDraft, title: e.target.value })}
                className="admin-input"
                placeholder="BTF Spring Cup"
                required
              />
            </Field>
            <Field label="Code (unique)">
              <input
                type="text"
                value={createDraft.code}
                onChange={(e) => setCreateDraft({ ...createDraft, code: e.target.value.toUpperCase() })}
                className="admin-input"
                placeholder="SPRINGCUP"
                required
              />
            </Field>
            <Field label="Début">
              <input
                type="datetime-local"
                value={createDraft.startAt}
                onChange={(e) => setCreateDraft({ ...createDraft, startAt: e.target.value })}
                className="admin-input"
                required
              />
            </Field>
            <Field label="Fin">
              <input
                type="datetime-local"
                value={createDraft.endAt}
                onChange={(e) => setCreateDraft({ ...createDraft, endAt: e.target.value })}
                className="admin-input"
                required
              />
            </Field>
            <Field label="Mode">
              <select
                value={createDraft.executionMode}
                onChange={(e) => setCreateDraft({ ...createDraft, executionMode: e.target.value === 'real' ? 'real' : 'paper' })}
                className="admin-input"
              >
                <option value="paper">Paper trading</option>
                <option value="real">Réel (à venir)</option>
              </select>
            </Field>
            <Field label="Visibilité">
              <label className="flex h-10 items-center gap-2 rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm">
                <input
                  type="checkbox"
                  checked={createDraft.isPublic}
                  onChange={(e) => setCreateDraft({ ...createDraft, isPublic: e.target.checked })}
                  className="h-4 w-4 accent-amber-500"
                />
                Listée publiquement
              </label>
            </Field>

            <PrizeFields
              draft={createDraft.prize}
              onChange={(prize) => setCreateDraft({ ...createDraft, prize })}
            />

            <div className="md:col-span-2 flex justify-end">
              <button
                type="submit"
                disabled={creating}
                className="rounded-lg bg-amber-500 px-6 py-2.5 text-sm font-semibold uppercase tracking-[0.2em] text-black hover:bg-amber-400 disabled:opacity-50"
              >
                {creating ? 'Création…' : 'Créer l\'arène'}
              </button>
            </div>
          </form>
        </section>

        <section>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-rajdhani text-xl font-semibold text-white">Arènes ({sortedCompetitions.length})</h2>
            <button
              type="button"
              onClick={fetchCompetitions}
              className="text-xs uppercase tracking-[0.2em] text-slate-400 hover:text-white"
            >
              {loadingList ? 'Chargement…' : 'Rafraîchir'}
            </button>
          </div>

          {sortedCompetitions.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/40 px-6 py-12 text-center text-sm text-slate-500">
              Aucune arène pour le moment.
            </div>
          ) : (
            <div className="space-y-4">
              {sortedCompetitions.map((competition) => {
                const isEditing = editingId === competition.id;
                const isExpanded = expandedId === competition.id;
                return (
                  <article key={competition.id} className="rounded-2xl border border-slate-800 bg-slate-900/60">
                    <div className="flex flex-col gap-3 p-5 md:flex-row md:items-start md:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          {statusBadge(competition.status)}
                          <h3 className="font-rajdhani text-lg font-semibold text-white">{competition.title}</h3>
                          <span className="rounded-full border border-slate-700 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-slate-400">
                            {competition.code}
                          </span>
                          {!competition.isPublic && (
                            <span className="rounded-full border border-slate-700 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-slate-400">Privée</span>
                          )}
                        </div>
                        <p className="mt-1 text-xs text-slate-400">
                          {formatDate(competition.startAt)} → {formatDate(competition.endAt)}
                        </p>
                        <p className="mt-1 text-xs text-slate-400">
                          {competition.participants} participant{competition.participants > 1 ? 's' : ''}
                          {competition.cashPrize && (
                            <> · Prize pool {competition.cashPrize.total.toLocaleString('en-US')} {competition.cashPrize.currency}</>
                          )}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => setExpandedId(isExpanded ? null : competition.id)}
                          className="rounded-lg border border-slate-700 px-3 py-1.5 text-[11px] uppercase tracking-[0.18em] text-slate-300 hover:border-slate-500 hover:text-white"
                        >
                          {isExpanded ? 'Replier' : 'Participants'}
                        </button>
                        {!isEditing && (
                          <button
                            type="button"
                            onClick={() => startEdit(competition)}
                            className="rounded-lg border border-slate-700 px-3 py-1.5 text-[11px] uppercase tracking-[0.18em] text-slate-300 hover:border-amber-400 hover:text-amber-200"
                          >
                            Modifier
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => deleteCompetition(competition)}
                          className="rounded-lg border border-rose-500/40 px-3 py-1.5 text-[11px] uppercase tracking-[0.18em] text-rose-300 hover:border-rose-400 hover:text-rose-200"
                        >
                          Supprimer
                        </button>
                      </div>
                    </div>

                    {isEditing && editDraft && (
                      <div className="border-t border-slate-800 bg-slate-950/40 p-5">
                        <div className="grid gap-4 md:grid-cols-2">
                          <Field label="Titre">
                            <input
                              type="text"
                              value={editDraft.title}
                              onChange={(e) => setEditDraft({ ...editDraft, title: e.target.value })}
                              className="admin-input"
                            />
                          </Field>
                          <Field label="Code">
                            <input
                              type="text"
                              value={editDraft.code}
                              onChange={(e) => setEditDraft({ ...editDraft, code: e.target.value.toUpperCase() })}
                              className="admin-input"
                            />
                          </Field>
                          <Field label="Début">
                            <input
                              type="datetime-local"
                              value={editDraft.startAt}
                              onChange={(e) => setEditDraft({ ...editDraft, startAt: e.target.value })}
                              className="admin-input"
                            />
                          </Field>
                          <Field label="Fin">
                            <input
                              type="datetime-local"
                              value={editDraft.endAt}
                              onChange={(e) => setEditDraft({ ...editDraft, endAt: e.target.value })}
                              className="admin-input"
                            />
                          </Field>
                          <Field label="Mode">
                            <select
                              value={editDraft.executionMode}
                              onChange={(e) => setEditDraft({ ...editDraft, executionMode: e.target.value === 'real' ? 'real' : 'paper' })}
                              className="admin-input"
                            >
                              <option value="paper">Paper trading</option>
                              <option value="real">Réel (à venir)</option>
                            </select>
                          </Field>
                          <Field label="Visibilité">
                            <label className="flex h-10 items-center gap-2 rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm">
                              <input
                                type="checkbox"
                                checked={editDraft.isPublic}
                                onChange={(e) => setEditDraft({ ...editDraft, isPublic: e.target.checked })}
                                className="h-4 w-4 accent-amber-500"
                              />
                              Listée publiquement
                            </label>
                          </Field>
                          <PrizeFields
                            draft={editDraft.prize}
                            onChange={(prize) => setEditDraft({ ...editDraft, prize })}
                          />
                        </div>
                        <div className="mt-5 flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={cancelEdit}
                            className="rounded-lg border border-slate-700 px-4 py-2 text-xs uppercase tracking-[0.2em] text-slate-300 hover:text-white"
                          >
                            Annuler
                          </button>
                          <button
                            type="button"
                            onClick={() => saveEdit(competition.id)}
                            className="rounded-lg bg-amber-500 px-5 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-black hover:bg-amber-400"
                          >
                            Enregistrer
                          </button>
                        </div>
                      </div>
                    )}

                    {isExpanded && (
                      <div className="border-t border-slate-800 bg-slate-950/40 p-5">
                        {competition.entriesDetailed.length === 0 ? (
                          <p className="text-sm text-slate-500">Aucun participant inscrit pour cette arène.</p>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="w-full min-w-[640px] text-sm">
                              <thead>
                                <tr className="text-left text-[10px] uppercase tracking-[0.18em] text-slate-500">
                                  <th className="px-3 py-2 font-medium">#</th>
                                  <th className="px-3 py-2 font-medium">Joueur</th>
                                  <th className="px-3 py-2 font-medium">Email</th>
                                  <th className="px-3 py-2 font-medium text-right">PnL %</th>
                                  <th className="px-3 py-2 font-medium text-right">PnL USD</th>
                                  <th className="px-3 py-2 font-medium text-right">Trades</th>
                                  <th className="px-3 py-2 font-medium">Inscrit</th>
                                </tr>
                              </thead>
                              <tbody>
                                {[...competition.entriesDetailed]
                                  .sort((a, b) => b.pnlPercent - a.pnlPercent)
                                  .map((entry, idx) => (
                                    <tr key={entry.userId} className="border-t border-slate-800/60">
                                      <td className="px-3 py-2 text-slate-400">{idx + 1}</td>
                                      <td className="px-3 py-2 font-medium text-white">{entry.user?.name || '—'}</td>
                                      <td className="px-3 py-2 text-slate-400">{entry.user?.email || '—'}</td>
                                      <td className={`px-3 py-2 text-right ${entry.pnlPercent > 0 ? 'text-emerald-300' : entry.pnlPercent < 0 ? 'text-rose-300' : 'text-slate-300'}`}>
                                        {formatUsd(entry.pnlPercent)}%
                                      </td>
                                      <td className={`px-3 py-2 text-right ${entry.pnlUsd > 0 ? 'text-emerald-300' : entry.pnlUsd < 0 ? 'text-rose-300' : 'text-slate-300'}`}>
                                        {formatUsd(entry.pnlUsd)}
                                      </td>
                                      <td className="px-3 py-2 text-right text-slate-300">{entry.tradesCount}</td>
                                      <td className="px-3 py-2 text-slate-400">{formatDate(entry.joinedAt)}</td>
                                    </tr>
                                  ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] uppercase tracking-[0.2em] text-slate-500">{label}</span>
      {children}
    </label>
  );
}

function PrizeFields({ draft, onChange }: { draft: PrizeDraft; onChange: (next: PrizeDraft) => void }) {
  return (
    <div className="md:col-span-2 rounded-xl border border-slate-800 bg-slate-950/40 p-4">
      <h3 className="mb-3 text-[11px] uppercase tracking-[0.2em] text-slate-500">Cash prize (optionnel)</h3>
      <div className="grid gap-3 md:grid-cols-5">
        <Field label="Devise">
          <input
            type="text"
            value={draft.currency}
            onChange={(e) => onChange({ ...draft, currency: e.target.value.toUpperCase().slice(0, 6) })}
            className="admin-input"
          />
        </Field>
        <Field label="Total">
          <input
            type="number"
            min={0}
            value={draft.total}
            onChange={(e) => onChange({ ...draft, total: e.target.value })}
            className="admin-input"
            placeholder="auto"
          />
        </Field>
        <Field label="1er">
          <input
            type="number"
            min={0}
            value={draft.first}
            onChange={(e) => onChange({ ...draft, first: e.target.value })}
            className="admin-input"
          />
        </Field>
        <Field label="2ème">
          <input
            type="number"
            min={0}
            value={draft.second}
            onChange={(e) => onChange({ ...draft, second: e.target.value })}
            className="admin-input"
          />
        </Field>
        <Field label="3ème">
          <input
            type="number"
            min={0}
            value={draft.third}
            onChange={(e) => onChange({ ...draft, third: e.target.value })}
            className="admin-input"
          />
        </Field>
      </div>
    </div>
  );
}
