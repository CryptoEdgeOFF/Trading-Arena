import crypto from 'node:crypto';
import { Pool } from 'pg';

export interface GlobalChatMessage {
  id: string;
  userId: string;
  name: string;
  avatarUrl: string | null;
  body: string;
  createdAt: number;
  replyTo?: {
    id: string;
    userId: string;
    name: string;
    body: string;
  } | null;
}

let pool: Pool | null = null;
let ready: Promise<void> | null = null;
const memoryMessages: GlobalChatMessage[] = [];

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
  pool.on('error', (error) => console.error('[global chat pool] idle client error:', error.message || error));
  return pool;
}

async function ensureTable(): Promise<void> {
  const db = getPool();
  if (!db) return;
  if (!ready) {
    ready = db.query(`
      create table if not exists comp_global_chat_messages (
        id text primary key,
        user_id text not null,
        name text not null,
        avatar_url text,
        body text not null,
        created_at bigint not null
      )
    `).then(async () => {
      await db.query('alter table comp_global_chat_messages add column if not exists reply_to_id text');
      await db.query('create index if not exists idx_comp_global_chat_created on comp_global_chat_messages(created_at desc)');
    });
  }
  await ready;
}

function sanitizeBody(input: unknown): string {
  return Array.from(String(input ?? ''))
    .filter((character) => {
      const code = character.charCodeAt(0);
      return (code >= 32 && code !== 127) || character === '\n' || character === '\t';
    })
    .join('')
    .replace(/\s{4,}/g, '   ')
    .trim();
}

export async function listGlobalChatMessages(options: { before?: number; limit?: number } = {}): Promise<GlobalChatMessage[]> {
  const before = Number.isFinite(options.before) ? Number(options.before) : Date.now() + 1;
  const limit = Math.min(100, Math.max(1, Math.floor(options.limit || 60)));
  const db = getPool();
  if (!db) {
    return memoryMessages.filter((message) => message.createdAt < before).slice(-limit);
  }
  await ensureTable();
  const result = await db.query<{
    id: string;
    user_id: string;
    name: string;
    avatar_url: string | null;
    body: string;
    created_at: string;
    reply_to_id: string | null;
    reply_user_id: string | null;
    reply_name: string | null;
    reply_body: string | null;
  }>(`
    select m.id, m.user_id, m.name, m.avatar_url, m.body, m.created_at, m.reply_to_id,
      r.user_id as reply_user_id, r.name as reply_name, r.body as reply_body
    from comp_global_chat_messages m
    left join comp_global_chat_messages r on r.id = m.reply_to_id
    where m.created_at < $1
    order by m.created_at desc
    limit $2
  `, [before, limit]);
  return result.rows.reverse().map((row) => ({
    id: row.id,
    userId: row.user_id,
    name: row.name,
    avatarUrl: row.avatar_url,
    body: row.body,
    createdAt: Number(row.created_at),
    replyTo: row.reply_to_id && row.reply_user_id && row.reply_name && row.reply_body
      ? { id: row.reply_to_id, userId: row.reply_user_id, name: row.reply_name, body: row.reply_body }
      : null,
  }));
}

export async function createGlobalChatMessage(user: {
  id: string;
  name: string;
  avatarUrl?: string | null;
}, input: unknown, replyToIdInput?: unknown): Promise<GlobalChatMessage> {
  const body = sanitizeBody(input);
  if (!body) throw new Error('Le message est vide');
  if (body.length > 600) throw new Error('Le message dépasse 600 caractères');
  const replyToId = String(replyToIdInput || '').trim();
  const db = getPool();
  let replyTo: GlobalChatMessage['replyTo'] = null;
  if (replyToId) {
    if (!db) {
      const referenced = memoryMessages.find((message) => message.id === replyToId);
      if (referenced) replyTo = { id: referenced.id, userId: referenced.userId, name: referenced.name, body: referenced.body };
    } else {
      await ensureTable();
      const referenced = await db.query<{ id: string; user_id: string; name: string; body: string }>(
        'select id, user_id, name, body from comp_global_chat_messages where id = $1 limit 1',
        [replyToId],
      );
      const row = referenced.rows[0];
      if (row) replyTo = { id: row.id, userId: row.user_id, name: row.name, body: row.body };
    }
    if (!replyTo) throw new Error('Le message auquel tu réponds est introuvable');
  }
  const message: GlobalChatMessage = {
    id: crypto.randomUUID(),
    userId: user.id,
    name: user.name,
    avatarUrl: user.avatarUrl || null,
    body,
    createdAt: Date.now(),
    replyTo,
  };
  if (!db) {
    memoryMessages.push(message);
    if (memoryMessages.length > 1_000) memoryMessages.splice(0, memoryMessages.length - 1_000);
    return message;
  }
  await ensureTable();
  await db.query(`
    insert into comp_global_chat_messages (id, user_id, name, avatar_url, body, created_at, reply_to_id)
    values ($1, $2, $3, $4, $5, $6, $7)
  `, [message.id, message.userId, message.name, message.avatarUrl, message.body, message.createdAt, replyTo?.id || null]);
  return message;
}
