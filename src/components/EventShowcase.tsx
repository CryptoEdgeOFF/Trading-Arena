import { motion } from 'framer-motion';
import type {
  ArchivedEventSnapshot,
  ArchivedPlayerSnapshot,
  ShowcasePayload,
  TeamInfo,
} from '../stores/useGameStore';
import { formatPnl, formatPercent, formatUSD } from '../utils/formatters';
import { TEAM_MODE_LABEL } from '../utils/teamMode';

const MODE_LABELS: Record<string, string> = {
  '1v1': '1 vs 1',
  '1v1v1': '1 vs 1 vs 1',
  '1v1v1v1': '1 vs 1 vs 1 vs 1',
  '4v4': TEAM_MODE_LABEL,
};

interface TeamGroup {
  team: TeamInfo;
  players: ArchivedPlayerSnapshot[];
  totalPnl: number;
  avgPnlPercent: number;
}

/** Regroupe les joueurs archivés par équipe, classés par P&L total décroissant. */
function buildTeamGroups(archive: ArchivedEventSnapshot): TeamGroup[] | null {
  if (archive.eventMode !== '4v4' || !archive.teams) return null;
  const byId = new Map(archive.players.map((p) => [p.id, p]));
  const groups = archive.teams.map((team) => {
    const players = team.playerIds
      .map((id) => byId.get(id))
      .filter(Boolean) as ArchivedPlayerSnapshot[];
    const totalPnl = players.reduce((sum, p) => sum + p.pnl, 0);
    const avgPnlPercent = players.length
      ? players.reduce((sum, p) => sum + p.pnlPercent, 0) / players.length
      : 0;
    return { team, players, totalPnl, avgPnlPercent };
  });
  return groups.sort((a, b) => b.totalPnl - a.totalPnl);
}

/**
 * Overlay plein écran diffusé sur le dashboard quand aucun round n'est en
 * cours et que l'admin a sélectionné une archive à montrer (podium ou stats).
 */
export default function EventShowcase({ payload }: { payload: ShowcasePayload }) {
  const { mode, archive } = payload;
  const teamGroups = buildTeamGroups(archive);

  return (
    <div className="relative flex-1 overflow-hidden">
      {/* Background glow */}
      <div className="pointer-events-none absolute inset-0" style={{
        background:
          'radial-gradient(900px 500px at 50% 20%, rgba(245,179,0,0.12), transparent 60%),' +
          'radial-gradient(700px 400px at 50% 110%, rgba(220,38,38,0.18), transparent 65%)',
      }} />

      <div className="relative h-full overflow-y-auto px-8 py-6 scrollbar-hide">
        <ShowcaseHeader archive={archive} />
        {teamGroups ? (
          mode === 'podium' ? (
            <TeamPodiumView groups={teamGroups} />
          ) : (
            <TeamStatsView groups={teamGroups} />
          )
        ) : mode === 'podium' ? (
          <PodiumView archive={archive} />
        ) : (
          <StatsView archive={archive} />
        )}
      </div>
    </div>
  );
}

function ShowcaseHeader({ archive }: { archive: ArchivedEventSnapshot }) {
  const finalized = new Date(archive.finalizedAt);
  const dateStr = finalized.toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
  const timeStr = finalized.toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  });
  const durationMin = Math.round(archive.durationMs / 60000);

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="mb-8 text-center"
    >
      <div className="micro mb-2 text-base tracking-[0.42em] text-red-300/80">
        BREAKOUT TRADING FIGHT — REPLAY
      </div>
      <h2 className="display text-5xl font-bold text-white tracking-[0.04em]">
        {dateStr.toUpperCase()} <span className="text-red-500">·</span> {timeStr}
      </h2>
      <div className="mt-3 inline-flex items-center gap-3 rounded-full border border-white/10 bg-black/40 px-4 py-1.5 text-xs uppercase tracking-[0.32em] text-zinc-400">
        <span>{MODE_LABELS[archive.eventMode] ?? archive.eventMode}</span>
        <span className="text-zinc-700">·</span>
        <span>{archive.players.length} traders</span>
        <span className="text-zinc-700">·</span>
        <span>{durationMin} min</span>
      </div>
    </motion.div>
  );
}

/* ---------------- Podium par équipe (mode 5v5) ---------------- */

function TeamPodiumView({ groups }: { groups: TeamGroup[] }) {
  const [winner, runnerUp] = groups;
  if (!winner) return null;

  return (
    <div className="mx-auto max-w-[1280px]">
      {/* Bannière équipe gagnante */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 180, damping: 20 }}
        className="relative overflow-hidden rounded-3xl border p-8 text-center"
        style={{
          borderColor: `${winner.team.color}80`,
          background: `
            radial-gradient(700px 280px at 50% 0%, ${winner.team.color}33, transparent 65%),
            linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01)),
            #08080c
          `,
          boxShadow: `0 40px 120px -30px ${winner.team.color}99, inset 0 1px 0 rgba(255,255,255,0.06)`,
        }}
      >
        <div
          className="absolute top-0 left-0 right-0 h-[4px]"
          style={{ background: `linear-gradient(90deg, transparent, ${winner.team.color}, transparent)` }}
        />
        <div
          className="display mb-2 text-sm font-bold uppercase tracking-[0.4em]"
          style={{ color: winner.team.color, textShadow: `0 0 24px ${winner.team.color}aa` }}
        >
          ★ Équipe victorieuse ★
        </div>
        <h2
          className="display text-6xl font-bold uppercase tracking-[0.04em] text-white"
          style={{ textShadow: `0 0 50px ${winner.team.color}80` }}
        >
          {winner.team.name.trim() || 'Équipe 1'}
        </h2>
        <div className="mt-4 inline-flex items-center gap-4">
          <div
            className={`num text-5xl font-bold tabular-nums leading-none ${
              winner.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'
            }`}
            style={{
              textShadow: winner.totalPnl >= 0
                ? '0 0 32px rgba(16,185,129,0.45)'
                : '0 0 32px rgba(239,68,68,0.45)',
            }}
          >
            {formatPnl(winner.totalPnl)}
          </div>
          <div className="text-left">
            <div className="micro text-[9px] text-zinc-500">P&L cumulé</div>
            <div className={`num text-sm ${winner.avgPnlPercent >= 0 ? 'text-emerald-500/80' : 'text-red-500/80'}`}>
              {formatPercent(winner.avgPnlPercent)} moy.
            </div>
          </div>
        </div>
      </motion.div>

      {/* Cartes des 5 membres de l'équipe gagnante */}
      <div className="mt-6 grid grid-cols-5 gap-3">
        {winner.players.map((player, idx) => (
          <TeamMemberCard
            key={player.id}
            player={player}
            color={winner.team.color}
            index={idx}
            highlight
          />
        ))}
      </div>

      {/* Équipe adverse */}
      {runnerUp && (
        <div className="mt-8">
          <div className="mb-3 flex items-center gap-3">
            <span className="h-3 w-3 rounded-full" style={{ background: runnerUp.team.color }} />
            <span className="display text-lg font-bold uppercase tracking-[0.12em] text-zinc-300">
              {runnerUp.team.name.trim() || 'Équipe 2'}
            </span>
            <span
              className={`num text-base font-bold ${runnerUp.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}
            >
              {formatPnl(runnerUp.totalPnl)}
            </span>
            <span className="num text-xs text-zinc-500">{formatPercent(runnerUp.avgPnlPercent)} moy.</span>
          </div>
          <div className="grid grid-cols-5 gap-3">
            {runnerUp.players.map((player, idx) => (
              <TeamMemberCard
                key={player.id}
                player={player}
                color={runnerUp.team.color}
                index={idx}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TeamMemberCard({
  player,
  color,
  index,
  highlight = false,
}: {
  player: ArchivedPlayerSnapshot;
  color: string;
  index: number;
  highlight?: boolean;
}) {
  const isPositive = player.pnl >= 0;
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.15 + index * 0.08, type: 'spring', stiffness: 200, damping: 22 }}
      className="relative flex flex-col items-center rounded-2xl border bg-gradient-to-b from-white/[0.04] to-white/[0.01] p-4 text-center backdrop-blur"
      style={{
        borderColor: highlight ? `${color}66` : 'rgba(255,255,255,0.08)',
        boxShadow: highlight ? `0 18px 50px -22px ${color}aa` : 'none',
      }}
    >
      <div
        className="mb-3 overflow-hidden rounded-2xl border-2"
        style={{ width: 72, height: 72, borderColor: color }}
      >
        {player.avatar ? (
          <img src={player.avatar} alt={player.name} className="h-full w-full object-cover" />
        ) : (
          <div
            className="flex h-full w-full items-center justify-center display text-3xl font-bold text-white"
            style={{ background: player.color }}
          >
            {player.name.charAt(0).toUpperCase()}
          </div>
        )}
      </div>
      <div className="display w-full truncate text-base font-bold text-white">{player.name}</div>
      <div className="micro mt-0.5 text-[9px] text-zinc-500">
        {player.tradeCount} trade{player.tradeCount > 1 ? 's' : ''}
      </div>
      <div
        className={`num mt-2 text-2xl font-bold tabular-nums leading-none ${
          isPositive ? 'text-emerald-400' : 'text-red-400'
        }`}
        style={{
          textShadow: isPositive
            ? '0 0 20px rgba(16,185,129,0.35)'
            : '0 0 20px rgba(239,68,68,0.35)',
        }}
      >
        {formatPnl(player.pnl)}
      </div>
      <div className={`num text-xs ${isPositive ? 'text-emerald-500/80' : 'text-red-500/80'}`}>
        {formatPercent(player.pnlPercent)}
      </div>
    </motion.div>
  );
}

/* ---------------- Stats par équipe (mode 5v5) ---------------- */

function TeamStatsView({ groups }: { groups: TeamGroup[] }) {
  const allPlayers = groups.flatMap((g) => g.players);
  const totalTrades = allPlayers.reduce((sum, p) => sum + p.tradeCount, 0);
  const totalFees = allPlayers.reduce((sum, p) => sum + p.feesPaid, 0);
  const winners = allPlayers.filter((p) => p.pnl > 0).length;
  const totalPnl = allPlayers.reduce((sum, p) => sum + p.pnl, 0);

  return (
    <div className="mx-auto max-w-[1280px]">
      <div className="grid grid-cols-4 gap-3 mb-6">
        <Aggregate label="P&L total" value={formatPnl(totalPnl)} accent={totalPnl >= 0 ? 'pos' : 'neg'} />
        <Aggregate label="Trades exécutés" value={totalTrades.toString()} />
        <Aggregate label="Frais cumulés" value={`$${formatUSD(totalFees)}`} />
        <Aggregate label="Traders gagnants" value={`${winners} / ${allPlayers.length}`} />
      </div>

      <div className="space-y-5">
        {groups.map((group, gIdx) => (
          <div
            key={group.team.name + gIdx}
            className="rounded-2xl border bg-black/40 backdrop-blur overflow-hidden"
            style={{ borderColor: `${group.team.color}55` }}
          >
            {/* En-tête équipe */}
            <div
              className="flex items-center gap-3 px-5 py-3"
              style={{ background: `linear-gradient(90deg, ${group.team.color}22, transparent 70%)` }}
            >
              <span className="h-3 w-3 rounded-full" style={{ background: group.team.color, boxShadow: `0 0 12px ${group.team.color}` }} />
              <span className="display text-lg font-bold uppercase tracking-[0.1em] text-white">
                {group.team.name.trim() || `Équipe ${gIdx + 1}`}
              </span>
              {gIdx === 0 && (
                <span
                  className="display rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.15em]"
                  style={{ background: group.team.color, color: '#0a0a0e' }}
                >
                  Vainqueur
                </span>
              )}
              <div className="ml-auto flex items-center gap-3">
                <span className={`num text-xl font-bold ${group.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {formatPnl(group.totalPnl)}
                </span>
                <span className={`num text-xs ${group.avgPnlPercent >= 0 ? 'text-emerald-500/70' : 'text-red-500/70'}`}>
                  {formatPercent(group.avgPnlPercent)} moy.
                </span>
              </div>
            </div>

            <div className="grid grid-cols-12 gap-3 px-5 py-2 border-y border-white/10 text-[10px] uppercase tracking-[0.32em] text-zinc-500">
              <div className="col-span-4">Trader</div>
              <div className="col-span-2 text-right">P&L</div>
              <div className="col-span-2 text-right">%</div>
              <div className="col-span-2 text-right">Trades</div>
              <div className="col-span-2 text-right">Frais</div>
            </div>

            {[...group.players]
              .sort((a, b) => b.pnl - a.pnl)
              .map((p, idx) => (
                <motion.div
                  key={p.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.03 }}
                  className="grid grid-cols-12 gap-3 px-5 py-3 items-center border-b border-white/5 last:border-b-0"
                >
                  <div className="col-span-4 flex items-center gap-3 min-w-0">
                    <PlayerThumb player={p} size={36} />
                    <div className="min-w-0">
                      <div className="display text-sm font-bold text-white truncate">{p.name}</div>
                      <div className="num text-[10px] text-zinc-500">
                        ${formatUSD(p.initialBalance)} → ${formatUSD(p.currentBalance)}
                      </div>
                    </div>
                  </div>
                  <div className={`col-span-2 num text-right font-bold ${p.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {formatPnl(p.pnl)}
                  </div>
                  <div className={`col-span-2 num text-right ${p.pnl >= 0 ? 'text-emerald-500/80' : 'text-red-500/80'}`}>
                    {formatPercent(p.pnlPercent)}
                  </div>
                  <div className="col-span-2 num text-right text-white">{p.tradeCount}</div>
                  <div className="col-span-2 num text-right text-zinc-500">${formatUSD(p.feesPaid)}</div>
                </motion.div>
              ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------- Podium ---------------- */

function PodiumView({ archive }: { archive: ArchivedEventSnapshot }) {
  const podium = archive.players.slice(0, 3);
  const others = archive.players.slice(3);
  const order: Array<{ player: ArchivedPlayerSnapshot | undefined; rank: 1 | 2 | 3 }> = [
    { player: podium[1], rank: 2 },
    { player: podium[0], rank: 1 },
    { player: podium[2], rank: 3 },
  ];

  return (
    <div className="mx-auto max-w-[1180px]">
      <div className="grid grid-cols-3 gap-5 items-end">
        {order.map(({ player, rank }, idx) => {
          if (!player) return <div key={idx} />;
          return <PodiumCard key={player.id} player={player} rank={rank} index={idx} />;
        })}
      </div>

      {others.length > 0 && (
        <div className="mt-10">
          <div className="micro mb-3 text-sm text-zinc-500 tracking-[0.32em]">Suivants</div>
          <div className="rounded-2xl border border-white/10 bg-black/40 backdrop-blur divide-y divide-white/5">
            {others.map((p, i) => (
              <div key={p.id} className="flex items-center gap-4 px-5 py-3">
                <span className="display num text-2xl font-bold text-zinc-500 w-10 text-center">
                  {i + 4}
                </span>
                <PlayerThumb player={p} size={40} />
                <div className="flex-1 min-w-0">
                  <div className="display text-lg font-bold text-white truncate">{p.name}</div>
                  <div className="num text-[11px] text-zinc-500">
                    {p.tradeCount} trade{p.tradeCount > 1 ? 's' : ''} · ${formatUSD(p.currentBalance)}
                  </div>
                </div>
                <div className="text-right">
                  <div className={`num font-bold ${p.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {formatPnl(p.pnl)}
                  </div>
                  <div className={`num text-[11px] ${p.pnl >= 0 ? 'text-emerald-500/70' : 'text-red-500/70'}`}>
                    {formatPercent(p.pnlPercent)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PodiumCard({
  player,
  rank,
  index,
}: {
  player: ArchivedPlayerSnapshot;
  rank: 1 | 2 | 3;
  index: number;
}) {
  const isPositive = player.pnl >= 0;
  const theme = {
    1: {
      label: 'CHAMPION',
      from: '#fde68a',
      to: '#b45309',
      border: 'rgba(245,179,0,0.55)',
      heightClass: 'min-h-[420px]',
      avatarSize: 132,
      glow: '0 30px 80px -10px rgba(245,179,0,0.55)',
      pnlSize: '54px',
    },
    2: {
      label: '2ND',
      from: '#e2e8f0',
      to: '#64748b',
      border: 'rgba(203,213,225,0.45)',
      heightClass: 'min-h-[360px]',
      avatarSize: 108,
      glow: '0 20px 60px -16px rgba(203,213,225,0.4)',
      pnlSize: '42px',
    },
    3: {
      label: '3RD',
      from: '#fbbf24',
      to: '#7c2d12',
      border: 'rgba(194,114,74,0.45)',
      heightClass: 'min-h-[340px]',
      avatarSize: 100,
      glow: '0 20px 60px -16px rgba(194,114,74,0.4)',
      pnlSize: '40px',
    },
  }[rank];

  return (
    <motion.div
      initial={{ opacity: 0, y: 40 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.15 + index * 0.12, type: 'spring', stiffness: 180, damping: 22 }}
      className={`relative flex flex-col items-center text-center rounded-3xl border bg-gradient-to-b from-white/[0.04] to-white/[0.01] backdrop-blur p-6 ${theme.heightClass}`}
      style={{ borderColor: theme.border, boxShadow: theme.glow }}
    >
      <span
        className="display absolute -top-5 left-1/2 -translate-x-1/2 flex h-10 min-w-[80px] items-center justify-center rounded-xl border px-4 text-sm font-bold tracking-[0.18em]"
        style={{
          background: `linear-gradient(180deg, ${theme.from} 0%, ${theme.to} 100%)`,
          color: '#1a0e00',
          borderColor: theme.border,
        }}
      >
        {theme.label}
      </span>

      <div
        className="my-6 overflow-hidden rounded-2xl border-4"
        style={{
          width: theme.avatarSize,
          height: theme.avatarSize,
          borderColor: theme.from,
        }}
      >
        {player.avatar ? (
          <img src={player.avatar} alt={player.name} className="h-full w-full object-cover" />
        ) : (
          <div
            className="flex h-full w-full items-center justify-center display font-bold text-white"
            style={{ background: player.color, fontSize: theme.avatarSize / 2.4 }}
          >
            {player.name.charAt(0).toUpperCase()}
          </div>
        )}
      </div>

      <div className="display text-2xl font-bold text-white truncate w-full">{player.name}</div>
      <div className="micro mt-1 text-zinc-500">
        {player.tradeCount} trade{player.tradeCount > 1 ? 's' : ''}
      </div>

      <div className="mt-5">
        <div
          className={`num font-bold tabular-nums leading-none ${
            isPositive ? 'text-emerald-400' : 'text-red-400'
          }`}
          style={{
            fontSize: theme.pnlSize,
            textShadow: isPositive
              ? '0 0 28px rgba(16,185,129,0.4)'
              : '0 0 28px rgba(239,68,68,0.4)',
          }}
        >
          {formatPnl(player.pnl)}
        </div>
        <div className={`num text-sm mt-1 ${isPositive ? 'text-emerald-500/80' : 'text-red-500/80'}`}>
          {formatPercent(player.pnlPercent)}
        </div>
      </div>

      <div className="mt-auto grid grid-cols-2 gap-2 w-full pt-5">
        <div className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-center">
          <div className="micro text-[8px] text-zinc-500">Balance</div>
          <div className="num text-sm font-bold text-white">${formatUSD(player.currentBalance)}</div>
        </div>
        <div className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-center">
          <div className="micro text-[8px] text-zinc-500">Best %</div>
          <div className="num text-sm font-bold text-white">
            {player.bestTradePercent > 0 ? `+${player.bestTradePercent.toFixed(1)}%` : '—'}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

/* ---------------- Stats détaillées ---------------- */

function StatsView({ archive }: { archive: ArchivedEventSnapshot }) {
  const totalPnl = archive.players.reduce((sum, p) => sum + p.pnl, 0);
  const totalTrades = archive.players.reduce((sum, p) => sum + p.tradeCount, 0);
  const totalFees = archive.players.reduce((sum, p) => sum + p.feesPaid, 0);
  const winners = archive.players.filter((p) => p.pnl > 0).length;

  return (
    <div className="mx-auto max-w-[1280px]">
      <div className="grid grid-cols-4 gap-3 mb-6">
        <Aggregate label="P&L total" value={formatPnl(totalPnl)} accent={totalPnl >= 0 ? 'pos' : 'neg'} />
        <Aggregate label="Trades exécutés" value={totalTrades.toString()} />
        <Aggregate label="Frais cumulés" value={`$${formatUSD(totalFees)}`} />
        <Aggregate label="Traders gagnants" value={`${winners} / ${archive.players.length}`} />
      </div>

      <div className="rounded-2xl border border-white/10 bg-black/40 backdrop-blur overflow-hidden">
        <div className="grid grid-cols-12 gap-3 px-5 py-3 border-b border-white/10 text-[10px] uppercase tracking-[0.32em] text-zinc-500">
          <div className="col-span-1">#</div>
          <div className="col-span-3">Trader</div>
          <div className="col-span-2 text-right">P&L</div>
          <div className="col-span-1 text-right">%</div>
          <div className="col-span-1 text-right">Trades</div>
          <div className="col-span-1 text-right">Best %</div>
          <div className="col-span-1 text-right">Whale</div>
          <div className="col-span-1 text-right">Streak</div>
          <div className="col-span-1 text-right">Frais</div>
        </div>

        {archive.players.map((p, idx) => (
          <motion.div
            key={p.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.025 }}
            className="grid grid-cols-12 gap-3 px-5 py-3 items-center border-b border-white/5 last:border-b-0"
          >
            <div className="col-span-1">
              <RankPill rank={p.rank} />
            </div>
            <div className="col-span-3 flex items-center gap-3 min-w-0">
              <PlayerThumb player={p} size={36} />
              <div className="min-w-0">
                <div className="display text-sm font-bold text-white truncate">{p.name}</div>
                <div className="num text-[10px] text-zinc-500">
                  ${formatUSD(p.initialBalance)} → ${formatUSD(p.currentBalance)}
                </div>
              </div>
            </div>
            <div className={`col-span-2 num text-right font-bold ${p.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {formatPnl(p.pnl)}
            </div>
            <div className={`col-span-1 num text-right ${p.pnl >= 0 ? 'text-emerald-500/80' : 'text-red-500/80'}`}>
              {formatPercent(p.pnlPercent)}
            </div>
            <div className="col-span-1 num text-right text-white">{p.tradeCount}</div>
            <div className="col-span-1 num text-right text-zinc-300">
              {p.bestTradePercent > 0 ? `+${p.bestTradePercent.toFixed(1)}%` : '—'}
            </div>
            <div className="col-span-1 num text-right text-zinc-300">
              {p.biggestTradePnl > 0 ? `$${formatUSD(p.biggestTradePnl)}` : '—'}
            </div>
            <div className="col-span-1 num text-right text-zinc-300">{p.winStreak}</div>
            <div className="col-span-1 num text-right text-zinc-500">${formatUSD(p.feesPaid)}</div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

function Aggregate({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: 'pos' | 'neg';
}) {
  const valueColor =
    accent === 'pos' ? 'text-emerald-400' : accent === 'neg' ? 'text-red-400' : 'text-white';
  return (
    <div className="rounded-xl border border-white/10 bg-black/40 px-4 py-3">
      <div className="micro text-[9px] text-zinc-500">{label}</div>
      <div className={`display text-xl font-bold mt-1 num ${valueColor}`}>{value}</div>
    </div>
  );
}

function RankPill({ rank }: { rank: number }) {
  const palette: Record<number, { bg: string; color: string }> = {
    1: { bg: 'linear-gradient(180deg, #fde68a, #b45309)', color: '#1a0e00' },
    2: { bg: 'linear-gradient(180deg, #e2e8f0, #64748b)', color: '#0f172a' },
    3: { bg: 'linear-gradient(180deg, #fbbf24, #7c2d12)', color: '#1a0e00' },
  };
  const style = palette[rank];
  return (
    <span
      className="display inline-flex h-7 min-w-[36px] items-center justify-center rounded-md px-2 text-xs font-bold tabular-nums"
      style={
        style
          ? { background: style.bg, color: style.color }
          : { background: 'rgba(255,255,255,0.06)', color: '#a1a1aa' }
      }
    >
      #{rank}
    </span>
  );
}

function PlayerThumb({
  player,
  size,
}: {
  player: ArchivedPlayerSnapshot;
  size: number;
}) {
  if (player.avatar) {
    return (
      <img
        src={player.avatar}
        alt={player.name}
        className="rounded-lg border border-white/10 object-cover shrink-0"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <div
      className="flex items-center justify-center rounded-lg display font-bold text-white shrink-0"
      style={{ background: player.color, width: size, height: size, fontSize: size / 2.4 }}
    >
      {player.name.charAt(0).toUpperCase()}
    </div>
  );
}
