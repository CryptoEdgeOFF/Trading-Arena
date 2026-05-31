import { useState } from 'react';
import { motion } from 'framer-motion';
import type { Badge, Player, Position, Trade } from '../stores/useGameStore';
import { formatPnl, formatPercent, formatUSD } from '../utils/formatters';
import { formatEngineSizeDisplay, fmtMarketPrice } from '../utils/positionSizing';
import { getCryptoIconUrl } from '../utils/cryptoIcons';
import PlayerAvatar from './PlayerAvatar';

function CryptoIcon({ pair, className }: { pair: string; className?: string }) {
  const [error, setError] = useState(false);
  const url = getCryptoIconUrl(pair);

  if (!url || error) {
    return (
      <div className={`rounded-full bg-zinc-800 flex items-center justify-center text-[9px] font-bold text-zinc-400 ${className || 'w-6 h-6'}`}>
        {pair.replace(/\/.*|USD.*$/i, '').slice(0, 3)}
      </div>
    );
  }

  return (
    <img
      src={url}
      alt={pair}
      onError={() => setError(true)}
      className={`rounded-full object-contain ${className || 'w-6 h-6'}`}
    />
  );
}

function PlayerBadges({
  badges,
  max = 4,
  size = 'md',
}: {
  badges: Badge[];
  max?: number;
  size?: 'sm' | 'md';
}) {
  if (badges.length === 0) return null;

  const iconClass = size === 'sm' ? 'text-sm' : 'text-xl';

  return (
    <div className="flex flex-wrap items-center gap-0.5">
      {badges.slice(0, max).map((badge) => (
        <motion.span
          key={badge.type}
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          className={`leading-none ${iconClass}`}
          title={`${badge.label} — ${badge.description}`}
        >
          {badge.icon}
        </motion.span>
      ))}
    </div>
  );
}

function PositionRow({ position, compact = false }: { position: Position; compact?: boolean }) {
  const isLong = position.side === 'long';
  const isProfit = position.pnl >= 0;
  const base = position.pair.split('/')[0] || '';
  const sizeDisplay = formatEngineSizeDisplay(position.pair, position.size, base);

  if (compact) {
    return (
      <div className="pos-row !py-1.5 !px-2 !gap-1.5">
        <CryptoIcon pair={position.pair} className="w-5 h-5 shrink-0" />
        <span className={`side-pill ${isLong ? 'long' : 'short'} !py-px !px-1.5 !text-[8px]`}>
          {isLong ? 'L' : 'S'}
        </span>
        <span className="num truncate text-[11px] font-semibold text-white">
          {position.pair.split('/')[0]}
        </span>
        <span className="num shrink-0 text-[10px] text-zinc-500 tabular-nums">
          {sizeDisplay.text}
        </span>
        <span
          className={`num shrink-0 ml-auto text-[11px] font-bold tabular-nums ${
            isProfit ? 'text-emerald-400' : 'text-red-400'
          }`}
        >
          {formatPnl(position.pnl)}
        </span>
      </div>
    );
  }

  return (
    <div className="pos-row">
      <CryptoIcon pair={position.pair} className="w-7 h-7 shrink-0" />
      <span className={`side-pill ${isLong ? 'long' : 'short'}`}>
        {isLong ? 'LONG' : 'SHORT'}
      </span>
      <div className="min-w-0 flex-1">
        <div className="num truncate text-[13px] font-bold text-white leading-tight">{position.pair}</div>
        <div className="mt-0.5 num text-[10.5px] text-zinc-500">
          <span className="text-zinc-300">{sizeDisplay.text}</span> {sizeDisplay.unit}
          <span className="mx-1.5 text-zinc-700">·</span>
          <span className="text-zinc-500">E</span> {fmtMarketPrice(position.entryPrice)}
          <span className="mx-1.5 text-zinc-700">·</span>
          <span className="text-zinc-500">M</span> {fmtMarketPrice(position.markPrice)}
        </div>
      </div>
      <span className={`num shrink-0 text-[13px] font-bold ${isProfit ? 'text-emerald-400' : 'text-red-400'}`}>
        {formatPnl(position.pnl)}
      </span>
    </div>
  );
}

function ClosedTradeRow({ trade, compact = false }: { trade: Trade; compact?: boolean }) {
  const isLong = trade.side === 'long';
  const isProfit = trade.pnl >= 0;

  if (compact) {
    return (
      <div className="pos-row closed !py-1.5 !px-2 !gap-1.5">
        <CryptoIcon pair={trade.pair} className="w-5 h-5 shrink-0" />
        <span className={`side-pill ${isLong ? 'long' : 'short'} opacity-70 !py-px !px-1.5 !text-[8px]`}>
          {isLong ? 'L' : 'S'}
        </span>
        <span className="num truncate text-[11px] font-medium text-zinc-400">
          {trade.pair.split('/')[0]}
        </span>
        <span
          className={`num shrink-0 ml-auto text-[11px] font-bold tabular-nums ${
            isProfit ? 'text-emerald-400' : 'text-red-400'
          }`}
        >
          {formatPnl(trade.pnl)}
        </span>
      </div>
    );
  }

  return (
    <div className="pos-row closed">
      <CryptoIcon pair={trade.pair} className="w-6 h-6 shrink-0" />
      <span className={`side-pill ${isLong ? 'long' : 'short'} opacity-70`}>
        {isLong ? 'LONG' : 'SHORT'}
      </span>
      <div className="min-w-0 flex-1">
        <div className="num truncate text-[12px] font-medium text-zinc-300">{trade.pair}</div>
        <div className="micro mt-0.5 text-[8.5px] text-zinc-600 tracking-[0.18em]">Closed</div>
      </div>
      <span className={`num shrink-0 text-[12px] font-bold ${isProfit ? 'text-emerald-400' : 'text-red-400'}`}>
        {formatPnl(trade.pnl)}
      </span>
    </div>
  );
}

interface ArenaCardProps {
  player: Player;
  side?: 'left' | 'right' | 'center';
  size?: 'full' | 'half' | 'third' | 'quarter' | 'team';
  teamColor?: string;
}

interface RankTheme {
  label: string;
  text: string;
  bg: string;
  border: string;
  glow: string;
}

const RANK_THEMES: Record<number, RankTheme> = {
  1: {
    label: 'CHAMPION',
    text: '#1a0e00',
    bg: 'linear-gradient(180deg, #fbbf24 0%, #b45309 100%)',
    border: 'rgba(245, 179, 0, 0.65)',
    glow: '0 0 28px rgba(245, 179, 0, 0.45)',
  },
  2: {
    label: '2ND',
    text: '#0a0a0a',
    bg: 'linear-gradient(180deg, #e2e8f0 0%, #94a3b8 100%)',
    border: 'rgba(203, 213, 225, 0.55)',
    glow: '0 0 22px rgba(203, 213, 225, 0.35)',
  },
  3: {
    label: '3RD',
    text: '#1a0a00',
    bg: 'linear-gradient(180deg, #f59e0b 0%, #92400e 100%)',
    border: 'rgba(194, 114, 74, 0.55)',
    glow: '0 0 22px rgba(194, 114, 74, 0.4)',
  },
};

const DEFAULT_RANK_THEME: RankTheme = {
  label: 'RANK',
  text: '#e4e4e7',
  bg: 'linear-gradient(180deg, rgba(63, 63, 70, 0.9) 0%, rgba(24, 24, 27, 0.9) 100%)',
  border: 'rgba(244, 244, 245, 0.18)',
  glow: '0 0 14px rgba(244, 244, 245, 0.12)',
};

function getLatestPositionSnapshot(player: Player): { type: 'open'; position: Position } | { type: 'closed'; trade: Trade } | null {
  if (player.openPositions.length > 0) {
    const position = [...player.openPositions].sort(
      (a, b) => (b.openedAt ?? 0) - (a.openedAt ?? 0),
    )[0];
    return { type: 'open', position };
  }
  const lastClose = [...player.trades].reverse().find((trade) => trade.action === 'close');
  if (lastClose) return { type: 'closed', trade: lastClose };
  return null;
}

export default function ArenaCard({ player, size = 'half', teamColor }: ArenaCardProps) {
  const isPositive = player.pnl >= 0;
  const isFull = size === 'full' || size === 'half';
  const isSolo = size === 'full'; // 1v1 : 2 cartes, le plus d'espace
  const isTeam = size === 'team';
  // Mode compact : 1v1v1v1 (quarter). Mode team : 5v5 (dernière position seulement).
  const isCompact = size === 'quarter';
  const rankTheme = RANK_THEMES[player.rank] || DEFAULT_RANK_THEME;
  const latestPosition = isTeam ? getLatestPositionSnapshot(player) : null;

  const closedTrades = player.trades
    .filter((t) => t.action === 'close')
    .slice(-5)
    .reverse();

  if (isTeam) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
        className={`arena-card h-full flex flex-col ${player.rank === 1 ? 'rank-1' : ''}`}
        style={{
          ...(teamColor
            ? { borderColor: `${teamColor}55`, boxShadow: `0 16px 48px -32px ${teamColor}80` }
            : {}),
        }}
      >
        <div
          className="arena-rank-strip"
          style={teamColor ? { background: `linear-gradient(90deg, ${teamColor}, transparent 70%)` } : undefined}
        />

        <div className="relative flex-1 min-h-0 flex flex-col overflow-hidden p-2.5 gap-2">
          <div className="flex items-center gap-2">
            <div className="relative shrink-0">
              <div
                className="overflow-hidden rounded-md border-2 bg-zinc-900 h-16 w-16"
                style={{ borderColor: `${player.color}55` }}
              >
                {player.avatar ? (
                  <img src={player.avatar} alt={player.name} className="h-full w-full object-cover" />
                ) : (
                  <div
                    className="flex h-full w-full items-center justify-center font-bold text-white display text-xl"
                    style={{ background: player.color }}
                  >
                    {player.name.charAt(0).toUpperCase()}
                  </div>
                )}
              </div>
              <span
                className="absolute -top-1.5 -left-1.5 z-10 display flex h-6 min-w-[26px] items-center justify-center rounded border px-1 text-[10px] font-bold leading-none tabular-nums"
                style={{
                  background: rankTheme.bg,
                  color: rankTheme.text,
                  borderColor: rankTheme.border,
                }}
              >
                #{player.rank}
              </span>
            </div>

            <div className="min-w-0 flex-1">
              <div className="display font-bold text-white leading-tight truncate text-[20px]" title={player.name}>
                {player.name}
              </div>
            </div>
          </div>

          <div className="shrink-0 flex items-baseline justify-between gap-1">
            <motion.div
              key={player.pnl}
              initial={{ scale: 1.05 }}
              animate={{ scale: 1 }}
              className={`pnl-mega min-w-0 truncate ${isPositive ? 'is-pos' : 'is-neg'} text-[36px] leading-[0.88]`}
            >
              {formatPnl(player.pnl)}
            </motion.div>
            <div className={`num shrink-0 text-[11px] font-semibold ${isPositive ? 'text-emerald-500/80' : 'text-red-500/80'}`}>
              {formatPercent(player.pnlPercent)}
            </div>
          </div>

          <div className="flex-1 min-h-0 flex flex-col justify-end">
            {latestPosition?.type === 'open' ? (
              <PositionRow position={latestPosition.position} compact />
            ) : latestPosition?.type === 'closed' ? (
              <ClosedTradeRow trade={latestPosition.trade} />
            ) : (
              <div className="rounded-lg border border-dashed border-white/[0.06] bg-white/[0.01] px-2 py-2 text-center text-[10px] text-zinc-600">
                Aucune position
              </div>
            )}
          </div>
        </div>
      </motion.div>
    );
  }

  if (isCompact) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
        className={`arena-card h-full flex flex-col ${player.rank === 1 ? 'rank-1' : ''}`}
        style={{
          ...(teamColor
            ? { borderColor: `${teamColor}55`, boxShadow: `0 22px 60px -38px ${teamColor}80` }
            : {}),
        }}
      >
        <div
          className="arena-rank-strip"
          style={teamColor ? { background: `linear-gradient(90deg, ${teamColor}, transparent 70%)` } : undefined}
        />

        <div className="relative flex-1 min-h-0 flex flex-col overflow-hidden p-3 gap-2.5">
          {/* Header compact : portrait + valeur compte à gauche, nom + PNL haut-droite */}
          <div className="flex items-start gap-3">
            <div className="flex shrink-0 flex-col items-center gap-1">
              <div className="relative">
                <div
                  className="overflow-hidden rounded-xl border-2 bg-zinc-900 h-[72px] w-[72px]"
                  style={{ borderColor: `${player.color}55` }}
                >
                  {player.avatar ? (
                    <img src={player.avatar} alt={player.name} className="h-full w-full object-cover" />
                  ) : (
                    <div
                      className="flex h-full w-full items-center justify-center font-bold text-white display"
                      style={{ background: player.color, fontSize: '1.85rem' }}
                    >
                      {player.name.charAt(0).toUpperCase()}
                    </div>
                  )}
                </div>
                <span
                  className="absolute -top-2 -left-2 z-10 display flex h-7 min-w-[32px] items-center justify-center rounded-md border px-1.5 text-[11px] font-bold leading-none tabular-nums"
                  style={{
                    background: rankTheme.bg,
                    color: rankTheme.text,
                    borderColor: rankTheme.border,
                    boxShadow: `${rankTheme.glow}, 0 4px 12px rgba(0,0,0,0.5)`,
                  }}
                  aria-label={`Rang ${player.rank}`}
                >
                  #{player.rank}
                </span>
              </div>
              <span className="num text-[13px] font-bold tabular-nums text-white">
                ${formatUSD(player.currentBalance)}
              </span>
            </div>

            <div className="min-w-0 flex-1 flex items-start justify-between gap-2 pt-1">
              <div className="min-w-0 flex-1">
                <div
                  className="display font-bold tracking-[0.02em] text-white leading-tight truncate text-[24px]"
                  title={player.name}
                >
                  {player.name}
                </div>
                {player.badges.length > 0 && (
                  <div className="mt-1">
                    <PlayerBadges badges={player.badges} max={4} size="sm" />
                  </div>
                )}
              </div>

              {/* PNL en haut à droite */}
              <div className="shrink-0 text-right">
                <motion.div
                  key={player.pnl}
                  initial={{ scale: 1.05 }}
                  animate={{ scale: 1 }}
                  className={`pnl-mega ${isPositive ? 'is-pos' : 'is-neg'} text-[32px] leading-[0.9]`}
                >
                  {formatPnl(player.pnl)}
                </motion.div>
                <div className={`num text-sm font-semibold ${isPositive ? 'text-emerald-500/80' : 'text-red-500/80'}`}>
                  {formatPercent(player.pnlPercent)}
                </div>
              </div>
            </div>
          </div>

          {/* Positions + historique */}
          <div className="flex-1 min-h-0 flex flex-col gap-2">
            <div className="flex-1 min-h-0 flex flex-col">
              <div className="flex items-center justify-between mb-1">
                <div className="micro flex items-center gap-1.5 !text-[8.5px]">
                  <span className="live-dot" />
                  Positions
                </div>
                <span className="num text-[9.5px] text-zinc-500">{player.openPositions.length}</span>
              </div>
              {player.openPositions.length > 0 ? (
                <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide space-y-1 pr-0.5">
                  {player.openPositions.map((pos) => (
                    <PositionRow key={pos.pair} position={pos} compact />
                  ))}
                </div>
              ) : (
                <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-white/[0.06] bg-white/[0.01] px-3 py-2 text-center text-[10px] text-zinc-600">
                  Aucune position ouverte
                </div>
              )}
            </div>

            {closedTrades.length > 0 && (
              <div className="flex-1 min-h-0 flex flex-col border-t border-white/[0.05] pt-2">
                <div className="flex items-center justify-between mb-1">
                  <div className="micro flex items-center gap-1.5 !text-[8.5px]">
                    <span className="h-1.5 w-1.5 rounded-full bg-zinc-600" />
                    Historique
                  </div>
                  <span className="num text-[9.5px] text-zinc-500">{closedTrades.length}</span>
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide space-y-1 pr-0.5">
                  {closedTrades.slice(0, 4).map((trade) => (
                    <ClosedTradeRow key={trade.id} trade={trade} compact />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.94 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className={`arena-card h-full flex flex-col ${player.rank === 1 ? 'rank-1' : ''}`}
      style={{
        ...(teamColor
          ? { borderColor: `${teamColor}55`, boxShadow: `0 22px 60px -38px ${teamColor}80` }
          : {}),
      }}
    >
      <div
        className="arena-rank-strip"
        style={teamColor ? { background: `linear-gradient(90deg, ${teamColor}, transparent 70%)` } : undefined}
      />

      <div className={`relative flex-1 flex flex-col overflow-hidden ${isFull ? 'p-6' : 'p-5'}`}>
        {/* Header : nom à gauche, gros portrait en haut à droite avec badge rang qui chevauche. */}
        <div className={`flex items-start justify-between gap-4 ${isFull ? 'mb-4' : 'mb-3'} ${isSolo ? 'h-32 xl:h-36' : 'h-28'}`}>
          <div className="min-w-0 flex-1 flex h-full flex-col pt-1">
            <div className="micro mb-1.5 text-[8.5px] tracking-[0.26em] text-zinc-500">
              Trader
            </div>
            <div
              className={`display font-bold tracking-[0.02em] text-white leading-[1.05] break-words line-clamp-2 ${isSolo ? 'text-4xl xl:text-5xl' : 'text-3xl xl:text-4xl'}`}
              title={player.name}
            >
              {player.name}
            </div>
            <div className="mt-auto min-h-[1.25rem]">
              <PlayerBadges badges={player.badges} max={6} size="md" />
            </div>
          </div>

          {/* Portrait rectangulaire + badge rang en chevauchement */}
          <div className="relative shrink-0">
            <div
              className={`overflow-hidden rounded-xl border-2 bg-zinc-900 shadow-[0_18px_40px_-18px_rgba(0,0,0,0.85)] ${
                isSolo ? 'h-32 w-32 xl:h-36 xl:w-36' : 'h-28 w-28'
              }`}
              style={{ borderColor: `${player.color}55` }}
            >
              {player.avatar ? (
                <img
                  src={player.avatar}
                  alt={player.name}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div
                  className="flex h-full w-full items-center justify-center font-bold text-white display tracking-wider"
                  style={{ background: player.color, fontSize: isSolo ? '3rem' : '2.5rem' }}
                >
                  {player.name.charAt(0).toUpperCase()}
                </div>
              )}
            </div>
            {/* Badge rang qui chevauche le portrait. */}
            <span
              className="absolute -top-2 -left-2 z-10 display flex h-9 min-w-[44px] items-center justify-center rounded-lg border px-2 text-base font-bold leading-none tabular-nums"
              style={{
                background: rankTheme.bg,
                color: rankTheme.text,
                borderColor: rankTheme.border,
                boxShadow: `${rankTheme.glow}, 0 6px 18px rgba(0,0,0,0.6)`,
              }}
              aria-label={`Rang ${player.rank}`}
              title={rankTheme.label}
            >
              #{player.rank}
            </span>
          </div>
        </div>

        {/* Valeur du compte + PNL grand */}
        <div className={`${isFull ? 'mb-5' : 'mb-4'}`}>
          <div className="mb-2 border-b border-white/[0.06] pb-2">
            <span className="num text-lg font-bold tabular-nums text-white">${formatUSD(player.currentBalance)}</span>
          </div>
          <div className="micro text-[9px] mb-1 text-zinc-500">P&amp;L Réalisé + Latent</div>
          <div className="flex items-end gap-3 flex-wrap">
            <motion.div
              key={player.pnl}
              initial={{ scale: 1.05 }}
              animate={{ scale: 1 }}
              className={`pnl-mega min-w-0 ${isPositive ? 'is-pos' : 'is-neg'} ${
                isSolo ? 'text-[clamp(2.75rem,5.5vw,4.5rem)]' : 'text-[clamp(2.25rem,4vw,3.5rem)]'
              } leading-[0.82]`}
            >
              {formatPnl(player.pnl)}
            </motion.div>
            <div
              className={`num pb-1 text-xl font-semibold ${isPositive ? 'text-emerald-500/80' : 'text-red-500/80'}`}
            >
              {formatPercent(player.pnlPercent)}
            </div>
          </div>
        </div>

        {/* Progress bar */}
        <div className={`relative h-1.5 w-full bg-white/[0.04] rounded-full overflow-hidden ${isFull ? 'mb-5' : 'mb-4'}`}>
          <motion.div
            className={`absolute inset-y-0 left-0 ${
              isPositive
                ? 'bg-gradient-to-r from-emerald-500 to-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.55)]'
                : 'bg-gradient-to-r from-red-700 to-red-400 shadow-[0_0_12px_rgba(239,68,68,0.6)]'
            }`}
            animate={{ width: `${Math.min(Math.abs(player.pnlPercent) * 10, 100)}%` }}
            transition={{ type: 'spring', stiffness: 90 }}
          />
        </div>

        {/* Stats */}
        <div className={`grid grid-cols-2 gap-2 ${isFull ? 'mb-5' : 'mb-4'}`}>
          <div className="stat-tile">
            <div className="stat-tile-label">Trades</div>
            <div className="stat-tile-value">{player.tradeCount}</div>
          </div>
          <div className="stat-tile">
            <div className="stat-tile-label">Open</div>
            <div className="stat-tile-value">{player.openPositions.length}</div>
          </div>
        </div>

        {/* Sections */}
        <div className="flex-1 flex flex-col gap-3 min-h-0 overflow-y-auto scrollbar-hide pr-1">
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="micro flex items-center gap-2">
                <span className="live-dot" />
                Positions actives
              </div>
              <span className="num text-[10.5px] text-zinc-500">{player.openPositions.length}</span>
            </div>
            {player.openPositions.length > 0 ? (
              <div className="space-y-1.5">
                {player.openPositions.map((pos) => (
                  <PositionRow key={pos.pair} position={pos} />
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-white/[0.06] bg-white/[0.01] px-4 py-4 text-center text-xs text-zinc-600">
                Aucune position ouverte
              </div>
            )}
          </div>

          {closedTrades.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="micro flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-zinc-600" />
                  Historique
                </div>
                <span className="num text-[10.5px] text-zinc-500">{closedTrades.length}</span>
              </div>
              <div className="space-y-1.5">
                {closedTrades.map((t) => (
                  <ClosedTradeRow key={t.id} trade={t} />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
