import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { COMPETE_SESSION_KEY } from '../lib/competeSession';
import {
  buildCompeteTradeUrl,
  writePaperBootstrapCache,
  writePaperSessionToken,
} from '../lib/paperSession';

const MINE_CACHE_KEY = 'btf-comp-mine-cache';

export type SwitchableArena = {
  id: string;
  title: string;
  status: 'registration' | 'starting_soon' | 'live' | 'ended';
  startAt: number;
  endAt: number;
  canTrade?: boolean;
  rank?: number | null;
  participants?: number;
  myEntry?: { pnlUsd: number; pnlPercent: number; tradesCount: number };
  executionMode?: 'paper' | 'real';
};

function readMineCache(): SwitchableArena[] {
  try {
    const raw = window.localStorage.getItem(MINE_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function formatClock(ms: number, dayUnit = 'd'): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(total / 86_400);
  const pad = (value: number) => String(value).padStart(2, '0');
  const clock = `${pad(Math.floor((total % 86_400) / 3_600))}h ${pad(Math.floor((total % 3_600) / 60))}m ${pad(total % 60)}s`;
  return days > 0 ? `${days}${dayUnit} ${clock}` : clock;
}

function statusRank(status: SwitchableArena['status']): number {
  if (status === 'live') return 0;
  if (status === 'starting_soon') return 1;
  if (status === 'registration') return 2;
  return 3;
}

function sortArenas(arenas: SwitchableArena[], currentId?: string | null): SwitchableArena[] {
  return [...arenas]
    .filter((arena) => arena.status !== 'ended')
    .sort((a, b) => {
      if (a.id === currentId) return -1;
      if (b.id === currentId) return 1;
      const tradeDelta = Number(Boolean(b.canTrade)) - Number(Boolean(a.canTrade));
      if (tradeDelta) return tradeDelta;
      return statusRank(a.status) - statusRank(b.status) || a.endAt - b.endAt;
    });
}

function statusClass(status: SwitchableArena['status']): string {
  if (status === 'live') return 'text-[#f87171] border-[#dc2626]/40 bg-[#dc2626]/12';
  if (status === 'ended') return 'text-[#8b8498] border-white/10 bg-white/[0.04]';
  return 'text-[#fbbf24] border-[#f59e0b]/35 bg-[#f59e0b]/10';
}

export default function ArenaSwitcher({
  variant,
  currentId,
}: {
  variant: 'page' | 'compact';
  currentId?: string | null;
}) {
  const { t, i18n } = useTranslation();
  const dayUnit = i18n.language.startsWith('fr') ? 'j' : 'd';
  const navigate = useNavigate();
  const [arenas, setArenas] = useState<SwitchableArena[]>(() => readMineCache());
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());
  const [panelPos, setPanelPos] = useState({ top: 0, left: 0 });
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const token = window.localStorage.getItem(COMPETE_SESSION_KEY);
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    void fetch('/api/competition/bootstrap', { headers })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!data) return;
        const mine = Array.isArray(data.myCompetitions) ? data.myCompetitions : [];
        setArenas(mine);
        try {
          window.localStorage.setItem(MINE_CACHE_KEY, JSON.stringify(mine));
        } catch {
          /* ignore quota */
        }
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!open && variant === 'compact') return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [open, variant]);

  useEffect(() => {
    if (!open || variant !== 'compact') return;
    function place() {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(360, window.innerWidth - 24);
      const left = Math.min(Math.max(12, rect.left), window.innerWidth - width - 12);
      setPanelPos({ top: rect.bottom + 8, left });
    }
    function onDown(event: MouseEvent) {
      const target = event.target as Node;
      if (rootRef.current?.contains(target)) return;
      if ((target as HTMLElement).closest?.('[data-arena-switcher-panel]')) return;
      setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, variant]);

  const visible = useMemo(() => sortArenas(arenas, currentId), [arenas, currentId]);
  const current = visible.find((arena) => arena.id === currentId) || visible[0] || null;

  async function openArena(arena: SwitchableArena) {
    if (arena.id === currentId && variant === 'compact') {
      setOpen(false);
      return;
    }
    const token = window.localStorage.getItem(COMPETE_SESSION_KEY);
    if (!token) {
      navigate('/compete');
      return;
    }
    setBusyId(arena.id);
    setError('');
    try {
      const response = await fetch('/api/competition/trade/session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ competitionId: arena.id }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || t('terminal.arenaOpenError'));
      writePaperSessionToken('compete', data.token);
      if (data.player) {
        writePaperBootstrapCache({
          token: data.token,
          player: data.player,
          platform: 'compete',
          competitionId: arena.id,
          competition: data.competition || null,
          market: data.market || null,
          canTrade: typeof data.canTrade === 'boolean' ? data.canTrade : null,
        });
      }
      setOpen(false);
      navigate(buildCompeteTradeUrl({
        id: arena.id,
        title: arena.title,
        executionMode: arena.executionMode,
      }));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : t('terminal.arenaOpenError'));
    } finally {
      setBusyId('');
    }
  }

  function statusLabel(status: SwitchableArena['status']): string {
    if (status === 'live') return t('terminal.arenaLive');
    if (status === 'starting_soon') return t('terminal.arenaSoon');
    if (status === 'registration') return t('terminal.arenaOpen');
    return t('terminal.arenaEnded');
  }

  function clockLabel(arena: SwitchableArena): string {
    if (arena.status === 'ended') return t('terminal.arenaEnded');
    if (arena.status === 'live') return t('terminal.arenaEndsIn', { time: formatClock(arena.endAt - now, dayUnit) });
    return t('terminal.arenaStartsIn', { time: formatClock(arena.startAt - now, dayUnit) });
  }

  function renderCard(arena: SwitchableArena) {
    const active = arena.id === currentId;
    const pnl = arena.myEntry?.pnlUsd;
    const pnlPos = (pnl ?? 0) >= 0;
    return (
      <button
        key={arena.id}
        type="button"
        disabled={Boolean(busyId) || !arena.canTrade}
        onClick={() => void openArena(arena)}
        className={`w-full rounded-xl border px-3.5 py-3 text-left transition-colors ${
          active
            ? 'border-[#dc2626]/55 bg-[#dc2626]/10'
            : 'border-white/[0.08] bg-[#121014] hover:border-white/20'
        } ${!arena.canTrade ? 'opacity-55' : ''}`}
      >
        <div className="flex items-center justify-between gap-3">
          <span className={`inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-[9px] font-black uppercase tracking-[0.14em] ${statusClass(arena.status)}`}>
            {arena.status === 'live' && <i className="h-1.5 w-1.5 rounded-full bg-[#f87171]" />}
            {statusLabel(arena.status)}
          </span>
          <span className="text-[11px] text-[#8b8498]">{clockLabel(arena)}</span>
        </div>
        <strong className="mt-2 block truncate font-['Barlow_Condensed',sans-serif] text-[18px] font-bold uppercase leading-none text-white">
          {arena.title}
        </strong>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[#9a94a3]">
          {arena.rank ? <span>#{arena.rank}</span> : null}
          {typeof pnl === 'number' && (
            <span style={{ color: pnlPos ? '#34d399' : '#fb7185' }}>
              {pnlPos ? '+' : ''}{pnl.toFixed(0)} $
            </span>
          )}
          {typeof arena.participants === 'number' && (
            <span>{t('terminal.arenaTraders', { count: arena.participants })}</span>
          )}
          {active && <span className="text-[#f87171]">{t('terminal.arenaCurrent')}</span>}
          {busyId === arena.id && <span>{t('terminal.arenaOpening')}</span>}
          {!arena.canTrade && arena.status !== 'ended' && <span>{t('terminal.arenaLocked')}</span>}
        </div>
      </button>
    );
  }

  const list = (
    <div className="grid gap-2">
      {visible.length ? visible.map(renderCard) : (
        <div className="rounded-xl border border-white/[0.08] bg-[#121014] px-4 py-6 text-center">
          <p className="text-[13px] text-[#9a94a3]">{t('terminal.arenaEmpty')}</p>
          <a
            href="/compete"
            className="mt-3 inline-flex rounded-lg bg-[#dc2626] px-4 py-2 text-[12px] font-bold uppercase tracking-[0.12em] text-white"
          >
            {t('terminal.arenaJoinCta')}
          </a>
        </div>
      )}
      {error && <p className="text-[12px] text-[#fda4af]">{error}</p>}
    </div>
  );

  if (variant === 'page') {
    return (
      <section className="mx-auto w-full max-w-2xl px-4 py-8 md:py-12">
        <p className="text-[10px] font-black uppercase tracking-[0.22em] text-[#f87171]">{t('terminal.tradingTerminal')}</p>
        <h1 className="mt-2 font-['Barlow_Condensed',sans-serif] text-[42px] font-black uppercase leading-none text-white">
          {t('terminal.pickArena')}
        </h1>
        <p className="mt-3 max-w-md text-[13px] leading-relaxed text-[#8b8498]">{t('terminal.pickArenaLead')}</p>
        <div className="mt-6">{list}</div>
      </section>
    );
  }

  const panel = open ? (
    <div
      data-arena-switcher-panel
      className="fixed z-[80] w-[min(360px,calc(100vw-24px))] rounded-2xl border border-[#2a2236] bg-[#0b0711] p-2 shadow-[0_24px_80px_-30px_rgba(0,0,0,.95)]"
      style={{ top: panelPos.top, left: panelPos.left }}
    >
      <div className="px-2 pb-2 pt-1 text-[9px] font-black uppercase tracking-[0.16em] text-[#8b8498]">
        {t('terminal.switchArena')}
      </div>
      <div className="max-h-[min(420px,60vh)] overflow-y-auto pr-0.5">{list}</div>
    </div>
  ) : null;

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex max-w-[220px] items-center gap-2 rounded-xl border border-[#241e30] bg-[#15121f] px-2.5 py-1.5 text-left transition-colors hover:border-[#dc2626]/45"
      >
        <span className={`mt-px h-1.5 w-1.5 shrink-0 rounded-full ${current?.status === 'live' ? 'bg-[#f87171]' : 'bg-[#fbbf24]'}`} />
        <span className="min-w-0">
          <small className="block text-[8px] font-bold uppercase tracking-[0.14em] text-[#7a8090]">{t('terminal.arenaLabel')}</small>
          <strong className="block truncate font-['Barlow_Condensed',sans-serif] text-[13px] font-bold uppercase leading-none text-white">
            {current?.title || t('terminal.pickArena')}
          </strong>
        </span>
        <span className="ml-auto text-[#7a8090]">{open ? '⌃' : '⌄'}</span>
      </button>
      {typeof document !== 'undefined' ? createPortal(panel, document.body) : panel}
    </div>
  );
}
