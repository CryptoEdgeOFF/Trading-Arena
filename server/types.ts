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
  /** Plus gros PNL réalisé (en USD) sur un trade clôturé. Utilisé pour le badge Whale. */
  biggestTradePnl: number;
  bestTradePercent: number;
  lastUpdate: number;
  connected: boolean;
  /**
   * `true` pour un joueur d'arène online (compete). Exclu du dashboard LIVE et
   * du roster LIVE. Persisté pour que l'isolation survive aux refreshs / cold
   * starts, indépendamment du set en mémoire `onlineCompetitionPlayerIds`.
   */
  isCompetitionPlayer?: boolean;
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
  biggestTradePnl?: number;
  /** @deprecated remplacé par biggestTradePnl. Conservé pour migration des anciennes rosters. */
  biggestTradeVolume?: number;
  bestTradePercent?: number;
  lastUpdate?: number;
  connected?: boolean;
  isCompetitionPlayer?: boolean;
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
  /** Mark au moment du placement — sert au déclenchement « au prix limite ». */
  placedAtMark?: number | null;
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
  /** Durée de l'événement live en minutes (0 = pas de timer auto). */
  eventDurationMinutes?: number;
}

export type SpotlightReason = 'manual' | 'stop-loss' | 'take-profit' | 'liquidation';

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
  /** Présent uniquement pour `action: 'close'`. */
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
  /** false hors heures d'ouverture (forex, indices, commodities). */
  marketOpen?: boolean;
  /** Ex. « Marché fermé » quand marketOpen === false. */
  marketClosedLabel?: string | null;
}

export interface GameState {
  players: Player[];
  recentTrades: Trade[];
  market: Record<string, MarketTicker>;
  eventStarted: boolean;
  eventStartTime: number | null;
  /** Timestamp fin auto (start + durée admin). Null si pas de timer. */
  eventEndTime: number | null;
  eventMode: EventMode;
  teams?: [TeamInfo, TeamInfo];
  platformMode: PlatformMode;
  paperStartingBalance: number;
  marketDataSource: MarketDataSource;
  newBadges: { playerId: string; badge: Badge }[];
  leaderChanges: { playerId: string; from: number; to: number }[];
  spotlightTrades: SpotlightTrade[];
  /** Showcase courant (archive d'un round précédent diffusée sur le dashboard). */
  showcase?: ShowcasePayload | null;
}

/** Payload diffusé pour afficher une archive de round sur le dashboard. */
export interface ShowcasePayload {
  mode: 'podium' | 'stats';
  archive: ArchivedEventSnapshot;
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
  // Snapshots complets de l'état des positions/ordres ouverts du joueur.
  // Inclus seulement quand le contenu (taille de l'array, ids, paires, sides,
  // mark price ou pnl par position/ordre) a changé depuis le dernier patch.
  // Permet au dashboard Live d'afficher en temps réel les positions et
  // limites de chaque trader sans avoir à interroger le serveur.
  openPositions?: Position[];
  openOrders?: Order[];
  /** Snapshot complet des badges — inclus quand la liste change. */
  badges?: Badge[];
  /**
   * Snapshot complet de l'historique des trades du joueur — inclus quand le
   * nombre de trades change (ouverture/clôture). Indispensable pour que la
   * carte joueur affiche l'historique à jour ET que le recalcul client du PnL
   * (réalisé) prenne en compte la position qui vient d'être fermée, sans
   * attendre un refresh complet.
   */
  trades?: Trade[];
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
  eventEndTime?: number | null;
  eventMode?: EventMode;
  teams?: [TeamInfo, TeamInfo] | null;
  platformMode?: PlatformMode;
  paperStartingBalance?: number;
  marketDataSource?: MarketDataSource;
  /** Push de l'archive showcase courante. `null` = retire l'overlay. */
  showcase?: ShowcasePayload | null;
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
    description: 'Plus gros gain sur un trade clôturé',
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
