import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ARENA_ADMIN_PATH, PAYOUTS_ADMIN_PATH } from '../lib/adminPath';

const ADMIN_TOKEN_KEY = 'btf-admin-token';

type PayoutStatus = 'pending' | 'approved';

interface PayoutRequest {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  amount: number;
  currency: string;
  arenaTitle: string | null;
  rank?: number | null;
  status?: PayoutStatus;
  erc20Address?: string | null;
  requestedAt?: number | null;
  approvedAt?: number | null;
}

function fmtDate(ts?: number | null): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function rankLabel(rank?: number | null): string {
  const r = Number(rank);
  if (r === 1) return '1er';
  if (r === 2) return '2e';
  if (r === 3) return '3e';
  if (Number.isFinite(r) && r > 0) return `#${r}`;
  return '—';
}

function formatAmount(amount: number, currency: string): string {
  const cur = String(currency || 'USD').toUpperCase();
  const sym = cur === 'EUR' ? '€' : cur === 'GBP' ? '£' : '$';
  return `${sym}${Number(amount).toLocaleString('fr-FR', { maximumFractionDigits: 2 })}`;
}

export default function PayoutRequestsAdmin() {
  const [adminToken, setAdminToken] = useState<string>(() => localStorage.getItem(ADMIN_TOKEN_KEY) || '');
  const [adminCode, setAdminCode] = useState('');
  const [loginError, setLoginError] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [requests, setRequests] = useState<PayoutRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [approvingId, setApprovingId] = useState<string | null>(null);

  const adminFetch = useCallback(
    async (url: string, init: RequestInit = {}) => {
      const headers: Record<string, string> = { ...((init.headers as Record<string, string>) || {}) };
      if (adminToken) headers.Authorization = `Bearer ${adminToken}`;
      return fetch(url, { ...init, headers });
    },
    [adminToken],
  );

  const fetchRequests = useCallback(async () => {
    if (!adminToken) return;
    setLoading(true);
    setError('');
    try {
      const res = await adminFetch('/api/admin/payout-requests');
      if (res.status === 401) {
        localStorage.removeItem(ADMIN_TOKEN_KEY);
        setAdminToken('');
        return;
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Chargement impossible');
      setRequests(data.requests || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  }, [adminFetch, adminToken]);

  useEffect(() => {
    void fetchRequests();
  }, [fetchRequests]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoginError('');
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: adminCode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Code invalide');
      localStorage.setItem(ADMIN_TOKEN_KEY, data.token);
      setAdminToken(data.token);
      setAdminCode('');
    } catch (err: unknown) {
      setLoginError(err instanceof Error ? err.message : 'Erreur');
    }
  }

  async function approveRequest(id: string) {
    if (!window.confirm('Confirmer que le virement a été effectué ? Un email sera envoyé au joueur.')) return;
    setApprovingId(id);
    setError('');
    setInfo('');
    try {
      const res = await adminFetch(`/api/admin/payout-requests/${id}/approve`, { method: 'PATCH' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Approbation impossible');
      setInfo('Demande approuvée — email de confirmation envoyé au joueur.');
      await fetchRequests();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setApprovingId(null);
    }
  }

  if (!adminToken) {
    return (
      <div className="min-h-dvh-safe bg-slate-950 px-4 py-10 text-slate-200">
        <div className="mx-auto max-w-md rounded-2xl border border-slate-800 bg-slate-900/80 p-6">
          <h1 className="font-rajdhani text-2xl font-bold text-white">Admin — Payout requests</h1>
          <form onSubmit={handleLogin} className="mt-6 space-y-4">
            <input
              type="password"
              value={adminCode}
              onChange={(e) => setAdminCode(e.target.value)}
              placeholder="Code admin"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
            />
            {loginError && <p className="text-sm text-red-400">{loginError}</p>}
            <button type="submit" className="w-full rounded-lg bg-red-600 px-4 py-2 font-semibold text-white hover:bg-red-500">
              Connexion
            </button>
          </form>
        </div>
      </div>
    );
  }

  const pendingCount = requests.filter((r) => r.status === 'pending').length;

  return (
    <div className="min-h-dvh-safe bg-slate-950 px-4 py-8 text-slate-200 md:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-rajdhani text-3xl font-bold text-white">Demandes de payout</h1>
            <p className="mt-1 text-sm text-slate-400">
              {pendingCount} en attente · {requests.length} au total
            </p>
          </div>
          <div className="flex flex-wrap gap-3 text-sm">
            <Link to={ARENA_ADMIN_PATH} className="text-slate-500 hover:text-amber-200">
              Admin Arènes
            </Link>
            <Link to={PAYOUTS_ADMIN_PATH} className="text-slate-500 hover:text-amber-200">
              Admin Certificats
            </Link>
          </div>
        </div>

        {error && <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>}
        {info && <div className="mb-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{info}</div>}

        {loading ? (
          <p className="text-slate-400">Chargement…</p>
        ) : requests.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/50 px-6 py-16 text-center text-slate-500">
            Aucune demande de payout pour le moment.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-slate-800">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-slate-800 bg-slate-900/80 text-xs uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-3">Joueur</th>
                  <th className="px-4 py-3">Arène</th>
                  <th className="px-4 py-3">Place</th>
                  <th className="px-4 py-3">Montant</th>
                  <th className="px-4 py-3">Adresse ERC20</th>
                  <th className="px-4 py-3">Statut</th>
                  <th className="px-4 py-3">Demandé</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {requests.map((req) => (
                  <tr key={req.id} className="border-b border-slate-800/80 hover:bg-slate-900/40">
                    <td className="px-4 py-3">
                      <div className="font-medium text-white">{req.userName}</div>
                      <div className="text-xs text-slate-500">{req.userEmail}</div>
                    </td>
                    <td className="px-4 py-3">{req.arenaTitle || '—'}</td>
                    <td className="px-4 py-3">{rankLabel(req.rank)}</td>
                    <td className="px-4 py-3 font-semibold text-emerald-400">{formatAmount(req.amount, req.currency)}</td>
                    <td className="max-w-[200px] truncate px-4 py-3 font-mono text-xs text-slate-300" title={req.erc20Address || ''}>
                      {req.erc20Address || '—'}
                    </td>
                    <td className="px-4 py-3">
                      {req.status === 'pending' ? (
                        <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-300">Pending</span>
                      ) : (
                        <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold text-emerald-300">Approved</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">{fmtDate(req.requestedAt)}</td>
                    <td className="px-4 py-3">
                      {req.status === 'pending' && (
                        <button
                          type="button"
                          disabled={approvingId === req.id}
                          onClick={() => void approveRequest(req.id)}
                          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-white hover:bg-emerald-500 disabled:opacity-50"
                        >
                          {approvingId === req.id ? '…' : 'Approuver'}
                        </button>
                      )}
                      {req.status === 'approved' && req.approvedAt && (
                        <span className="text-xs text-slate-500">{fmtDate(req.approvedAt)}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
