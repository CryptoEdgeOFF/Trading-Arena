import crypto from 'node:crypto';
import { Pool } from 'pg';

export type XpEventType =
  | 'account.created'
  | 'arena.join'
  | 'arena.first_trade'
  | 'arena.completed'
  | 'arena.podium'
  | 'arena.streak'
  | 'badge.unlocked'
  | 'trading.achievement';

export interface XpEvent {
  id: string;
  eventType: XpEventType;
  amount: number;
  label: string;
  createdAt: number;
}

export interface PlayerProgression {
  totalXp: number;
  level: number;
  levelStartXp: number;
  nextLevelXp: number;
  xpIntoLevel: number;
  xpForNextLevel: number;
  progressPercent: number;
  title: { id: string; label: string; rarity: 'common' | 'rare' | 'epic' | 'legendary' };
  frame: { id: string; label: string; tier: number };
  recentEvents: XpEvent[];
}

export interface UserXpFacts {
  joined: Array<{ competitionId: string; title: string }>;
  traded: Array<{ competitionId: string; title: string }>;
  completed: Array<{ competitionId: string; title: string }>;
  podiums: Array<{ competitionId: string; title: string; rank: number }>;
  badges: string[];
  tradingAchievements?: Array<{ key: string; amount: number; label: string }>;
}

interface AwardInput {
  eventKey: string;
  eventType: XpEventType;
  amount: number;
  label: string;
}

let pool: Pool | null = null;
let ready: Promise<void> | null = null;
const memory = new Map<string, Map<string, XpEvent>>();

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
  pool.on('error', (error) => console.error('[xp pool] idle client error:', error.message || error));
  return pool;
}

async function ensureTable(): Promise<void> {
  const db = getPool();
  if (!db) return;
  if (!ready) {
    ready = db.query(`
      create table if not exists comp_xp_ledger (
        id text primary key,
        user_id text not null,
        event_key text not null,
        event_type text not null,
        xp_amount integer not null,
        label text not null,
        created_at bigint not null,
        unique(user_id, event_key)
      )
    `).then(async () => {
      await db.query('create index if not exists idx_comp_xp_user_created on comp_xp_ledger(user_id, created_at desc)');
    });
  }
  await ready;
}

function threshold(level: number): number {
  return 250 * Math.max(0, level - 1) ** 2;
}

function levelFromXp(totalXp: number): number {
  return Math.max(1, Math.min(50, Math.floor(Math.sqrt(Math.max(0, totalXp) / 250)) + 1));
}

function identityForLevel(level: number): Pick<PlayerProgression, 'title' | 'frame'> {
  if (level >= 20) return {
    title: { id: 'btf-legend', label: 'Légende BTF', rarity: 'legendary' },
    frame: { id: 'diamond', label: 'Cadre Diamant', tier: 6 },
  };
  if (level >= 12) return {
    title: { id: 'arena-elite', label: 'Élite des Arènes', rarity: 'legendary' },
    frame: { id: 'platinum', label: 'Cadre Platine', tier: 5 },
  };
  if (level >= 8) return {
    title: { id: 'podium-hunter', label: 'Chasseur de Podium', rarity: 'epic' },
    frame: { id: 'gold', label: 'Cadre Or', tier: 4 },
  };
  if (level >= 5) return {
    title: { id: 'competitor', label: 'Compétiteur', rarity: 'rare' },
    frame: { id: 'silver', label: 'Cadre Argent', tier: 3 },
  };
  if (level >= 3) return {
    title: { id: 'active-trader', label: 'Trader Actif', rarity: 'rare' },
    frame: { id: 'bronze', label: 'Cadre Bronze', tier: 2 },
  };
  return {
    title: { id: 'challenger', label: 'Nouveau Challenger', rarity: 'common' },
    frame: { id: 'rookie', label: 'Cadre Challenger', tier: 1 },
  };
}

async function awardXp(userId: string, award: AwardInput): Promise<boolean> {
  const db = getPool();
  const event: XpEvent = {
    id: crypto.randomUUID(),
    eventType: award.eventType,
    amount: award.amount,
    label: award.label,
    createdAt: Date.now(),
  };
  if (!db) {
    const ledger = memory.get(userId) || new Map<string, XpEvent>();
    if (ledger.has(award.eventKey)) return false;
    ledger.set(award.eventKey, event);
    memory.set(userId, ledger);
    return true;
  }
  await ensureTable();
  const result = await db.query(`
    insert into comp_xp_ledger (id, user_id, event_key, event_type, xp_amount, label, created_at)
    values ($1,$2,$3,$4,$5,$6,$7)
    on conflict (user_id, event_key) do nothing
    returning id
  `, [event.id, userId, award.eventKey, event.eventType, event.amount, event.label, event.createdAt]);
  return result.rowCount === 1;
}

function awardsFromFacts(facts: UserXpFacts): AwardInput[] {
  const awards: AwardInput[] = [{
    eventKey: 'account.created',
    eventType: 'account.created',
    amount: 100,
    label: 'Bienvenue dans BTF Arena',
  }];
  for (const arena of facts.joined) awards.push({
    eventKey: `arena.join:${arena.competitionId}`,
    eventType: 'arena.join',
    amount: 50,
    label: `Arène rejointe · ${arena.title}`,
  });
  for (const arena of facts.traded) awards.push({
    eventKey: `arena.first_trade:${arena.competitionId}`,
    eventType: 'arena.first_trade',
    amount: 75,
    label: `Premier trade · ${arena.title}`,
  });
  for (const arena of facts.completed) awards.push({
    eventKey: `arena.completed:${arena.competitionId}`,
    eventType: 'arena.completed',
    amount: 100,
    label: `Arène terminée · ${arena.title}`,
  });
  for (const podium of facts.podiums) {
    const amount = podium.rank === 1 ? 500 : podium.rank === 2 ? 350 : 250;
    awards.push({
      eventKey: `arena.podium:${podium.competitionId}:${podium.rank}`,
      eventType: 'arena.podium',
      amount,
      label: `Podium #${podium.rank} · ${podium.title}`,
    });
  }
  for (const milestone of [3, 5, 10, 20]) {
    if (facts.completed.length >= milestone) awards.push({
      eventKey: `arena.streak:${milestone}`,
      eventType: 'arena.streak',
      amount: milestone === 3 ? 200 : milestone === 5 ? 350 : milestone === 10 ? 700 : 1_500,
      label: `${milestone} arènes d’affilée`,
    });
  }
  for (const badge of facts.badges) awards.push({
    eventKey: `badge.unlocked:${badge}`,
    eventType: 'badge.unlocked',
    amount: 300,
    label: `Badge débloqué · ${badge}`,
  });
  for (const achievement of facts.tradingAchievements || []) awards.push({
    eventKey: `trading.${achievement.key}`,
    eventType: 'trading.achievement',
    amount: achievement.amount,
    label: achievement.label,
  });
  return awards;
}

export async function syncUserProgression(userId: string, facts: UserXpFacts): Promise<PlayerProgression> {
  for (const award of awardsFromFacts(facts)) await awardXp(userId, award);
  return getUserProgression(userId);
}

export async function getUserProgression(userId: string): Promise<PlayerProgression> {
  const db = getPool();
  let events: XpEvent[];
  if (!db) {
    events = [...(memory.get(userId)?.values() || [])].sort((a, b) => b.createdAt - a.createdAt);
  } else {
    await ensureTable();
    const result = await db.query<{
      id: string;
      event_type: XpEventType;
      xp_amount: number;
      label: string;
      created_at: string;
    }>('select id, event_type, xp_amount, label, created_at from comp_xp_ledger where user_id = $1 order by created_at desc', [userId]);
    events = result.rows.map((row) => ({
      id: row.id,
      eventType: row.event_type,
      amount: Number(row.xp_amount),
      label: row.label,
      createdAt: Number(row.created_at),
    }));
  }
  const totalXp = events.reduce((sum, event) => sum + event.amount, 0);
  const level = levelFromXp(totalXp);
  const levelStartXp = threshold(level);
  const nextLevelXp = level >= 50 ? totalXp : threshold(level + 1);
  const xpIntoLevel = Math.max(0, totalXp - levelStartXp);
  const xpForNextLevel = Math.max(1, nextLevelXp - levelStartXp);
  return {
    totalXp,
    level,
    levelStartXp,
    nextLevelXp,
    xpIntoLevel,
    xpForNextLevel,
    progressPercent: level >= 50 ? 100 : Math.min(100, (xpIntoLevel / xpForNextLevel) * 100),
    ...identityForLevel(level),
    recentEvents: events.slice(0, 12),
  };
}
