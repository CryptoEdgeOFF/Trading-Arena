import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';
import {
  BADGE_DEFS,
  Badge,
  BadgeType,
  EventConfig,
  EventMalus,
  MalusType,
  MarketDataSource,
  EventMode,
  GameState,
  MarketTicker,
  PlatformMode,
  Order,
  Player,
  PlayerStatePatch,
  Position,
  SpotlightTrade,
  StatePatch,
  StoredPlayer,
  TeamInfo,
  Trade,
} from './types.js';
import * as kraken from './kraken.js';
import { PaperTradingEngine, type ExternalQuote, type PaperOrderInput } from './exchangePaperEngine.js';
import {
  EventArchiveStore,
  buildEventArchive,
  type EventArchive,
  type ShowcaseMode,
  type ShowcaseState,
} from './eventArchive.js';

const PLAYER_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f97316',
  '#eab308', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6',
  '#a855f7', '#d946ef', '#f472b6', '#fb923c', '#a3e635',
  '#2dd4bf', '#38bdf8', '#818cf8', '#c084fc', '#fb7185',
];

const DEFAULT_PAPER_BALANCE = 10_000;
const ROSTER_FILE = path.join(process.cwd(), 'data', 'roster.json');
const ROSTER_DB_KEY = 'paper-roster';
/** Leader #1 doit rester stable avant d'annoncer un changement (évite le ping-pong PnL). */
const LEADER_STABLE_MS = 10_000;
const LEADER_ANNOUNCE_COOLDOWN_MS = 45_000;
/** Décompte cinématique avant ouverture du trading (aligné EventTransitions). */
const EVENT_INTRO_COUNTDOWN_MS = 15_000;

/** Malus (roue) — doit rester aligné avec src/utils/malus.ts. */
const MALUS_SPIN_MS = 5_000;
const MALUS_PREP_MS = 60_000;
const MALUS_ACTIVE_MS = 600_000;
/** Marge avant nettoyage de l'état malus (laisse la notif de fin s'afficher). */
const MALUS_CLEAR_GRACE_MS = 12_000;
/** Layout roue : alternance direction / asset sur 6 parts (index pairs = direction). */
const MALUS_SEGMENT_TYPES: MalusType[] = ['direction', 'asset', 'direction', 'asset', 'direction', 'asset'];

/** Seuils minimum avant d'attribuer un badge compétitif (évite le spam au 1er trade). */
const BADGE_THRESHOLDS: Record<
  Exclude<BadgeType, 'first-blood'>,
  { score: (player: Player) => number; min: number }
> = {
  'whale-alert': { score: (p) => p.biggestTradePnl, min: 50 },
  'speed-demon': { score: (p) => p.tradeCount, min: 5 },
  'diamond-hands': { score: (p) => p.longestPositionMinutes, min: 15 },
  sniper: { score: (p) => p.bestTradePercent, min: 2 },
  'green-machine': { score: (p) => p.winStreak, min: 3 },
};

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
  /** Trading autorisé seulement après le décompte d'intro (eventStartTime + 15s). */
  private eventTradingStartTime: number | null = null;
  private tradingUnlockTimer: ReturnType<typeof setTimeout> | null = null;
  private onTradingUnlock: (() => void) | null = null;
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private tickerInterval: ReturnType<typeof setInterval> | null = null;
  private playerQueue: string[] = [];
  private currentPollIndex = 0;
  private firstTradeAwarded = false;
  private onUpdate: (patch: StatePatch) => void;
  private pendingBadges: { playerId: string; badge: Badge }[] = [];
  private pendingLeaderChange: { playerId: string; from: number; to: number } | null = null;
  private pendingSpotlights: SpotlightTrade[] = [];
  private badgeHolders: Map<BadgeType, string> = new Map();
  /** Suivi anti ping-pong pour la notif « nouveau leader ». */
  private topLeaderId: string | null = null;
  private topLeaderSince = 0;
  private lastAnnouncedLeaderId: string | null = null;
  private lastLeaderAnnouncementAt = 0;
  private tickerPrices: Record<string, number> = {};
  private eventMode: EventMode = '1v1';
  private platformMode: PlatformMode = 'kraken';
  private marketDataSource: MarketDataSource = 'kraken';
  private paperStartingBalance = DEFAULT_PAPER_BALANCE;
  // Balance de départ des joueurs des arènes online — TOTALEMENT découplée de
  // `paperStartingBalance` (config événement LIVE). La source de vérité est
  // `CompetitionManager.competitionStartingBalance`, poussée ici au boot et à
  // chaque réglage admin compete.
  private competitionStartingBalance = DEFAULT_PAPER_BALANCE;
  private eventDurationMinutes = 60;
  private eventEndTime: number | null = null;
  private eventTimerInterval: ReturnType<typeof setInterval> | null = null;
  private teams?: [TeamInfo, TeamInfo];
  private paperEngine: PaperTradingEngine;
  private competitionPaperRuntimeStarted = false;
  private onlineCompetitionPlayerIds = new Set<string>();
  private pool: Pool | null = null;
  private isServerless = Boolean(process.env.NETLIFY);
  private dbWriteQueue: Promise<void> = Promise.resolve();
  // Set of player IDs whose state changed since the last persistence flush.
  // We persist these in batches every ROSTER_FLUSH_INTERVAL ms so the high
  // frequency engine ticks (Kraken futures WS, ~30/s/pair) never overwhelm
  // Postgres. User-driven mutations call persistPlayer() directly and bypass
  // this throttle.
  private dirtyPlayerIds = new Set<string>();
  private rosterFlushTimer: ReturnType<typeof setInterval> | null = null;
  private static readonly ROSTER_FLUSH_INTERVAL = 2000;
  // Throttle outbound WebSocket state broadcasts so we never push more than
  // getBroadcastInterval() ms apart, even during a market spike. The
  // interval is computed dynamically based on the number of active traders
  // tracked by the engine: small competitions get sub-100ms responsiveness,
  // very large competitions slow down to keep the pipe healthy.
  private lastBroadcastAt = 0;
  private broadcastTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly BROADCAST_INTERVAL_LOW = 100;
  private static readonly BROADCAST_INTERVAL_MID = 200;
  private static readonly BROADCAST_INTERVAL_HIGH = 500;
  // Diff snapshots: tracking what we last broadcasted so we can compute
  // a small patch instead of resending the full state on every tick.
  private snapshotPlayers: Map<string, {
    pnl: number;
    pnlPercent: number;
    rank: number;
    previousRank: number;
    tradeCount: number;
    currentBalance: number;
    availableMargin: number;
    usedMargin: number;
    feesPaid: number;
    connected: boolean;
    lastUpdate: number;
    // Empreintes compactes utilisées par computeStatePatch pour détecter
    // les changements de positions/ordres ouverts sans réécrire les arrays
    // entiers à chaque tick. Voir `fingerprintPositions` / `fingerprintOrders`.
    openPositionsFp: string;
    openOrdersFp: string;
    badgesFp: string;
    /** Historique trades (opens + closes) — les closes n'incrémentent pas tradeCount. */
    tradesFp: string;
  }> = new Map();
  private snapshotMarket: Map<string, {
    markPrice: number;
    bidPrice: number;
    askPrice: number;
    change24h: number | null;
    spreadBps: number;
  }> = new Map();
  private snapshotTradeIds: Set<string> = new Set();
  // Paper-player snapshot used to detect PnL changes for online competition
  // traders (which are excluded from the public state and from
  // computeStatePatch). Index.ts uses this to push live leaderboard diffs
  // to the matching arena shard.
  private snapshotPaperPlayers: Map<string, {
    pnl: number;
    pnlPercent: number;
    tradeCount: number;
    currentBalance: number;
  }> = new Map();
  private snapshotEvent = {
    eventStarted: false as boolean,
    eventStartTime: null as number | null,
    eventEndTime: null as number | null,
    eventMode: null as EventMode | null,
    platformMode: null as PlatformMode | null,
    paperStartingBalance: null as number | null,
    marketDataSource: null as MarketDataSource | null,
    teamsSignature: '' as string,
    showcaseSignature: '' as string,
    malusSignature: '' as string,
  };
  private archiveStore = new EventArchiveStore();
  /** Malus courant (roue de la fortune, annoncé à l'oral). */
  private malus: EventMalus | null = null;
  private malusClearTimer: ReturnType<typeof setTimeout> | null = null;
  private marketTickBroadcaster: ((pairs: string[]) => void) | null = null;
  readonly ready: Promise<void>;

  constructor(onUpdate: (patch: StatePatch) => void) {
    this.onUpdate = onUpdate;
    const databaseUrl = process.env.DATABASE_URL?.trim();
    if (databaseUrl) {
      this.pool = new Pool({
        connectionString: databaseUrl,
        ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
      });
      this.pool.on('error', (err) => {
        console.error('[player pool] idle client error:', err.message || err);
      });
    }
    this.paperEngine = new PaperTradingEngine(
      () => {
        const engineSpotlights = this.paperEngine.drainEngineSpotlights();
        if (engineSpotlights.length > 0) {
          this.pendingSpotlights.push(...engineSpotlights);
        }
        this.updateRankings();
        this.checkBadges();
        this.markRosterDirty();
        this.broadcastState();
      },
      (pairs) => {
        this.marketTickBroadcaster?.(pairs);
      },
    );
    this.paperEngine.setPlayerResolver((id) => this.players.get(id));
    this.paperEngine.setStartingBalance(this.paperStartingBalance);
    this.archiveStore.setPool(this.pool);
    this.archiveStore.onChange(() => this.broadcastState(true));
    this.ready = this.loadRoster().then(() => this.archiveStore.init());
    this.startRosterFlushLoop();
  }

  private markRosterDirty(playerId?: string): void {
    if (playerId) {
      this.dirtyPlayerIds.add(playerId);
    } else {
      for (const id of this.players.keys()) this.dirtyPlayerIds.add(id);
    }
  }

  private startRosterFlushLoop(): void {
    if (this.rosterFlushTimer || !this.pool) return;
    this.rosterFlushTimer = setInterval(() => {
      void this.flushDirtyPlayers();
    }, PlayerManager.ROSTER_FLUSH_INTERVAL);
    if (typeof this.rosterFlushTimer.unref === 'function') this.rosterFlushTimer.unref();
  }

  private async flushDirtyPlayers(): Promise<void> {
    if (!this.pool) return;
    if (this.dirtyPlayerIds.size === 0) return;
    const ids = Array.from(this.dirtyPlayerIds);
    this.dirtyPlayerIds.clear();
    await this.enqueueDbWrite('Failed to flush dirty players', async () => {
      const stored = this.currentRoster().filter((p) => ids.includes(p.id));
      if (stored.length === 0) return;
      const placeholders: string[] = [];
      const params: string[] = [];
      stored.forEach((p, i) => {
        placeholders.push(`($${2 * i + 1}, $${2 * i + 2}::jsonb)`);
        params.push(p.id, JSON.stringify(p));
      });
      await this.pool!.query(
        `insert into comp_paper_players (id, data) values ${placeholders.join(', ')}
         on conflict (id) do update set data = excluded.data, updated_at = now()`,
        params,
      );
    });
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
    // Avatars du roster live admin stockés directement en Postgres pour
    // survivre aux redéploiements Railway (filesystem éphémère). Servis
    // via GET /api/roster/avatars/:id. Même pattern que comp_user_avatars.
    await this.pool.query(`
      create table if not exists live_roster_avatars (
        player_id text primary key,
        mime text not null,
        data bytea not null,
        updated_at timestamptz not null default now()
      )
    `);
  }

  async putRosterAvatar(playerId: string, mime: string, data: Buffer): Promise<string> {
    if (!this.pool) {
      throw new Error('Database non configurée pour stocker les avatars');
    }
    await this.pool.query(
      `insert into live_roster_avatars (player_id, mime, data, updated_at)
       values ($1, $2, $3, now())
       on conflict (player_id) do update
         set mime = excluded.mime,
             data = excluded.data,
             updated_at = now()`,
      [playerId, mime, data],
    );
    const player = this.players.get(playerId);
    if (!player) throw new Error('Joueur introuvable');
    const version = Date.now();
    player.avatar = `/api/roster/avatars/${playerId}?v=${version}`;
    this.saveRoster();
    return player.avatar;
  }

  async getRosterAvatar(playerId: string): Promise<{ mime: string; data: Buffer } | null> {
    if (!this.pool) return null;
    const result = await this.pool.query(
      'select mime, data from live_roster_avatars where player_id = $1 limit 1',
      [playerId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return { mime: String(row.mime), data: row.data as Buffer };
  }

  private applyStoredRoster(data: StoredPlayer[]): void {
    this.players.clear();
    for (const stored of data) {
      const player = this.createPlayerFromStored(stored);
      this.players.set(player.id, player);
    }
    this.syncBadgeHoldersFromPlayers();
  }

  /**
   * Merge a stored roster from Postgres into in-memory state without losing
   * uncommitted live mutations. Used by refresh() so a serverless re-read
   * (or a single fallback fetch on a persistent server) cannot delete a
   * position/order that was just created in memory.
   */
  private mergeStoredRoster(data: StoredPlayer[]): void {
    const seen = new Set<string>();
    for (const stored of data) {
      seen.add(stored.id);
      const existing = this.players.get(stored.id);
      const storedUpdate = stored.lastUpdate || 0;
      const memoryUpdate = existing?.lastUpdate || 0;
      // Keep the freshest snapshot. If the in-memory player has a more recent
      // lastUpdate, it has uncommitted mutations we must preserve.
      if (existing && memoryUpdate >= storedUpdate) continue;
      const player = this.createPlayerFromStored(stored);
      this.players.set(player.id, player);
      // Trace les positions/ordres restaurés au boot pour qu'une position
      // "fantôme" puisse être corrélée avec son origine (importée depuis
      // Postgres au démarrage vs créée pendant la session).
      const positions = player.openPositions ?? [];
      const orders = (player.openOrders ?? []).filter((o) => o.status === 'open');
      if (positions.length > 0 || orders.length > 0) {
        console.log(
          `[paper] hydrate ${player.name} positions=${positions.length} orders=${orders.length}`,
        );
        for (const p of positions) {
          console.log(
            `[paper]   pos ${p.pair} ${p.side} size=${p.size} entry=${p.entryPrice} `
            + `id=${p.id} openedAt=${p.openedAt ?? '?'}`,
          );
        }
        for (const o of orders) {
          console.log(
            `[paper]   ord ${o.pair} ${o.side} ${o.orderType} size=${o.size} `
            + `limit=${o.limitPrice} id=${o.id} createdAt=${o.createdAt}`,
          );
        }
      }
    }
    // Remove players that vanished from the database AND have no live state.
    for (const id of Array.from(this.players.keys())) {
      if (!seen.has(id)) {
        const existing = this.players.get(id);
        if (!existing) continue;
        // Only drop if the player has no open positions/orders. This protects
        // a freshly registered trader that hasn't been persisted yet.
        if (existing.openPositions.length === 0 && existing.openOrders.length === 0) {
          this.players.delete(id);
        }
      }
    }
    this.paperEngine.refreshPlayerRefs();
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
      biggestTradePnl: player.biggestTradePnl,
      bestTradePercent: player.bestTradePercent,
      lastUpdate: player.lastUpdate,
      connected: player.connected,
      isCompetitionPlayer: player.isCompetitionPlayer ?? false,
    }));
  }

  private enqueueDbWrite(label: string, work: () => Promise<void>): Promise<void> {
    const run = this.dbWriteQueue
      .catch(() => undefined)
      .then(async () => {
        try {
          await work();
        } catch (err) {
          console.error(`${label}:`, err);
        }
      });
    this.dbWriteQueue = run.catch(() => undefined);
    return run;
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
      // On a persistent server the roster is flushed every
      // ROSTER_FLUSH_INTERVAL ms via flushDirtyPlayers(). Live ticks just
      // mark every player dirty so we never spam Postgres mid-tick.
      // On serverless every mutation is awaited explicitly via persistPlayer,
      // so we still upsert the full roster synchronously here for safety.
      if (this.isServerless) {
        void this.enqueueDbWrite('Failed to save Postgres roster', async () => {
          await this.ensureDbStore();
          await this.upsertAllPlayers();
        });
      } else {
        this.markRosterDirty();
      }
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
    await this.enqueueDbWrite('Failed to save Postgres roster', async () => {
      await this.ensureDbStore();
      await this.upsertAllPlayers();
    });
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
    await this.enqueueDbWrite('Failed to upsert player row', async () => {
      const player = this.players.get(playerId);
      if (!player) return;
      const stored = this.currentRoster().find((p) => p.id === playerId);
      if (!stored) return;
      await this.pool.query(
        `insert into comp_paper_players (id, data) values ($1, $2::jsonb)
         on conflict (id) do update set data = excluded.data, updated_at = now()`,
        [playerId, JSON.stringify(stored)],
      );
    });
  }

  private async deletePlayerRow(playerId: string): Promise<void> {
    if (!this.pool) return;
    await this.enqueueDbWrite('Failed to delete player row', async () => {
      await this.pool.query('delete from comp_paper_players where id = $1', [playerId]);
    });
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

  private persistTradingMutation(playerId: string): Promise<void> {
    if (this.isServerless) {
      return this.persistPlayer(playerId);
    }

    // On a persistent Node server the in-memory trading engine is the live
    // source of truth. Persist in the background so order/close endpoints can
    // answer immediately and the UI feels like local mode.
    void this.persistPlayer(playerId);
    return Promise.resolve();
  }

  /**
   * Re-read the roster from Postgres into in-memory state.
   * Uses a merge strategy that preserves uncommitted live mutations so a
   * concurrent refresh during an order placement cannot wipe a fresh
   * position. Required on serverless to import state from sibling Lambdas.
   */
  async refresh(): Promise<void> {
    if (!this.pool) return;
    try {
      const rows = await this.pool.query('select id, data from comp_paper_players');
      if (rows.rowCount && rows.rowCount > 0) {
        const stored: StoredPlayer[] = rows.rows.map((r) => r.data as StoredPlayer);
        this.mergeStoredRoster(stored);
        return;
      }
      // Fallback to legacy blob if the new table is still empty (first boot).
      const legacy = await this.pool.query('select value from competition_store where key = $1 limit 1', [ROSTER_DB_KEY]);
      if (Array.isArray(legacy.rows[0]?.value)) {
        this.mergeStoredRoster(legacy.rows[0].value as StoredPlayer[]);
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
      biggestTradePnl: stored.biggestTradePnl ?? 0,
      bestTradePercent: stored.bestTradePercent ?? 0,
      lastUpdate: stored.lastUpdate ?? 0,
      connected: stored.connected ?? false,
    };
  }

  private resetCompetitionState(players = this.getActivePlayers()): void {
    this.pendingBadges = [];
    this.pendingLeaderChange = null;
    this.pendingSpotlights = [];
    this.badgeHolders.clear();
    this.firstTradeAwarded = false;
    this.resetLeaderAnnouncementState();

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
      player.biggestTradePnl = 0;
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
      biggestTradePnl: 0,
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

  /** Définit la couleur d'un participant (hex #RRGGBB ou #RGB). */
  setPlayerColor(id: string, color: string): Player | null {
    const player = this.players.get(id);
    if (!player) return null;
    const match = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.exec((color || '').trim());
    if (!match) return null;
    let hex = match[0].toLowerCase();
    if (hex.length === 4) {
      // #abc → #aabbcc
      hex = `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
    }
    player.color = hex;
    this.saveRoster();
    this.broadcastState();
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
    return this.getPlayers().filter((player) => (
      player.active
      && !player.isCompetitionPlayer
      && !this.onlineCompetitionPlayerIds.has(player.id)
    ));
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
      .filter((player) => !player.isCompetitionPlayer && !this.onlineCompetitionPlayerIds.has(player.id))
      .map((player) => this.toRosterPlayer(player));
  }

  markOnlineCompetitionPlayers(playerIds: string[]): void {
    let changed = false;
    for (const playerId of playerIds) {
      if (!this.onlineCompetitionPlayerIds.has(playerId)) {
        this.onlineCompetitionPlayerIds.add(playerId);
        changed = true;
      }
      const player = this.players.get(playerId);
      if (player && !player.isCompetitionPlayer) {
        player.isCompetitionPlayer = true;
        changed = true;
      }
      this.playerQueue = this.playerQueue.filter((id) => id !== playerId);
    }
    if (changed) this.broadcastState();
  }

  /** Resync in-memory isolation after a DB refresh (serverless cold start). */
  reconcileOnlineCompetitionPlayers(playerIds: string[]): void {
    const next = new Set(playerIds);
    let changed = false;
    for (const playerId of Array.from(this.onlineCompetitionPlayerIds)) {
      if (!next.has(playerId)) {
        this.onlineCompetitionPlayerIds.delete(playerId);
        const player = this.players.get(playerId);
        if (player?.isCompetitionPlayer) player.isCompetitionPlayer = false;
        changed = true;
      }
    }
    for (const playerId of next) {
      if (!this.onlineCompetitionPlayerIds.has(playerId)) {
        this.onlineCompetitionPlayerIds.add(playerId);
        changed = true;
      }
      const player = this.players.get(playerId);
      if (player && !player.isCompetitionPlayer) {
        player.isCompetitionPlayer = true;
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
      const player = this.players.get(playerId);
      if (player?.isCompetitionPlayer) {
        player.isCompetitionPlayer = false;
        changed = true;
      }
    }
    if (changed) this.broadcastState();
  }

  isOnlineCompetitionPlayer(playerId: string): boolean {
    return this.onlineCompetitionPlayerIds.has(playerId);
  }

  /** Snapshot marché pour les charts — toujours disponible, compétition ou non. */
  getChartMarketSnapshot(): Record<string, import('./types.js').MarketTicker> {
    return this.getPaperMarketSnapshot();
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
    player.isCompetitionPlayer = true;
    this.playerQueue = this.playerQueue.filter((id) => id !== player.id);

    if (!player.active) {
      player.active = true;
      this.saveRoster();
    }

    this.ensurePaperPlayerBaseline(player);
    this.saveRoster();

    await this.ensureCompetitionPaperRuntime(player);
    this.paperEngine.syncPlayerRefs([player]);

    this.broadcastState();
    return player;
  }

  setEventConfig(config: EventConfig): void {
    this.eventMode = config.mode;
    this.teams = config.mode === '4v4' ? config.teams : undefined;
    this.platformMode = config.platformMode;
    this.marketDataSource = config.marketDataSource;
    this.paperStartingBalance = config.paperStartingBalance;
    if (typeof config.eventDurationMinutes === 'number' && Number.isFinite(config.eventDurationMinutes)) {
      this.eventDurationMinutes = Math.max(0, Math.floor(config.eventDurationMinutes));
    }
    this.paperEngine.setMarketDataSource(this.marketDataSource);
    this.paperEngine.setStartingBalance(this.paperStartingBalance);

    // En mode équipe, les joueurs sont sélectionnés via les rosters d'équipe
    // (pas le toggle individuel). On reflète l'assignation dans le flag
    // `active` dès la configuration pour que le dashboard affiche les cartes
    // AVANT le démarrage de l'événement, comme dans les autres modes.
    if (!this.eventStarted && config.mode === '4v4' && this.teams) {
      const teamIds = new Set([...this.teams[0].playerIds, ...this.teams[1].playerIds]);
      let changed = false;
      for (const player of this.players.values()) {
        if (player.isCompetitionPlayer || this.onlineCompetitionPlayerIds.has(player.id)) continue;
        const shouldBeActive = teamIds.has(player.id);
        if (player.active !== shouldBeActive) {
          player.active = shouldBeActive;
          changed = true;
        }
      }
      if (changed) {
        this.playerQueue = Array.from(teamIds);
        this.saveRoster();
        this.rebuildRankings();
      }
    }
    if (!this.eventStarted) {
      this.broadcastState(true);
    }
  }

  getEventConfig(): EventConfig {
    return {
      mode: this.eventMode,
      teams: this.teams,
      platformMode: this.platformMode,
      paperStartingBalance: this.paperStartingBalance,
      marketDataSource: this.marketDataSource,
      eventDurationMinutes: this.eventDurationMinutes,
    };
  }

  getEventDurationMinutes(): number {
    return this.eventDurationMinutes;
  }

  getEventEndTime(): number | null {
    return this.eventEndTime;
  }

  canTradeLiveEvent(): boolean {
    if (!this.eventStarted) return false;
    if (this.eventTradingStartTime != null && Date.now() < this.eventTradingStartTime) return false;
    if (this.eventEndTime != null && Date.now() >= this.eventEndTime) return false;
    return true;
  }

  getEventTradingStartTime(): number | null {
    return this.eventTradingStartTime;
  }

  getPlatformMode(): PlatformMode {
    return this.platformMode;
  }

  getPaperStartingBalance(): number {
    return this.paperStartingBalance;
  }

  getCompetitionStartingBalance(): number {
    return this.competitionStartingBalance;
  }

  /** Réglée par l'admin compete (indépendante de l'événement LIVE). */
  setCompetitionStartingBalance(balance: number): void {
    if (!Number.isFinite(balance) || balance <= 0) return;
    this.competitionStartingBalance = Math.floor(balance);
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

  setMarketTickBroadcaster(fn: (pairs: string[]) => void): void {
    this.marketTickBroadcaster = fn;
  }

  /** Notifie les terminaux paper quand le trading s'ouvre après le décompte. */
  setTradingUnlockHandler(fn: () => void): void {
    this.onTradingUnlock = fn;
  }

  private clearTradingUnlockTimer(): void {
    if (this.tradingUnlockTimer) {
      clearTimeout(this.tradingUnlockTimer);
      this.tradingUnlockTimer = null;
    }
  }

  private scheduleTradingUnlockBroadcast(): void {
    this.clearTradingUnlockTimer();
    if (!this.eventTradingStartTime) return;
    const delay = Math.max(0, this.eventTradingStartTime - Date.now());
    this.tradingUnlockTimer = setTimeout(() => {
      this.tradingUnlockTimer = null;
      this.onTradingUnlock?.();
    }, delay);
    if (typeof this.tradingUnlockTimer.unref === 'function') {
      this.tradingUnlockTimer.unref();
    }
  }

  /** Démarre le flux prix crypto (Binance/Kraken) pour les charts, always-on. */
  async ensurePublicMarketFeed(): Promise<void> {
    await this.paperEngine.ensureMarketFeed();
  }

  shutdownMarketFeed(): void {
    this.paperEngine.stop();
  }

  /**
   * Applique des prix iTick au paper engine. Source unique pour les
   * pairs forex / commodities / indices (PAPER_PAIRS source='itick').
   *
   * On ignore volontairement `isPaperMarketActive()` : le streaming de
   * prix pour les consommateurs du chart ne doit pas dépendre d'une
   * compétition active. Les ticks iTick sont de la donnée de marché
   * pure (pas d'état joueur), donc l'application always-on garde le
   * chart vivant pour les viewers et survit aux restarts Railway.
   */
  applyItickMarketTicks(quotes: Record<string, ExternalQuote>): string[] {
    return this.paperEngine.applyItickQuotes(quotes);
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
    this.clearMalus();
    this.eventStarted = true;
    this.eventStartTime = Date.now();
    this.eventTradingStartTime = this.eventStartTime + EVENT_INTRO_COUNTDOWN_MS;
    this.eventEndTime = this.eventDurationMinutes > 0
      ? this.eventStartTime + this.eventDurationMinutes * 60_000
      : null;
    this.playerQueue = active.map((player) => player.id);
    this.scheduleTradingUnlockBroadcast();

    // Assigner les rangs AVANT le démarrage du moteur paper pour éviter
    // un faux « nouveau leader » (0 → #1) sur le premier tick marché.
    this.rebuildRankings();

    if (this.platformMode === 'paper') {
      await this.paperEngine.start(active);
      this.paperEngine.syncPlayerRefs(active);
    } else {
      await this.initializeBalances();
      this.startPolling();
    }

    this.startEventTimerLoop();
    this.broadcastState();
  }

  async stopEvent(): Promise<void> {
    if (this.eventStarted) {
      await this.archiveCurrentEvent('manual-stop');
    }
    this.eventStarted = false;
    this.eventEndTime = null;
    this.eventTradingStartTime = null;
    this.clearTradingUnlockTimer();
    this.clearMalus();
    this.stopEventTimerLoop();
    this.stopRealtimeLoops();
    // Purge — voir commentaire dans finalizeLiveEvent.
    this.resetActivePlayersForNextRound();
    this.broadcastState();
  }

  /**
   * Réinitialise les stats compétition de tous les joueurs (PnL, trades,
   * positions, balances, badges, séries…) pour que le dashboard reparte
   * propre entre deux rounds. L'archive éventuelle a déjà capturé le
   * snapshot final, donc on peut purger sans perte.
   */
  private resetActivePlayersForNextRound(): void {
    const players = Array.from(this.players.values());
    if (players.length === 0) return;
    this.resetCompetitionState(players);
    this.saveRoster();
  }

  private startEventTimerLoop(): void {
    this.stopEventTimerLoop();
    if (!this.eventEndTime) return;
    this.eventTimerInterval = setInterval(() => {
      void this.checkEventTimer();
    }, 1000);
    if (typeof this.eventTimerInterval.unref === 'function') {
      this.eventTimerInterval.unref();
    }
  }

  private stopEventTimerLoop(): void {
    if (this.eventTimerInterval) {
      clearInterval(this.eventTimerInterval);
      this.eventTimerInterval = null;
    }
  }

  private async checkEventTimer(): Promise<void> {
    if (!this.eventStarted || this.eventEndTime == null) return;
    if (Date.now() < this.eventEndTime) return;
    await this.finalizeLiveEvent();
  }

  /** Fin auto du timer : clôture toutes les positions, stop trading. */
  async finalizeLiveEvent(): Promise<void> {
    if (!this.eventStarted) return;
    this.stopEventTimerLoop();

    const active = this.getActivePlayers();
    if (this.platformMode === 'paper') {
      for (const player of active) {
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
      }
      this.rebuildRankings();
      this.saveRoster();
    }

    await this.archiveCurrentEvent('timer');

    this.pendingLeaderChange = null;
    this.eventStarted = false;
    this.eventEndTime = null;
    this.eventTradingStartTime = null;
    this.clearTradingUnlockTimer();
    this.clearMalus();
    this.stopRealtimeLoops();
    // Purge des stats des joueurs immédiatement après archivage : on
    // veut que le dashboard inter-rounds reparte propre (badges, PnL,
    // trades, positions à zéro) plutôt que d'afficher l'état figé du
    // round précédent quand l'admin configure un nouveau round.
    this.resetActivePlayersForNextRound();
    this.broadcastState(true);
  }

  isStarted(): boolean {
    return this.eventStarted;
  }

  getEventStartTime(): number | null {
    return this.eventStartTime;
  }

  /* ---------- Archives & Showcase ---------- */

  private async archiveCurrentEvent(_origin: 'timer' | 'manual-stop'): Promise<void> {
    const players = this.getActivePlayers().filter(
      (player) => player.initialBalance != null && player.tradeCount > 0,
    );
    if (players.length === 0) return;
    const archive = buildEventArchive({
      players,
      startedAt: this.eventStartTime,
      finalizedAt: Date.now(),
      eventMode: this.eventMode,
      teams: this.teams ?? null,
    });
    try {
      await this.archiveStore.add(archive);
      if (this.eventMode === '4v4') {
        await this.archiveStore.setShowcase({ archiveId: archive.id, mode: 'podium' });
      }
    } catch (err) {
      console.error('[archive] add failed:', (err as Error).message || err);
    }
  }

  listEventArchives(): EventArchive[] {
    return this.archiveStore.list();
  }

  getEventArchive(id: string): EventArchive | null {
    return this.archiveStore.get(id);
  }

  async deleteEventArchive(id: string): Promise<boolean> {
    return this.archiveStore.remove(id);
  }

  async setEventShowcase(state: ShowcaseState | null): Promise<boolean> {
    return this.archiveStore.setShowcase(state);
  }

  getEventShowcase(): ShowcaseState | null {
    return this.archiveStore.getShowcase();
  }

  getEventShowcasePayload(): { mode: ShowcaseMode; archive: EventArchive } | null {
    return this.archiveStore.getShowcasePayload();
  }

  getMalus(): EventMalus | null {
    return this.malus;
  }

  /**
   * Déclenche un malus (roue de la fortune). Le type et la part sont tirés au
   * sort côté serveur pour que tous les écrans s'arrêtent au même endroit.
   * Purement visuel : aucune contrainte n'est appliquée aux ordres.
   */
  triggerMalus(forcedType?: MalusType): EventMalus | null {
    if (!this.eventStarted) return null;
    const type: MalusType = forcedType ?? (Math.random() < 0.5 ? 'direction' : 'asset');
    const candidates = MALUS_SEGMENT_TYPES
      .map((t, i) => ({ t, i }))
      .filter((s) => s.t === type)
      .map((s) => s.i);
    const segmentIndex = candidates[Math.floor(Math.random() * candidates.length)] ?? 0;
    const triggeredAt = Date.now();
    const prepEndAt = triggeredAt + MALUS_SPIN_MS + MALUS_PREP_MS;
    const endAt = prepEndAt + MALUS_ACTIVE_MS;
    this.malus = {
      id: `malus-${triggeredAt}-${Math.random().toString(36).slice(2, 8)}`,
      type,
      segmentIndex,
      triggeredAt,
      prepEndAt,
      endAt,
    };
    if (this.malusClearTimer) clearTimeout(this.malusClearTimer);
    this.malusClearTimer = setTimeout(() => {
      this.malusClearTimer = null;
      this.malus = null;
      this.broadcastState();
    }, endAt - triggeredAt + MALUS_CLEAR_GRACE_MS);
    if (typeof this.malusClearTimer.unref === 'function') this.malusClearTimer.unref();
    this.broadcastState();
    return this.malus;
  }

  clearMalus(): void {
    if (this.malusClearTimer) {
      clearTimeout(this.malusClearTimer);
      this.malusClearTimer = null;
    }
    if (this.malus) {
      this.malus = null;
      this.broadcastState();
    }
  }

  async placePaperOrder(playerId: string, order: PaperOrderInput): Promise<void> {
    if (!this.canTradeLiveEvent() || this.platformMode !== 'paper') {
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
    this.paperEngine.syncPlayerRefs([player]);
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
    await this.persistTradingMutation(player.id);
    this.broadcastState();
  }

  async closePaperPosition(playerId: string, pair: string, partialSize?: number): Promise<void> {
    if (!this.canTradeLiveEvent() || this.platformMode !== 'paper') {
      throw new Error('Le paper trading n’est pas disponible');
    }

    const player = this.players.get(playerId);
    if (!player || !player.active) {
      throw new Error('Trader introuvable');
    }

    const result = await this.paperEngine.closePosition(player, pair, partialSize);
    this.pendingSpotlights.push(result.spotlight);
    this.paperEngine.syncPlayerRefs([player]);
    this.updateRankings();
    this.checkBadges();
    this.saveRoster();
    this.broadcastState();
  }

  async closeCompetitionPaperPosition(
    playerId: string,
    pair: string,
    partialSize?: number,
  ): Promise<{ closed: boolean; alreadyClosed: boolean }> {
    const player = this.players.get(playerId);
    if (!player) {
      throw new Error('Trader introuvable');
    }
    await this.ensureCompetitionPaperRuntime(player);
    // Idempotent close: if a SL/TP trigger or a concurrent click already
    // closed the position, return success silently so the UI does not show a
    // confusing "Position introuvable" error.
    const stillOpen = player.openPositions.some(
      (entry) => entry.id === pair || entry.pair === pair,
    );
    if (!stillOpen) {
      return { closed: false, alreadyClosed: true };
    }
    await this.paperEngine.closePosition(player, pair, partialSize);
    await this.persistTradingMutation(player.id);
    this.broadcastState(true);
    return { closed: true, alreadyClosed: false };
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

  async cancelCompetitionPaperOrder(
    playerId: string,
    orderId: string,
  ): Promise<{ cancelled: boolean; alreadyClosed: boolean }> {
    const player = this.players.get(playerId);
    if (!player) {
      throw new Error('Trader introuvable');
    }
    await this.ensureCompetitionPaperRuntime(player);
    const stillOpen = player.openOrders.some((entry) => entry.id === orderId && entry.status === 'open');
    if (!stillOpen) {
      return { cancelled: false, alreadyClosed: true };
    }
    this.paperEngine.cancelOrder(player, orderId);
    await this.persistTradingMutation(player.id);
    this.broadcastState(true);
    return { cancelled: true, alreadyClosed: false };
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
    if (!this.canTradeLiveEvent() || this.platformMode !== 'paper') {
      throw new Error('Le paper trading n’est pas disponible');
    }

    const player = this.players.get(playerId);
    if (!player || !player.active) {
      throw new Error('Trader introuvable');
    }

    this.paperEngine.updatePositionRisk(player, pair, stopLoss, takeProfit, options);
    this.paperEngine.syncPlayerRefs([player]);
    this.saveRoster();
    this.broadcastState();
  }

  updatePaperOrderRisk(
    playerId: string,
    orderId: string,
    stopLoss: number | null,
    takeProfit: number | null,
  ): void {
    if (!this.canTradeLiveEvent() || this.platformMode !== 'paper') {
      throw new Error('Le paper trading n’est pas disponible');
    }

    const player = this.players.get(playerId);
    if (!player || !player.active) {
      throw new Error('Trader introuvable');
    }

    this.paperEngine.updateOrderRisk(player, orderId, stopLoss, takeProfit);
    this.paperEngine.syncPlayerRefs([player]);
    this.saveRoster();
    this.broadcastState();
  }

  async updateCompetitionPaperOrderRisk(
    playerId: string,
    orderId: string,
    stopLoss: number | null,
    takeProfit: number | null,
  ): Promise<void> {
    const player = this.players.get(playerId);
    if (!player) {
      throw new Error('Trader introuvable');
    }
    await this.ensureCompetitionPaperRuntime(player);
    this.paperEngine.updateOrderRisk(player, orderId, stopLoss, takeProfit);
    this.paperEngine.syncPlayerRefs([player]);
    await this.persistTradingMutation(player.id);
    this.broadcastState();
  }

  updatePaperOrderLimitPrice(playerId: string, orderId: string, limitPrice: number): void {
    if (!this.canTradeLiveEvent() || this.platformMode !== 'paper') {
      throw new Error('Le paper trading n’est pas disponible');
    }

    const player = this.players.get(playerId);
    if (!player || !player.active) {
      throw new Error('Trader introuvable');
    }

    this.paperEngine.updateOrderLimitPrice(player, orderId, limitPrice);
    this.saveRoster();
    this.broadcastState();
  }

  async updateCompetitionPaperOrderLimitPrice(
    playerId: string,
    orderId: string,
    limitPrice: number,
  ): Promise<void> {
    const player = this.players.get(playerId);
    if (!player) {
      throw new Error('Trader introuvable');
    }
    await this.ensureCompetitionPaperRuntime(player);
    this.paperEngine.updateOrderLimitPrice(player, orderId, limitPrice);
    await this.persistTradingMutation(player.id);
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
    this.paperEngine.syncPlayerRefs([player]);
    await this.persistTradingMutation(player.id);
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
    // Joueurs d'arène online → balance compete dédiée, jamais celle du LIVE.
    const baseline = this.competitionStartingBalance;
    player.initialBalance = baseline;
    player.currentBalance = baseline;
    player.availableMargin = baseline;
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
    // CRITIQUE : ne JAMAIS appeler `paperEngine.start()` ici. `start()` fait
    // `this.playersRef = players` et écrase la liste suivie par le moteur —
    // ce qui éjectait les joueurs de l'événement LIVE en cours (SL/TP, fills
    // d'ordres limites et PnL gelés). On se contente d'AJOUTER le joueur
    // compete et de garantir que le feed marché tourne (idempotent).
    this.paperEngine.trackPlayers([player]);
    await this.paperEngine.ensureMarketFeed();
    this.competitionPaperRuntimeStarted = true;
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
    // Ne coupe pas le WS Binance/Kraken : les charts crypto doivent rester live.
    this.paperEngine.stopSession();
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
      // Whale = plus gros gain sur trade clôturé : on s'aligne sur les trades 'close' réalisés.
      for (const trade of player.trades) {
        if (trade.action === 'close' && trade.pnl > player.biggestTradePnl) {
          player.biggestTradePnl = trade.pnl;
        }
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

  private hasAnyOpenPositions(): boolean {
    return this.getActivePlayers().some((player) => player.openPositions.length > 0);
  }

  private resetLeaderAnnouncementState(): void {
    this.topLeaderId = null;
    this.topLeaderSince = 0;
    this.lastAnnouncedLeaderId = null;
    this.lastLeaderAnnouncementAt = 0;
  }

  private maybeAnnounceLeaderChange(sorted: Player[]): void {
    if (!this.hasAnyOpenPositions() || sorted.length === 0) {
      this.topLeaderId = null;
      this.topLeaderSince = 0;
      return;
    }

    const leader = sorted[0];
    const now = Date.now();

    if (leader.id !== this.topLeaderId) {
      this.topLeaderId = leader.id;
      this.topLeaderSince = now;
      return;
    }

    const stableMs = now - this.topLeaderSince;
    if (stableMs < LEADER_STABLE_MS) return;

    // Premier leader établi : on enregistre sans célébrer.
    if (this.lastAnnouncedLeaderId === null) {
      this.lastAnnouncedLeaderId = leader.id;
      return;
    }

    if (this.lastAnnouncedLeaderId === leader.id) return;

    if (now - this.lastLeaderAnnouncementAt < LEADER_ANNOUNCE_COOLDOWN_MS) return;

    this.pendingLeaderChange = {
      playerId: leader.id,
      from: leader.previousRank > 1 ? leader.previousRank : 2,
      to: 1,
    };
    this.lastAnnouncedLeaderId = leader.id;
    this.lastLeaderAnnouncementAt = now;
  }

  private updateRankings(): void {
    const sorted = this.getActivePlayers()
      .filter((player) => player.initialBalance !== null)
      .sort((a, b) => b.pnlPercent - a.pnlPercent);

    sorted.forEach((player, index) => {
      const nextRank = index + 1;
      if (player.rank !== nextRank) {
        player.previousRank = player.rank;
        player.rank = nextRank;
      }
    });

    this.maybeAnnounceLeaderChange(sorted);
  }

  private syncBadgeHoldersFromPlayers(): void {
    this.badgeHolders.clear();
    for (const player of this.players.values()) {
      for (const badge of player.badges) {
        if (badge.type !== 'first-blood') {
          this.badgeHolders.set(badge.type, player.id);
        }
      }
    }
  }

  /** Leader strict : score >= min et pas d'égalité au sommet. */
  private findStrictBadgeLeader(
    players: Player[],
    scoreOf: (player: Player) => number,
    minScore: number,
  ): Player | null {
    const ranked = players
      .map((player) => ({ player, score: scoreOf(player) }))
      .filter((entry) => entry.score >= minScore)
      .sort((a, b) => b.score - a.score);

    if (ranked.length === 0) return null;
    if (ranked.length >= 2 && ranked[0].score === ranked[1].score) return null;
    return ranked[0].player;
  }

  private checkBadges(): void {
    const players = this.getActivePlayers().filter((player) => player.initialBalance !== null);
    if (players.length === 0) return;

    const competitiveTypes = Object.keys(BADGE_THRESHOLDS) as Array<
      Exclude<BadgeType, 'first-blood'>
    >;
    for (const type of competitiveTypes) {
      const { score, min } = BADGE_THRESHOLDS[type];
      const winner = this.findStrictBadgeLeader(players, score, min);
      if (!winner) continue;
      this.assignCompetitiveBadge(type, winner, players);
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

  /**
   * Build the full GameState snapshot. Sent to a client as `state:init` on
   * connect, and used internally to seed the diff snapshot.
   */
  getStateInit(): GameState {
    const players = this.getPublicPlayers() as GameState['players'];
    const allTrades = players
      .flatMap((player) => player.trades)
      .sort((a, b) => b.time - a.time)
      .slice(0, 50);
    return {
      players,
      recentTrades: allTrades,
      market: this.getChartMarketSnapshot(),
      eventStarted: this.eventStarted,
      eventStartTime: this.eventStartTime,
      eventEndTime: this.eventEndTime,
      eventMode: this.eventMode,
      teams: this.teams,
      platformMode: this.platformMode,
      paperStartingBalance: this.paperStartingBalance,
      marketDataSource: this.marketDataSource,
      newBadges: [],
      leaderChanges: [],
      spotlightTrades: [],
      showcase: this.archiveStore.getShowcasePayload() ?? null,
      malus: this.malus,
    };
  }

  /** Reset the diff snapshot to the current state (used after sending init). */
  primeSnapshotFromCurrentState(): void {
    this.snapshotPlayers.clear();
    this.snapshotMarket.clear();
    this.snapshotTradeIds.clear();
    const players = this.getPublicPlayers();
    for (const player of players) {
      this.snapshotPlayers.set(player.id, {
        pnl: player.pnl,
        pnlPercent: player.pnlPercent,
        rank: player.rank,
        previousRank: player.previousRank,
        tradeCount: player.tradeCount,
        currentBalance: player.currentBalance,
        availableMargin: player.availableMargin,
        usedMargin: player.usedMargin,
        feesPaid: player.feesPaid,
        connected: player.connected,
        lastUpdate: player.lastUpdate,
        openPositionsFp: this.fingerprintPositions(player.openPositions),
        openOrdersFp: this.fingerprintOrders(player.openOrders),
        badgesFp: this.fingerprintBadges(player.badges),
        tradesFp: this.fingerprintTrades(player.trades),
      });
      for (const trade of player.trades) this.snapshotTradeIds.add(trade.id);
    }
    const market = this.getChartMarketSnapshot();
    for (const [pair, ticker] of Object.entries(market)) {
      this.snapshotMarket.set(pair, {
        markPrice: ticker.markPrice,
        bidPrice: ticker.bidPrice,
        askPrice: ticker.askPrice,
        change24h: ticker.change24h ?? null,
        spreadBps: ticker.spreadBps,
      });
    }
    this.snapshotEvent = {
      eventStarted: this.eventStarted,
      eventStartTime: this.eventStartTime,
      eventEndTime: this.eventEndTime,
      eventMode: this.eventMode,
      platformMode: this.platformMode,
      paperStartingBalance: this.paperStartingBalance,
      marketDataSource: this.marketDataSource,
      teamsSignature: JSON.stringify(this.teams || null),
      showcaseSignature: JSON.stringify(this.archiveStore.getShowcase() || null),
      malusSignature: JSON.stringify(this.malus || null),
    };
  }

  /**
   * Empreinte compacte d'un set de positions ouvertes. Ne dépend QUE des
   * champs structurels (id, paire, side, taille, entrée, levier, SL/TP) —
   * pas du markPrice ni du PnL qui changent à chaque tick. Le dashboard
   * recalcule le PnL côté client à partir du markPrice diffusé via
   * `patch.market`, donc on ne ré-émet les positions que sur ouverture /
   * fermeture / modification effective.
   */
  private fingerprintPositions(positions: Position[]): string {
    if (!positions.length) return '';
    return positions
      .map((p) => `${p.id}|${p.pair}|${p.side}|${p.size}|${p.entryPrice}|${p.leverage}|${p.stopLoss ?? ''}|${p.takeProfit ?? ''}`)
      .join(';');
  }

  private fingerprintOrders(orders: Order[]): string {
    if (!orders.length) return '';
    return orders
      .map((o) => `${o.id}|${o.pair}|${o.side}|${o.size}|${o.orderType}|${o.limitPrice ?? ''}|${o.status}|${o.stopLoss ?? ''}|${o.takeProfit ?? ''}`)
      .join(';');
  }

  private fingerprintBadges(badges: Badge[]): string {
    if (!badges.length) return '';
    return badges
      .map((b) => `${b.type}:${b.awardedAt}`)
      .sort()
      .join(';');
  }

  /** Détecte ouvertures ET clôtures (tradeCount ne bouge qu'à l'open). */
  private fingerprintTrades(trades: Trade[]): string {
    if (!trades.length) return '';
    return trades
      .map((t) => `${t.id}|${t.action}|${t.pnl}|${t.time}|${t.pair}|${t.size}`)
      .join(';');
  }

  private computeStatePatch(): StatePatch | null {
    const patch: StatePatch = {};
    const players = this.getPublicPlayers();
    const playerPatches: PlayerStatePatch[] = [];
    const addedPlayers: Player[] = [];
    const seenIds = new Set<string>();

    for (const player of players) {
      seenIds.add(player.id);
      const previous = this.snapshotPlayers.get(player.id);
      const positionsFp = this.fingerprintPositions(player.openPositions);
      const ordersFp = this.fingerprintOrders(player.openOrders);
      const badgesFp = this.fingerprintBadges(player.badges);
      const tradesFp = this.fingerprintTrades(player.trades);
      if (!previous) {
        addedPlayers.push(player as Player);
        this.snapshotPlayers.set(player.id, {
          pnl: player.pnl,
          pnlPercent: player.pnlPercent,
          rank: player.rank,
          previousRank: player.previousRank,
          tradeCount: player.tradeCount,
          currentBalance: player.currentBalance,
          availableMargin: player.availableMargin,
          usedMargin: player.usedMargin,
          feesPaid: player.feesPaid,
          connected: player.connected,
          lastUpdate: player.lastUpdate,
          openPositionsFp: positionsFp,
          openOrdersFp: ordersFp,
          badgesFp,
          tradesFp,
        });
        continue;
      }
      const diff: PlayerStatePatch = { id: player.id };
      let changed = false;
      if (previous.pnl !== player.pnl) { diff.pnl = player.pnl; changed = true; }
      if (previous.pnlPercent !== player.pnlPercent) { diff.pnlPercent = player.pnlPercent; changed = true; }
      if (previous.rank !== player.rank) { diff.rank = player.rank; changed = true; }
      if (previous.previousRank !== player.previousRank) { diff.previousRank = player.previousRank; changed = true; }
      if (previous.tradeCount !== player.tradeCount) {
        diff.tradeCount = player.tradeCount;
        changed = true;
      }
      if (previous.tradesFp !== tradesFp) {
        // Clôture (et parfois open) : l'historique doit suivre pour la carte
        // joueur et le recalcul client du PnL réalisé (tradeCount seul ne suffit
        // pas — les closes n'incrémentent pas tradeCount).
        diff.trades = player.trades;
        changed = true;
      }
      if (previous.currentBalance !== player.currentBalance) { diff.currentBalance = player.currentBalance; changed = true; }
      if (previous.availableMargin !== player.availableMargin) { diff.availableMargin = player.availableMargin; changed = true; }
      if (previous.usedMargin !== player.usedMargin) { diff.usedMargin = player.usedMargin; changed = true; }
      if (previous.feesPaid !== player.feesPaid) { diff.feesPaid = player.feesPaid; changed = true; }
      if (previous.connected !== player.connected) { diff.connected = player.connected; changed = true; }
      if (previous.lastUpdate !== player.lastUpdate) { diff.lastUpdate = player.lastUpdate; changed = true; }
      if (previous.openPositionsFp !== positionsFp) {
        diff.openPositions = player.openPositions;
        changed = true;
      }
      if (previous.openOrdersFp !== ordersFp) {
        diff.openOrders = player.openOrders;
        changed = true;
      }
      if (previous.badgesFp !== badgesFp) {
        diff.badges = player.badges;
        changed = true;
      }
      if (changed) {
        playerPatches.push(diff);
        previous.pnl = player.pnl;
        previous.pnlPercent = player.pnlPercent;
        previous.rank = player.rank;
        previous.previousRank = player.previousRank;
        previous.tradeCount = player.tradeCount;
        previous.currentBalance = player.currentBalance;
        previous.availableMargin = player.availableMargin;
        previous.usedMargin = player.usedMargin;
        previous.feesPaid = player.feesPaid;
        previous.connected = player.connected;
        previous.lastUpdate = player.lastUpdate;
        previous.openPositionsFp = positionsFp;
        previous.openOrdersFp = ordersFp;
        previous.badgesFp = badgesFp;
        previous.tradesFp = tradesFp;
      }
    }

    const removedPlayerIds: string[] = [];
    for (const id of Array.from(this.snapshotPlayers.keys())) {
      if (!seenIds.has(id)) {
        removedPlayerIds.push(id);
        this.snapshotPlayers.delete(id);
      }
    }

    if (playerPatches.length > 0) patch.players = playerPatches;
    if (addedPlayers.length > 0) patch.addedPlayers = addedPlayers;
    if (removedPlayerIds.length > 0) patch.removedPlayerIds = removedPlayerIds;

    // Market diff: only include pairs whose price-related fields changed.
    const market: Record<string, MarketTicker> = this.getChartMarketSnapshot();
    const marketPatch: Record<string, MarketTicker> = {};
    const seenPairs = new Set<string>();
    for (const [pair, ticker] of Object.entries(market)) {
      seenPairs.add(pair);
      const prev = this.snapshotMarket.get(pair);
      if (
        !prev ||
        prev.markPrice !== ticker.markPrice ||
        prev.bidPrice !== ticker.bidPrice ||
        prev.askPrice !== ticker.askPrice ||
        prev.change24h !== (ticker.change24h ?? null) ||
        prev.spreadBps !== ticker.spreadBps
      ) {
        marketPatch[pair] = ticker;
        this.snapshotMarket.set(pair, {
          markPrice: ticker.markPrice,
          bidPrice: ticker.bidPrice,
          askPrice: ticker.askPrice,
          change24h: ticker.change24h ?? null,
          spreadBps: ticker.spreadBps,
        });
      }
    }
    for (const pair of Array.from(this.snapshotMarket.keys())) {
      if (!seenPairs.has(pair)) this.snapshotMarket.delete(pair);
    }
    if (Object.keys(marketPatch).length > 0) patch.market = marketPatch;

    // New trades only: each broadcast emits trades not yet sent.
    const newTrades: Trade[] = [];
    for (const player of players) {
      for (const trade of player.trades) {
        if (!this.snapshotTradeIds.has(trade.id)) {
          this.snapshotTradeIds.add(trade.id);
          newTrades.push(trade);
        }
      }
    }
    // Trim the trade-id snapshot to a reasonable size to bound memory growth.
    if (this.snapshotTradeIds.size > 5000) {
      const tail = Array.from(this.snapshotTradeIds).slice(-2500);
      this.snapshotTradeIds = new Set(tail);
    }
    if (newTrades.length > 0) {
      newTrades.sort((a, b) => b.time - a.time);
      patch.newTrades = newTrades.slice(0, 50);
    }

    // Event-level scalars
    if (this.snapshotEvent.eventStarted !== this.eventStarted) {
      patch.eventStarted = this.eventStarted;
      this.snapshotEvent.eventStarted = this.eventStarted;
      if (!this.eventStarted) {
        patch.eventMode = this.eventMode;
        this.snapshotEvent.eventMode = this.eventMode;
        patch.teams = this.teams ?? null;
        this.snapshotEvent.teamsSignature = JSON.stringify(this.teams || null);
      }
    }
    if (this.snapshotEvent.eventStartTime !== this.eventStartTime) {
      patch.eventStartTime = this.eventStartTime;
      this.snapshotEvent.eventStartTime = this.eventStartTime;
    }
    if (this.snapshotEvent.eventEndTime !== this.eventEndTime) {
      patch.eventEndTime = this.eventEndTime;
      this.snapshotEvent.eventEndTime = this.eventEndTime;
    }
    if (this.snapshotEvent.eventMode !== this.eventMode) {
      patch.eventMode = this.eventMode;
      this.snapshotEvent.eventMode = this.eventMode;
    }
    if (this.snapshotEvent.platformMode !== this.platformMode) {
      patch.platformMode = this.platformMode;
      this.snapshotEvent.platformMode = this.platformMode;
    }
    if (this.snapshotEvent.paperStartingBalance !== this.paperStartingBalance) {
      patch.paperStartingBalance = this.paperStartingBalance;
      this.snapshotEvent.paperStartingBalance = this.paperStartingBalance;
    }
    if (this.snapshotEvent.marketDataSource !== this.marketDataSource) {
      patch.marketDataSource = this.marketDataSource;
      this.snapshotEvent.marketDataSource = this.marketDataSource;
    }
    const teamsSignature = JSON.stringify(this.teams || null);
    if (this.snapshotEvent.teamsSignature !== teamsSignature) {
      patch.teams = this.teams || null;
      this.snapshotEvent.teamsSignature = teamsSignature;
    }
    const showcaseSignature = JSON.stringify(this.archiveStore.getShowcase() || null);
    if (this.snapshotEvent.showcaseSignature !== showcaseSignature) {
      patch.showcase = this.archiveStore.getShowcasePayload() ?? null;
      this.snapshotEvent.showcaseSignature = showcaseSignature;
    }
    const malusSignature = JSON.stringify(this.malus || null);
    if (this.snapshotEvent.malusSignature !== malusSignature) {
      patch.malus = this.malus;
      this.snapshotEvent.malusSignature = malusSignature;
    }

    // One-shot signals always go in the patch when present.
    if (this.pendingBadges.length > 0) patch.newBadges = [...this.pendingBadges];
    if (this.pendingLeaderChange) patch.leaderChanges = [this.pendingLeaderChange];
    if (this.pendingSpotlights.length > 0) patch.spotlightTrades = [...this.pendingSpotlights];
    this.pendingBadges = [];
    this.pendingLeaderChange = null;
    this.pendingSpotlights = [];

    return Object.keys(patch).length > 0 ? patch : null;
  }

  /**
   * Returns the list of online-competition (paper) players whose
   * PnL/balance/tradeCount changed since the last call. The result is
   * consumed by the arena WS shard to push leaderboard diffs to the
   * traders of that competition without re-walking every player on
   * every tick.
   */
  drainDirtyPaperPlayers(): Player[] {
    const dirty: Player[] = [];
    for (const playerId of this.onlineCompetitionPlayerIds) {
      const player = this.players.get(playerId);
      if (!player) continue;
      const previous = this.snapshotPaperPlayers.get(playerId);
      if (
        !previous ||
        previous.pnl !== player.pnl ||
        previous.pnlPercent !== player.pnlPercent ||
        previous.tradeCount !== player.tradeCount ||
        previous.currentBalance !== player.currentBalance
      ) {
        dirty.push(player);
        this.snapshotPaperPlayers.set(playerId, {
          pnl: player.pnl,
          pnlPercent: player.pnlPercent,
          tradeCount: player.tradeCount,
          currentBalance: player.currentBalance,
        });
      }
    }
    // Drop snapshots for players that left the competition.
    for (const id of Array.from(this.snapshotPaperPlayers.keys())) {
      if (!this.onlineCompetitionPlayerIds.has(id)) {
        this.snapshotPaperPlayers.delete(id);
      }
    }
    return dirty;
  }

  /**
   * Pick the broadcast interval based on the current load. Small lobbies
   * get sub-100ms PnL refresh; huge tournaments back off to 500ms so the
   * WS pipe + client React reconciliation stay healthy.
   */
  private getBroadcastInterval(): number {
    const count = this.players.size;
    if (count >= 200) return PlayerManager.BROADCAST_INTERVAL_HIGH;
    if (count >= 50) return PlayerManager.BROADCAST_INTERVAL_MID;
    return PlayerManager.BROADCAST_INTERVAL_LOW;
  }

  private broadcastState(force = false): void {
    const now = Date.now();
    const interval = this.getBroadcastInterval();
    // Always emit immediately if there's a one-shot signal that must reach
    // the UI (badge unlock, leader change, spotlight). Otherwise we coalesce
    // updates on a fixed interval to keep the WS load predictable.
    const hasOneShot =
      this.pendingBadges.length > 0 ||
      this.pendingLeaderChange !== null ||
      this.pendingSpotlights.length > 0;
    if (!force && !hasOneShot) {
      const elapsed = now - this.lastBroadcastAt;
      if (elapsed < interval) {
        if (!this.broadcastTimer) {
          const delay = Math.max(0, interval - elapsed);
          this.broadcastTimer = setTimeout(() => {
            this.broadcastTimer = null;
            this.broadcastState(true);
          }, delay);
          if (typeof this.broadcastTimer.unref === 'function') this.broadcastTimer.unref();
        }
        return;
      }
    }
    if (this.broadcastTimer) {
      clearTimeout(this.broadcastTimer);
      this.broadcastTimer = null;
    }
    this.lastBroadcastAt = now;

    const patch = this.computeStatePatch();
    if (!patch) return;
    this.onUpdate(patch);
  }
}
