import { create } from 'zustand';
import { refreshPlayerPaperMetrics } from '../utils/positionPnl';
import { tryAcceptSpotlight, resetSpotlightNotifications } from '../utils/arenaSounds';

function refreshAllPlayersPositions(
  players: Player[],
  market: Record<string, { markPrice?: number }>,
  startingBalance: number,
): Player[] {
  if (!players.length) return players;
  return players.map((player) => refreshPlayerPaperMetrics(player, market, startingBalance));
}

type CelebrationItem = { type: 'leader-change' | 'big-trade'; playerId: string };

function enqueueLeaderCelebration(
  queue: CelebrationItem[],
  playerId: string,
): CelebrationItem[] {
  // Une seule notif leader à la fois : pas de file d'attente qui s'empile.
  if (queue.some((item) => item.type === 'leader-change')) return queue;
  return [...queue, { type: 'leader-change', playerId }];
}

function shouldCelebrateLeaderChange(
  change: { playerId: string; from: number; to: number },
  players: Player[],
  celebrationQueue: CelebrationItem[],
): boolean {
  if (change.to !== 1 || change.from <= 0) return false;
  if (!players.some((player) => (player.openPositions?.length ?? 0) > 0)) return false;

  // Déjà une célébration leader affichée ou en attente → on drop.
  if (celebrationQueue.some((item) => item.type === 'leader-change')) return false;

  const now = Date.now();
  if (now - leaderCelebrationGuard.lastAt < 45_000) return false;
  if (leaderCelebrationGuard.lastPlayerId === change.playerId) return false;

  leaderCelebrationGuard.lastAt = now;
  leaderCelebrationGuard.lastPlayerId = change.playerId;
  return true;
}

const leaderCelebrationGuard = {
  lastAt: 0,
  lastPlayerId: '',
};

export interface Player {
  id: string;
  name: string;
  color: string;
  avatar: string | null;
  active: boolean;
  initialBalance: number | null;
  currentBalance: number;
  availableMargin: number;
  usedMargin: number;
  feesPaid: number;
  pnl: number;
  pnlPercent: number;
  tradeCount: number;
  trades: Trade[];
  openPositions: Position[];
  openOrders: Order[];
  rank: number;
  previousRank: number;
  badges: Badge[];
  winStreak: number;
  longestPositionMinutes: number;
  biggestTradePnl: number;
  bestTradePercent: number;
  lastUpdate: number;
  connected: boolean;
}

export interface Trade {
  id: string;
  playerName: string;
  playerColor: string;
  pair: string;
  side: 'long' | 'short';
  size: number;
  price: number;
  fee: number;
  leverage: number;
  orderType: OrderType;
  pnl: number;
  time: number;
  action: 'open' | 'close' | 'update';
}

export interface Position {
  id: string;
  pair: string;
  side: 'long' | 'short';
  size: number;
  entryPrice: number;
  markPrice: number;
  pnl: number;
  unrealizedFunding: number;
  leverage: number;
  margin: number;
  feesPaid: number;
  liquidationPrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  stopLossSize?: number | null;
  takeProfitSize?: number | null;
  openedAt?: number;
}

export type OrderType = 'market' | 'limit';
export type OrderStatus = 'open' | 'filled' | 'cancelled';

export interface Order {
  id: string;
  pair: string;
  side: 'long' | 'short';
  size: number;
  orderType: OrderType;
  status: OrderStatus;
  limitPrice: number | null;
  leverage: number;
  marginReserved: number;
  feeEstimate: number;
  createdAt: number;
  updatedAt: number;
  stopLoss?: number | null;
  takeProfit?: number | null;
  placedAtMark?: number | null;
}

export interface Badge {
  type: string;
  label: string;
  description: string;
  icon: string;
  awardedAt: number;
}

export type SpotlightReason = 'manual' | 'stop-loss' | 'take-profit';

export interface SpotlightTrade {
  id: string;
  playerName: string;
  playerColor: string;
  playerAvatar: string | null;
  pair: string;
  side: 'long' | 'short';
  size: number;
  entryPrice: number;
  action: 'open' | 'close';
  pnl: number;
  reason?: SpotlightReason;
}

export interface MarketTicker {
  pair: string;
  symbol: string;
  markPrice: number;
  bidPrice: number;
  askPrice: number;
  change24h?: number | null;
  spreadBps: number;
  updatedAt: number;
  marketOpen?: boolean;
  marketClosedLabel?: string | null;
}

export type EventMode = '1v1' | '1v1v1' | '1v1v1v1' | '4v4';
export type PlatformMode = 'kraken' | 'paper';
export type MarketDataSource = 'kraken' | 'binance';

export interface TeamInfo {
  name: string;
  color: string;
  playerIds: string[];
}

export interface PlayerStatePatch {
  id: string;
  pnl?: number;
  pnlPercent?: number;
  rank?: number;
  previousRank?: number;
  tradeCount?: number;
  currentBalance?: number;
  availableMargin?: number;
  usedMargin?: number;
  feesPaid?: number;
  connected?: boolean;
  lastUpdate?: number;
  // Snapshot complet des positions / ordres ouverts. Inclus uniquement quand
  // le contenu structurel a changé depuis le dernier patch (ouverture,
  // fermeture, modif SL/TP). Le PnL en temps réel est recalculé côté front
  // à partir du markPrice diffusé via `patch.market`.
  openPositions?: Position[];
  openOrders?: Order[];
  badges?: Badge[];
  // Historique complet des trades — inclus quand le nombre de trades change.
  // Garde la carte joueur et le PnL réalisé synchronisés sans refresh.
  trades?: Trade[];
}

export interface ArchivedPlayerSnapshot {
  id: string;
  name: string;
  color: string;
  avatar: string | null;
  rank: number;
  initialBalance: number;
  currentBalance: number;
  pnl: number;
  pnlPercent: number;
  tradeCount: number;
  feesPaid: number;
  winStreak: number;
  bestTradePercent: number;
  biggestTradePnl: number;
  longestPositionMinutes: number;
  badges: Badge[];
}

export interface ArchivedEventSnapshot {
  id: string;
  finalizedAt: number;
  startedAt: number | null;
  durationMs: number;
  eventMode: EventMode;
  teams: [TeamInfo, TeamInfo] | null;
  players: ArchivedPlayerSnapshot[];
}

export interface ShowcasePayload {
  mode: 'podium' | 'stats';
  archive: ArchivedEventSnapshot;
}

export interface StatePatch {
  players?: PlayerStatePatch[];
  addedPlayers?: Player[];
  removedPlayerIds?: string[];
  market?: Record<string, MarketTicker>;
  newTrades?: Trade[];
  newBadges?: { playerId: string; badge: Badge }[];
  leaderChanges?: { playerId: string; from: number; to: number }[];
  spotlightTrades?: SpotlightTrade[];
  eventStarted?: boolean;
  eventStartTime?: number | null;
  eventEndTime?: number | null;
  eventMode?: EventMode;
  teams?: [TeamInfo, TeamInfo] | null;
  platformMode?: PlatformMode;
  paperStartingBalance?: number;
  marketDataSource?: MarketDataSource;
  showcase?: ShowcasePayload | null;
}

interface GameState {
  players: Player[];
  recentTrades: Trade[];
  market: Record<string, MarketTicker>;
  eventStarted: boolean;
  eventStartTime: number | null;
  eventEndTime: number | null;
  platformMode: PlatformMode;
  paperStartingBalance: number;
  marketDataSource: MarketDataSource;
  newBadges: { playerId: string; badge: Badge }[];
  leaderChanges: { playerId: string; from: number; to: number }[];
  spotlightTrades: SpotlightTrade[];
  eventMode: EventMode;
  teams?: [TeamInfo, TeamInfo];
  showcase: ShowcasePayload | null;

  badgeQueue: { playerId: string; playerName: string; badge: Badge }[];
  celebrationQueue: { type: 'leader-change' | 'big-trade'; playerId: string }[];
  /** Spotlight trade actuellement à l'écran (null = rien). Pas de file d'attente. */
  spotlightTrade: SpotlightTrade | null;
  /** True après le premier `state:init` WebSocket (évite un faux démarrage au refresh). */
  liveStateSynced: boolean;

  updateState: (state: Partial<GameState>) => void;
  applyStatePatch: (patch: StatePatch) => void;
  addBadgeToQueue: (item: { playerId: string; playerName: string; badge: Badge }) => void;
  shiftBadgeQueue: () => void;
  addCelebration: (item: { type: 'leader-change' | 'big-trade'; playerId: string }) => void;
  shiftCelebration: () => void;
  dismissSpotlight: () => void;
  resetClientLiveState: () => void;
}

export const useGameStore = create<GameState>((set) => ({
  players: [],
  recentTrades: [],
  market: {},
  eventStarted: false,
  eventStartTime: null,
  eventEndTime: null,
  platformMode: 'kraken',
  paperStartingBalance: 10000,
  marketDataSource: 'kraken',
  newBadges: [],
  leaderChanges: [],
  spotlightTrades: [],
  eventMode: '1v1',
  teams: undefined,
  showcase: null,
  badgeQueue: [],
  celebrationQueue: [],
  spotlightTrade: null,
  liveStateSynced: false,

  updateState: (incoming) =>
    set((state) => {
      const next = { ...state, ...incoming, liveStateSynced: true };

      // Clear teams when not in 4v4 mode
      if (next.eventMode !== '4v4' || !next.teams) {
        next.teams = undefined;
      }

      if (incoming.newBadges && incoming.newBadges.length > 0) {
        const players = incoming.players || state.players;
        const items = incoming.newBadges.map((nb) => {
          const p = players.find((pl) => pl.id === nb.playerId);
          return { ...nb, playerName: p?.name || '???' };
        });
        next.badgeQueue = [...state.badgeQueue, ...items];
      }

      if (incoming.leaderChanges && incoming.leaderChanges.length > 0) {
        const topChange = incoming.leaderChanges.find((lc) => lc.to === 1);
        const players = incoming.players || state.players;
        if (topChange && shouldCelebrateLeaderChange(topChange, players, state.celebrationQueue)) {
          next.celebrationQueue = enqueueLeaderCelebration(
            state.celebrationQueue,
            topChange.playerId,
          );
        }
      }

      if (incoming.spotlightTrades && incoming.spotlightTrades.length > 0) {
        if (!state.spotlightTrade) {
          for (const trade of incoming.spotlightTrades) {
            if (tryAcceptSpotlight(trade)) {
              next.spotlightTrade = trade;
              break;
            }
          }
        }
      }

      // Recalcule le PnL flottant (positions + equity globale) à partir
      // des mark prices live — le patch ne pousse pas le PnL à chaque tick.
      if (next.players.length > 0) {
        next.players = refreshAllPlayersPositions(next.players, next.market, next.paperStartingBalance);
      }

      return next;
    }),

  applyStatePatch: (patch) =>
    set((state) => {
      const next: GameState = { ...state } as GameState;

      // Player diffs: merge tracked scalar fields by id.
      if (patch.players && patch.players.length > 0) {
        const byId = new Map<string, PlayerStatePatch>();
        for (const p of patch.players) byId.set(p.id, p);
        next.players = state.players.map((p) => {
          const diff = byId.get(p.id);
          return diff ? { ...p, ...diff } : p;
        });
      }

      if (patch.addedPlayers && patch.addedPlayers.length > 0) {
        const known = new Set(next.players.map((p) => p.id));
        const additions = patch.addedPlayers.filter((p) => !known.has(p.id));
        if (additions.length > 0) next.players = [...next.players, ...additions];
      }

      if (patch.removedPlayerIds && patch.removedPlayerIds.length > 0) {
        const removed = new Set(patch.removedPlayerIds);
        next.players = next.players.filter((p) => !removed.has(p.id));
      }

      // Market diff: only changed pairs are present in the patch.
      if (patch.market) {
        next.market = { ...state.market, ...patch.market };
      }

      // Recent trades: prepend new trades and cap the feed at 50 entries.
      if (patch.newTrades && patch.newTrades.length > 0) {
        const seen = new Set<string>();
        const merged = [...patch.newTrades, ...state.recentTrades];
        next.recentTrades = merged.filter((t) => {
          if (seen.has(t.id)) return false;
          seen.add(t.id);
          return true;
        }).slice(0, 50);
      }

      // Event-level scalars only when explicitly included in the patch.
      if (patch.eventStarted !== undefined) {
        next.eventStarted = patch.eventStarted;
        if (!patch.eventStarted) {
          leaderCelebrationGuard.lastAt = 0;
          leaderCelebrationGuard.lastPlayerId = '';
        }
      }
      if (patch.eventStartTime !== undefined) next.eventStartTime = patch.eventStartTime;
      if (patch.eventEndTime !== undefined) next.eventEndTime = patch.eventEndTime;
      if (patch.eventMode !== undefined) next.eventMode = patch.eventMode;
      if (patch.platformMode !== undefined) next.platformMode = patch.platformMode;
      if (patch.paperStartingBalance !== undefined) next.paperStartingBalance = patch.paperStartingBalance;
      if (patch.marketDataSource !== undefined) next.marketDataSource = patch.marketDataSource;
      if (patch.teams !== undefined) {
        next.teams = patch.teams === null ? undefined : patch.teams;
      }
      if (patch.showcase !== undefined) {
        next.showcase = patch.showcase ?? null;
      }

      // One-shot signals reuse the same queue logic as updateState().
      if (patch.newBadges && patch.newBadges.length > 0) {
        const items = patch.newBadges.map((nb) => {
          const p = next.players.find((pl) => pl.id === nb.playerId);
          return { ...nb, playerName: p?.name || '???' };
        });
        next.badgeQueue = [...state.badgeQueue, ...items];
      }
      if (patch.leaderChanges && patch.leaderChanges.length > 0) {
        const topChange = patch.leaderChanges.find((lc) => lc.to === 1);
        if (topChange && shouldCelebrateLeaderChange(topChange, next.players, state.celebrationQueue)) {
          next.celebrationQueue = enqueueLeaderCelebration(
            state.celebrationQueue,
            topChange.playerId,
          );
        }
      }
      if (patch.spotlightTrades && patch.spotlightTrades.length > 0) {
        if (!state.spotlightTrade) {
          for (const trade of patch.spotlightTrades) {
            if (tryAcceptSpotlight(trade)) {
              next.spotlightTrade = trade;
              break;
            }
          }
        }
      }

      // À chaque tick marché (ou patch positions), recalcule le PnL
      // position par position et l'equity globale pour aligner dashboard ↔ terminal.
      if (next.players.length > 0 && (patch.market || patch.players || patch.addedPlayers)) {
        next.players = refreshAllPlayersPositions(next.players, next.market, next.paperStartingBalance);
      }

      return next;
    }),

  addBadgeToQueue: (item) =>
    set((s) => ({ badgeQueue: [...s.badgeQueue, item] })),

  shiftBadgeQueue: () =>
    set((s) => ({ badgeQueue: s.badgeQueue.slice(1) })),

  addCelebration: (item) =>
    set((s) => ({ celebrationQueue: [...s.celebrationQueue, item] })),

  shiftCelebration: () =>
    set((s) => ({ celebrationQueue: s.celebrationQueue.slice(1) })),

  dismissSpotlight: () =>
    set(() => ({ spotlightTrade: null })),

  /**
   * Reset des files locales au démarrage d'un nouveau round : on jette
   * spotlights, badges, célébrations et trades de l'événement précédent
   * pour repartir d'un dashboard propre.
   */
  resetClientLiveState: () => {
    resetSpotlightNotifications();
    set(() => ({
      badgeQueue: [],
      celebrationQueue: [],
      spotlightTrade: null,
      recentTrades: [],
      newBadges: [],
      leaderChanges: [],
      spotlightTrades: [],
    }));
  },
}));
