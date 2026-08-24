import { useCallback, useEffect, useState } from 'react';
import type { ArchivedEventSnapshot } from '../stores/useGameStore';
import { formatPnl, formatPercent, formatUSD } from '../utils/formatters';
import { TEAM_MODE_LABEL } from '../utils/teamMode';

type ShowcaseMode = 'podium' | 'stats';

interface ShowcaseRef {
  archiveId: string;
  mode: ShowcaseMode;
}

const MODE_LABELS: Record<string, string> = {
  '1v1': '1 vs 1',
  '1v1v1': '1 vs 1 vs 1',
  '1v1v1v1': '1 vs 1 vs 1 vs 1',
  '4v4': TEAM_MODE_LABEL,
};

/**
 * Section admin pour consulter les compétitions live archivées et choisir
 * quelle archive (podium ou stats détaillées) projeter sur le dashboard
 * lorsqu'aucun round n'est en cours.
 */
export default function EventArchivesAdmin({
  adminFetch,
}: {
  adminFetch: (url: string, init?: RequestInit) => Promise<Response>;
}) {
  const [archives, setArchives] = useState<ArchivedEventSnapshot[]>([]);
  const [showcase, setShowcase] = useState<ShowcaseRef | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch('/api/event/archives');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: { archives: ArchivedEventSnapshot[]; showcase: ShowcaseRef | null } = await res.json();
      setArchives(data.archives ?? []);
      setShowcase(data.showcase ?? null);
    } catch (err) {
      setError((err as Error).message || 'Impossible de charger les archives');
    } finally {
      setLoading(false);
    }
  }, [adminFetch]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function pushShowcase(archiveId: string | null, mode: ShowcaseMode | null) {
    setBusyAction(archiveId ? `${archiveId}:${mode}` : 'clear');
    try {
      const body = archiveId && mode ? { archiveId, mode } : {};
      const res = await adminFetch('/api/event/showcase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await reload();
    } catch (err) {
      setError((err as Error).message || 'Impossible de mettre à jour l\'affichage');
    } finally {
      setBusyAction(null);
    }
  }

  async function deleteArchive(archiveId: string) {
    if (!window.confirm('Supprimer définitivement cette archive ?')) return;
    setBusyAction(`delete:${archiveId}`);
    try {
      const res = await adminFetch(`/api/event/archives/${archiveId}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 404) throw new Error(`HTTP ${res.status}`);
      await reload();
    } catch (err) {
      setError((err as Error).message || 'Impossible de supprimer l\'archive');
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <div className="mb-8 rounded-2xl border border-slate-800 bg-slate-900/80 p-6">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">
            Archives des compétitions
          </p>
          <p className="mt-1 text-sm text-slate-400">
            Chaque round terminé est archivé automatiquement. Choisis ce qui est diffusé
            sur le dashboard quand aucune compétition n'est en cours.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void reload()}
          className="rounded-xl border border-slate-700 px-3 py-2 text-xs uppercase tracking-[0.2em] text-slate-300 transition-colors hover:border-indigo-500/40 hover:text-indigo-300"
        >
          Rafraîchir
        </button>
      </div>

      {error && (
        <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {showcase && (
        <div className="mb-4 flex items-center justify-between gap-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
          <div className="text-sm">
            <span className="text-amber-300">Affichage actif sur le dashboard :</span>{' '}
            <span className="font-semibold text-amber-200">
              {showcase.mode === 'podium' ? 'Podium' : 'Stats détaillées'}
            </span>
          </div>
          <button
            type="button"
            onClick={() => void pushShowcase(null, null)}
            disabled={busyAction === 'clear'}
            className="rounded-lg border border-amber-400/40 px-3 py-1.5 text-xs uppercase tracking-[0.2em] text-amber-200 transition-colors hover:bg-amber-400/15 disabled:opacity-60"
          >
            Masquer
          </button>
        </div>
      )}

      {loading ? (
        <div className="rounded-xl border border-slate-700 bg-slate-950/60 p-8 text-center text-sm text-slate-500">
          Chargement…
        </div>
      ) : archives.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-700 bg-slate-950/40 p-8 text-center text-sm text-slate-500">
          Aucune compétition archivée pour le moment. Lance et stoppe un round pour
          générer ton premier replay.
        </div>
      ) : (
        <div className="space-y-3">
          {archives.map((arch) => (
            <ArchiveRow
              key={arch.id}
              archive={arch}
              isShowcased={showcase?.archiveId === arch.id ? showcase.mode : null}
              expanded={expanded === arch.id}
              onToggle={() => setExpanded((current) => (current === arch.id ? null : arch.id))}
              onShowcase={(mode) => void pushShowcase(arch.id, mode)}
              onDelete={() => void deleteArchive(arch.id)}
              busyAction={busyAction}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ArchiveRow({
  archive,
  isShowcased,
  expanded,
  onToggle,
  onShowcase,
  onDelete,
  busyAction,
}: {
  archive: ArchivedEventSnapshot;
  isShowcased: ShowcaseMode | null;
  expanded: boolean;
  onToggle: () => void;
  onShowcase: (mode: ShowcaseMode) => void;
  onDelete: () => void;
  busyAction: string | null;
}) {
  const date = new Date(archive.finalizedAt);
  const dateStr = date.toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  const timeStr = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const durationMin = Math.round(archive.durationMs / 60000);
  const winner = archive.players[0];
  const winnerLabel = winner
    ? `${winner.name} · ${formatPnl(winner.pnl)}`
    : 'Aucun trader';
  const totalPnl = archive.players.reduce((sum, p) => sum + p.pnl, 0);

  const podiumBusy = busyAction === `${archive.id}:podium`;
  const statsBusy = busyAction === `${archive.id}:stats`;
  const deleteBusy = busyAction === `delete:${archive.id}`;

  return (
    <div className="rounded-xl border border-slate-700 bg-slate-950/40 overflow-hidden">
      <div className="flex flex-wrap items-center gap-4 px-4 py-3">
        <button
          type="button"
          onClick={onToggle}
          className="flex flex-1 min-w-0 items-center gap-3 text-left"
        >
          <span className="display flex h-9 w-9 items-center justify-center rounded-lg border border-slate-700 bg-slate-900 text-sm text-slate-400">
            {expanded ? '▾' : '▸'}
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-white">
              <span className="font-semibold">{dateStr}</span>
              <span className="text-slate-600">·</span>
              <span className="text-slate-400">{timeStr}</span>
              <span className="rounded-full border border-slate-700 bg-slate-900 px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] text-slate-400">
                {MODE_LABELS[archive.eventMode] ?? archive.eventMode}
              </span>
              <span className="rounded-full border border-slate-700 bg-slate-900 px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] text-slate-400">
                {durationMin} min
              </span>
            </div>
            <div className="mt-0.5 truncate text-xs text-slate-500">
              {archive.players.length} traders · gagnant : {winnerLabel} · P&L total{' '}
              <span className={totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                {formatPnl(totalPnl)}
              </span>
            </div>
          </div>
        </button>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onShowcase('podium')}
            disabled={podiumBusy}
            className={`rounded-lg border px-3 py-1.5 text-xs uppercase tracking-[0.2em] transition-colors ${
              isShowcased === 'podium'
                ? 'border-amber-400 bg-amber-400/15 text-amber-200'
                : 'border-slate-700 text-slate-300 hover:border-amber-400/40 hover:text-amber-200'
            } disabled:opacity-50`}
          >
            {isShowcased === 'podium' ? 'Podium ✓' : 'Podium'}
          </button>
          <button
            type="button"
            onClick={() => onShowcase('stats')}
            disabled={statsBusy}
            className={`rounded-lg border px-3 py-1.5 text-xs uppercase tracking-[0.2em] transition-colors ${
              isShowcased === 'stats'
                ? 'border-indigo-400 bg-indigo-400/15 text-indigo-200'
                : 'border-slate-700 text-slate-300 hover:border-indigo-400/40 hover:text-indigo-200'
            } disabled:opacity-50`}
          >
            {isShowcased === 'stats' ? 'Stats ✓' : 'Stats'}
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={deleteBusy}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs uppercase tracking-[0.2em] text-slate-400 transition-colors hover:border-rose-500/40 hover:text-rose-300 disabled:opacity-50"
          >
            Suppr.
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-slate-800 bg-slate-950/70 px-4 py-3">
          <ArchivePlayersTable players={archive.players} />
        </div>
      )}
    </div>
  );
}

function ArchivePlayersTable({ players }: { players: ArchivedEventSnapshot['players'] }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-[0.2em] text-slate-500">
            <th className="px-3 py-2">#</th>
            <th className="px-3 py-2">Trader</th>
            <th className="px-3 py-2 text-right">P&L</th>
            <th className="px-3 py-2 text-right">%</th>
            <th className="px-3 py-2 text-right">Trades</th>
            <th className="px-3 py-2 text-right">Best %</th>
            <th className="px-3 py-2 text-right">Whale</th>
            <th className="px-3 py-2 text-right">Streak</th>
            <th className="px-3 py-2 text-right">Frais</th>
          </tr>
        </thead>
        <tbody>
          {players.map((p) => (
            <tr key={p.id} className="border-t border-slate-800">
              <td className="px-3 py-2 text-slate-500">#{p.rank}</td>
              <td className="px-3 py-2">
                <div className="flex items-center gap-3">
                  {p.avatar ? (
                    <img
                      src={p.avatar}
                      alt={p.name}
                      className="h-7 w-7 rounded-md border border-slate-700 object-cover"
                    />
                  ) : (
                    <div
                      className="flex h-7 w-7 items-center justify-center rounded-md text-xs font-bold text-white"
                      style={{ background: p.color }}
                    >
                      {p.name.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div>
                    <div className="font-semibold text-white">{p.name}</div>
                    <div className="text-[10px] text-slate-500">
                      ${formatUSD(p.initialBalance)} → ${formatUSD(p.currentBalance)}
                    </div>
                  </div>
                </div>
              </td>
              <td className={`px-3 py-2 text-right font-semibold ${p.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {formatPnl(p.pnl)}
              </td>
              <td className={`px-3 py-2 text-right ${p.pnl >= 0 ? 'text-emerald-500/80' : 'text-red-500/80'}`}>
                {formatPercent(p.pnlPercent)}
              </td>
              <td className="px-3 py-2 text-right text-slate-200">{p.tradeCount}</td>
              <td className="px-3 py-2 text-right text-slate-300">
                {p.bestTradePercent > 0 ? `+${p.bestTradePercent.toFixed(1)}%` : '—'}
              </td>
              <td className="px-3 py-2 text-right text-slate-300">
                {p.biggestTradePnl > 0 ? `$${formatUSD(p.biggestTradePnl)}` : '—'}
              </td>
              <td className="px-3 py-2 text-right text-slate-300">{p.winStreak}</td>
              <td className="px-3 py-2 text-right text-slate-500">${formatUSD(p.feesPaid)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
