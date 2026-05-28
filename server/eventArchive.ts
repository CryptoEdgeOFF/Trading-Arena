import crypto from 'crypto';
import { Pool } from 'pg';
import type {
  ArchivedEventSnapshot,
  ArchivedPlayerSnapshot,
  EventMode,
  Player,
  TeamInfo,
} from './types.js';

/** Mode d'affichage du showcase choisi par l'admin pour un archive donné. */
export type ShowcaseMode = 'podium' | 'stats';

export type EventArchive = ArchivedEventSnapshot;
export type ArchivedPlayer = ArchivedPlayerSnapshot;

/** Pointeur vers l'archive actuellement diffusée sur le dashboard. */
export interface ShowcaseState {
  archiveId: string;
  mode: ShowcaseMode;
}

/**
 * Construit un snapshot d'archive à partir des joueurs actifs et de la
 * configuration de l'événement courant. Les joueurs sont triés par rang.
 */
export function buildEventArchive(params: {
  players: Player[];
  startedAt: number | null;
  finalizedAt: number;
  eventMode: EventMode;
  teams: [TeamInfo, TeamInfo] | null;
}): EventArchive {
  const sorted = [...params.players]
    .filter((player) => player.initialBalance != null)
    .sort((a, b) => b.pnl - a.pnl);

  const archived: ArchivedPlayer[] = sorted.map((player, index) => ({
    id: player.id,
    name: player.name,
    color: player.color,
    avatar: player.avatar ?? null,
    rank: index + 1,
    initialBalance: player.initialBalance ?? 0,
    currentBalance: player.currentBalance,
    pnl: player.pnl,
    pnlPercent: player.pnlPercent,
    tradeCount: player.tradeCount,
    feesPaid: player.feesPaid ?? 0,
    winStreak: player.winStreak,
    bestTradePercent: player.bestTradePercent,
    biggestTradePnl: player.biggestTradePnl,
    longestPositionMinutes: player.longestPositionMinutes,
    badges: player.badges,
  }));

  return {
    id: crypto.randomUUID(),
    finalizedAt: params.finalizedAt,
    startedAt: params.startedAt,
    durationMs:
      params.startedAt != null ? Math.max(0, params.finalizedAt - params.startedAt) : 0,
    eventMode: params.eventMode,
    teams: params.teams,
    players: archived,
  };
}

/**
 * Persiste les archives d'événements live en mémoire et en base de données.
 * Le store fonctionne aussi sans Postgres (in-memory only).
 */
export class EventArchiveStore {
  private archives: EventArchive[] = [];
  private showcase: ShowcaseState | null = null;
  private pool: Pool | null = null;
  private ready = false;
  private listeners = new Set<() => void>();

  setPool(pool: Pool | null): void {
    this.pool = pool;
  }

  /** Crée la table et charge les archives existantes. */
  async init(): Promise<void> {
    if (!this.pool) {
      this.ready = true;
      return;
    }
    await this.pool.query(`
      create table if not exists comp_event_archives (
        id text primary key,
        data jsonb not null,
        finalized_at timestamptz not null default now()
      )
    `);
    await this.pool.query(`
      create table if not exists comp_event_showcase (
        key text primary key,
        archive_id text not null,
        mode text not null,
        updated_at timestamptz not null default now()
      )
    `);

    const archivesRes = await this.pool.query<{ data: EventArchive }>(
      'select data from comp_event_archives order by finalized_at desc limit 200',
    );
    this.archives = archivesRes.rows.map((row) => row.data);

    const showcaseRes = await this.pool.query<{ archive_id: string; mode: ShowcaseMode }>(
      "select archive_id, mode from comp_event_showcase where key = 'current'",
    );
    if (showcaseRes.rows[0]) {
      const { archive_id, mode } = showcaseRes.rows[0];
      const exists = this.archives.some((arch) => arch.id === archive_id);
      this.showcase = exists ? { archiveId: archive_id, mode } : null;
      if (!exists) await this.persistShowcase();
    }
    this.ready = true;
  }

  isReady(): boolean {
    return this.ready;
  }

  /** Souscrit aux changements (showcase ou archives) — utilisé pour rebroadcast WS. */
  onChange(handler: () => void): () => void {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  list(): EventArchive[] {
    return this.archives.slice();
  }

  get(id: string): EventArchive | null {
    return this.archives.find((arch) => arch.id === id) ?? null;
  }

  async add(archive: EventArchive): Promise<void> {
    this.archives.unshift(archive);
    if (this.archives.length > 200) this.archives.length = 200;
    if (this.pool) {
      await this.pool.query(
        `insert into comp_event_archives (id, data, finalized_at)
         values ($1, $2::jsonb, to_timestamp($3 / 1000.0))
         on conflict (id) do update set data = excluded.data, finalized_at = excluded.finalized_at`,
        [archive.id, JSON.stringify(archive), archive.finalizedAt],
      );
    }
    this.notify();
  }

  async remove(id: string): Promise<boolean> {
    const before = this.archives.length;
    this.archives = this.archives.filter((arch) => arch.id !== id);
    const removed = this.archives.length !== before;
    if (removed && this.pool) {
      await this.pool.query('delete from comp_event_archives where id = $1', [id]);
    }
    if (this.showcase?.archiveId === id) {
      this.showcase = null;
      await this.persistShowcase();
    }
    if (removed) this.notify();
    return removed;
  }

  getShowcase(): ShowcaseState | null {
    return this.showcase;
  }

  /**
   * Renvoie le pack à diffuser au dashboard : showcase + archive associée.
   * `null` si aucune archive sélectionnée.
   */
  getShowcasePayload(): { mode: ShowcaseMode; archive: EventArchive } | null {
    if (!this.showcase) return null;
    const archive = this.get(this.showcase.archiveId);
    if (!archive) return null;
    return { mode: this.showcase.mode, archive };
  }

  async setShowcase(state: ShowcaseState | null): Promise<boolean> {
    if (state) {
      const archive = this.get(state.archiveId);
      if (!archive) return false;
    }
    this.showcase = state;
    await this.persistShowcase();
    this.notify();
    return true;
  }

  private async persistShowcase(): Promise<void> {
    if (!this.pool) return;
    if (!this.showcase) {
      await this.pool.query("delete from comp_event_showcase where key = 'current'");
      return;
    }
    await this.pool.query(
      `insert into comp_event_showcase (key, archive_id, mode, updated_at)
       values ('current', $1, $2, now())
       on conflict (key) do update set archive_id = excluded.archive_id, mode = excluded.mode, updated_at = now()`,
      [this.showcase.archiveId, this.showcase.mode],
    );
  }
}
