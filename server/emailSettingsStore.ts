/**
 * Store de configuration & de suivi des emails (panneau admin « Emails »).
 *
 * Deux responsabilités :
 *  1. Paramètres par type d'email (activé / bloqué / test) + redirection de test
 *     globale + surcharges de texte (sujet, libellés du template).
 *  2. Journal des emails envoyés (ring buffer des derniers envois) pour suivre
 *     ce qui part, vers qui, et avec quel statut.
 *
 * Persisté dans Postgres quand `DATABASE_URL` est configuré, sinon conservé en
 * RAM (mode dev). Mêmes conventions de pool que `promotionsStore.ts`.
 */
import { Pool } from 'pg';
import crypto from 'crypto';

const APP_NAME = process.env.APP_NAME || 'BTF Trade';

export const EMAIL_KINDS = [
  'otp',
  'new_arena',
  'prize_winner',
  'arena_start_soon',
  'arena_podium_lost',
  'arena_results',
] as const;

export type EmailKind = (typeof EMAIL_KINDS)[number];

export type EmailMode = 'on' | 'off' | 'test';

export type EmailStatus = 'sent' | 'test' | 'blocked' | 'failed' | 'no-smtp';

/** Définition d'un champ texte éditable depuis l'admin pour un type d'email. */
export interface EmailFieldDef {
  key: string;
  label: string;
  multiline?: boolean;
  default: string;
  /** Variables disponibles (ex. "{app}, {code}"). */
  vars?: string;
}

export interface EmailKindMeta {
  kind: EmailKind;
  label: string;
  description: string;
  /** Champs texte éditables (vide = seul le mode est réglable). */
  fields: EmailFieldDef[];
}

/** Catalogue des types d'emails + champs éditables. Source de vérité partagée. */
export const EMAIL_CATALOG: EmailKindMeta[] = [
  {
    kind: 'otp',
    label: 'Code de connexion / inscription',
    description: "Code à usage unique envoyé pour se connecter ou confirmer une inscription. ⚠️ Le bloquer empêche toute connexion.",
    fields: [
      { key: 'subjectSignup', label: 'Sujet — inscription', default: `Confirme ton inscription ${APP_NAME} ({code})`, vars: '{app}, {code}' },
      { key: 'subjectLogin', label: 'Sujet — connexion', default: `Ton code de connexion ${APP_NAME} ({code})`, vars: '{app}, {code}' },
      { key: 'headingSignup', label: 'Titre — inscription', default: `Bienvenue sur ${APP_NAME}`, vars: '{app}' },
      { key: 'headingLogin', label: 'Titre — connexion', default: 'Ton code de connexion', vars: '{app}' },
      { key: 'introSignup', label: 'Intro — inscription', multiline: true, default: 'Confirme ton adresse email en saisissant le code ci-dessous pour activer ton compte.', vars: '{app}' },
      { key: 'introLogin', label: 'Intro — connexion', multiline: true, default: 'Voici ton code de connexion à usage unique.', vars: '{app}' },
      { key: 'expiryNote', label: 'Note de bas de page', multiline: true, default: "Ce code expire dans 10 minutes. Si tu n'es pas à l'origine de cette demande, ignore cet email." },
    ],
  },
  {
    kind: 'new_arena',
    label: 'Nouvelle arène disponible',
    description: "Annonce d'une nouvelle arène ouverte aux inscriptions (envoi manuel depuis l'admin).",
    fields: [
      { key: 'subject', label: 'Sujet', default: 'Nouvelle arène : {title}', vars: '{title}' },
      { key: 'ctaLabel', label: "Texte du bouton", default: "Rejoindre l'arène ▸" },
    ],
  },
  {
    kind: 'prize_winner',
    label: 'Gagnant — réclamation du lot',
    description: 'Envoyé aux gagnants pour qu’ils communiquent leur adresse ERC20 et reçoivent leur lot.',
    fields: [
      { key: 'subject', label: 'Sujet', default: '🏆 Tu as gagné un lot — {title}', vars: '{title}, {rank}' },
      { key: 'eyebrow', label: 'Sur-titre', default: '🏆 Tu as gagné un lot' },
      { key: 'claimTitle', label: 'Titre — réception', default: 'Comment recevoir ton lot' },
      { key: 'claimText', label: 'Texte — réception', multiline: true, default: "Pour t'envoyer ta récompense, réponds à cet email avec ton adresse de réception ERC20 (réseau Ethereum, pour recevoir des USDT/USDC)." },
      { key: 'buttonLabel', label: 'Texte du bouton', default: 'Envoyer mon adresse ERC20 ▸' },
      { key: 'warning', label: 'Avertissement', multiline: true, default: 'Vérifie bien que ton adresse est sur le réseau Ethereum (ERC20). Une adresse erronée ou sur un autre réseau peut entraîner une perte définitive des fonds.' },
    ],
  },
  {
    kind: 'arena_start_soon',
    label: 'Arène — bientôt en live',
    description: "Notification automatique aux inscrits quand une arène va démarrer. Texte dynamique (non éditable).",
    fields: [],
  },
  {
    kind: 'arena_podium_lost',
    label: 'Arène — place de podium perdue',
    description: 'Notification automatique quand un participant se fait dépasser sur le podium. Texte dynamique (non éditable).',
    fields: [],
  },
  {
    kind: 'arena_results',
    label: 'Arène — résultats de fin',
    description: 'Notification automatique des résultats à la clôture d’une arène. Texte dynamique (non éditable).',
    fields: [],
  },
];

export interface EmailKindSetting {
  mode: EmailMode;
  /** Surcharges de texte par clé de champ (cf. EMAIL_CATALOG). */
  overrides: Record<string, string>;
}

export interface EmailSettings {
  /** Quand vrai, TOUS les emails (sauf bloqués) sont redirigés vers testRedirect. */
  globalTest: boolean;
  /** Adresse utilisée pour le mode test / la redirection globale. */
  testRedirect: string;
  kinds: Record<EmailKind, EmailKindSetting>;
  updatedAt: number;
}

export interface EmailLogEntry {
  id: string;
  at: number;
  kind: EmailKind;
  /** Destinataire réel d'origine (avant éventuelle redirection de test). */
  to: string;
  subject: string;
  status: EmailStatus;
  /** Adresse vers laquelle l'email a réellement été envoyé en mode test. */
  redirectedTo?: string;
  error?: string;
}

const LOG_LIMIT = 300;
const SETTINGS_ID = 'default';

function defaultSettings(): EmailSettings {
  const envRedirect = (process.env.MAIL_TEST_REDIRECT || '').trim();
  const kinds = {} as Record<EmailKind, EmailKindSetting>;
  for (const kind of EMAIL_KINDS) {
    // `new_arena` est une annonce de masse (tous les inscrits) → désactivée par
    // défaut pour éviter tout envoi accidentel ; à activer explicitement.
    kinds[kind] = { mode: kind === 'new_arena' ? 'off' : 'on', overrides: {} };
  }
  return {
    // Si une redirection de test était configurée via l'env, on démarre en mode
    // test global pour préserver le comportement précédent.
    globalTest: Boolean(envRedirect),
    testRedirect: envRedirect,
    kinds,
    updatedAt: Date.now(),
  };
}

function mergeSettings(raw: Partial<EmailSettings> | null | undefined): EmailSettings {
  const base = defaultSettings();
  if (!raw || typeof raw !== 'object') return base;
  const merged: EmailSettings = {
    globalTest: typeof raw.globalTest === 'boolean' ? raw.globalTest : base.globalTest,
    testRedirect: typeof raw.testRedirect === 'string' ? raw.testRedirect.trim() : base.testRedirect,
    kinds: { ...base.kinds },
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now(),
  };
  const rawKinds = (raw.kinds || {}) as Record<string, Partial<EmailKindSetting>>;
  for (const kind of EMAIL_KINDS) {
    const rk = rawKinds[kind];
    if (!rk) continue;
    const mode: EmailMode = rk.mode === 'off' || rk.mode === 'test' ? rk.mode : 'on';
    const overrides: Record<string, string> = {};
    if (rk.overrides && typeof rk.overrides === 'object') {
      for (const [k, v] of Object.entries(rk.overrides)) {
        if (typeof v === 'string') overrides[k] = v;
      }
    }
    merged.kinds[kind] = { mode, overrides };
  }
  return merged;
}

let pool: Pool | null = null;
let ready: Promise<void> | null = null;
/** Fallback RAM (dev sans Postgres). */
let memorySettings: EmailSettings | null = null;
const memoryLog: EmailLogEntry[] = [];

/** Cache court des paramètres pour éviter un hit DB à chaque envoi (chemin chaud OTP). */
let settingsCache: { value: EmailSettings; at: number } | null = null;
const SETTINGS_TTL_MS = 10_000;

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
    console.error('[email-settings pool] idle client error:', err.message || err);
  });
  return pool;
}

async function ensureTables(): Promise<void> {
  const db = getPool();
  if (!db) return;
  if (!ready) {
    ready = (async () => {
      await db.query(`
        create table if not exists email_settings (
          id text primary key,
          data jsonb not null default '{}'::jsonb,
          updated_at bigint not null
        )
      `);
      await db.query(`
        create table if not exists email_log (
          id text primary key,
          at bigint not null,
          kind text not null,
          recipient text not null default '',
          subject text not null default '',
          status text not null default 'sent',
          redirected_to text,
          error text
        )
      `);
      await db.query('create index if not exists email_log_at_idx on email_log (at desc)');
    })();
  }
  await ready;
}

export async function getEmailSettings(): Promise<EmailSettings> {
  const db = getPool();
  if (!db) {
    if (!memorySettings) memorySettings = defaultSettings();
    return memorySettings;
  }
  await ensureTables();
  const result = await db.query('select data from email_settings where id = $1 limit 1', [SETTINGS_ID]);
  if (!result.rows[0]) return mergeSettings(null);
  return mergeSettings(result.rows[0].data as Partial<EmailSettings>);
}

/** Version mise en cache (TTL court) pour le chemin d'envoi. */
export async function getEmailSettingsCached(): Promise<EmailSettings> {
  if (settingsCache && Date.now() - settingsCache.at < SETTINGS_TTL_MS) {
    return settingsCache.value;
  }
  const value = await getEmailSettings();
  settingsCache = { value, at: Date.now() };
  return value;
}

export interface EmailSettingsPatch {
  globalTest?: boolean;
  testRedirect?: string;
  kinds?: Partial<Record<EmailKind, Partial<EmailKindSetting>>>;
}

export async function updateEmailSettings(patch: EmailSettingsPatch): Promise<EmailSettings> {
  const current = await getEmailSettings();
  const next: EmailSettings = {
    globalTest: typeof patch.globalTest === 'boolean' ? patch.globalTest : current.globalTest,
    testRedirect: typeof patch.testRedirect === 'string' ? patch.testRedirect.trim() : current.testRedirect,
    kinds: { ...current.kinds },
    updatedAt: Date.now(),
  };
  if (patch.kinds) {
    for (const kind of EMAIL_KINDS) {
      const pk = patch.kinds[kind];
      if (!pk) continue;
      const prev = current.kinds[kind];
      const mode: EmailMode = pk.mode === 'on' || pk.mode === 'off' || pk.mode === 'test' ? pk.mode : prev.mode;
      let overrides = prev.overrides;
      if (pk.overrides && typeof pk.overrides === 'object') {
        overrides = {};
        for (const [k, v] of Object.entries(pk.overrides)) {
          // Une chaîne vide = revenir au défaut → on ne stocke pas.
          if (typeof v === 'string' && v.trim().length > 0) overrides[k] = v;
        }
      }
      next.kinds[kind] = { mode, overrides };
    }
  }

  const db = getPool();
  if (!db) {
    memorySettings = next;
  } else {
    await ensureTables();
    await db.query(
      `insert into email_settings (id, data, updated_at) values ($1, $2::jsonb, $3)
       on conflict (id) do update set data = excluded.data, updated_at = excluded.updated_at`,
      [SETTINGS_ID, JSON.stringify(next), next.updatedAt],
    );
  }
  settingsCache = { value: next, at: Date.now() };
  return next;
}

/** Enregistre un envoi dans le journal (best-effort, ne throw jamais). */
export async function logEmail(entry: Omit<EmailLogEntry, 'id' | 'at'> & { at?: number }): Promise<void> {
  const full: EmailLogEntry = {
    id: crypto.randomUUID(),
    at: entry.at ?? Date.now(),
    kind: entry.kind,
    to: entry.to,
    subject: entry.subject,
    status: entry.status,
    redirectedTo: entry.redirectedTo,
    error: entry.error,
  };
  try {
    const db = getPool();
    if (!db) {
      memoryLog.unshift(full);
      if (memoryLog.length > LOG_LIMIT) memoryLog.length = LOG_LIMIT;
      return;
    }
    await ensureTables();
    await db.query(
      `insert into email_log (id, at, kind, recipient, subject, status, redirected_to, error)
       values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [full.id, full.at, full.kind, full.to, full.subject, full.status, full.redirectedTo ?? null, full.error ?? null],
    );
    // Élagage : ne conserver que les LOG_LIMIT entrées les plus récentes.
    await db.query(
      `delete from email_log where id in (
         select id from email_log order by at desc offset $1
       )`,
      [LOG_LIMIT],
    );
  } catch (err) {
    console.warn('[email-log] enregistrement impossible:', (err as Error)?.message || err);
  }
}

export async function listEmailLog(limit = 100): Promise<EmailLogEntry[]> {
  const capped = Math.max(1, Math.min(limit, LOG_LIMIT));
  const db = getPool();
  if (!db) return memoryLog.slice(0, capped);
  await ensureTables();
  const result = await db.query(
    'select id, at, kind, recipient, subject, status, redirected_to, error from email_log order by at desc limit $1',
    [capped],
  );
  return result.rows.map((row: any) => ({
    id: String(row.id),
    at: Number(row.at),
    kind: row.kind as EmailKind,
    to: String(row.recipient ?? ''),
    subject: String(row.subject ?? ''),
    status: row.status as EmailStatus,
    redirectedTo: row.redirected_to ? String(row.redirected_to) : undefined,
    error: row.error ? String(row.error) : undefined,
  }));
}

/** Résout un texte éditable : surcharge admin sinon défaut du catalogue, avec substitution de {variables}. */
export function resolveEmailText(
  settings: EmailSettings | undefined,
  kind: EmailKind,
  key: string,
  vars: Record<string, string | number> = {},
): string {
  const meta = EMAIL_CATALOG.find((m) => m.kind === kind);
  const field = meta?.fields.find((f) => f.key === key);
  const override = settings?.kinds[kind]?.overrides?.[key];
  let value = (override && override.trim().length > 0 ? override : field?.default) ?? '';
  for (const [k, v] of Object.entries({ app: APP_NAME, ...vars })) {
    value = value.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
  }
  return value;
}
