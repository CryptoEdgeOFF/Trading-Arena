export interface Player {
  id: string;
  name: string;
  color: string;
  avatar: string | null;
  apiKey: string;
  apiSecret: string;
  traderCode: string;
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

export interface StoredPlayer {
  id: string;
  name: string;
  color: string;
  avatar: string | null;
  apiKey: string;
  apiSecret: string;
  traderCode: string;
  active: boolean;
  initialBalance?: number | null;
  currentBalance?: number;
  availableMargin?: number;
  usedMargin?: number;
  feesPaid?: number;
  pnl?: number;
  pnlPercent?: number;
  tradeCount?: number;
  trades?: Trade[];
  openPositions?: Position[];
  openOrders?: Order[];
  rank?: number;
  previousRank?: number;
  badges?: Badge[];
  winStreak?: number;
  longestPositionMinutes?: number;
  biggestTradeVolume?: number;
  bestTradePercent?: number;
  lastUpdate?: number;
  connected?: boolean;
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
  // Quantity (in base units) to close when SL/TP triggers; null/undefined => close full remaining size.
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
}

export type BadgeType =
  | 'first-blood'
  | 'whale-alert'
  | 'sniper'
  | 'diamond-hands'
  | 'speed-demon'
  | 'green-machine';

export interface Badge {
  type: BadgeType;
  label: string;
  description: string;
  icon: string;
  awardedAt: number;
}

export type EventMode = '1v1' | '1v1v1' | '1v1v1v1' | '4v4';
export type PlatformMode = 'kraken' | 'paper';
export type MarketDataSource = 'kraken' | 'binance';

export interface TeamInfo {
  name: string;
  color: string;
  playerIds: string[];
}

export interface EventConfig {
  mode: EventMode;
  teams?: [TeamInfo, TeamInfo];
  platformMode: PlatformMode;
  paperStartingBalance: number;
  marketDataSource: MarketDataSource;
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

export interface GameState {
  players: Player[];
  recentTrades: Trade[];
  market: Record<string, MarketTicker>;
  eventStarted: boolean;
  eventStartTime: number | null;
  eventMode: EventMode;
  teams?: [TeamInfo, TeamInfo];
  platformMode: PlatformMode;
  paperStartingBalance: number;
  marketDataSource: MarketDataSource;
  newBadges: { playerId: string; badge: Badge }[];
  leaderChanges: { playerId: string; from: number; to: number }[];
  spotlightTrades: SpotlightTrade[];
}

/**
 * Lightweight player diff broadcast on every tick instead of the full
 * Player object. Only includes scalar fields the leaderboard cares about,
 * so a 500-trader competition stays under a few KB per broadcast.
 */
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
}

export interface StatePatch {
  /** Players whose tracked scalar fields changed since the last broadcast. */
  players?: PlayerStatePatch[];
  /** New players that did not exist in the previous snapshot. */
  addedPlayers?: Player[];
  /** Players that disappeared from the active roster. */
  removedPlayerIds?: string[];
  /** Tickers whose price-related fields changed since the last broadcast. */
  market?: Record<string, MarketTicker>;
  /** Trades that did not exist in the previous broadcast. */
  newTrades?: Trade[];
  newBadges?: { playerId: string; badge: Badge }[];
  leaderChanges?: { playerId: string; from: number; to: number }[];
  spotlightTrades?: SpotlightTrade[];
  eventStarted?: boolean;
  eventStartTime?: number | null;
  eventMode?: EventMode;
  teams?: [TeamInfo, TeamInfo] | null;
  platformMode?: PlatformMode;
  paperStartingBalance?: number;
  marketDataSource?: MarketDataSource;
}

export const BADGE_DEFS: Record<BadgeType, Omit<Badge, 'awardedAt'>> = {
  'first-blood': {
    type: 'first-blood',
    label: 'First Blood',
    description: 'Premier trade de l\'événement',
    icon: '🩸',
  },
  'whale-alert': {
    type: 'whale-alert',
    label: 'Whale Alert',
    description: 'Plus gros trade en volume',
    icon: '🐋',
  },
  sniper: {
    type: 'sniper',
    label: 'Sniper',
    description: 'Meilleur trade unique en %',
    icon: '🎯',
  },
  'diamond-hands': {
    type: 'diamond-hands',
    label: 'Diamond Hands',
    description: 'Plus longue position ouverte',
    icon: '💎',
  },
  'speed-demon': {
    type: 'speed-demon',
    label: 'Speed Demon',
    description: 'Plus grand nombre de trades',
    icon: '⚡',
  },
  'green-machine': {
    type: 'green-machine',
    label: 'Green Machine',
    description: 'Plus longue série gagnante',
    icon: '🟢',
  },
};
