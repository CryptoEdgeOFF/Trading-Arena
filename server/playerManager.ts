import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';
import {
  BADGE_DEFS,
  Badge,
  BadgeType,
  EventConfig,
  MarketDataSource,
  EventMode,
  GameState,
  PlatformMode,
  Player,
  Position,
  SpotlightTrade,
  StoredPlayer,
  TeamInfo,
} from './types.js';
import * as kraken from './kraken.js';
import { PaperTradingEngine, type PaperOrderInput } from './exchangePaperEngine.js';

const PLAYER_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f97316',
  '#eab308', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6',
  '#a855f7', '#d946ef', '#f472b6', '#fb923c', '#a3e635',
  '#2dd4bf', '#38bdf8', '#818cf8', '#c084fc', '#fb7185',
];

const DEFAULT_PAPER_BALANCE = 10_000;
const ROSTER_FILE = path.join(process.cwd(), 'data', 'roster.json');
const ROSTER_DB_KEY = 'paper-roster';

function cleanPair(instrument: string): string {
  return instrument
    .replace(/^pf_|^fi_/i, '')
    .replace(/_/g, '/')
    .toUpperCase()
    .replace(/XXBT/g, 'BTC')
    .replace(/XBT/g, 'BTC');
}

export class PlayerManager {
  private players: Map<string, Player> = new Map();
  private eventStarted = false;
  private eventStartTime: number | null = null;
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private tickerInterval: ReturnType<typeof setInterval> | null = null;
  private playerQueue: string[] = [];
  private currentPollIndex = 0;
  private firstTradeAwarded = false;
  private onUpdate: (state: GameState) => void;
  private pendingBadges: { playerId: string; badge: Badge }[] = [];
  private pendingLeaderChanges: { playerId: string; from: number; to: number }[] = [];
  private pendingSpotlights: SpotlightTrade[] = [];
  private badgeHolders: Map<BadgeType, string> = new Map();
  private tickerPrices: Record<string, number> = {};
  private eventMode: EventMode = '1v1';
  private platformMode: PlatformMode = 'kraken';
  private marketDataSource: MarketDataSource = 'kraken';
  private paperStartingBalance = DEFAULT_PAPER_BALANCE;
  private teams?: [TeamInfo, TeamInfo];
  private paperEngine: PaperTradingEngine;
  private competitionPaperRuntimeStarted = false;
  private onlineCompetitionPlayerIds = new Set<string>();
  private pool: Pool | null = null;
  private isServerless = Boolean(process.env.NETLIFY);
  readonly ready: Promise<void>;

  constructor(onUpdate: (state: GameState) => void) {
    this.onUpdate = onUpdate;
    const databaseUrl = process.env.DATABASE_URL?.trim();
    if (databaseUrl) {
      this.pool = new Pool({
        connectionString: databaseUrl,
        ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
      });
    }
    this.paperEngine = new PaperTradingEngine(() => {
      this.updateRankings();
      this.checkBadges();
      this.saveRoster();
      this.broadcastState();
    });
    this.paperEngine.setStartingBalance(this.paperStartingBalance);
    this.ready = this.loadRoster();
  }

  private async ensureDbStore(): Promise<void> {
    if (!this.pool) return;
    await this.pool.query(`
      create table if not exists competition_store (
        key text primary key,
        value jsonb not null,
        updated_at timestamptz not null default now()
      )
    `);
    await this.pool.query(`
      create table if not exists comp_paper_players (
        id text primary key,
        data jsonb not null,
        updated_at timestamptz not null default now()
      )
    `);
  }

  private applyStoredRoster(data: StoredPlayer[]): void {
    this.players.clear();
    for (const stored of data) {
      const player = this.createPlayerFromStored(stored);
      this.players.set(player.id, player);
    }
  }

  private currentRoster(): StoredPlayer[] {
    return Array.from(this.players.values()).map((player) => ({
      id: player.id,
      name: player.name,
      color: player.color,
      avatar: player.avatar,
      apiKey: player.apiKey,
      apiSecret: player.apiSecret,
      traderCode: player.traderCode,
      active: player.active,
      initialBalance: player.initialBalance,
      currentBalance: player.currentBalance,
      availableMargin: player.availableMargin,
      usedMargin: player.usedMargin,
      feesPaid: player.feesPaid,
      pnl: player.pnl,
      pnlPercent: player.pnlPercent,
      tradeCount: player.tradeCount,
      trades: player.trades,
      openPositions: player.openPositions,
      openOrders: player.openOrders,
      rank: player.rank,
      previousRank: player.previousRank,
      badges: player.badges,
      winStreak: player.winStreak,
      longestPositionMinutes: player.longestPositionMinutes,
      biggestTradeVolume: player.biggestTradeVolume,
      bestTradePercent: player.bestTradePercent,
      lastUpdate: player.lastUpdate,
      connected: player.connected,
    }));
  }

  private async loadRoster(): Promise<void> {
    try {
      if (this.pool) {
        await this.ensureDbStore();

        // Prefer the row-per-player table to avoid concurrent-write races
        // that could overwrite freshly-created players in the legacy blob.
        const rows = await this.pool.query('select id, data from comp_paper_players');
        if (rows.rowCount && rows.rowCount > 0) {
          const stored: StoredPlayer[] = rows.rows.map((r) => r.data as StoredPlayer);
          this.applyStoredRoster(stored);
          console.log(`Loaded ${this.players.size} players from comp_paper_players`);
          return;
        }

        // Migrate from the legacy paper-roster blob if present.
        const legacy = await this.pool.query('select value from competition_store where key = $1 limit 1', [ROSTER_DB_KEY]);
        if (Array.isArray(legacy.rows[0]?.value)) {
          const data = legacy.rows[0].value as StoredPlayer[];
          this.applyStoredRoster(data);
          await this.upsertAllPlayers();
          console.log(`Migrated ${data.length} players from legacy blob to comp_paper_players`);
          return;
        }

        if (fs.existsSync(ROSTER_FILE)) {
          const data: StoredPlayer[] = JSON.parse(fs.readFileSync(ROSTER_FILE, 'utf-8'));
          this.applyStoredRoster(data);
          await this.upsertAllPlayers();
          console.log(`Imported ${data.length} players from JSON roster into comp_paper_players`);
          return;
        }

        console.log('Initialized empty Postgres roster');
        return;
      }

      if (!fs.existsSync(ROSTER_FILE)) return;
      const data: StoredPlayer[] = JSON.parse(fs.readFileSync(ROSTER_FILE, 'utf-8'));
      this.applyStoredRoster(data);
      console.log(`Loaded ${data.length} players from roster`);
    } catch (err) {
      console.error('Failed to load roster:', err);
    }
  }

  private saveRoster(): void {
    if (this.pool) {
      // Avoid global stale writes only in serverless. On a persistent Node
      // server there is a single long-lived trading runtime, so timer/WS ticks
      // should persist SL/TP, limit fills and live PnL like local mode.
      if (!this.isServerless) void this.saveRosterToDb();
      return;
    }
    try {
      const dir = path.dirname(ROSTER_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      fs.writeFileSync(ROSTER_FILE, JSON.stringify(this.currentRoster(), null, 2));
    } catch (err) {
      console.error('Failed to save roster:', err);
    }
  }

  /**
   * Batched UPSERT of every in-memory player into the row-per-player table.
   * Each row is updated independently of the others, so concurrent saves
   * from different Lambdas can no longer wipe each other's freshly-created
   * players.
   */
  private async saveRosterToDb(): Promise<void> {
    if (!this.pool) return;
    try {
      await this.ensureDbStore();
      await this.upsertAllPlayers();
    } catch (err) {
      console.error('Failed to save Postgres roster:', err);
    }
  }

  private async upsertAllPlayers(): Promise<void> {
    if (!this.pool) return;
    const players = this.currentRoster();
    if (players.length === 0) return;

    // Build a single multi-row INSERT ... ON CONFLICT DO UPDATE so we keep a
    // single round-trip even with many players.
    const placeholders: string[] = [];
    const params: string[] = [];
    players.forEach((p, i) => {
      placeholders.push(`($${2 * i + 1}, $${2 * i + 2}::jsonb)`);
      params.push(p.id, JSON.stringify(p));
    });
    await this.pool.query(
      `insert into comp_paper_players (id, data) values ${placeholders.join(', ')}
       on conflict (id) do update set data = excluded.data, updated_at = now()`,
      params,
    );
  }

  private async upsertSinglePlayer(playerId: string): Promise<void> {
    if (!this.pool) return;
    const player = this.players.get(playerId);
    if (!player) return;
    const stored = this.currentRoster().find((p) => p.id === playerId);
    if (!stored) return;
    try {
      await this.pool.query(
        `insert into comp_paper_players (id, data) values ($1, $2::jsonb)
         on conflict (id) do update set data = excluded.data, updated_at = now()`,
        [playerId, JSON.stringify(stored)],
      );
    } catch (err) {
      console.error('Failed to upsert player row:', err);
    }
  }

  private async deletePlayerRow(playerId: string): Promise<void> {
    if (!this.pool) return;
    try {
      await this.pool.query('delete from comp_paper_players where id = $1', [playerId]);
    } catch (err) {
      console.error('Failed to delete player row:', err);
    }
  }

  /**
   * Awaitable persist used by serverless routes to ensure the roster
   * is durable in Postgres before responding to the client.
   */
  async persist(): Promise<void> {
    if (this.pool) {
      await this.saveRosterToDb();
      return;
    }
    this.saveRoster();
  }

  /**
   * Targeted persist for a single player. Cheaper than rewriting the whole
   * roster and avoids touching unrelated rows on serverless write paths.
   */
  async persistPlayer(playerId: string): Promise<void> {
    if (this.pool) {
      await this.upsertSinglePlayer(playerId);
      return;
    }
    this.saveRoster();
  }

  /**
   * Re-read the roster from Postgres and overwrite in-memory state.
   * Required on serverless platforms where multiple Lambda instances
   * may hold stale in-memory copies.
   */
  async refresh(): Promise<void> {
    if (!this.pool) return;
    try {
      const rows = await this.pool.query('select id, data from comp_paper_players');
      if (rows.rowCount && rows.rowCount > 0) {
        const stored: StoredPlayer[] = rows.rows.map((r) => r.data as StoredPlayer);
        this.applyStoredRoster(stored);
        return;
      }
      // Fallback to legacy blob if the new table is still empty (first boot).
      const legacy = await this.pool.query('select value from competition_store where key = $1 limit 1', [ROSTER_DB_KEY]);
      if (Array.isArray(legacy.rows[0]?.value)) {
        this.applyStoredRoster(legacy.rows[0].value as StoredPlayer[]);
      }
    } catch (err) {
      console.error('Failed to refresh Postgres roster:', err);
    }
  }

  private createTraderCode(): string {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    do {
      code = Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
    } while (Array.from(this.players.values()).some((player) => player.traderCode === code));
    return code;
  }

  private createPlayerFromStored(stored: StoredPlayer): Player {
    return {
      ...stored,
      traderCode: stored.traderCode || this.createTraderCode(),
      initialBalance: stored.initialBalance ?? null,
      currentBalance: stored.currentBalance ?? 0,
      availableMargin: stored.availableMargin ?? 0,
      usedMargin: stored.usedMargin ?? 0,
      feesPaid: stored.feesPaid ?? 0,
      pnl: stored.pnl ?? 0,
      pnlPercent: stored.pnlPercent ?? 0,
      tradeCount: stored.tradeCount ?? 0,
      trades: stored.trades ?? [],
      openPositions: stored.openPositions ?? [],
      openOrders: stored.openOrders ?? [],
      rank: stored.rank ?? 0,
      previousRank: stored.previousRank ?? 0,
      badges: stored.badges ?? [],
      winStreak: stored.winStreak ?? 0,
      longestPositionMinutes: stored.longestPositionMinutes ?? 0,
      biggestTradeVolume: stored.biggestTradeVolume ?? 0,
      bestTradePercent: stored.bestTradePercent ?? 0,
      lastUpdate: stored.lastUpdate ?? 0,
      connected: stored.connected ?? false,
    };
  }

  private resetCompetitionState(players = this.getActivePlayers()): void {
    this.pendingBadges = [];
    this.pendingLeaderChanges = [];
    this.pendingSpotlights = [];
    this.badgeHolders.clear();
    this.firstTradeAwarded = false;

    for (const player of players) {
      player.initialBalance = null;
      player.currentBalance = 0;
      player.availableMargin = 0;
      player.usedMargin = 0;
      player.feesPaid = 0;
      player.pnl = 0;
      player.pnlPercent = 0;
      player.tradeCount = 0;
      player.trades = [];
      player.openPositions = [];
      player.openOrders = [];
      player.rank = 0;
      player.previousRank = 0;
      player.badges = [];
      player.winStreak = 0;
      player.longestPositionMinutes = 0;
      player.biggestTradeVolume = 0;
      player.bestTradePercent = 0;
      player.lastUpdate = Date.now();
      player.connected = false;
    }
  }

  private toDashboardPlayer(player: Player): Omit<Player, 'apiKey' | 'apiSecret' | 'traderCode'> {
    const { apiKey: _apiKey, apiSecret: _apiSecret, traderCode: _traderCode, ...rest } = player;
    return rest;
  }

  private toRosterPlayer(player: Player): Omit<Player, 'apiKey' | 'apiSecret'> {
    const { apiKey: _apiKey, apiSecret: _apiSecret, ...rest } = player;
    return rest;
  }

  registerPlayer(name: string, apiKey = '', apiSecret = ''): Player {
    const id = crypto.randomUUID();
    const colorIndex = this.players.size % PLAYER_COLORS.length;
    const player: Player = {
      id,
      name,
      color: PLAYER_COLORS[colorIndex],
      avatar: null,
      apiKey,
      apiSecret,
      traderCode: this.createTraderCode(),
      active: false,
      initialBalance: null,
      currentBalance: 0,
      availableMargin: 0,
      usedMargin: 0,
      feesPaid: 0,
      pnl: 0,
      pnlPercent: 0,
      tradeCount: 0,
      trades: [],
      openPositions: [],
      openOrders: [],
      rank: 0,
      previousRank: 0,
      badges: [],
      winStreak: 0,
      longestPositionMinutes: 0,
      biggestTradeVolume: 0,
      bestTradePercent: 0,
      lastUpdate: Date.now(),
      connected: false,
    };
    this.players.set(id, player);
    this.saveRoster();
    return player;
  }

  setAvatar(id: string, avatarUrl: string): Player | null {
    const player = this.players.get(id);
    if (!player) return null;
    player.avatar = avatarUrl.startsWith('/') || avatarUrl.startsWith('data:') ? avatarUrl : `/uploads/${avatarUrl}`;
    this.saveRoster();
    return player;
  }

  removePlayer(id: string): void {
    this.players.delete(id);
    this.playerQueue = this.playerQueue.filter((playerId) => playerId !== id);
    if (this.pool) {
      void this.deletePlayerRow(id);
    } else {
      this.saveRoster();
    }
  }

  togglePlayer(id: string): Player | null {
    const player = this.players.get(id);
    if (!player) return null;

    player.active = !player.active;
    if (player.active) {
      if (!this.playerQueue.includes(id)) this.playerQueue.push(id);
    } else {
      this.playerQueue = this.playerQueue.filter((playerId) => playerId !== id);
      player.rank = 0;
      player.previousRank = 0;
      player.connected = false;
    }

    this.saveRoster();
    this.rebuildRankings();
    this.broadcastState();
    return player;
  }

  setPlayerActive(id: string, active: boolean): Player | null {
    const player = this.players.get(id);
    if (!player) return null;
    if (player.active === active) return player;

    player.active = active;
    if (player.active) {
      if (!this.playerQueue.includes(id)) this.playerQueue.push(id);
    } else {
      this.playerQueue = this.playerQueue.filter((playerId) => playerId !== id);
      player.rank = 0;
      player.previousRank = 0;
      player.connected = false;
    }

    this.saveRoster();
    this.rebuildRankings();
    this.broadcastState();
    return player;
  }

  getPlayers(): Player[] {
    return Array.from(this.players.values());
  }

  getActivePlayers(): Player[] {
    return this.getPlayers().filter((player) => player.active && !this.onlineCompetitionPlayerIds.has(player.id));
  }

  getPlayerById(id: string): Player | null {
    return this.players.get(id) || null;
  }

  findPlayerByTraderCode(code: string): Player | null {
    const normalized = code.trim().toUpperCase();
    return this.getPlayers().find((player) => player.traderCode === normalized) || null;
  }

  getPublicPlayers(): Omit<Player, 'apiKey' | 'apiSecret' | 'traderCode'>[] {
    return this.getActivePlayers().map((player) => this.toDashboardPlayer(player));
  }

  getRosterPublic(): Omit<Player, 'apiKey' | 'apiSecret'>[] {
    return this.getPlayers()
      .filter((player) => !this.onlineCompetitionPlayerIds.has(player.id))
      .map((player) => this.toRosterPlayer(player));
  }

  markOnlineCompetitionPlayers(playerIds: string[]): void {
    let changed = false;
    for (const playerId of playerIds) {
      if (!this.onlineCompetitionPlayerIds.has(playerId)) {
        this.onlineCompetitionPlayerIds.add(playerId);
        changed = true;
      }
      this.playerQueue = this.playerQueue.filter((id) => id !== playerId);
    }
    if (changed) this.broadcastState();
  }

  unmarkOnlineCompetitionPlayers(playerIds: string[]): void {
    let changed = false;
    for (const playerId of playerIds) {
      if (this.onlineCompetitionPlayerIds.delete(playerId)) {
        changed = true;
      }
    }
    if (changed) this.broadcastState();
  }

  isOnlineCompetitionPlayer(playerId: string): boolean {
    return this.onlineCompetitionPlayerIds.has(playerId);
  }

  isPaperMarketActive(): boolean {
    return this.platformMode === 'paper' || this.competitionPaperRuntimeStarted;
  }

  /**
   * Prépare un joueur de compétition online pour trader :
   *  - l'isole du dashboard live (set onlineCompetitionPlayerIds)
   *  - l'active sans le pousser dans la queue de polling
   *  - garantit son baseline (balance / margin)
   *  - démarre/attache le moteur paper sans réinitialiser ses positions
   * Retourne le joueur prêt à trader.
   */
  async setupCompetitionPaperPlayer(playerId: string): Promise<Player | null> {
    const player = this.players.get(playerId);
    if (!player) return null;

    this.onlineCompetitionPlayerIds.add(player.id);
    this.playerQueue = this.playerQueue.filter((id) => id !== player.id);

    if (!player.active) {
      player.active = true;
      this.saveRoster();
    }

    this.ensurePaperPlayerBaseline(player);
    this.saveRoster();

    if (!this.competitionPaperRuntimeStarted) {
      await this.paperEngine.start([player], { reset: false });
      this.competitionPaperRuntimeStarted = true;
    } else {
      this.paperEngine.trackPlayers([player]);
    }

    this.broadcastState();
    return player;
  }

  setEventConfig(config: EventConfig): void {
    this.eventMode = config.mode;
    this.teams = config.mode === '4v4' ? config.teams : undefined;
    this.platformMode = config.platformMode;
    this.marketDataSource = config.marketDataSource;
    this.paperStartingBalance = config.paperStartingBalance;
    this.paperEngine.setMarketDataSource(this.marketDataSource);
    this.paperEngine.setStartingBalance(this.paperStartingBalance);
  }

  getEventConfig(): EventConfig {
    return {
      mode: this.eventMode,
      teams: this.teams,
      platformMode: this.platformMode,
      paperStartingBalance: this.paperStartingBalance,
      marketDataSource: this.marketDataSource,
    };
  }

  getPlatformMode(): PlatformMode {
    return this.platformMode;
  }

  getPaperStartingBalance(): number {
    return this.paperStartingBalance;
  }

  getMarketDataSource(): MarketDataSource {
    return this.marketDataSource;
  }

  getSupportedPaperPairs(): string[] {
    return this.paperEngine.getSupportedPairs();
  }

  getPaperMarketSnapshot() {
    return this.paperEngine.getMarketSnapshot();
  }

  async refreshPaperMarketSnapshot() {
    return this.paperEngine.refreshMarketSnapshot();
  }

  getPaperFeeRates() {
    return this.paperEngine.getFeeRates();
  }

  prepareStart(): void {
    if (this.eventMode === '4v4' && this.teams) {
      const allTeamIds = new Set([...this.teams[0].playerIds, ...this.teams[1].playerIds]);
      for (const player of this.players.values()) {
        player.active = allTeamIds.has(player.id);
      }
      this.playerQueue = Array.from(allTeamIds);
      this.saveRoster();
    }
  }

  async startEvent(): Promise<void> {
    if (this.eventStarted) return;

    const active = this.getActivePlayers();
    if (active.length === 0) return;

    this.stopRealtimeLoops();
    this.resetCompetitionState(active);
    this.eventStarted = true;
    this.eventStartTime = Date.now();
    this.playerQueue = active.map((player) => player.id);

    if (this.platformMode === 'paper') {
      await this.paperEngine.start(active);
    } else {
      await this.initializeBalances();
      this.startPolling();
    }

    this.rebuildRankings();
    this.broadcastState();
  }

  stopEvent(): void {
    this.eventStarted = false;
    this.stopRealtimeLoops();
    this.broadcastState();
  }

  isStarted(): boolean {
    return this.eventStarted;
  }

  getEventStartTime(): number | null {
    return this.eventStartTime;
  }

  async placePaperOrder(playerId: string, order: PaperOrderInput): Promise<void> {
    if (!this.eventStarted || this.platformMode !== 'paper') {
      throw new Error('Le paper trading n’est pas disponible');
    }

    const player = this.players.get(playerId);
    if (!player || !player.active) {
      throw new Error('Trader introuvable');
    }

    const result = await this.paperEngine.placeOrder(player, order);
    this.pendingSpotlights.push(result.spotlight);
    if (!this.firstTradeAwarded) {
      this.firstTradeAwarded = true;
      this.awardBadge(player, 'first-blood');
    }
    this.updateRankings();
    this.checkBadges();
    this.saveRoster();
    this.broadcastState();
  }

  async placeCompetitionPaperOrder(playerId: string, order: PaperOrderInput): Promise<void> {
    const player = this.players.get(playerId);
    if (!player) {
      throw new Error('Trader introuvable');
    }

    await this.ensureCompetitionPaperRuntime(player);
    const result = await this.paperEngine.placeOrder(player, order);
    void result;
    await this.persistPlayer(player.id);
    this.broadcastState();
  }

  async closePaperPosition(playerId: string, pair: string, partialSize?: number): Promise<void> {
    if (!this.eventStarted || this.platformMode !== 'paper') {
      throw new Error('Le paper trading n’est pas disponible');
    }

    const player = this.players.get(playerId);
    if (!player || !player.active) {
      throw new Error('Trader introuvable');
    }

    const result = await this.paperEngine.closePosition(player, pair, partialSize);
    this.pendingSpotlights.push(result.spotlight);
    this.updateRankings();
    this.checkBadges();
    this.saveRoster();
    this.broadcastState();
  }

  async closeCompetitionPaperPosition(playerId: string, pair: string, partialSize?: number): Promise<void> {
    const player = this.players.get(playerId);
    if (!player) {
      throw new Error('Trader introuvable');
    }
    await this.ensureCompetitionPaperRuntime(player);
    const result = await this.paperEngine.closePosition(player, pair, partialSize);
    void result;
    await this.persistPlayer(player.id);
    this.broadcastState();
  }

  cancelPaperOrder(playerId: string, orderId: string): void {
    if (!this.eventStarted || this.platformMode !== 'paper') {
      throw new Error('Le paper trading n’est pas disponible');
    }

    const player = this.players.get(playerId);
    if (!player || !player.active) {
      throw new Error('Trader introuvable');
    }

    this.paperEngine.cancelOrder(player, orderId);
    this.saveRoster();
    this.broadcastState();
  }

  async cancelCompetitionPaperOrder(playerId: string, orderId: string): Promise<void> {
    const player = this.players.get(playerId);
    if (!player) {
      throw new Error('Trader introuvable');
    }
    await this.ensureCompetitionPaperRuntime(player);
    this.paperEngine.cancelOrder(player, orderId);
    await this.persistPlayer(player.id);
    this.broadcastState();
  }

  async finalizeCompetitionPaperPlayer(playerId: string): Promise<void> {
    const player = this.players.get(playerId);
    if (!player) return;

    await this.ensureCompetitionPaperRuntime(player);

    for (const order of [...player.openOrders]) {
      if (order.status === 'open') {
        this.paperEngine.cancelOrder(player, order.id);
      }
    }

    for (const position of [...player.openPositions]) {
      if (player.openPositions.some((entry) => entry.id === position.id)) {
        await this.paperEngine.closePosition(player, position.id);
      }
    }

    player.connected = false;
    player.lastUpdate = Date.now();
    await this.persistPlayer(player.id);
    this.broadcastState();
  }

  updatePaperPositionRisk(
    playerId: string,
    pair: string,
    stopLoss: number | null,
    takeProfit: number | null,
    options: { stopLossSize?: number | null; takeProfitSize?: number | null } = {},
  ): void {
    if (!this.eventStarted || this.platformMode !== 'paper') {
      throw new Error('Le paper trading n’est pas disponible');
    }

    const player = this.players.get(playerId);
    if (!player || !player.active) {
      throw new Error('Trader introuvable');
    }

    this.paperEngine.updatePositionRisk(player, pair, stopLoss, takeProfit, options);
    this.saveRoster();
    this.broadcastState();
  }

  async updateCompetitionPaperPositionRisk(
    playerId: string,
    pair: string,
    stopLoss: number | null,
    takeProfit: number | null,
    options: { stopLossSize?: number | null; takeProfitSize?: number | null } = {},
  ): Promise<void> {
    const player = this.players.get(playerId);
    if (!player) {
      throw new Error('Trader introuvable');
    }
    await this.ensureCompetitionPaperRuntime(player);
    this.paperEngine.updatePositionRisk(player, pair, stopLoss, takeProfit, options);
    await this.persistPlayer(player.id);
    this.broadcastState();
  }

  async refreshCompetitionPaperPlayer(
    playerId: string,
    options: { forceMarketRefresh?: boolean; persist?: boolean } = {},
  ): Promise<Player | null> {
    const player = this.players.get(playerId);
    if (!player) return null;

    await this.ensureCompetitionPaperRuntime(player);
    if (options.forceMarketRefresh) {
      await this.paperEngine.refreshMarketSnapshot();
    }
    if (options.persist) {
      await this.persistPlayer(player.id);
    }
    this.broadcastState();
    return player;
  }

  private ensurePaperPlayerBaseline(player: Player): void {
    if (player.initialBalance != null) return;
    player.initialBalance = this.paperStartingBalance;
    player.currentBalance = this.paperStartingBalance;
    player.availableMargin = this.paperStartingBalance;
    player.usedMargin = 0;
    player.feesPaid = 0;
    player.pnl = 0;
    player.pnlPercent = 0;
    player.openOrders = [];
    player.openPositions = [];
    player.trades = [];
    player.connected = true;
    player.lastUpdate = Date.now();
  }

  private async ensureCompetitionPaperRuntime(player: Player): Promise<void> {
    this.ensurePaperPlayerBaseline(player);
    if (!this.competitionPaperRuntimeStarted) {
      await this.paperEngine.start([player], { reset: false });
      this.competitionPaperRuntimeStarted = true;
      return;
    }
    this.paperEngine.trackPlayers([player]);
  }

  private stopRealtimeLoops(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    if (this.tickerInterval) {
      clearInterval(this.tickerInterval);
      this.tickerInterval = null;
    }
    this.paperEngine.stop();
    this.competitionPaperRuntimeStarted = false;
  }

  private extractEquity(accountsResponse: any): number {
    const accounts = accountsResponse.accounts;
    if (!accounts) return 0;

    if (accounts.flex) {
      return accounts.flex.portfolioValue ?? accounts.flex.balance ?? 0;
    }

    let total = 0;
    for (const key of Object.keys(accounts)) {
      const account = accounts[key];
      if (account.auxiliary?.pv != null) {
        total += account.auxiliary.pv;
      } else if (account.auxiliary?.equity != null) {
        total += account.auxiliary.equity;
      } else if (account.balances) {
        for (const value of Object.values(account.balances)) {
          total += Number(value) || 0;
        }
      }
    }
    return total;
  }

  private async initializeBalances(): Promise<void> {
    const promises = this.getActivePlayers().map(async (player) => {
      try {
        const accountsResp = await kraken.getAccounts(player.apiKey, player.apiSecret);
        const equity = this.extractEquity(accountsResp);
        player.initialBalance = equity;
        player.currentBalance = equity;
        player.availableMargin = equity;
        player.usedMargin = 0;
        player.feesPaid = 0;
        player.connected = true;
      } catch (err) {
        console.error(`Failed to init balance for ${player.name}:`, err);
        player.connected = false;
      }
    });
    await Promise.all(promises);
  }

  private startPolling(): void {
    this.refreshTickers().catch((error) => {
      console.error('Ticker refresh failed:', (error as Error).message);
    });
    this.tickerInterval = setInterval(() => {
      this.refreshTickers().catch((error) => {
        console.error('Ticker refresh failed:', (error as Error).message);
      });
    }, 5000);

    this.pollInterval = setInterval(() => {
      if (this.playerQueue.length === 0) return;
      this.currentPollIndex = this.currentPollIndex % this.playerQueue.length;
      const playerId = this.playerQueue[this.currentPollIndex];
      this.currentPollIndex += 1;
      this.pollPlayer(playerId).catch((error) => {
        console.error('Kraken polling failed:', (error as Error).message);
      });
    }, 2000);
  }

  private async refreshTickers(): Promise<void> {
    this.tickerPrices = await kraken.getTickers();
  }

  private async pollPlayer(playerId: string): Promise<void> {
    const player = this.players.get(playerId);
    if (!player || !player.active) return;

    try {
      const accountsResp = await kraken.getAccounts(player.apiKey, player.apiSecret);
      const positionsResp = await kraken.getOpenPositions(player.apiKey, player.apiSecret);

      const equity = this.extractEquity(accountsResp);
      player.currentBalance = equity;
      if (player.initialBalance !== null) {
        player.pnl = equity - player.initialBalance;
        player.pnlPercent = player.initialBalance > 0 ? (player.pnl / player.initialBalance) * 100 : 0;
      }

      const rawPositions: any[] = positionsResp.openPositions || [];
      const previousPositions = new Map(player.openPositions.map((position) => [position.pair, position]));
      const nextPositions: Position[] = rawPositions
        .filter((position: any) => Math.abs(position.size || 0) > 0)
        .map((position: any) => {
          const side = position.side === 'long' ? 'long' : 'short';
          const size = Math.abs(position.size || 0);
          const entryPrice = position.price || 0;
          const symbol = (position.symbol || position.instrument || '').toUpperCase();
          const markPrice = this.tickerPrices[symbol] || position.markPrice || entryPrice;
          const unrealizedFunding = position.unrealizedFunding || 0;
          const pair = cleanPair(symbol);
          const previous = previousPositions.get(pair);

          let pnl = side === 'long'
            ? (markPrice - entryPrice) * size
            : (entryPrice - markPrice) * size;
          pnl += unrealizedFunding;

          return {
            pair,
            side: side as 'long' | 'short',
            size,
            entryPrice,
            markPrice,
            pnl,
            unrealizedFunding,
            leverage: 1,
            margin: size * entryPrice,
            feesPaid: 0,
            liquidationPrice: null,
            stopLoss: previous?.stopLoss ?? null,
            takeProfit: previous?.takeProfit ?? null,
            openedAt: previous?.openedAt || Date.now(),
          };
        });

      const nextPositionPairs = new Set(nextPositions.map((position) => position.pair));
      for (const position of nextPositions) {
        if (!previousPositions.has(position.pair)) {
          const openedAt = Date.now();
          player.trades.push({
            id: `${player.id}-${position.pair}-${openedAt}`,
            playerName: player.name,
            playerColor: player.color,
            pair: position.pair,
            side: position.side,
            size: position.size,
            price: position.entryPrice,
            fee: 0,
            leverage: 1,
            orderType: 'market',
            pnl: 0,
            time: openedAt,
            action: 'open',
          });
          player.tradeCount += 1;
          this.pendingSpotlights.push({
            id: `${player.id}-${position.pair}-${openedAt}`,
            playerName: player.name,
            playerColor: player.color,
            playerAvatar: player.avatar,
            pair: position.pair,
            side: position.side,
            size: position.size,
            entryPrice: position.entryPrice,
            action: 'open',
            pnl: 0,
          });
          if (!this.firstTradeAwarded) {
            this.firstTradeAwarded = true;
            this.awardBadge(player, 'first-blood');
          }
        }
      }

      for (const previous of player.openPositions) {
        if (!nextPositionPairs.has(previous.pair)) {
          const closedAt = Date.now();
          player.trades.push({
            id: `${player.id}-${previous.pair}-close-${closedAt}`,
            playerName: player.name,
            playerColor: player.color,
            pair: previous.pair,
            side: previous.side,
            size: previous.size,
            price: previous.markPrice,
            fee: 0,
            leverage: 1,
            orderType: 'market',
            pnl: previous.pnl,
            time: closedAt,
            action: 'close',
          });
          this.pendingSpotlights.push({
            id: `${player.id}-${previous.pair}-close-${closedAt}`,
            playerName: player.name,
            playerColor: player.color,
            playerAvatar: player.avatar,
            pair: previous.pair,
            side: previous.side,
            size: previous.size,
            entryPrice: previous.entryPrice,
            action: 'close',
            pnl: previous.pnl,
          });
        }
      }

      player.trades = player.trades.slice(-50);
      player.openPositions = nextPositions;
      player.openOrders = [];
      player.usedMargin = nextPositions.reduce((total, position) => total + position.margin, 0);
      player.availableMargin = Math.max(0, player.currentBalance - player.usedMargin);
      for (const position of nextPositions) {
        player.biggestTradeVolume = Math.max(player.biggestTradeVolume, position.size * position.markPrice);
      }
      player.connected = true;
      player.lastUpdate = Date.now();

      this.updateRankings();
      this.checkBadges();
      this.broadcastState();
    } catch (err) {
      console.error(`Poll failed for ${player.name}:`, (err as Error).message);
      player.connected = false;
      this.broadcastState();
    }
  }

  private rebuildRankings(): void {
    const sorted = this.getActivePlayers()
      .filter((player) => player.initialBalance !== null)
      .sort((a, b) => b.pnlPercent - a.pnlPercent);

    sorted.forEach((player, index) => {
      player.previousRank = player.rank;
      player.rank = index + 1;
    });
  }

  private updateRankings(): void {
    const sorted = this.getActivePlayers()
      .filter((player) => player.initialBalance !== null)
      .sort((a, b) => b.pnlPercent - a.pnlPercent);

    sorted.forEach((player, index) => {
      const nextRank = index + 1;
      if (player.rank !== nextRank) {
        this.pendingLeaderChanges.push({
          playerId: player.id,
          from: player.rank,
          to: nextRank,
        });
        player.previousRank = player.rank;
        player.rank = nextRank;
      }
    });
  }

  private checkBadges(): void {
    const players = this.getActivePlayers().filter((player) => player.initialBalance !== null);
    if (players.length === 0) return;

    const whale = players.reduce((best, player) => (
      player.biggestTradeVolume > best.biggestTradeVolume ? player : best
    ));
    if (whale.biggestTradeVolume > 0) {
      this.assignCompetitiveBadge('whale-alert', whale, players);
    }

    const speedy = players.reduce((best, player) => (
      player.tradeCount > best.tradeCount ? player : best
    ));
    if (speedy.tradeCount > 0) {
      this.assignCompetitiveBadge('speed-demon', speedy, players);
    }

    const longest = players.reduce((best, player) => (
      player.longestPositionMinutes > best.longestPositionMinutes ? player : best
    ));
    if (longest.longestPositionMinutes > 0) {
      this.assignCompetitiveBadge('diamond-hands', longest, players);
    }

    const sniper = players.reduce((best, player) => (
      player.bestTradePercent > best.bestTradePercent ? player : best
    ));
    if (sniper.bestTradePercent > 0) {
      this.assignCompetitiveBadge('sniper', sniper, players);
    }

    const greenest = players.reduce((best, player) => (
      player.pnlPercent > best.pnlPercent ? player : best
    ));
    if (greenest.pnlPercent > 0) {
      this.assignCompetitiveBadge('green-machine', greenest, players);
    }
  }

  private assignCompetitiveBadge(type: BadgeType, winner: Player, players: Player[]): void {
    const currentHolder = this.badgeHolders.get(type);
    if (currentHolder === winner.id) return;

    if (currentHolder) {
      const previousHolder = players.find((player) => player.id === currentHolder);
      if (previousHolder) {
        previousHolder.badges = previousHolder.badges.filter((badge) => badge.type !== type);
      }
    }

    const badge: Badge = { ...BADGE_DEFS[type], awardedAt: Date.now() };
    winner.badges = winner.badges.filter((current) => current.type !== type);
    winner.badges.push(badge);
    this.badgeHolders.set(type, winner.id);
    this.pendingBadges.push({ playerId: winner.id, badge });
  }

  private awardBadge(player: Player, type: BadgeType): void {
    if (player.badges.some((badge) => badge.type === type)) return;
    const badge: Badge = { ...BADGE_DEFS[type], awardedAt: Date.now() };
    player.badges.push(badge);
    this.badgeHolders.set(type, player.id);
    this.pendingBadges.push({ playerId: player.id, badge });
  }

  private broadcastState(): void {
    const allTrades = this.getActivePlayers()
      .flatMap((player) => player.trades)
      .sort((a, b) => b.time - a.time)
      .slice(0, 50);

    const state: GameState = {
      players: this.getPublicPlayers() as GameState['players'],
      recentTrades: allTrades,
      market: this.isPaperMarketActive() ? this.getPaperMarketSnapshot() : {},
      eventStarted: this.eventStarted,
      eventStartTime: this.eventStartTime,
      eventMode: this.eventMode,
      teams: this.teams,
      platformMode: this.platformMode,
      paperStartingBalance: this.paperStartingBalance,
      marketDataSource: this.marketDataSource,
      newBadges: [...this.pendingBadges],
      leaderChanges: [...this.pendingLeaderChanges],
      spotlightTrades: [...this.pendingSpotlights],
    };

    this.pendingBadges = [];
    this.pendingLeaderChanges = [];
    this.pendingSpotlights = [];
    this.onUpdate(state);
  }
}
