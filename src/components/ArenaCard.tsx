import { useState } from 'react';
import { motion } from 'framer-motion';
import type { Player, Position, Trade } from '../stores/useGameStore';
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

function ClosedTradeRow({ trade }: { trade: Trade }) {
  const isLong = trade.side === 'long';
  const isProfit = trade.pnl >= 0;

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
                className="overflow-hidden rounded-md border bg-zinc-900 h-10 w-10"
                style={{ borderColor: `${player.color}55` }}
              >
                {player.avatar ? (
                  <img src={player.avatar} alt={player.name} className="h-full w-full object-cover" />
                ) : (
                  <div
                    className="flex h-full w-full items-center justify-center font-bold text-white display text-sm"
                    style={{ background: player.color }}
                  >
                    {player.name.charAt(0).toUpperCase()}
                  </div>
                )}
              </div>
              <span
                className="absolute -top-1 -left-1 z-10 display flex h-5 min-w-[22px] items-center justify-center rounded border px-1 text-[9px] font-bold leading-none tabular-nums"
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
              <div className="display font-bold text-white leading-tight truncate text-[13px]" title={player.name}>
                {player.name}
              </div>
              <div className={`num text-[10px] font-semibold ${isPositive ? 'text-emerald-500/80' : 'text-red-500/80'}`}>
                {formatPercent(player.pnlPercent)}
              </div>
            </div>

            <div className="text-right shrink-0">
              <motion.div
                key={player.pnl}
                initial={{ scale: 1.05 }}
                animate={{ scale: 1 }}
                className={`pnl-mega ${isPositive ? 'is-pos' : 'is-neg'} text-[18px] leading-none`}
              >
                {formatPnl(player.pnl)}
              </motion.div>
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
          {/* Header compact : portrait + nom + rank + PNL */}
          <div className="flex items-start gap-2.5">
            <div className="relative shrink-0">
              <div
                className="overflow-hidden rounded-lg border-2 bg-zinc-900 h-14 w-14"
                style={{ borderColor: `${player.color}55` }}
              >
                {player.avatar ? (
                  <img src={player.avatar} alt={player.name} className="h-full w-full object-cover" />
                ) : (
                  <div
                    className="flex h-full w-full items-center justify-center font-bold text-white display"
                    style={{ background: player.color, fontSize: '1.5rem' }}
                  >
                    {player.name.charAt(0).toUpperCase()}
                  </div>
                )}
              </div>
              <span
                className="absolute -top-1.5 -left-1.5 z-10 display flex h-6 min-w-[28px] items-center justify-center rounded-md border px-1.5 text-[10px] font-bold leading-none tabular-nums"
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

            <div className="min-w-0 flex-1">
              <div
                className="display font-bold tracking-[0.02em] text-white leading-tight truncate text-[15px]"
                title={player.name}
              >
                {player.name}
              </div>
              <div className="mt-0.5 flex items-center gap-1.5">
                <span className={`live-pill ${player.connected ? 'is-live' : 'is-idle'} !py-0 !px-1 !text-[8px]`}>
                  <span className={`h-1 w-1 rounded-full ${player.connected ? 'bg-red-500 animate-pulse' : 'bg-zinc-600'}`} />
                  {player.connected ? 'Live' : 'Off'}
                </span>
                <span className="num text-[9.5px] text-zinc-500 tabular-nums">
                  {player.tradeCount} tr · ${formatUSD(player.currentBalance)}
                </span>
              </div>
            </div>

            <div className="text-right shrink-0">
              <motion.div
                key={player.pnl}
                initial={{ scale: 1.05 }}
                animate={{ scale: 1 }}
                className={`pnl-mega ${isPositive ? 'is-pos' : 'is-neg'} text-[22px] leading-none`}
              >
                {formatPnl(player.pnl)}
              </motion.div>
              <div className={`num text-[10px] font-semibold mt-0.5 ${isPositive ? 'text-emerald-500/80' : 'text-red-500/80'}`}>
                {formatPercent(player.pnlPercent)}
              </div>
            </div>
          </div>

          {/* Positions actives — section principale, prend le reste de la carte */}
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
        <div className={`flex items-start justify-between gap-4 ${isFull ? 'mb-5' : 'mb-4'}`}>
          <div className="min-w-0 flex-1 pt-1">
            <div className="micro mb-1.5 text-[8.5px] tracking-[0.26em] text-zinc-500">
              Trader
            </div>
            <div className={`display font-bold tracking-[0.02em] text-white leading-tight break-words ${isFull ? 'text-3xl' : 'text-2xl'}`}>
              {player.name}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className={`live-pill ${player.connected ? 'is-live' : 'is-idle'} !py-0.5 !text-[9px]`}>
                <span className={`h-1.5 w-1.5 rounded-full ${player.connected ? 'bg-red-500 animate-pulse' : 'bg-zinc-600'}`} />
                {player.connected ? 'Live' : 'Off'}
              </span>
              {player.badges.length > 0 && (
                <div className="flex gap-0.5">
                  {player.badges.slice(0, 4).map((b) => (
                    <motion.span
                      key={b.type}
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      className={isFull ? 'text-xl' : 'text-base'}
                      title={b.label}
                    >
                      {b.icon}
                    </motion.span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Portrait rectangulaire + badge rang en chevauchement */}
          <div className="relative shrink-0">
            <div
              className={`overflow-hidden rounded-xl border-2 bg-zinc-900 shadow-[0_18px_40px_-18px_rgba(0,0,0,0.85)] ${
                isFull ? 'h-32 w-32' : 'h-24 w-24'
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
                  style={{ background: player.color, fontSize: isFull ? '3rem' : '2.25rem' }}
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

        {/* PNL grand */}
        <div className={`${isFull ? 'mb-5' : 'mb-4'}`}>
          <div className="micro text-[9px] mb-1 text-zinc-500">P&amp;L Réalisé + Latent</div>
          <div className="flex items-baseline gap-3 flex-wrap">
            <motion.div
              key={player.pnl}
              initial={{ scale: 1.05 }}
              animate={{ scale: 1 }}
              className={`pnl-mega ${isPositive ? 'is-pos' : 'is-neg'} ${isFull ? 'text-[58px]' : 'text-[40px]'} leading-[0.85]`}
            >
              {formatPnl(player.pnl)}
            </motion.div>
            <div
              className={`num text-base font-semibold ${isPositive ? 'text-emerald-500/80' : 'text-red-500/80'}`}
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
        <div className={`grid grid-cols-3 gap-2 ${isFull ? 'mb-5' : 'mb-4'}`}>
          <div className="stat-tile">
            <div className="stat-tile-label">Balance</div>
            <div className="stat-tile-value">${formatUSD(player.currentBalance)}</div>
          </div>
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
