import crypto from 'node:crypto';
import { Pool } from 'pg';

export interface GlobalChatMessage {
  id: string;
  userId: string;
  name: string;
  avatarUrl: string | null;
  body: string;
  imageUrl: string | null;
  createdAt: number;
  replyTo?: {
    id: string;
    userId: string;
    name: string;
    body: string;
    imageUrl: string | null;
  } | null;
}

let pool: Pool | null = null;
let ready: Promise<void> | null = null;
const memoryMessages: GlobalChatMessage[] = [];
const memoryImages = new Map<string, { userId: string; mime: string; data: Buffer }>();
const CHAT_IMAGE_PATH = /^\/api\/chat-images\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;

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
      await db.query('alter table comp_global_chat_messages add column if not exists image_url text');
      await db.query(`
        create table if not exists comp_chat_images (
          id text primary key,
          user_id text not null,
          mime text not null,
          data bytea not null,
          created_at timestamptz not null default now()
        )
      `);
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

function sanitizeImageUrl(input: unknown): string | null {
  const value = String(input ?? '').trim().split('?')[0];
  return CHAT_IMAGE_PATH.test(value) ? value : null;
}

function chatImageIdFromUrl(imageUrl: string): string {
  return imageUrl.slice(imageUrl.lastIndexOf('/') + 1);
}

export async function putChatImage(userId: string, mime: string, data: Buffer): Promise<string> {
  const id = crypto.randomUUID();
  const db = getPool();
  if (!db) {
    memoryImages.set(id, { userId, mime, data });
    return `/api/chat-images/${id}`;
  }
  await ensureTable();
  await db.query(
    'insert into comp_chat_images (id, user_id, mime, data) values ($1, $2, $3, $4)',
    [id, userId, mime, data],
  );
  return `/api/chat-images/${id}`;
}

export async function getChatImage(id: string): Promise<{ mime: string; data: Buffer } | null> {
  const memory = memoryImages.get(id);
  if (memory) return { mime: memory.mime, data: memory.data };
  const db = getPool();
  if (!db) return null;
  await ensureTable();
  const result = await db.query<{ mime: string; data: Buffer }>(
    'select mime, data from comp_chat_images where id = $1 limit 1',
    [id],
  );
  const row = result.rows[0];
  return row ? { mime: row.mime, data: row.data } : null;
}

async function assertOwnedChatImage(userId: string, imageUrl: string): Promise<void> {
  const id = chatImageIdFromUrl(imageUrl);
  const memory = memoryImages.get(id);
  if (memory) {
    if (memory.userId !== userId) throw new Error('Image invalide');
    return;
  }
  const db = getPool();
  if (!db) throw new Error('Image introuvable');
  await ensureTable();
  const result = await db.query<{ user_id: string }>(
    'select user_id from comp_chat_images where id = $1 limit 1',
    [id],
  );
  if (!result.rows[0] || result.rows[0].user_id !== userId) throw new Error('Image introuvable');
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
    image_url: string | null;
    created_at: string;
    reply_to_id: string | null;
    reply_user_id: string | null;
    reply_name: string | null;
    reply_body: string | null;
    reply_image_url: string | null;
  }>(`
    select m.id, m.user_id, m.name, m.avatar_url, m.body, m.image_url, m.created_at, m.reply_to_id,
      r.user_id as reply_user_id, r.name as reply_name, r.body as reply_body, r.image_url as reply_image_url
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
    imageUrl: row.image_url,
    createdAt: Number(row.created_at),
    replyTo: row.reply_to_id && row.reply_user_id && row.reply_name
      ? {
        id: row.reply_to_id,
        userId: row.reply_user_id,
        name: row.reply_name,
        body: row.reply_body || '',
        imageUrl: row.reply_image_url,
      }
      : null,
  }));
}

export async function createGlobalChatMessage(user: {
  id: string;
  name: string;
  avatarUrl?: string | null;
}, input: { body?: unknown; replyToId?: unknown; imageUrl?: unknown }): Promise<GlobalChatMessage> {
  const body = sanitizeBody(input.body);
  const imageUrl = sanitizeImageUrl(input.imageUrl);
  if (!body && !imageUrl) throw new Error('Le message est vide');
  if (body.length > 600) throw new Error('Le message dépasse 600 caractères');
  if (imageUrl) await assertOwnedChatImage(user.id, imageUrl);
  const replyToId = String(input.replyToId || '').trim();
  const db = getPool();
  let replyTo: GlobalChatMessage['replyTo'] = null;
  if (replyToId) {
    if (!db) {
      const referenced = memoryMessages.find((message) => message.id === replyToId);
      if (referenced) {
        replyTo = {
          id: referenced.id,
          userId: referenced.userId,
          name: referenced.name,
          body: referenced.body,
          imageUrl: referenced.imageUrl,
        };
      }
    } else {
      await ensureTable();
      const referenced = await db.query<{ id: string; user_id: string; name: string; body: string; image_url: string | null }>(
        'select id, user_id, name, body, image_url from comp_global_chat_messages where id = $1 limit 1',
        [replyToId],
      );
      const row = referenced.rows[0];
      if (row) {
        replyTo = {
          id: row.id,
          userId: row.user_id,
          name: row.name,
          body: row.body || '',
          imageUrl: row.image_url,
        };
      }
    }
    if (!replyTo) throw new Error('Le message auquel tu réponds est introuvable');
  }
  const message: GlobalChatMessage = {
    id: crypto.randomUUID(),
    userId: user.id,
    name: user.name,
    avatarUrl: user.avatarUrl || null,
    body,
    imageUrl,
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
    insert into comp_global_chat_messages (id, user_id, name, avatar_url, body, image_url, created_at, reply_to_id)
    values ($1, $2, $3, $4, $5, $6, $7, $8)
  `, [message.id, message.userId, message.name, message.avatarUrl, message.body, message.imageUrl, message.createdAt, replyTo?.id || null]);
  return message;
}
