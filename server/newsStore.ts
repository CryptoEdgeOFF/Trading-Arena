import crypto from 'node:crypto';
import { Pool } from 'pg';

export interface NewsArticle {
  id: string;
  title: string;
  summary: string;
  body: string;
  coverUrl: string;
  published: boolean;
  featured: boolean;
  publishedAt: number | null;
  pushSentAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface NewsInput {
  title?: unknown;
  summary?: unknown;
  body?: unknown;
  coverUrl?: unknown;
  published?: unknown;
  featured?: unknown;
}

let pool: Pool | null = null;
let ready: Promise<void> | null = null;
const memory = new Map<string, NewsArticle>();

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
  pool.on('error', (error) => console.error('[news pool] idle client error:', error.message || error));
  return pool;
}

async function ensureTable(): Promise<void> {
  const db = getPool();
  if (!db) return;
  if (!ready) {
    ready = db.query(`
      create table if not exists comp_news (
        id text primary key,
        title text not null,
        summary text not null default '',
        body text not null,
        cover_url text not null default '',
        published boolean not null default false,
        featured boolean not null default false,
        published_at bigint,
        push_sent_at bigint,
        created_at bigint not null,
        updated_at bigint not null
      )
    `).then(async () => {
      await db.query('create index if not exists idx_comp_news_public on comp_news(published, published_at desc)');
    });
  }
  await ready;
}

function rowToArticle(row: Record<string, unknown>): NewsArticle {
  return {
    id: String(row.id),
    title: String(row.title || ''),
    summary: String(row.summary || ''),
    body: String(row.body || ''),
    coverUrl: String(row.cover_url || ''),
    published: Boolean(row.published),
    featured: Boolean(row.featured),
    publishedAt: row.published_at == null ? null : Number(row.published_at),
    pushSentAt: row.push_sent_at == null ? null : Number(row.push_sent_at),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function normalizeText(value: unknown, max: number): string {
  return String(value ?? '').replace(/\r\n/g, '\n').trim().slice(0, max);
}

function build(input: NewsInput, previous?: NewsArticle): NewsArticle {
  const now = Date.now();
  const base: NewsArticle = previous || {
    id: crypto.randomUUID(),
    title: '',
    summary: '',
    body: '',
    coverUrl: '',
    published: false,
    featured: false,
    publishedAt: null,
    pushSentAt: null,
    createdAt: now,
    updatedAt: now,
  };
  const published = input.published === undefined ? base.published : Boolean(input.published);
  const next = {
    ...base,
    title: input.title === undefined ? base.title : normalizeText(input.title, 180),
    summary: input.summary === undefined ? base.summary : normalizeText(input.summary, 420),
    body: input.body === undefined ? base.body : normalizeText(input.body, 30_000),
    coverUrl: input.coverUrl === undefined ? base.coverUrl : normalizeText(input.coverUrl, 1_000),
    featured: input.featured === undefined ? base.featured : Boolean(input.featured),
    published,
    publishedAt: published ? (base.publishedAt || now) : null,
    updatedAt: now,
  };
  if (!next.title) throw new Error('Le titre est requis');
  if (!next.body) throw new Error('Le contenu est requis');
  return next;
}

async function upsert(article: NewsArticle): Promise<void> {
  const db = getPool();
  if (!db) {
    memory.set(article.id, article);
    return;
  }
  await ensureTable();
  await db.query(`
    insert into comp_news
      (id, title, summary, body, cover_url, published, featured, published_at, push_sent_at, created_at, updated_at)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    on conflict (id) do update set
      title=excluded.title, summary=excluded.summary, body=excluded.body,
      cover_url=excluded.cover_url, published=excluded.published, featured=excluded.featured,
      published_at=excluded.published_at, push_sent_at=excluded.push_sent_at, updated_at=excluded.updated_at
  `, [
    article.id, article.title, article.summary, article.body, article.coverUrl,
    article.published, article.featured, article.publishedAt, article.pushSentAt,
    article.createdAt, article.updatedAt,
  ]);
}

export async function listAdminNews(): Promise<NewsArticle[]> {
  const db = getPool();
  if (!db) return [...memory.values()].sort((a, b) => b.createdAt - a.createdAt);
  await ensureTable();
  const result = await db.query('select * from comp_news order by created_at desc');
  return result.rows.map(rowToArticle);
}

export async function listPublicNews(before = Date.now() + 1, limit = 20): Promise<NewsArticle[]> {
  const safeLimit = Math.min(50, Math.max(1, Math.floor(limit)));
  const db = getPool();
  if (!db) {
    return [...memory.values()]
      .filter((article) => article.published && (article.publishedAt || 0) < before)
      .sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0))
      .slice(0, safeLimit);
  }
  await ensureTable();
  const result = await db.query(
    `select * from comp_news
     where published = true and published_at < $1
     order by published_at desc
     limit $2`,
    [before, safeLimit],
  );
  return result.rows.map(rowToArticle);
}

export async function getNews(id: string, includeDraft = false): Promise<NewsArticle | null> {
  const db = getPool();
  if (!db) {
    const article = memory.get(id) || null;
    return article && (includeDraft || article.published) ? article : null;
  }
  await ensureTable();
  const result = await db.query(
    `select * from comp_news where id = $1${includeDraft ? '' : ' and published = true'} limit 1`,
    [id],
  );
  return result.rows[0] ? rowToArticle(result.rows[0]) : null;
}

export async function createNews(input: NewsInput): Promise<NewsArticle> {
  const article = build(input);
  await upsert(article);
  return article;
}

export async function updateNews(id: string, input: NewsInput): Promise<NewsArticle> {
  const previous = await getNews(id, true);
  if (!previous) throw new Error('Actualité introuvable');
  const article = build(input, previous);
  await upsert(article);
  return article;
}

export async function markPushSent(id: string): Promise<NewsArticle> {
  const article = await getNews(id, true);
  if (!article) throw new Error('Actualité introuvable');
  if (!article.published) throw new Error('Publie l’actualité avant d’envoyer la notification');
  if (!article.pushSentAt) {
    article.pushSentAt = Date.now();
    article.updatedAt = Date.now();
    await upsert(article);
  }
  return article;
}

export async function deleteNews(id: string): Promise<void> {
  const db = getPool();
  if (!db) {
    memory.delete(id);
    return;
  }
  await ensureTable();
  await db.query('delete from comp_news where id = $1', [id]);
}
