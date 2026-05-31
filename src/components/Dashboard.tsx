import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useGameStore, FINAL_NOTIF_BLACKOUT_MS, type Player } from '../stores/useGameStore';
import Header from './Header';
import TradesFeed from './TradesFeed';
import LivePositionsBoard from './LivePositionsBoard';
import TickerBar from './TickerBar';
import Achievements from './Achievements';
import CelebrationOverlay from './CelebrationOverlay';
import TradeSpotlight from './TradeSpotlight';
import EventTransitions from './EventTransitions';
import MalusWheelOverlay from './MalusWheelOverlay';
import EventShowcase from './EventShowcase';
import ArenaSoundController from './ArenaSoundController';
import Leaderboard from './Leaderboard';
import ArenaInsights from './ArenaInsights';
import { Layout1v1, Layout1v1v1, Layout1v1v1v1, Layout4v4 } from './ArenaLayouts';
import { useWebSocket } from '../hooks/useWebSocket';

type RightPanel = 'trades' | 'positions';

const BTF_LOGO_SRC = '/assets/pictures/btf-dashboard.webp';
const KRAKEN_LOGO_SRC = '/assets/pictures/kraken-logo-white.webp';

function sortArenaSlots(players: Player[]): Player[] {
  return [...players].sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
}

/** true sur les ~10 dernières secondes d'une partie LIVE en cours. */
function useFinalNotifBlackout(): boolean {
  const eventStarted = useGameStore((s) => s.eventStarted);
  const eventEndTime = useGameStore((s) => s.eventEndTime);
  const dismissSpotlight = useGameStore((s) => s.dismissSpotlight);
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    if (!eventStarted || !eventEndTime) {
      setBlocked(false);
      return;
    }
    const evaluate = () => {
      const isBlocked = eventEndTime - Date.now() <= FINAL_NOTIF_BLACKOUT_MS;
      setBlocked((prev) => {
        // À l'entrée du blackout, on efface aussi toute notif déjà affichée.
        if (isBlocked && !prev) dismissSpotlight();
        return isBlocked;
      });
    };
    evaluate();
    const id = window.setInterval(evaluate, 250);
    return () => window.clearInterval(id);
  }, [eventStarted, eventEndTime, dismissSpotlight]);

  return blocked;
}

function orderArenaPlayers(players: Player[], slotIds: string[]): Player[] {
  if (slotIds.length === 0) return sortArenaSlots(players);
  const byId = new Map(players.map((player) => [player.id, player]));
  const ordered = slotIds.map((id) => byId.get(id)).filter(Boolean) as Player[];
  const extras = players.filter((player) => !slotIds.includes(player.id));
  return [...ordered, ...sortArenaSlots(extras)];
}

export default function Dashboard() {
  useWebSocket();

  const players = useGameStore((s) => s.players);
  const eventStarted = useGameStore((s) => s.eventStarted);
  const eventMode = useGameStore((s) => s.eventMode);
  const teams = useGameStore((s) => s.teams);
  const showcase = useGameStore((s) => s.showcase);

  const [rightPanel, setRightPanel] = useState<RightPanel>('positions');
  const [arenaSlotIds, setArenaSlotIds] = useState<string[]>([]);

  useEffect(() => {
    if (eventStarted && players.length > 0 && arenaSlotIds.length === 0) {
      setArenaSlotIds(sortArenaSlots(players).map((player) => player.id));
    }
    if (!eventStarted && arenaSlotIds.length > 0) {
      setArenaSlotIds([]);
    }
  }, [eventStarted, players, arenaSlotIds.length]);

  const arenaPlayers = useMemo(
    () => orderArenaPlayers(players, arenaSlotIds),
    [players, arenaSlotIds],
  );
  const showFeed = eventMode !== '4v4';
  const notifsBlocked = useFinalNotifBlackout();

  return (
    <div className="live-arena relative h-screen flex flex-col overflow-hidden">
      {/* Stripes diagonales (DA écran). */}
      <div
        className="stripe-corner"
        style={{ top: 0, left: 0, width: '36vw', height: 6, transform: 'translateY(0)' }}
      />
      <div
        className="stripe-corner"
        style={{ top: 0, right: 0, width: '36vw', height: 6 }}
      />
      <div
        className="stripe-corner"
        style={{ bottom: 0, left: 0, width: '28vw', height: 4 }}
      />
      <div
        className="stripe-corner"
        style={{ bottom: 0, right: 0, width: '28vw', height: 4 }}
      />

      {/* Scanline cinematique. */}
      <div className="scanline" style={{ top: 0 }} />

      <Header />

      {!eventStarted && showcase ? (
        <EventShowcase payload={showcase} />
      ) : !eventStarted && players.length === 0 ? (
        <div className="relative flex-1 flex items-center justify-center">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            className="relative text-center"
          >
            <div className="relative mx-auto mb-10 standby-orb flex items-center justify-center">
              <div className="absolute inset-12 rounded-full bg-gradient-to-br from-red-600/40 to-red-900/0 blur-xl" />
              <img
                src="/assets/pictures/logoBTF.webp"
                alt="BTF"
                className="relative w-24 h-24 rounded-2xl object-contain shadow-[0_24px_60px_-20px_rgba(220,38,38,0.7)]"
              />
            </div>

            <div className="micro mb-3">Breakout Trading Fight</div>
            <h2 className="display text-6xl font-bold tracking-[0.04em] text-white">
              ARENA <span className="text-red-500">/</span> LIVE
            </h2>

            <motion.div
              className="mx-auto my-7 h-px w-72 bg-gradient-to-r from-transparent via-red-500/70 to-transparent"
              animate={{ opacity: [0.3, 1, 0.3] }}
              transition={{ duration: 2.4, repeat: Infinity }}
            />

            <p className="text-base text-zinc-400 mb-2">
              En attente du <span className="text-red-300 font-semibold">lancement du combat</span>...
            </p>
            <p className="text-xs text-zinc-600 tracking-wider uppercase">
              Configurez via{' '}
              <a href="/admin" className="text-red-400 hover:text-red-300 transition-colors">/admin</a>
              {' · '}
              traders <a href="/trader" className="text-red-400 hover:text-red-300 transition-colors">/trader</a>
            </p>
          </motion.div>
        </div>
      ) : (
        <div className="relative flex-1 flex overflow-hidden">
          {/* Left: Leaderboard */}
          {showFeed && (
            <div className="w-60 xl:w-72 shrink-0 border-r border-white/[0.05] px-4 py-5 overflow-y-auto scrollbar-hide">
              <Leaderboard />
            </div>
          )}

          {/* Center: Arena stage */}
          <div className="flex-1 min-w-0 overflow-hidden px-2 py-2 xl:px-4 xl:py-3">
            <div className="relative h-full w-full">
              {/* Liseré rouge décoratif autour de la scène. */}
              <div className="pointer-events-none absolute -inset-px rounded-[24px] bg-[linear-gradient(135deg,rgba(220,38,38,0.45),transparent_30%,transparent_70%,rgba(220,38,38,0.45))] opacity-50" />
              <div className="relative h-full w-full rounded-[24px] border border-white/[0.06] bg-black/30 px-3 py-3 xl:px-5 xl:py-4 backdrop-blur-sm shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]">
                <div className="h-full w-full max-w-[1720px] mx-auto flex flex-col">
                  <div className="min-h-0 flex-1 pt-1 xl:pt-2">
                    {eventMode === '4v4' && teams ? (
                      <Layout4v4 players={arenaPlayers} teams={teams} />
                    ) : eventMode === '1v1v1v1' || (eventMode !== '4v4' && arenaPlayers.length >= 4) ? (
                      <Layout1v1v1v1 players={arenaPlayers} />
                    ) : eventMode === '1v1v1' || arenaPlayers.length === 3 ? (
                      <Layout1v1v1 players={arenaPlayers} />
                    ) : (
                      <Layout1v1 players={arenaPlayers} />
                    )}
                  </div>

                  <div className="mt-3 h-20 shrink-0">
                    <ArenaInsights />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Right: Trade feed / Live positions (toggle) */}
          {showFeed && (
            <div className="flex w-60 xl:w-72 shrink-0 flex-col overflow-hidden border-l border-white/[0.05] px-4 py-5">
              <div className="seg-toggle mb-3 shrink-0">
                <button
                  type="button"
                  onClick={() => setRightPanel('positions')}
                  className={rightPanel === 'positions' ? 'active' : ''}
                >
                  Positions
                </button>
                <button
                  type="button"
                  onClick={() => setRightPanel('trades')}
                  className={rightPanel === 'trades' ? 'active' : ''}
                >
                  Trades
                </button>
              </div>

              <div className="min-h-0 flex-1 overflow-hidden">
                {rightPanel === 'positions' ? <LivePositionsBoard /> : <TradesFeed />}
              </div>
            </div>
          )}
        </div>
      )}

      <TickerBar />

      {/* Overlays */}
      <ArenaSoundController />
      {/* Notifications coupées sur les 10 dernières secondes : on laisse voir
          le compteur et les PnL pendant le sprint final. */}
      {!notifsBlocked && <TradeSpotlight />}
      {!notifsBlocked && <Achievements />}
      {!notifsBlocked && <CelebrationOverlay />}
      <EventTransitions />
      <MalusWheelOverlay />
    </div>
  );
}
