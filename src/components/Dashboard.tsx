import { motion } from 'framer-motion';
import { useGameStore } from '../stores/useGameStore';
import Header from './Header';
import TradesFeed from './TradesFeed';
import TickerBar from './TickerBar';
import Achievements from './Achievements';
import CelebrationOverlay from './CelebrationOverlay';
import TradeSpotlight from './TradeSpotlight';
import Leaderboard from './Leaderboard';
import ArenaInsights from './ArenaInsights';
import { Layout1v1, Layout1v1v1, Layout1v1v1v1, Layout4v4 } from './ArenaLayouts';
import { useWebSocket } from '../hooks/useWebSocket';

export default function Dashboard() {
  useWebSocket();

  const players = useGameStore((s) => s.players);
  const eventStarted = useGameStore((s) => s.eventStarted);
  const eventMode = useGameStore((s) => s.eventMode);
  const teams = useGameStore((s) => s.teams);

  const sorted = [...players].sort((a, b) => a.rank - b.rank);
  const showFeed = eventMode !== '4v4';

  return (
    <div className="h-screen flex flex-col bg-gray-950 overflow-hidden">
      {/* Background grid */}
      <div
        className="fixed inset-0 pointer-events-none opacity-[0.03]"
        style={{
          backgroundImage: `linear-gradient(rgba(99,102,241,0.3) 1px, transparent 1px),
                            linear-gradient(90deg, rgba(99,102,241,0.3) 1px, transparent 1px)`,
          backgroundSize: '60px 60px',
        }}
      />
      <div className="fixed top-0 left-0 w-96 h-96 bg-indigo-600/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="fixed bottom-0 right-0 w-96 h-96 bg-purple-600/10 rounded-full blur-[120px] pointer-events-none" />

      <Header />

      {!eventStarted && players.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center relative"
          >
            <div className="relative w-32 h-32 mx-auto mb-8">
              <motion.div
                className="absolute inset-0 rounded-full border-2 border-indigo-500/20"
                animate={{ scale: [1, 1.5, 1], opacity: [0.5, 0, 0.5] }}
                transition={{ duration: 3, repeat: Infinity }}
              />
              <motion.div
                className="absolute inset-0 rounded-full border-2 border-purple-500/20"
                animate={{ scale: [1, 1.8, 1], opacity: [0.3, 0, 0.3] }}
                transition={{ duration: 3, repeat: Infinity, delay: 0.5 }}
              />
              <div className="absolute inset-0 flex items-center justify-center">
                <img src="/src/assets/pictures/logoBTF.png" alt="BTF" className="w-20 h-20 rounded-2xl object-contain shadow-2xl shadow-indigo-500/30" />
              </div>
            </div>
            <h2 className="font-rajdhani text-5xl font-bold text-white mb-3 tracking-wide">
              TRADING ARENA
            </h2>
            <motion.div
              className="h-0.5 w-48 mx-auto bg-gradient-to-r from-transparent via-indigo-500 to-transparent mb-6"
              animate={{ opacity: [0.3, 1, 0.3] }}
              transition={{ duration: 2, repeat: Infinity }}
            />
            <p className="text-gray-400 text-lg mb-2">En attente du lancement...</p>
            <p className="text-gray-600 text-sm">
              Configurez via{' '}
              <a href="/admin" className="text-indigo-400 hover:text-indigo-300 transition-colors">/admin</a>
              {' '}ou tradez depuis{' '}
              <a href="/trade" className="text-green-400 hover:text-green-300 transition-colors">/trade</a>
            </p>
          </motion.div>
        </div>
      ) : (
        <div className="flex-1 flex overflow-hidden">
          {/* Left: Leaderboard */}
          {showFeed && (
            <div className="w-56 xl:w-64 shrink-0 border-r border-gray-800/50 p-4 overflow-y-auto scrollbar-hide">
              <Leaderboard />
            </div>
          )}

          {/* Center: Arena stage */}
          <div className="flex-1 min-w-0 overflow-hidden px-6 py-4 xl:px-8 xl:py-5">
            <div className="h-full w-full rounded-[28px] border border-gray-800/60 bg-gray-950/35 px-6 py-5 shadow-[inset_0_0_0_1px_rgba(99,102,241,0.04)] xl:px-8 xl:py-6">
              <div className="h-full w-full max-w-[1500px] mx-auto flex flex-col">
                <div className="min-h-0 flex-1 pt-6 xl:pt-8">
                  {eventMode === '4v4' && teams ? (
                    <Layout4v4 players={sorted} teams={teams} />
                  ) : eventMode === '1v1v1v1' || (eventMode !== '4v4' && sorted.length >= 4) ? (
                    <Layout1v1v1v1 players={sorted} />
                  ) : eventMode === '1v1v1' || sorted.length === 3 ? (
                    <Layout1v1v1 players={sorted} />
                  ) : (
                    <Layout1v1 players={sorted} />
                  )}
                </div>

                <div className="mt-6 h-28 shrink-0 px-2 pb-2">
                  <ArenaInsights />
                </div>
              </div>
            </div>
          </div>

          {/* Right: Trade feed */}
          {showFeed && (
            <div className="w-56 xl:w-64 shrink-0 border-l border-gray-800/50 p-4 overflow-hidden">
              <TradesFeed />
            </div>
          )}
        </div>
      )}

      <TickerBar />

      {/* Overlays */}
      <TradeSpotlight />
      <Achievements />
      <CelebrationOverlay />
    </div>
  );
}
