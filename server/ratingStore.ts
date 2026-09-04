import crypto from 'node:crypto';
import { Pool } from 'pg';

/**
 * BTF Rating : Arena Points visibles gagnés/perdus selon le résultat final de
 * chaque arène terminée. Les événements sont idempotents (une seule écriture
 * par arène et par user), avec Postgres si
 * DATABASE_URL est présent, fallback mémoire sinon.
 * Le rating mesure le niveau compétitif (divisions Bronze → Legend).
 */

export interface RatingEvent {
  id: string;
  points: number;
  label: string;
  createdAt: number;
}

export interface ArenaRatingResult {
  competitionId: string;
  title: string;
  /** Rang final (1 = vainqueur). 0 = non classé (aucun trade). */
  rank: number;
  /** Nombre de participants effectivement classés (rank > 0). */
  participants: number;
  breached: boolean;
}

export interface RatingDivision {
  id: string;
  label: string;
  /** Conservé pour compatibilité API. Toujours 0 : les sous-paliers sont supprimés. */
  tier: number;
}

export interface PlayerRating {
  points: number;
  division: RatingDivision;
  /** Prochaine division et points manquants. Null au sommet (Legend). */
  next: { label: string; pointsNeeded: number } | null;
  worldRank: number | null;
  totalPlayers: number;
  recentEvents: RatingEvent[];
}

/**
 * Paliers volontairement progressifs : les premières divisions se franchissent
 * en 1-2 bons résultats (une victoire = +100 ≈ Silver direct), puis chaque
 * division demande ~1,5× plus de points que la précédente. Monter est facile
 * au début, le sommet se mérite.
 */
const DIVISIONS: Array<{ id: string; label: string; floor: number; ceiling: number }> = [
  { id: 'bronze', label: 'Bronze', floor: 0, ceiling: 100 },
  { id: 'silver', label: 'Silver', floor: 100, ceiling: 250 },
  { id: 'gold', label: 'Gold', floor: 250, ceiling: 500 },
  { id: 'platinum', label: 'Platinum', floor: 500, ceiling: 900 },
  { id: 'diamond', label: 'Diamond', floor: 900, ceiling: 1_500 },
  { id: 'master', label: 'Master', floor: 1_500, ceiling: 3_600 },
  { id: 'legend', label: 'Legend', floor: 3_600, ceiling: Number.POSITIVE_INFINITY },
];

let pool: Pool | null = null;
let ready: Promise<void> | null = null;
const memory = new Map<string, Map<string, RatingEvent>>();

function getPool(): Pool | null {
  if (pool) return pool;
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) return null;
  pool = new Pool({
    connectionString: databaseUrl,
    ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
    max: Number(process.env.PG_POOL_MAX_MISC) || 3,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  pool.on('error', (error) => console.error('[rating pool] idle client error:', error.message || error));
  return pool;
}

async function ensureTable(): Promise<void> {
  const db = getPool();
  if (!db) return;
  if (!ready) {
    ready = db.query(`
      create table if not exists comp_rating_ledger (
        id text primary key,
        user_id text not null,
        event_key text not null,
        points integer not null,
        label text not null,
        created_at bigint not null,
        unique(user_id, event_key)
      )
    `).then(async () => {
      await db.query('create index if not exists idx_comp_rating_user_created on comp_rating_ledger(user_id, created_at desc)');
    });
  }
  await ready;
}

/**
 * Barème d'une arène terminée, par percentile de rang :
 * podium fixe, puis top 10 % / 25 % / 50 %, malus pour la moitié basse,
 * malus renforcé si le compte a été éliminé (drawdown). Bonus logarithmique
 * selon la taille du champ pour les résultats positifs.
 */
export function arenaResultPoints(rank: number, participants: number, breached: boolean): number {
  if (breached) return -25;
  if (!Number.isFinite(rank) || rank < 1 || participants < 1) return 0;
  let base: number;
  if (rank === 1) base = 100;
  else if (rank === 2) base = 80;
  else if (rank === 3) base = 65;
  else {
    const percentile = rank / participants;
    base = percentile <= 0.10 ? 45 : percentile <= 0.25 ? 25 : percentile <= 0.50 ? 10 : -10;
  }
  if (base <= 0) return base;
  return base + Math.max(0, Math.floor(Math.log2(Math.max(1, participants))));
}

export function divisionForPoints(totalPoints: number): { division: RatingDivision; next: PlayerRating['next'] } {
  const points = Math.max(0, totalPoints);
  const division = DIVISIONS.find((item) => points >= item.floor && points < item.ceiling) || DIVISIONS[DIVISIONS.length - 1];
  if (!Number.isFinite(division.ceiling)) {
    return { division: { id: division.id, label: division.label, tier: 0 }, next: null };
  }
  const nextDivision = DIVISIONS[DIVISIONS.indexOf(division) + 1];
  return {
    division: { id: division.id, label: division.label, tier: 0 },
    next: {
      label: nextDivision?.label || division.label,
      pointsNeeded: Math.max(1, Math.ceil(division.ceiling - points)),
    },
  };
}

async function awardRating(userId: string, eventKey: string, points: number, label: string): Promise<void> {
  const event: RatingEvent = { id: crypto.randomUUID(), points, label, createdAt: Date.now() };
  const db = getPool();
  if (!db) {
    const ledger = memory.get(userId) || new Map<string, RatingEvent>();
    if (ledger.has(eventKey)) return;
    ledger.set(eventKey, event);
    memory.set(userId, ledger);
    return;
  }
  await ensureTable();
  await db.query(`
    insert into comp_rating_ledger (id, user_id, event_key, points, label, created_at)
    values ($1,$2,$3,$4,$5,$6)
    on conflict (user_id, event_key) do nothing
  `, [event.id, userId, eventKey, points, label, event.createdAt]);
}

export async function deleteUserRating(userId: string): Promise<void> {
  if (!userId) return;
  memory.delete(userId);
  const db = getPool();
  if (!db) return;
  await ensureTable();
  await db.query('delete from comp_rating_ledger where user_id = $1', [userId]);
}

export async function syncUserRating(userId: string, results: ArenaRatingResult[]): Promise<PlayerRating> {
  for (const result of results) {
    const points = arenaResultPoints(result.rank, result.participants, result.breached);
    if (points === 0) continue;
    const label = result.breached
      ? `Éliminé · ${result.title}`
      : `#${result.rank} / ${result.participants} · ${result.title}`;
    await awardRating(userId, `arena.result:${result.competitionId}`, points, label);
  }
  return getUserRating(userId);
}

/** Recalcule le ledger pour une liste de joueurs. Idempotent. */
export async function syncManyUserRatings(
  entries: Array<{ userId: string; results: ArenaRatingResult[] }>,
): Promise<number> {
  const chunkSize = 8;
  let synced = 0;
  for (let index = 0; index < entries.length; index += chunkSize) {
    const chunk = entries.slice(index, index + chunkSize);
    await Promise.all(chunk.map(async (entry) => {
      await syncUserRating(entry.userId, entry.results);
      synced += 1;
    }));
  }
  return synced;
}

async function listUserEvents(userId: string): Promise<RatingEvent[]> {
  const db = getPool();
  if (!db) {
    return [...(memory.get(userId)?.values() || [])].sort((a, b) => b.createdAt - a.createdAt);
  }
  await ensureTable();
  const result = await db.query<{ id: string; points: number; label: string; created_at: string }>(
    'select id, points, label, created_at from comp_rating_ledger where user_id = $1 order by created_at desc',
    [userId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    points: Number(row.points),
    label: row.label,
    createdAt: Number(row.created_at),
  }));
}

function memoryTotals(): Map<string, number> {
  const totals = new Map<string, number>();
  for (const [userId, ledger] of memory) {
    let sum = 0;
    for (const event of ledger.values()) sum += event.points;
    totals.set(userId, Math.max(0, sum));
  }
  return totals;
}

export async function getUserRating(userId: string): Promise<PlayerRating> {
  const events = await listUserEvents(userId);
  const points = Math.max(0, events.reduce((sum, event) => sum + event.points, 0));
  const { division, next } = divisionForPoints(points);
  let worldRank: number | null = null;
  let totalPlayers = 0;
  const db = getPool();
  if (!db) {
    const totals = memoryTotals();
    totalPlayers = totals.size;
    if (events.length) {
      worldRank = 1 + [...totals.entries()].filter(([id, total]) => id !== userId && total > points).length;
    }
  } else {
    await ensureTable();
    const result = await db.query<{ total_players: string; above: string; has_rows: string }>(`
      with totals as (
        select user_id, greatest(0, sum(points))::bigint as total
        from comp_rating_ledger
        group by user_id
      )
      select
        (select count(*) from totals) as total_players,
        (select count(*) from totals where total > $2 and user_id <> $1) as above,
        (select count(*) from totals where user_id = $1) as has_rows
    `, [userId, points]);
    const row = result.rows[0];
    totalPlayers = Number(row?.total_players || 0);
    if (Number(row?.has_rows || 0) > 0) worldRank = Number(row?.above || 0) + 1;
  }
  return {
    points,
    division,
    next,
    worldRank,
    totalPlayers,
    recentEvents: events.slice(0, 12),
  };
}

type RatingSnapshot = {
  points: number;
  division: RatingDivision;
  worldRank: number;
};

let snapshotsCache: { at: number; map: Map<string, RatingSnapshot> } | null = null;
const SNAPSHOTS_TTL_MS = 30_000;

async function listAllRatingTotals(): Promise<Array<{ userId: string; points: number }>> {
  const db = getPool();
  if (!db) {
    return [...memoryTotals().entries()]
      .map(([userId, points]) => ({ userId, points }))
      .sort((a, b) => b.points - a.points || a.userId.localeCompare(b.userId));
  }
  await ensureTable();
  const result = await db.query<{ user_id: string; total: string }>(`
    select user_id, greatest(0, sum(points))::bigint as total
    from comp_rating_ledger
    group by user_id
    order by total desc, user_id asc
  `);
  return result.rows.map((row) => ({ userId: row.user_id, points: Number(row.total) }));
}

/**
 * Rang mondial + division de tous les joueurs notés, mis en cache 30 s pour
 * pouvoir décorer le classement d'arène sans interroger Postgres à chaque poll.
 */
export async function getRatingSnapshots(): Promise<Map<string, RatingSnapshot>> {
  if (snapshotsCache && Date.now() - snapshotsCache.at < SNAPSHOTS_TTL_MS) {
    return snapshotsCache.map;
  }
  const totals = await listAllRatingTotals();
  const map = new Map<string, RatingSnapshot>();
  totals.forEach((row, index) => {
    map.set(row.userId, {
      points: row.points,
      division: divisionForPoints(row.points).division,
      worldRank: index + 1,
    });
  });
  snapshotsCache = { at: Date.now(), map };
  return map;
}

export async function getRatingLeaderboard(limit = 100): Promise<Array<{
  userId: string;
  points: number;
  division: RatingDivision;
}>> {
  const max = Math.min(200, Math.max(1, Math.floor(limit)));
  const db = getPool();
  let totals: Array<{ userId: string; points: number }>;
  if (!db) {
    totals = [...memoryTotals().entries()]
      .map(([userId, points]) => ({ userId, points }))
      .sort((a, b) => b.points - a.points)
      .slice(0, max);
  } else {
    await ensureTable();
    const result = await db.query<{ user_id: string; total: string }>(`
      select user_id, greatest(0, sum(points))::bigint as total
      from comp_rating_ledger
      group by user_id
      order by total desc
      limit $1
    `, [max]);
    totals = result.rows.map((row) => ({ userId: row.user_id, points: Number(row.total) }));
  }
  return totals.map((row) => ({
    userId: row.userId,
    points: row.points,
    division: divisionForPoints(row.points).division,
  }));
}
