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
  /** Salle : null = chat global, sinon id de l'arène (chat par tournoi). */
  competitionId?: string | null;
  replyTo?: {
    id: string;
    userId: string;
    name: string;
    body: string;
    imageUrl: string | null;
  } | null;
}

export type ChatReportReason = 'harassment' | 'hate' | 'spam' | 'sexual' | 'violence' | 'other';

/** Normalise l'identifiant de salle (null = chat global). */
function roomOf(competitionId?: string | null): string | null {
  const value = String(competitionId ?? '').trim();
  return value ? value : null;
}

let pool: Pool | null = null;
let ready: Promise<void> | null = null;
const memoryMessages: GlobalChatMessage[] = [];
const memoryImages = new Map<string, { userId: string; mime: string; data: Buffer }>();
const memoryBlocks = new Set<string>();
const memoryReports = new Set<string>();
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
      await db.query('alter table comp_global_chat_messages add column if not exists competition_id text');
      await db.query('create index if not exists idx_comp_global_chat_room on comp_global_chat_messages(competition_id, created_at desc)');
      await db.query(`
        create table if not exists comp_chat_images (
          id text primary key,
          user_id text not null,
          mime text not null,
          data bytea not null,
          created_at timestamptz not null default now()
        )
      `);
      await db.query(`
        create table if not exists comp_chat_blocks (
          blocker_user_id text not null,
          blocked_user_id text not null,
          created_at bigint not null,
          primary key (blocker_user_id, blocked_user_id)
        )
      `);
      await db.query(`
        create table if not exists comp_chat_reports (
          id text primary key,
          message_id text not null,
          reporter_user_id text not null,
          reported_user_id text not null,
          reason text not null,
          details text not null default '',
          status text not null default 'pending',
          created_at bigint not null,
          unique (message_id, reporter_user_id)
        )
      `);
      await db.query('create index if not exists idx_comp_chat_reports_status on comp_chat_reports(status, created_at desc)');
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

function moderationText(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[0@]/g, 'o')
    .replace(/[1!|]/g, 'i')
    .replace(/[3]/g, 'e')
    .replace(/[4]/g, 'a')
    .replace(/[5$]/g, 's')
    .replace(/[7]/g, 't')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const PROHIBITED_CHAT_PATTERNS = [
  /\b(?:nigger|nigga|negre|bougnoule|sale arabe|sale noir|sale juif)\b/i,
  /\b(?:faggot|tapette|pede|gouine)\b/i,
  /\b(?:kys|kill yourself|go kill yourself|va te suicider|suicide toi)\b/i,
  /\b(?:je vais te tuer|i will kill you|rape you|je vais te violer)\b/i,
  /\b(?:heil hitler|white power)\b/i,
];

export function hasProhibitedChatContent(input: string): boolean {
  const normalized = moderationText(input);
  return PROHIBITED_CHAT_PATTERNS.some((pattern) => pattern.test(normalized));
}

function blockKey(blockerUserId: string, blockedUserId: string): string {
  return `${blockerUserId}:${blockedUserId}`;
}

function sanitizeImageUrl(input: unknown): string | null {
  const value = String(input ?? '').trim().split('?')[0];
  return CHAT_IMAGE_PATH.test(value) ? value : null;
}

function chatImageIdFromUrl(imageUrl: string): string {
  return imageUrl.slice(imageUrl.lastIndexOf('/') + 1);
}

export async function anonymizeChatForUser(userId: string): Promise<void> {
  if (!userId) return;
  for (const message of memoryMessages) {
    if (message.userId === userId) {
      message.name = 'Compte supprimé';
      message.avatarUrl = null;
    }
    if (message.replyTo?.userId === userId) {
      message.replyTo.name = 'Compte supprimé';
    }
  }
  const db = getPool();
  if (!db) return;
  await ensureTable();
  await db.query(
    `update comp_global_chat_messages
     set name = 'Compte supprimé', avatar_url = null
     where user_id = $1`,
    [userId],
  );
  await db.query('delete from comp_chat_blocks where blocker_user_id = $1 or blocked_user_id = $1', [userId]);
  await db.query('delete from comp_chat_reports where reporter_user_id = $1', [userId]);
}

export async function listBlockedChatUserIds(userId: string): Promise<string[]> {
  if (!userId) return [];
  const db = getPool();
  if (!db) {
    return Array.from(memoryBlocks)
      .filter((key) => key.startsWith(`${userId}:`))
      .map((key) => key.slice(userId.length + 1));
  }
  await ensureTable();
  const result = await db.query<{ blocked_user_id: string }>(
    'select blocked_user_id from comp_chat_blocks where blocker_user_id = $1 order by created_at desc',
    [userId],
  );
  return result.rows.map((row) => row.blocked_user_id);
}

export async function blockChatUser(blockerUserId: string, blockedUserId: string): Promise<void> {
  if (!blockerUserId || !blockedUserId) throw new Error('Utilisateur invalide');
  if (blockerUserId === blockedUserId) throw new Error('Tu ne peux pas te bloquer');
  const db = getPool();
  if (!db) {
    memoryBlocks.add(blockKey(blockerUserId, blockedUserId));
    return;
  }
  await ensureTable();
  await db.query(`
    insert into comp_chat_blocks (blocker_user_id, blocked_user_id, created_at)
    values ($1, $2, $3)
    on conflict (blocker_user_id, blocked_user_id) do nothing
  `, [blockerUserId, blockedUserId, Date.now()]);
}

export async function unblockChatUser(blockerUserId: string, blockedUserId: string): Promise<void> {
  if (!blockerUserId || !blockedUserId) return;
  const db = getPool();
  if (!db) {
    memoryBlocks.delete(blockKey(blockerUserId, blockedUserId));
    return;
  }
  await ensureTable();
  await db.query(
    'delete from comp_chat_blocks where blocker_user_id = $1 and blocked_user_id = $2',
    [blockerUserId, blockedUserId],
  );
}

export async function reportGlobalChatMessage(input: {
  reporterUserId: string;
  messageId: string;
  reason: ChatReportReason;
  details?: unknown;
}): Promise<boolean> {
  const reporterUserId = String(input.reporterUserId || '').trim();
  const messageId = String(input.messageId || '').trim();
  const allowedReasons: ChatReportReason[] = ['harassment', 'hate', 'spam', 'sexual', 'violence', 'other'];
  if (!reporterUserId || !messageId || !allowedReasons.includes(input.reason)) {
    throw new Error('Signalement invalide');
  }
  const details = sanitizeBody(input.details).slice(0, 500);
  const db = getPool();
  if (!db) {
    const message = memoryMessages.find((entry) => entry.id === messageId);
    if (!message) throw new Error('Message introuvable');
    if (message.userId === reporterUserId) throw new Error('Tu ne peux pas signaler ton propre message');
    const key = `${messageId}:${reporterUserId}`;
    const created = !memoryReports.has(key);
    memoryReports.add(key);
    return created;
  }
  await ensureTable();
  const message = await db.query<{ user_id: string }>(
    'select user_id from comp_global_chat_messages where id = $1 limit 1',
    [messageId],
  );
  const reportedUserId = message.rows[0]?.user_id;
  if (!reportedUserId) throw new Error('Message introuvable');
  if (reportedUserId === reporterUserId) throw new Error('Tu ne peux pas signaler ton propre message');
  const inserted = await db.query<{ id: string }>(`
    insert into comp_chat_reports
      (id, message_id, reporter_user_id, reported_user_id, reason, details, status, created_at)
    values ($1, $2, $3, $4, $5, $6, 'pending', $7)
    on conflict (message_id, reporter_user_id) do nothing
    returning id
  `, [crypto.randomUUID(), messageId, reporterUserId, reportedUserId, input.reason, details, Date.now()]);
  return inserted.rows.length > 0;
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

export async function listGlobalChatMessages(
  options: { before?: number; limit?: number; competitionId?: string | null; viewerUserId?: string | null } = {},
): Promise<GlobalChatMessage[]> {
  const before = Number.isFinite(options.before) ? Number(options.before) : Date.now() + 1;
  const limit = Math.min(100, Math.max(1, Math.floor(options.limit || 60)));
  const room = roomOf(options.competitionId);
  const viewerUserId = String(options.viewerUserId || '').trim() || null;
  const db = getPool();
  if (!db) {
    const blocked = viewerUserId ? new Set(await listBlockedChatUserIds(viewerUserId)) : null;
    return memoryMessages
      .filter((message) => (
        message.createdAt < before
        && roomOf(message.competitionId) === room
        && !blocked?.has(message.userId)
      ))
      .slice(-limit);
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
      and m.competition_id is not distinct from $3
      and (
        $4::text is null
        or not exists (
          select 1 from comp_chat_blocks b
          where b.blocker_user_id = $4 and b.blocked_user_id = m.user_id
        )
      )
    order by m.created_at desc
    limit $2
  `, [before, limit, room, viewerUserId]);
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
}, input: { body?: unknown; replyToId?: unknown; imageUrl?: unknown; competitionId?: string | null }): Promise<GlobalChatMessage> {
  const body = sanitizeBody(input.body);
  const imageUrl = sanitizeImageUrl(input.imageUrl);
  const room = roomOf(input.competitionId);
  if (!body && !imageUrl) throw new Error('Le message est vide');
  if (body.length > 600) throw new Error('Le message dépasse 600 caractères');
  if (body && hasProhibitedChatContent(body)) {
    throw new Error('Message refusé par le filtre de sécurité');
  }
  if (imageUrl) await assertOwnedChatImage(user.id, imageUrl);
  const replyToId = String(input.replyToId || '').trim();
  const db = getPool();
  let replyTo: GlobalChatMessage['replyTo'] = null;
  if (replyToId) {
    if (!db) {
      const referenced = memoryMessages.find((message) => message.id === replyToId && roomOf(message.competitionId) === room);
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
        'select id, user_id, name, body, image_url from comp_global_chat_messages where id = $1 and competition_id is not distinct from $2 limit 1',
        [replyToId, room],
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
    competitionId: room,
    replyTo,
  };
  if (!db) {
    memoryMessages.push(message);
    if (memoryMessages.length > 2_000) memoryMessages.splice(0, memoryMessages.length - 2_000);
    return message;
  }
  await ensureTable();
  await db.query(`
    insert into comp_global_chat_messages (id, user_id, name, avatar_url, body, image_url, created_at, reply_to_id, competition_id)
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
  `, [message.id, message.userId, message.name, message.avatarUrl, message.body, message.imageUrl, message.createdAt, replyTo?.id || null, room]);
  return message;
}
