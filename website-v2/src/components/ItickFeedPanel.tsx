export type ItickFeedStatus = {
  configured: boolean;
  feed?: {
    connected?: boolean;
    authenticated?: boolean;
    symbols?: string[];
    lastError?: string | null;
    cooldownRemainingMs?: number;
    latest?: Array<{ symbol: string; price: number; ageMs: number }>;
    clusters?: Array<{
      asset: string;
      connected: boolean;
      authenticated: boolean;
      symbols: string[];
    }>;
  };
};

export type ItickInstrument = {
  pair: string;
  asset: string;
  category?: string;
  label?: string;
};

const COPY = {
  compete: {
    body:
      'Les arènes online utilisent iTick pour tous les marchés : crypto (spot Binance via iTick), forex, indices et matières premières. Binance/Kraken ne servent plus que de fallback automatique si iTick est indisponible.',
  },
  live: {
    body:
      'La room live utilise iTick pour alimenter le dashboard et le terminal paper : crypto, forex, indices et matières premières. Binance/Kraken restent un fallback automatique si iTick est indisponible.',
  },
} as const;

export default function ItickFeedPanel({
  status,
  instruments,
  context = 'compete',
}: {
  status: ItickFeedStatus | null;
  instruments: ItickInstrument[];
  context?: keyof typeof COPY;
}) {
  const clusters = status?.feed?.clusters ?? [];
  const connectedClusters = clusters.filter((c) => c.connected && c.authenticated).length;
  const subscribedSymbols = clusters.reduce((acc, c) => acc + (c.symbols?.length ?? 0), 0)
    || status?.feed?.symbols?.length
    || 0;
  const freshTicks = status?.feed?.latest?.filter((t) => t.ageMs < 60_000).length ?? 0;

  let badgeClass = 'border-slate-600 bg-slate-800 text-slate-300';
  let badgeLabel = 'Statut inconnu';
  if (!status?.configured) {
    badgeClass = 'border-rose-500/40 bg-rose-500/10 text-rose-200';
    badgeLabel = 'ITICK_TOKEN absent';
  } else if (connectedClusters > 0) {
    badgeClass = 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200';
    badgeLabel = `Connecté (${connectedClusters} cluster${connectedClusters > 1 ? 's' : ''})`;
  } else if ((status.feed?.cooldownRemainingMs ?? 0) > 0) {
    badgeClass = 'border-amber-500/40 bg-amber-500/10 text-amber-200';
    badgeLabel = 'Cooldown iTick';
  } else {
    badgeClass = 'border-rose-500/40 bg-rose-500/10 text-rose-200';
    badgeLabel = 'Déconnecté';
  }

  const cryptoCount = instruments.filter((i) => i.asset === 'crypto' || i.category === 'crypto').length;
  const macroCount = instruments.length - cryptoCount;

  return (
    <div className="rounded-xl border border-cyan-500/25 bg-cyan-500/5 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.2em] text-cyan-300/80">Source de prix</p>
          <h3 className="mt-1 font-rajdhani text-lg font-semibold text-white">iTick — feed unifié</h3>
        </div>
        <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${badgeClass}`}>
          {badgeLabel}
        </span>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-slate-400">{COPY[context].body}</p>
      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        <div className="rounded-lg border border-slate-700/80 bg-slate-950/60 px-3 py-2">
          <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Instruments</div>
          <div className="mt-1 text-sm font-semibold text-white">{instruments.length || '—'}</div>
          <div className="text-[11px] text-slate-500">{cryptoCount} crypto · {macroCount} macro</div>
        </div>
        <div className="rounded-lg border border-slate-700/80 bg-slate-950/60 px-3 py-2">
          <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Abonnements WS</div>
          <div className="mt-1 text-sm font-semibold text-white">{subscribedSymbols || '—'}</div>
          <div className="text-[11px] text-slate-500">symboles iTick actifs</div>
        </div>
        <div className="rounded-lg border border-slate-700/80 bg-slate-950/60 px-3 py-2">
          <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Ticks récents</div>
          <div className="mt-1 text-sm font-semibold text-white">{freshTicks || '—'}</div>
          <div className="text-[11px] text-slate-500">moins de 60 s</div>
        </div>
      </div>
      {status?.feed?.lastError ? (
        <p className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
          Dernière erreur : {status.feed.lastError}
        </p>
      ) : null}
    </div>
  );
}
