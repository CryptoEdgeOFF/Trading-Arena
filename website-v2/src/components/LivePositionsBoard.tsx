import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { useGameStore, type Player, type Position } from '../stores/useGameStore';

/**
 * Tableau live des positions ouvertes côté événement BTF.
 *
 * Le PnL par position est recalculé dans useGameStore à chaque tick
 * marché (`state:patch.market`) via la même formule que le terminal.
 */
export default function LivePositionsBoard() {
  const players = useGameStore((s) => s.players);

  type Row = {
    player: Player;
    position: Position;
  };

  const rows: Row[] = useMemo(() => {
    const list: Row[] = [];
    for (const player of players) {
      for (const position of player.openPositions || []) {
        list.push({ player, position });
      }
    }
    return list.sort((a, b) => b.position.pnl - a.position.pnl);
  }, [players]);

  const Header = (
    <div className="mb-3 flex items-center justify-between">
      <div>
        <div className="micro text-zinc-500 mb-0.5">Live</div>
        <h3 className="display text-lg font-bold tracking-[0.04em] text-white uppercase">
          Positions
        </h3>
      </div>
      <span className="num text-[11px] text-red-300/80 tabular-nums">
        {rows.length} open
      </span>
    </div>
  );

  if (rows.length === 0) {
    return (
      <div className="flex h-full flex-col">
        {Header}
        <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-white/[0.06] bg-white/[0.005] px-4 text-center text-xs text-zinc-600">
          Aucune position ouverte sur le roster.
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {Header}

      <div className="flex-1 space-y-1.5 overflow-y-auto overflow-x-hidden pr-1 scrollbar-hide">
        {rows.map(({ player, position }, index) => {
          const positive = position.pnl >= 0;
          const pairLabel = position.pair.split('/')[0] || position.pair;

          return (
            <motion.div
              key={`${player.id}-${position.id}`}
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: Math.min(index * 0.02, 0.18) }}
              className="pos-row !py-2 !gap-2"
            >
              {player.avatar ? (
                <img
                  src={player.avatar}
                  alt=""
                  className="h-7 w-7 shrink-0 rounded-full object-cover ring-1 ring-white/10"
                />
              ) : (
                <span
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[9px] font-bold uppercase text-white"
                  style={{ background: player.color || '#dc2626' }}
                >
                  {player.name.slice(0, 2)}
                </span>
              )}

              <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-white">
                {player.name}
              </span>

              <span className="num shrink-0 text-[11px] font-semibold text-zinc-300">
                {pairLabel}
              </span>

              <span className={`side-pill shrink-0 ${position.side === 'long' ? 'long' : 'short'} !py-px !px-1.5 !text-[8px]`}>
                {position.side === 'long' ? 'LONG' : 'SHORT'}
              </span>

              <span
                className={`num shrink-0 min-w-[4.5rem] text-right text-[12px] font-bold tabular-nums ${
                  positive ? 'text-emerald-400' : 'text-red-400'
                }`}
              >
                {positive ? '+' : ''}
                {position.pnl.toFixed(2)}$
              </span>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
