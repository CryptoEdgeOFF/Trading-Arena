import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ARENA_ADMIN_PATH } from '../lib/adminPath';
import EmailAdminPanel from './EmailAdminPanel';

const ADMIN_TOKEN_KEY = 'btf-admin-token';

export default function EmailAdminPage() {
  const [adminToken, setAdminToken] = useState<string>(() => localStorage.getItem(ADMIN_TOKEN_KEY) || '');
  const [adminCode, setAdminCode] = useState('');
  const [loginError, setLoginError] = useState('');

  const adminFetch = useCallback(
    async (url: string, init: RequestInit = {}) => {
      const headers: Record<string, string> = { ...((init.headers as Record<string, string>) || {}) };
      if (adminToken) headers['Authorization'] = `Bearer ${adminToken}`;
      return fetch(url, { ...init, headers });
    },
    [adminToken],
  );

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
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [adminToken]);

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
  }

  if (!adminToken) {
    return (
      <div className="h-dvh overflow-y-auto overflow-x-hidden overscroll-y-auto bg-[#020617] text-slate-100">
        <main className="px-4 py-12">
          <div className="mx-auto w-full max-w-md">
            <Link to="/compete" className="mb-6 inline-flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-slate-400 hover:text-white">
              <span aria-hidden>←</span> Retour à BTF Arena
            </Link>
            <form
              onSubmit={loginAdmin}
              className="rounded-2xl border border-slate-800 bg-slate-900/80 p-7 shadow-2xl"
            >
              <div className="mb-5 flex items-center gap-3">
                <img src="/assets/pictures/logoBTF.webp" alt="BTF" className="h-10 w-10 rounded-lg object-contain" />
                <div>
                  <h1 className="font-rajdhani text-2xl font-bold text-white">Admin Emails</h1>
                  <p className="text-xs text-slate-400">Suivi & configuration des emails</p>
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

  return (
    <div className="h-dvh overflow-y-auto overflow-x-hidden overscroll-y-auto bg-[#020617] text-slate-100">
      <main className="px-4 py-8 pb-16 md:px-8">
        <div className="mx-auto w-full max-w-6xl">
          <header className="mb-8 flex flex-col gap-4 border-b border-slate-800 pb-6 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="mb-2 flex flex-wrap items-center gap-3 text-[11px] uppercase tracking-[0.2em]">
                <Link to="/compete" className="inline-flex items-center gap-2 text-slate-400 hover:text-white">
                  <span aria-hidden>←</span> BTF Arena
                </Link>
                <Link to={ARENA_ADMIN_PATH} className="text-slate-500 hover:text-amber-200">Admin Arènes</Link>
              </div>
              <h1 className="font-rajdhani text-3xl font-bold text-white">Admin Emails</h1>
              <p className="text-sm text-slate-400">Suis les envois, active/bloque les emails et édite les textes.</p>
            </div>
            <button
              type="button"
              onClick={logoutAdmin}
              className="self-start rounded-lg border border-slate-700 px-4 py-2 text-xs uppercase tracking-[0.2em] text-slate-300 hover:border-rose-400 hover:text-rose-300 md:self-auto"
            >
              Déconnexion
            </button>
          </header>

          <EmailAdminPanel adminFetch={adminFetch} />
        </div>
      </main>
    </div>
  );
}
