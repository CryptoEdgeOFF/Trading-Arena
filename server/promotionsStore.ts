/**
 * Store des promotions / deals partenaires affichés sur la page
 * « Trade Live Bonus » (/compete/bonus).
 *
 * Persisté dans Postgres (table `promotions`) quand `DATABASE_URL` est
 * configuré, sinon conservé en RAM (mode dev). Les photos réutilisent le
 * stockage d'images existant (`/api/admin/prize-image` → /api/prize-images/:id),
 * donc on ne stocke ici qu'une URL.
 */
import { Pool } from 'pg';
import crypto from 'crypto';
import { bilingual, bilingualList, type Lang } from './translate.js';

export type PromotionCategory = 'exchange' | 'broker' | 'prop' | 'tool' | 'community';

const CATEGORIES: PromotionCategory[] = ['exchange', 'broker', 'prop', 'tool', 'community'];

export interface Promotion {
  id: string;
  name: string;
  category: PromotionCategory;
  /** Couleur d'accent (hex). */
  accent: string;
  /** Accroche courte (1 ligne) — version FR (canonique). */
  tagline: string;
  /** Avantage principal mis en avant (badge) — FR. */
  highlight: string;
  /** Description longue (optionnelle) — FR. */
  description: string;
  /** Liste d'avantages (puces) — FR. */
  perks: string[];
  /** Versions EN générées automatiquement (repli sur FR si vide). */
  taglineEn: string;
  highlightEn: string;
  descriptionEn: string;
  perksEn: string[];
  /** Code promo (optionnel). */
  promoCode: string;
  /** Lien d'affiliation (optionnel). */
  referralUrl: string;
  /** URL de la photo / logo (optionnel). */
  photoUrl: string;
  /** Mise en avant (grande carte en haut). */
  featured: boolean;
  /** Visible publiquement. */
  enabled: boolean;
  /** Ordre d'affichage (asc). */
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

export interface PromotionInput {
  name?: unknown;
  category?: unknown;
  accent?: unknown;
  tagline?: unknown;
  highlight?: unknown;
  description?: unknown;
  perks?: unknown;
  promoCode?: unknown;
  referralUrl?: unknown;
  photoUrl?: unknown;
  featured?: unknown;
  enabled?: unknown;
  sortOrder?: unknown;
}

let pool: Pool | null = null;
let ready: Promise<void> | null = null;
/** Fallback RAM quand Postgres n'est pas configuré (dev). */
const memory = new Map<string, Promotion>();

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
  pool.on('error', (err) => {
    console.error('[promotions pool] idle client error:', err.message || err);
  });
  return pool;
}

async function ensureTable(): Promise<void> {
  const db = getPool();
  if (!db) return;
  if (!ready) {
    ready = db.query(`
      create table if not exists promotions (
        id text primary key,
        name text not null default '',
        category text not null default 'exchange',
        accent text not null default '#dc2626',
        tagline text not null default '',
        highlight text not null default '',
        description text not null default '',
        perks jsonb not null default '[]'::jsonb,
        promo_code text not null default '',
        referral_url text not null default '',
        photo_url text not null default '',
        featured boolean not null default false,
        enabled boolean not null default true,
        sort_order integer not null default 0,
        created_at bigint not null,
        updated_at bigint not null
      )
    `).then(() => undefined);
    ready = ready.then(async () => {
      await db.query("alter table promotions add column if not exists tagline_en text not null default ''");
      await db.query("alter table promotions add column if not exists highlight_en text not null default ''");
      await db.query("alter table promotions add column if not exists description_en text not null default ''");
      await db.query("alter table promotions add column if not exists perks_en jsonb not null default '[]'::jsonb");
    });
  }
  await ready;
}

function normalizeCategory(value: unknown): PromotionCategory {
  const v = String(value || '').trim().toLowerCase();
  return (CATEGORIES as string[]).includes(v) ? (v as PromotionCategory) : 'exchange';
}

function normalizePerks(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((p) => String(p ?? '').trim()).filter((p) => p.length > 0).slice(0, 12);
  }
  if (typeof value === 'string') {
    return value
      .split('\n')
      .map((p) => p.trim())
      .filter((p) => p.length > 0)
      .slice(0, 12);
  }
  return [];
}

function normalizeAccent(value: unknown, fallback = '#dc2626'): string {
  const v = String(value || '').trim();
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v) ? v : fallback;
}

function rowToPromotion(row: any): Promotion {
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    category: normalizeCategory(row.category),
    accent: normalizeAccent(row.accent),
    tagline: String(row.tagline ?? ''),
    highlight: String(row.highlight ?? ''),
    description: String(row.description ?? ''),
    perks: Array.isArray(row.perks) ? row.perks.map((p: unknown) => String(p)) : normalizePerks(row.perks),
    taglineEn: String(row.tagline_en ?? ''),
    highlightEn: String(row.highlight_en ?? ''),
    descriptionEn: String(row.description_en ?? ''),
    perksEn: Array.isArray(row.perks_en) ? row.perks_en.map((p: unknown) => String(p)) : normalizePerks(row.perks_en),
    promoCode: String(row.promo_code ?? ''),
    referralUrl: String(row.referral_url ?? ''),
    photoUrl: String(row.photo_url ?? ''),
    featured: Boolean(row.featured),
    enabled: Boolean(row.enabled),
    sortOrder: Number(row.sort_order ?? 0),
    createdAt: Number(row.created_at ?? Date.now()),
    updatedAt: Number(row.updated_at ?? Date.now()),
  };
}

function sortPromotions(list: Promotion[]): Promotion[] {
  return [...list].sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.createdAt - b.createdAt;
  });
}

function buildFromInput(input: PromotionInput, base?: Promotion): Promotion {
  const now = Date.now();
  const prev = base ?? {
    id: crypto.randomUUID(),
    name: '',
    category: 'exchange' as PromotionCategory,
    accent: '#dc2626',
    tagline: '',
    highlight: '',
    description: '',
    perks: [],
    taglineEn: '',
    highlightEn: '',
    descriptionEn: '',
    perksEn: [],
    promoCode: '',
    referralUrl: '',
    photoUrl: '',
    featured: false,
    enabled: true,
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
  };

  return {
    id: prev.id,
    name: input.name !== undefined ? String(input.name).trim() : prev.name,
    category: input.category !== undefined ? normalizeCategory(input.category) : prev.category,
    accent: input.accent !== undefined ? normalizeAccent(input.accent) : prev.accent,
    tagline: input.tagline !== undefined ? String(input.tagline).trim() : prev.tagline,
    highlight: input.highlight !== undefined ? String(input.highlight).trim() : prev.highlight,
    description: input.description !== undefined ? String(input.description).trim() : prev.description,
    perks: input.perks !== undefined ? normalizePerks(input.perks) : prev.perks,
    taglineEn: prev.taglineEn,
    highlightEn: prev.highlightEn,
    descriptionEn: prev.descriptionEn,
    perksEn: prev.perksEn,
    promoCode: input.promoCode !== undefined ? String(input.promoCode).trim() : prev.promoCode,
    referralUrl: input.referralUrl !== undefined ? String(input.referralUrl).trim() : prev.referralUrl,
    photoUrl: input.photoUrl !== undefined ? String(input.photoUrl).trim() : prev.photoUrl,
    featured: input.featured !== undefined ? Boolean(input.featured) : prev.featured,
    enabled: input.enabled !== undefined ? Boolean(input.enabled) : prev.enabled,
    sortOrder: input.sortOrder !== undefined && Number.isFinite(Number(input.sortOrder))
      ? Number(input.sortOrder)
      : prev.sortOrder,
    createdAt: prev.createdAt,
    updatedAt: now,
  };
}

/**
 * Remplit les versions FR/EN des champs texte via traduction automatique.
 * Pour économiser des appels, on ne re-traduit un champ que si son texte a
 * changé (ou si la version EN manque). Best-effort : en cas d'échec réseau,
 * `bilingual` renvoie le texte source des deux côtés.
 */
async function withTranslations(promo: Promotion, base?: Promotion): Promise<Promotion> {
  const next = { ...promo };

  const taglineChanged = !base || base.tagline !== promo.tagline || !base.taglineEn;
  const highlightChanged = !base || base.highlight !== promo.highlight || !base.highlightEn;
  const descriptionChanged = !base || base.description !== promo.description || !base.descriptionEn;
  const perksChanged =
    !base || base.perks.join('\n') !== promo.perks.join('\n') || base.perksEn.length === 0;

  const [tagline, highlight, description, perks] = await Promise.all([
    taglineChanged ? bilingual(promo.tagline) : Promise.resolve({ fr: base!.tagline, en: base!.taglineEn }),
    highlightChanged ? bilingual(promo.highlight) : Promise.resolve({ fr: base!.highlight, en: base!.highlightEn }),
    descriptionChanged ? bilingual(promo.description) : Promise.resolve({ fr: base!.description, en: base!.descriptionEn }),
    perksChanged ? bilingualList(promo.perks) : Promise.resolve({ fr: base!.perks, en: base!.perksEn }),
  ]);

  next.tagline = tagline.fr;
  next.taglineEn = tagline.en;
  next.highlight = highlight.fr;
  next.highlightEn = highlight.en;
  next.description = description.fr;
  next.descriptionEn = description.en;
  next.perks = perks.fr;
  next.perksEn = perks.en;
  return next;
}

async function upsert(promo: Promotion): Promise<void> {
  const db = getPool();
  if (!db) {
    memory.set(promo.id, promo);
    return;
  }
  await ensureTable();
  await db.query(
    `insert into promotions
      (id, name, category, accent, tagline, highlight, description, perks,
       tagline_en, highlight_en, description_en, perks_en,
       promo_code, referral_url, photo_url, featured, enabled, sort_order, created_at, updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12::jsonb,$13,$14,$15,$16,$17,$18,$19,$20)
     on conflict (id) do update set
       name = excluded.name,
       category = excluded.category,
       accent = excluded.accent,
       tagline = excluded.tagline,
       highlight = excluded.highlight,
       description = excluded.description,
       perks = excluded.perks,
       tagline_en = excluded.tagline_en,
       highlight_en = excluded.highlight_en,
       description_en = excluded.description_en,
       perks_en = excluded.perks_en,
       promo_code = excluded.promo_code,
       referral_url = excluded.referral_url,
       photo_url = excluded.photo_url,
       featured = excluded.featured,
       enabled = excluded.enabled,
       sort_order = excluded.sort_order,
       updated_at = excluded.updated_at`,
    [
      promo.id,
      promo.name,
      promo.category,
      promo.accent,
      promo.tagline,
      promo.highlight,
      promo.description,
      JSON.stringify(promo.perks),
      promo.taglineEn,
      promo.highlightEn,
      promo.descriptionEn,
      JSON.stringify(promo.perksEn),
      promo.promoCode,
      promo.referralUrl,
      promo.photoUrl,
      promo.featured,
      promo.enabled,
      promo.sortOrder,
      promo.createdAt,
      promo.updatedAt,
    ],
  );
}

/** Liste complète (admin). */
export async function listPromotions(): Promise<Promotion[]> {
  const db = getPool();
  if (!db) return sortPromotions([...memory.values()]);
  await ensureTable();
  const result = await db.query('select * from promotions');
  return sortPromotions(result.rows.map(rowToPromotion));
}

/** Forme localisée envoyée à la page publique (champs aplatis dans une langue). */
export interface LocalizedPromotion {
  id: string;
  name: string;
  category: PromotionCategory;
  accent: string;
  tagline: string;
  highlight: string;
  description: string;
  perks: string[];
  promoCode: string;
  referralUrl: string;
  photoUrl: string;
  featured: boolean;
  sortOrder: number;
}

function localize(promo: Promotion, lang: Lang): LocalizedPromotion {
  const en = lang === 'en';
  return {
    id: promo.id,
    name: promo.name,
    category: promo.category,
    accent: promo.accent,
    tagline: en ? (promo.taglineEn || promo.tagline) : promo.tagline,
    highlight: en ? (promo.highlightEn || promo.highlight) : promo.highlight,
    description: en ? (promo.descriptionEn || promo.description) : promo.description,
    perks: en ? (promo.perksEn.length > 0 ? promo.perksEn : promo.perks) : promo.perks,
    promoCode: promo.promoCode,
    referralUrl: promo.referralUrl,
    photoUrl: promo.photoUrl,
    featured: promo.featured,
    sortOrder: promo.sortOrder,
  };
}

/** Liste publique localisée (uniquement les promos activées). */
export async function listPublicPromotions(lang: Lang = 'fr'): Promise<LocalizedPromotion[]> {
  const all = await listPromotions();
  return all.filter((p) => p.enabled).map((p) => localize(p, lang));
}

export async function createPromotion(input: PromotionInput): Promise<Promotion> {
  const built = buildFromInput(input);
  if (!built.name) throw new Error('Le nom est requis');
  const promo = await withTranslations(built);
  await upsert(promo);
  return promo;
}

export async function updatePromotion(id: string, input: PromotionInput): Promise<Promotion> {
  const existing = await getPromotion(id);
  if (!existing) throw new Error('Promotion introuvable');
  const built = buildFromInput(input, existing);
  const promo = await withTranslations(built, existing);
  await upsert(promo);
  return promo;
}

export async function getPromotion(id: string): Promise<Promotion | null> {
  const db = getPool();
  if (!db) return memory.get(id) ?? null;
  await ensureTable();
  const result = await db.query('select * from promotions where id = $1 limit 1', [id]);
  return result.rows[0] ? rowToPromotion(result.rows[0]) : null;
}

export async function deletePromotion(id: string): Promise<void> {
  const db = getPool();
  if (!db) {
    memory.delete(id);
    return;
  }
  await ensureTable();
  await db.query('delete from promotions where id = $1', [id]);
}
