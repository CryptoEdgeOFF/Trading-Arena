import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ARENA_ADMIN_PATH, PAYOUT_REQUESTS_ADMIN_PATH } from '../lib/adminPath';
import PayoutCertificate from './PayoutCertificate';

const ADMIN_TOKEN_KEY = 'btf-admin-token';

interface PayoutUser {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
}

interface AdminPayout {
  id: string;
  userId: string;
  amount: number;
  currency: string;
  paidAt: number;
  createdAt: number;
  userName: string;
  userEmail: string;
  source?: 'auto' | 'manual';
  rank?: number | null;
  arenaTitle?: string | null;
}

const CURRENCY_OPTIONS = ['USD', 'EUR', 'GBP'];

function todayInput(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function PayoutsAdmin() {
  const [adminToken, setAdminToken] = useState<string>(() => localStorage.getItem(ADMIN_TOKEN_KEY) || '');
  const [adminCode, setAdminCode] = useState('');
  const [loginError, setLoginError] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const [payouts, setPayouts] = useState<AdminPayout[]>([]);
  const [loading, setLoading] = useState(false);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PayoutUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedUser, setSelectedUser] = useState<PayoutUser | null>(null);

  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [dateStr, setDateStr] = useState(todayInput());
  const [creating, setCreating] = useState(false);

  const adminFetch = useCallback(
    async (url: string, init: RequestInit = {}) => {
      const headers: Record<string, string> = { ...((init.headers as Record<string, string>) || {}) };
      if (adminToken) headers['Authorization'] = `Bearer ${adminToken}`;
      return fetch(url, { ...init, headers });
    },
    [adminToken],
  );

  const fetchPayouts = useCallback(async () => {
    if (!adminToken) return;
    setLoading(true);
    try {
      const res = await adminFetch('/api/admin/payouts');
      if (res.status === 401) {
        localStorage.removeItem(ADMIN_TOKEN_KEY);
        setAdminToken('');
        return;
      }
      const data = await res.json();
      setPayouts(data.payouts || []);
    } catch (err: any) {
      setError(err.message || 'Chargement impossible');
    } finally {
      setLoading(false);
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
        fetchPayouts();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [adminToken, fetchPayouts]);

  // Recherche de joueurs (debounce léger).
  useEffect(() => {
    if (!adminToken || selectedUser) return;
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const handle = setTimeout(async () => {
      try {
        const res = await adminFetch(`/api/admin/payout-users?q=${encodeURIComponent(q)}`);
        const data = await res.json().catch(() => ({}));
        if (!cancelled) setResults(data.users || []);
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [query, adminFetch, adminToken, selectedUser]);

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
    setPayouts([]);
  }

  function resetForm() {
    setSelectedUser(null);
    setQuery('');
    setResults([]);
    setAmount('');
    setCurrency('USD');
    setDateStr(todayInput());
  }

  async function createPayout(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setInfo('');
    if (!selectedUser) {
      setError('Sélectionne un joueur');
      return;
    }
    const amountNum = Number(amount);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      setError('Montant invalide');
      return;
    }
    const paidAt = dateStr ? new Date(`${dateStr}T12:00:00Z`).getTime() : Date.now();
    setCreating(true);
    try {
      const res = await adminFetch('/api/admin/payouts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: selectedUser.id, amount: amountNum, currency, paidAt }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Création impossible');
      setInfo('Payout créé');
      resetForm();
      await fetchPayouts();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  }

  async function deletePayout(id: string, name: string) {
    if (!window.confirm(`Supprimer le payout de « ${name} » ?`)) return;
    setError('');
    setInfo('');
    try {
      const res = await adminFetch(`/api/admin/payouts/${id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Suppression impossible');
      setInfo('Payout supprimé');
      await fetchPayouts();
    } catch (err: any) {
      setError(err.message);
    }
  }

  if (!adminToken) {
    return (
      <div className="h-dvh overflow-y-auto overflow-x-hidden overscroll-y-auto bg-[#020617] text-slate-100">
        <main className="px-4 py-12">
          <div className="mx-auto w-full max-w-md">
            <Link to="/compete" className="mb-6 inline-flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-slate-400 hover:text-white">
              <span aria-hidden>←</span> Retour à BTF Arena
            </Link>
            <form onSubmit={loginAdmin} className="rounded-2xl border border-slate-800 bg-slate-900/80 p-7 shadow-2xl">
              <div className="mb-5 flex items-center gap-3">
                <img src="/assets/pictures/logoBTF.webp" alt="BTF" className="h-10 w-10 rounded-lg object-contain" />
                <div>
                  <h1 className="font-rajdhani text-2xl font-bold text-white">Admin Payouts</h1>
                  <p className="text-xs text-slate-400">Certificats de gains des joueurs</p>
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
      </div>
    );
  }

  const previewAmount = Number(amount) || 0;
  const previewPaidAt = dateStr ? new Date(`${dateStr}T12:00:00Z`).getTime() : Date.now();

  return (
    <div className="h-dvh overflow-y-auto overflow-x-hidden overscroll-y-auto bg-[#020617] text-slate-100">
      <main className="px-4 py-8 pb-16 md:px-8">
        <div className="mx-auto w-full max-w-5xl">
          <header className="mb-8 flex flex-col gap-4 border-b border-slate-800 pb-6 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="mb-2 flex flex-wrap items-center gap-3 text-[11px] uppercase tracking-[0.2em]">
                <Link to="/compete" className="inline-flex items-center gap-2 text-slate-400 hover:text-white">
                  <span aria-hidden>←</span> BTF Arena
                </Link>
                <Link to={ARENA_ADMIN_PATH} className="text-slate-500 hover:text-amber-200">Admin Arènes</Link>
                <Link to={PAYOUT_REQUESTS_ADMIN_PATH} className="text-slate-500 hover:text-amber-200">Payout Requests</Link>
              </div>
              <h1 className="font-rajdhani text-3xl font-bold text-white">Admin Payouts</h1>
              <p className="text-sm text-slate-400">Attribue un certificat de payout à un joueur (affiché sur son profil public).</p>
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

          {/* Création */}
          <section className="mb-8 grid gap-6 rounded-2xl border border-slate-800 bg-slate-900/60 p-6 md:grid-cols-[1fr_320px]">
            <div>
              <h2 className="font-rajdhani text-xl font-semibold text-white">Nouveau payout</h2>
              <p className="mb-5 text-xs text-slate-400">Recherche un joueur, saisis le montant et la date.</p>
              <form onSubmit={createPayout} className="space-y-5">
                {/* Joueur */}
                <div>
                  <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Joueur *</span>
                  {selectedUser ? (
                    <div className="flex items-center justify-between gap-3 rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-2.5">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-white">{selectedUser.name}</div>
                        <div className="truncate text-[11px] text-slate-400">{selectedUser.email}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => { setSelectedUser(null); setQuery(''); }}
                        className="shrink-0 rounded-md border border-slate-600 px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-slate-300 hover:border-rose-400 hover:text-rose-300"
                      >
                        Changer
                      </button>
                    </div>
                  ) : (
                    <div className="relative">
                      <input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Nom ou email du joueur…"
                        className="admin-input"
                        autoComplete="off"
                      />
                      {(searching || results.length > 0) && query.trim().length >= 2 && (
                        <div className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-slate-700 bg-slate-950 shadow-xl">
                          {searching && results.length === 0 ? (
                            <div className="px-3 py-2.5 text-xs text-slate-500">Recherche…</div>
                          ) : results.length === 0 ? (
                            <div className="px-3 py-2.5 text-xs text-slate-500">Aucun joueur</div>
                          ) : (
                            results.map((u) => (
                              <button
                                key={u.id}
                                type="button"
                                onClick={() => { setSelectedUser(u); setResults([]); }}
                                className="flex w-full items-center gap-3 border-b border-slate-800/60 px-3 py-2.5 text-left last:border-0 hover:bg-slate-800/60"
                              >
                                <div className="h-8 w-8 shrink-0 overflow-hidden rounded-full border border-slate-700 bg-slate-800">
                                  {u.avatarUrl && <img src={u.avatarUrl} alt="" className="h-full w-full object-cover" />}
                                </div>
                                <div className="min-w-0">
                                  <div className="truncate text-sm text-white">{u.name}</div>
                                  <div className="truncate text-[11px] text-slate-400">{u.email}</div>
                                </div>
                              </button>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Montant *</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="100"
                      className="admin-input"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Devise</span>
                    <select value={currency} onChange={(e) => setCurrency(e.target.value)} className="admin-input">
                      {CURRENCY_OPTIONS.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </label>
                </div>

                <label className="block">
                  <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Date</span>
                  <input
                    type="date"
                    value={dateStr}
                    onChange={(e) => setDateStr(e.target.value)}
                    className="admin-input"
                  />
                </label>

                <button
                  type="submit"
                  disabled={creating}
                  className="rounded-lg bg-amber-500 px-5 py-2.5 text-sm font-semibold uppercase tracking-[0.18em] text-black hover:bg-amber-400 disabled:opacity-50"
                >
                  {creating ? 'Création…' : 'Créer le payout'}
                </button>
              </form>
            </div>

            {/* Aperçu */}
            <div>
              <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Aperçu</span>
              <PayoutCertificate
                data={{
                  name: selectedUser?.name || 'NOM',
                  amount: previewAmount,
                  currency,
                  paidAt: previewPaidAt,
                }}
                className="overflow-hidden rounded-xl border border-slate-800"
              />
            </div>
          </section>

          {/* Liste */}
          <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="font-rajdhani text-xl font-semibold text-white">Payouts ({payouts.length})</h2>
              {loading && <span className="text-xs text-slate-500">Chargement…</span>}
            </div>

            {payouts.length === 0 && !loading ? (
              <p className="rounded-xl border border-dashed border-slate-700 px-4 py-8 text-center text-sm text-slate-500">
                Aucun payout. Crée le premier ci-dessus.
              </p>
            ) : (
              <div className="space-y-3">
                {payouts.map((p) => (
                  <div key={p.id} className="flex flex-wrap items-center gap-4 rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-white">{p.userName}</span>
                        <span className="rounded-full border border-slate-700 px-2 py-0.5 text-[10px] text-slate-400">{p.userEmail}</span>
                        {p.source === 'auto' ? (
                          <span className="rounded-full border border-sky-400/40 bg-sky-400/10 px-2 py-0.5 text-[9px] uppercase tracking-[0.14em] text-sky-200">
                            Auto{p.rank ? ` · #${p.rank}` : ''}
                          </span>
                        ) : (
                          <span className="rounded-full border border-slate-700 px-2 py-0.5 text-[9px] uppercase tracking-[0.14em] text-slate-400">Manuel</span>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-slate-400">
                        {p.arenaTitle && <span className="text-slate-500">{p.arenaTitle} · </span>}
                        <Link to={`/compete/player/${p.userId}`} className="text-amber-200/80 hover:underline">Voir le profil ↗</Link>
                      </p>
                    </div>
                    <div className="text-right">
                      <div className="num text-lg font-bold text-emerald-400">
                        {new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(p.amount)} {p.currency}
                      </div>
                      <div className="text-[11px] text-slate-500">{fmtDate(p.paidAt)}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => deletePayout(p.id, p.userName)}
                      className="shrink-0 rounded-lg border border-slate-700 px-3 py-1.5 text-[11px] uppercase tracking-[0.14em] text-slate-400 hover:border-rose-400 hover:text-rose-300"
                    >
                      Suppr.
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
