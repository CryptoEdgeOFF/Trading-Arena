import { create } from 'zustand';

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
  biggestTradeVolume: number;
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
}

export interface Badge {
  type: string;
  label: string;
  description: string;
  icon: string;
  awardedAt: number;
}

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
}

export type EventMode = '1v1' | '1v1v1' | '1v1v1v1' | '4v4';
export type PlatformMode = 'kraken' | 'paper';
export type MarketDataSource = 'kraken' | 'hyperliquid';

export interface TeamInfo {
  name: string;
  color: string;
  playerIds: string[];
}

interface GameState {
  players: Player[];
  recentTrades: Trade[];
  market: Record<string, MarketTicker>;
  eventStarted: boolean;
  eventStartTime: number | null;
  platformMode: PlatformMode;
  paperStartingBalance: number;
  marketDataSource: MarketDataSource;
  newBadges: { playerId: string; badge: Badge }[];
  leaderChanges: { playerId: string; from: number; to: number }[];
  spotlightTrades: SpotlightTrade[];
  eventMode: EventMode;
  teams?: [TeamInfo, TeamInfo];

  badgeQueue: { playerId: string; playerName: string; badge: Badge }[];
  celebrationQueue: { type: 'leader-change' | 'big-trade'; playerId: string }[];
  spotlightQueue: SpotlightTrade[];

  updateState: (state: Partial<GameState>) => void;
  addBadgeToQueue: (item: { playerId: string; playerName: string; badge: Badge }) => void;
  shiftBadgeQueue: () => void;
  addCelebration: (item: { type: 'leader-change' | 'big-trade'; playerId: string }) => void;
  shiftCelebration: () => void;
  shiftSpotlight: () => void;
}

export const useGameStore = create<GameState>((set) => ({
  players: [],
  recentTrades: [],
  market: {},
  eventStarted: false,
  eventStartTime: null,
  platformMode: 'kraken',
  paperStartingBalance: 10000,
  marketDataSource: 'kraken',
  newBadges: [],
  leaderChanges: [],
  spotlightTrades: [],
  eventMode: '1v1',
  teams: undefined,
  badgeQueue: [],
  celebrationQueue: [],
  spotlightQueue: [],

  updateState: (incoming) =>
    set((state) => {
      const next = { ...state, ...incoming };

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
        if (topChange) {
          next.celebrationQueue = [
            ...state.celebrationQueue,
            { type: 'leader-change', playerId: topChange.playerId },
          ];
        }
      }

      if (incoming.spotlightTrades && incoming.spotlightTrades.length > 0) {
        next.spotlightQueue = [...state.spotlightQueue, ...incoming.spotlightTrades];
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

  shiftSpotlight: () =>
    set((s) => ({ spotlightQueue: s.spotlightQueue.slice(1) })),
}));
