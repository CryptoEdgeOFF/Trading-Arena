import { useCallback, useEffect, useState } from 'react';

type PoolStats = { max: number | null; total: number; idle: number; waiting: number } | null;

interface Metrics {
  at: number;
  uptimeSec: number;
  serverless: boolean;
  memoryMB: { rss: number; heapUsed: number; heapTotal: number; external: number };
  websockets: {
    total: number;
    paperTraders: number;
    arenaCompetitions: number;
    arenaSockets: number;
    arenaByCompetition: Array<{ competitionId: string; sockets: number }>;
  };
  traders: { tracked: number; active: number; withOpenPositions: number };
  competitions: { total: number; live: number; users: number };
  pools: Record<string, PoolStats>;
}

type AdminFetch = (url: string, init?: RequestInit) => Promise<Response>;

function fmtUptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}j ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-lg font-bold text-white">{value}</div>
      {hint && <div className="text-[10px] text-slate-500">{hint}</div>}
    </div>
  );
}

export default function AdminMetricsPanel({ adminFetch }: { adminFetch: AdminFetch }) {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [auto, setAuto] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await adminFetch('/api/admin/metrics');
      if (!res.ok) throw new Error('Chargement impossible');
      setMetrics(await res.json());
      setError('');
    } catch (err) {
      setError((err as Error)?.message || 'Erreur');
    }
  }, [adminFetch]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!auto) return;
    const t = window.setInterval(load, 5000);
    return () => window.clearInterval(t);
  }, [auto, load]);

  const poolWarn = (p: PoolStats) => Boolean(p && p.waiting > 0);

  return (
    <section className="mb-8 rounded-2xl border border-emerald-400/20 bg-slate-900/60 p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-rajdhani text-xl font-semibold text-white">Monitoring en direct</h2>
          <p className="text-xs text-slate-400">
            Connexions WebSocket, traders actifs et pools Postgres. Surveille pendant la compétition.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-xs text-slate-300">
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} className="h-3.5 w-3.5 accent-emerald-500" />
            Auto 5s
          </label>
          <button onClick={load} className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-700">
            Rafraîchir
          </button>
        </div>
      </div>

      {error && <div className="mb-3 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</div>}

      {!metrics ? (
        <p className="text-sm text-slate-500">Chargement…</p>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            <Stat label="WS total" value={metrics.websockets.total} />
            <Stat label="Traders (arène)" value={metrics.websockets.paperTraders} />
            <Stat label="Arènes suivies" value={metrics.websockets.arenaCompetitions} hint={`${metrics.websockets.arenaSockets} sockets`} />
            <Stat label="Positions ouvertes" value={metrics.traders.withOpenPositions} hint={`${metrics.traders.tracked} suivis`} />
            <Stat label="Arènes live" value={metrics.competitions.live} hint={`${metrics.competitions.total} au total`} />
            <Stat label="Utilisateurs" value={metrics.competitions.users} />
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            <Stat label="RAM (RSS)" value={`${metrics.memoryMB.rss} Mo`} hint={`heap ${metrics.memoryMB.heapUsed}/${metrics.memoryMB.heapTotal}`} />
            <Stat label="Uptime" value={fmtUptime(metrics.uptimeSec)} />
            <Stat label="Mode" value={metrics.serverless ? 'serverless' : 'serveur'} hint={metrics.serverless ? 'pas de minuteur' : 'minuteur actif'} />
          </div>

          <div>
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">Pools Postgres (utilisé / max · en attente)</h3>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              {Object.entries(metrics.pools).map(([name, p]) => (
                <div
                  key={name}
                  className={`rounded-lg border px-3 py-2 ${poolWarn(p) ? 'border-amber-500/50 bg-amber-500/10' : 'border-slate-800 bg-slate-950/50'}`}
                >
                  <div className="text-[10px] uppercase tracking-wide text-slate-500">{name}</div>
                  {p ? (
                    <>
                      <div className="text-sm font-bold text-white">
                        {p.total}/{p.max ?? '?'}
                      </div>
                      <div className={`text-[10px] ${p.waiting > 0 ? 'text-amber-300' : 'text-slate-500'}`}>
                        {p.idle} idle · {p.waiting} en attente
                      </div>
                    </>
                  ) : (
                    <div className="text-sm text-slate-600">—</div>
                  )}
                </div>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-slate-500">
              « En attente &gt; 0 » sur un pool = saturation : augmente la variable d'env correspondante sur Railway.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
