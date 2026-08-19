import crypto from 'node:crypto';
import http2 from 'node:http2';
import { GoogleAuth } from 'google-auth-library';
import { Pool } from 'pg';
import type { CompetitionManager } from './competitionManager.js';
import { isPodiumLoss } from './notificationRules.js';

export type PushKind =
  | 'order_filled'
  | 'stop_loss'
  | 'take_profit'
  | 'drawdown_warning'
  | 'rank_change'
  | 'podium_lost'
  | 'new_arena'
  | 'arena_open'
  | 'chat_reply'
  | 'news'
  | 'payout';
export type PushEnvironment = 'sandbox' | 'production' | 'auto';
export type PushPlatform = 'ios' | 'android';

export interface PushMessage {
  title: string;
  body: string;
  kind: PushKind;
  competitionId?: string;
  data?: Record<string, string | number | boolean | null | undefined>;
}

interface PushDevice {
  token: string;
  platform: PushPlatform;
  environment: PushEnvironment;
}

let pool: Pool | null = null;
let ready: Promise<void> | null = null;
let jwtCache: { value: string; createdAt: number } | null = null;
let googleAuth: GoogleAuth | null = null;
const memoryDevices = new Map<string, { userId: string; platform: PushPlatform; environment: PushEnvironment }>();

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
  pool.on('error', (error) => console.error('[push pool] idle client error:', error.message || error));
  return pool;
}

async function ensureTable(): Promise<void> {
  const db = getPool();
  if (!db) return;
  if (!ready) {
    ready = db.query(`
      create table if not exists comp_push_devices (
        device_token text primary key,
        user_id text not null,
        platform text not null default 'ios',
        environment text not null default 'production',
        created_at bigint not null,
        updated_at bigint not null
      )
    `).then(async () => {
      await db.query('create index if not exists idx_comp_push_devices_user on comp_push_devices(user_id)');
    });
  }
  await ready;
}

function normalizeEnvironment(value: unknown): PushEnvironment {
  if (value === 'sandbox' || value === 'production') return value;
  return 'auto';
}

function normalizePlatform(value: unknown): PushPlatform {
  return value === 'android' ? 'android' : 'ios';
}

export async function registerPushDevice(
  userId: string,
  token: string,
  platform: unknown,
  environment: unknown,
): Promise<void> {
  const normalizedToken = String(token || '').trim();
  if (!normalizedToken || normalizedToken.length > 512) throw new Error('Token push invalide');
  const normalizedPlatform = normalizePlatform(platform);
  const normalizedEnvironment = normalizeEnvironment(environment);
  const db = getPool();
  if (!db) {
    memoryDevices.set(normalizedToken, { userId, platform: normalizedPlatform, environment: normalizedEnvironment });
    return;
  }
  await ensureTable();
  const now = Date.now();
  await db.query(`
    insert into comp_push_devices (device_token, user_id, platform, environment, created_at, updated_at)
    values ($1, $2, $3, $4, $5, $5)
    on conflict (device_token) do update set
      user_id = excluded.user_id,
      platform = excluded.platform,
      environment = excluded.environment,
      updated_at = excluded.updated_at
  `, [normalizedToken, userId, normalizedPlatform, normalizedEnvironment, now]);
}

export async function unregisterAllPushDevices(userId: string): Promise<void> {
  if (!userId) return;
  const db = getPool();
  if (!db) {
    for (const [token, device] of memoryDevices.entries()) {
      if (device.userId === userId) memoryDevices.delete(token);
    }
    return;
  }
  await ensureTable();
  await db.query('delete from comp_push_devices where user_id = $1', [userId]);
}

export async function unregisterPushDevice(userId: string, token: string): Promise<void> {
  const normalizedToken = String(token || '').trim();
  if (!normalizedToken) return;
  const db = getPool();
  if (!db) {
    const current = memoryDevices.get(normalizedToken);
    if (current?.userId === userId) memoryDevices.delete(normalizedToken);
    return;
  }
  await ensureTable();
  await db.query('delete from comp_push_devices where device_token = $1 and user_id = $2', [normalizedToken, userId]);
}

async function devicesForUser(userId: string): Promise<PushDevice[]> {
  const db = getPool();
  if (!db) {
    return Array.from(memoryDevices.entries())
      .filter(([, device]) => device.userId === userId)
      .map(([token, device]) => ({ token, platform: device.platform, environment: device.environment }));
  }
  await ensureTable();
  const result = await db.query<{ device_token: string; platform: string; environment: string }>(
    'select device_token, platform, environment from comp_push_devices where user_id = $1',
    [userId],
  );
  return result.rows.map((row) => ({
    token: row.device_token,
    platform: normalizePlatform(row.platform),
    environment: normalizeEnvironment(row.environment),
  }));
}

async function allDevices(): Promise<PushDevice[]> {
  const db = getPool();
  if (!db) {
    return Array.from(memoryDevices.entries()).map(([token, device]) => ({
      token,
      platform: device.platform,
      environment: device.environment,
    }));
  }
  await ensureTable();
  const result = await db.query<{ device_token: string; platform: string; environment: string }>(
    'select device_token, platform, environment from comp_push_devices',
  );
  return result.rows.map((row) => ({
    token: row.device_token,
    platform: normalizePlatform(row.platform),
    environment: normalizeEnvironment(row.environment),
  }));
}

function base64Url(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url');
}

function stripWrappingQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

/** Railway aplatit souvent le .p8 : on reconstruit un PEM PKCS#8 lisible par OpenSSL. */
export function normalizeApnsPrivateKey(raw: string): string {
  let value = stripWrappingQuotes(raw).replace(/\r\n/g, '\n').replace(/\\n/g, '\n');
  const header = value.match(/-----BEGIN ([A-Z ]*PRIVATE KEY)-----/);
  if (header) {
    const label = header[1];
    const body = value
      .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----/, '')
      .replace(/-----END [A-Z ]*PRIVATE KEY-----/, '')
      .replace(/\s+/g, '');
    const lines = body.match(/.{1,64}/g) || [];
    return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----`;
  }

  const compact = value.replace(/\s+/g, '');
  const decodedUtf8 = Buffer.from(compact, 'base64').toString('utf8');
  if (decodedUtf8.includes('BEGIN') && decodedUtf8.includes('PRIVATE KEY')) {
    return normalizeApnsPrivateKey(decodedUtf8);
  }

  const lines = compact.match(/.{1,64}/g) || [];
  return `-----BEGIN PRIVATE KEY-----\n${lines.join('\n')}\n-----END PRIVATE KEY-----`;
}

let apnsConfigLogged = false;

function logApnsConfigOnce(): void {
  if (apnsConfigLogged) return;
  apnsConfigLogged = true;
  const teamId = process.env.APNS_TEAM_ID?.trim();
  const keyId = process.env.APNS_KEY_ID?.trim();
  const raw = process.env.APNS_PRIVATE_KEY?.trim();
  const bundleId = process.env.APNS_BUNDLE_ID?.trim() || 'com.btfarena.app';
  if (!teamId || !keyId || !raw) {
    console.warn('[push] APNs incomplet: TEAM_ID / KEY_ID / PRIVATE_KEY manquant');
    return;
  }
  try {
    crypto.createPrivateKey(normalizeApnsPrivateKey(raw));
    console.log(`[push] APNs prêt · team=${teamId} key=${keyId} bundle=${bundleId} keyChars=${raw.length}`);
  } catch {
    console.error('[push] APNs: APNS_PRIVATE_KEY illisible (PEM cassé). Colle le .p8 entier, ou une ligne avec \\n à la place des retours.');
  }
}

function apnsJwt(): string | null {
  const teamId = process.env.APNS_TEAM_ID?.trim();
  const keyId = process.env.APNS_KEY_ID?.trim();
  const privateKeyRaw = process.env.APNS_PRIVATE_KEY?.trim();
  if (!teamId || !keyId || !privateKeyRaw) return null;
  const now = Date.now();
  if (jwtCache && now - jwtCache.createdAt < 50 * 60_000) return jwtCache.value;
  const privateKey = normalizeApnsPrivateKey(privateKeyRaw);
  try {
    crypto.createPrivateKey(privateKey);
  } catch {
    throw new Error('APNs key unreadable: APNS_PRIVATE_KEY n’est pas un PEM PKCS#8 valide');
  }
  const issuedAt = Math.floor(now / 1000);
  const encodedHeader = base64Url(JSON.stringify({ alg: 'ES256', kid: keyId }));
  const encodedPayload = base64Url(JSON.stringify({ iss: teamId, iat: issuedAt }));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto.sign('sha256', Buffer.from(signingInput), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  });
  const value = `${signingInput}.${base64Url(signature)}`;
  jwtCache = { value, createdAt: now };
  return value;
}

function deleteDevice(token: string): void {
  memoryDevices.delete(token);
  const db = getPool();
  if (db) void ensureTable().then(() => db.query('delete from comp_push_devices where device_token = $1', [token])).catch(() => undefined);
}

async function sendApnsToEnvironment(device: PushDevice, message: PushMessage, environment: Exclude<PushEnvironment, 'auto'>): Promise<void> {
  const jwt = apnsJwt();
  const bundleId = process.env.APNS_BUNDLE_ID?.trim() || 'com.btfarena.app';
  if (!jwt) return;
  const origin = environment === 'sandbox'
    ? 'https://api.sandbox.push.apple.com'
    : 'https://api.push.apple.com';
  const client = http2.connect(origin);
  client.on('error', () => undefined);
  const payload = JSON.stringify({
    aps: {
      alert: { title: message.title, body: message.body },
      sound: 'default',
      'thread-id': message.competitionId || message.kind,
      category: message.kind.toUpperCase(),
    },
    kind: message.kind,
    ...(message.competitionId ? { competitionId: message.competitionId } : {}),
    ...Object.fromEntries(Object.entries(message.data || {}).filter(([, value]) => value != null)),
  });
  await new Promise<void>((resolve, reject) => {
    const request = client.request({
      ':method': 'POST',
      ':path': `/3/device/${device.token}`,
      authorization: `bearer ${jwt}`,
      'apns-topic': bundleId,
      'apns-push-type': 'alert',
      'apns-priority': '10',
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(payload),
    });
    let status = 0;
    let body = '';
    request.setEncoding('utf8');
    request.on('response', (headers) => { status = Number(headers[':status'] || 0); });
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      client.close();
      if (status >= 200 && status < 300) {
        resolve();
        return;
      }
      if (status === 410 || body.includes('Unregistered')) deleteDevice(device.token);
      reject(new Error(`APNs ${status} ${environment}: ${body || 'envoi refusé'}`));
    });
    request.on('error', (error) => {
      client.close();
      reject(error);
    });
    request.setTimeout(10_000, () => {
      request.close(http2.constants.NGHTTP2_CANCEL);
      client.close();
      reject(new Error('APNs timeout'));
    });
    request.end(payload);
  });
}

async function sendApns(device: PushDevice, message: PushMessage): Promise<void> {
  if (device.environment !== 'auto') {
    await sendApnsToEnvironment(device, message, device.environment);
    return;
  }
  const attempts = await Promise.allSettled([
    sendApnsToEnvironment(device, message, 'production'),
    sendApnsToEnvironment(device, message, 'sandbox'),
  ]);
  if (attempts.some((attempt) => attempt.status === 'fulfilled')) return;
  const reason = attempts.find((attempt): attempt is PromiseRejectedResult => attempt.status === 'rejected')?.reason;
  throw reason instanceof Error ? reason : new Error('APNs a refusé le token');
}

function firebaseServiceAccount(): Record<string, string> | null {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT?.trim();
  if (!raw) return null;
  try {
    const json = raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
    return JSON.parse(json) as Record<string, string>;
  } catch {
    console.error('[push] FIREBASE_SERVICE_ACCOUNT invalide');
    return null;
  }
}

function isFirebaseConfigured(): boolean {
  return Boolean(process.env.FIREBASE_SERVICE_ACCOUNT?.trim());
}

async function sendFcm(device: PushDevice, message: PushMessage): Promise<void> {
  const serviceAccount = firebaseServiceAccount();
  if (!serviceAccount) throw new Error('Firebase non configuré');
  const projectId = serviceAccount.project_id;
  if (!projectId || !serviceAccount.client_email || !serviceAccount.private_key) {
    throw new Error('Compte de service Firebase incomplet');
  }
  if (!googleAuth) {
    googleAuth = new GoogleAuth({
      credentials: {
        client_email: serviceAccount.client_email,
        private_key: serviceAccount.private_key.replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/firebase.messaging'],
    });
  }
  const client = await googleAuth.getClient();
  const accessToken = await client.getAccessToken();
  const data = Object.fromEntries(
    Object.entries({
      kind: message.kind,
      competitionId: message.competitionId,
      ...(message.data || {}),
    }).filter(([, value]) => value != null).map(([key, value]) => [key, String(value)]),
  );
  const response = await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: {
        token: device.token,
        notification: { title: message.title, body: message.body },
        data,
        android: {
          priority: 'high',
          notification: {
            channel_id: 'btf_trading',
            sound: 'default',
            click_action: 'FCM_PLUGIN_ACTIVITY',
          },
        },
      },
    }),
  });
  if (response.ok) return;
  const body = await response.text();
  if (body.includes('UNREGISTERED')) {
    deleteDevice(device.token);
  }
  throw new Error(`FCM ${response.status}: ${body || 'envoi refusé'}`);
}

export function isPushConfigured(): boolean {
  logApnsConfigOnce();
  return Boolean(
    (process.env.APNS_TEAM_ID && process.env.APNS_KEY_ID && process.env.APNS_PRIVATE_KEY)
    || isFirebaseConfigured(),
  );
}

export async function describePushForUser(userId: string): Promise<{
  configured: boolean;
  devices: number;
}> {
  return {
    configured: isPushConfigured(),
    devices: (await devicesForUser(userId)).length,
  };
}

function isSimulatedBot(userId: string): boolean {
  return userId.startsWith('sim-bot-');
}

export async function sendPushToUser(userId: string, message: PushMessage): Promise<number> {
  if (isSimulatedBot(userId)) return 0;
  if (!isPushConfigured()) {
    console.warn('[push] skip: APNs/FCM non configuré');
    return 0;
  }
  const devices = await devicesForUser(userId);
  if (devices.length === 0) {
    console.warn(`[push] skip: aucun device pour ${userId} (${message.kind})`);
    return 0;
  }
  const apnsConfigured = Boolean(process.env.APNS_TEAM_ID && process.env.APNS_KEY_ID && process.env.APNS_PRIVATE_KEY);
  const eligible = devices.filter((device) => device.platform === 'android' ? isFirebaseConfigured() : apnsConfigured);
  const results = await Promise.allSettled(eligible.map((device) => (
    device.platform === 'android' ? sendFcm(device, message) : sendApns(device, message)
  )));
  let sent = 0;
  for (const result of results) {
    if (result.status === 'fulfilled') sent += 1;
    else console.warn('[push] send failed:', result.reason?.message || result.reason);
  }
  if (sent > 0) {
    console.log(`[push] sent ${sent}/${eligible.length} · user=${userId} kind=${message.kind}`);
  }
  return sent;
}

export async function sendPushToUsers(userIds: string[], message: PushMessage): Promise<number> {
  const unique = Array.from(new Set(userIds.filter(Boolean)));
  const sent = await Promise.all(unique.map((userId) => sendPushToUser(userId, message)));
  return sent.reduce((sum, count) => sum + count, 0);
}

export async function sendPushToAllDevices(message: PushMessage): Promise<number> {
  if (!isPushConfigured()) return 0;
  const devices = await allDevices();
  const apnsConfigured = Boolean(process.env.APNS_TEAM_ID && process.env.APNS_KEY_ID && process.env.APNS_PRIVATE_KEY);
  const eligible = devices.filter((device) => device.platform === 'android' ? isFirebaseConfigured() : apnsConfigured);
  let sent = 0;
  for (let offset = 0; offset < eligible.length; offset += 100) {
    const batch = eligible.slice(offset, offset + 100);
    const results = await Promise.allSettled(batch.map((device) => (
      device.platform === 'android' ? sendFcm(device, message) : sendApns(device, message)
    )));
    for (const result of results) {
      if (result.status === 'fulfilled') sent += 1;
      else console.warn('[push] news send failed:', result.reason?.message || result.reason);
    }
  }
  return sent;
}

export class CompetitionPushNotifier {
  private statuses = new Map<string, string>();
  private ranks = new Map<string, Map<string, number>>();
  private lastRankPush = new Map<string, number>();
  private lastPodiumPush = new Map<string, number>();
  private initialized = false;
  private running = false;

  constructor(private readonly competitionManager: CompetitionManager) {}

  async tick(now = Date.now()): Promise<void> {
    if (!isPushConfigured() || this.running) return;
    this.running = true;
    try {
      const competitions = this.competitionManager.listCompetitionsForNotifier();
      for (const competition of competitions) {
        const previousStatus = this.statuses.get(competition.id);
        this.statuses.set(competition.id, competition.status);
        const entries = this.competitionManager.getRankedEntriesForNotifier(competition.id);

        if (!competition.notifiedNewArenaPushAt && competition.isPublic) {
          // Au premier tick on photographie l'existant sans rejouer tout
          // l'historique. Toute arène publique créée ensuite est annoncée.
          this.competitionManager.markCompetitionNotified(competition.id, 'newArenaPush');
          if (this.initialized && competition.status !== 'ended') {
            await sendPushToAllDevices({
              title: 'Nouvelle arène disponible',
              body: `${competition.title} est ouverte aux inscriptions.`,
              kind: 'new_arena',
              competitionId: competition.id,
            });
          }
        }

        if (this.initialized && previousStatus && previousStatus !== 'live' && competition.status === 'live') {
          await sendPushToUsers(entries.map((entry) => entry.userId), {
            title: 'L’arène est ouverte',
            body: `${competition.title} vient de démarrer. Ton terminal est prêt.`,
            kind: 'arena_open',
            competitionId: competition.id,
          });
        }

        if (competition.status !== 'live') {
          this.ranks.delete(competition.id);
          continue;
        }
        const activeEntries = entries.filter((entry) => entry.tradesCount > 0 && !entry.breached);
        const previousRanks = this.ranks.get(competition.id);
        const nextRanks = new Map(activeEntries.map((entry) => [entry.userId, entry.rank]));
        this.ranks.set(competition.id, nextRanks);
        if (!previousRanks) continue;

        for (const entry of activeEntries) {
          if (isSimulatedBot(entry.userId) || entry.rank <= 0) continue;
          const previousRank = previousRanks.get(entry.userId);
          if (!previousRank || previousRank === entry.rank) continue;
          const cooldownKey = `${competition.id}:${entry.userId}`;
          if (isPodiumLoss(previousRank, entry.rank)) {
            if (now - (this.lastPodiumPush.get(cooldownKey) || 0) < 30 * 60_000) continue;
            this.lastPodiumPush.set(cooldownKey, now);
            await sendPushToUser(entry.userId, {
              title: 'Tu viens de perdre ta place sur le podium',
              body: `Tu es maintenant #${entry.rank} dans ${competition.title}. Reprends ta place !`,
              kind: 'podium_lost',
              competitionId: competition.id,
              data: { rank: entry.rank, previousRank },
            });
            continue;
          }
          if (now - (this.lastRankPush.get(cooldownKey) || 0) < 3 * 60_000) continue;
          this.lastRankPush.set(cooldownKey, now);
          await sendPushToUser(entry.userId, {
            title: `Tu es maintenant #${entry.rank}`,
            body: `${previousRank > entry.rank ? 'Tu progresses' : 'Ton rang évolue'} dans ${competition.title}.`,
            kind: 'rank_change',
            competitionId: competition.id,
            data: { rank: entry.rank, previousRank },
          });
        }
      }
      this.initialized = true;
    } finally {
      this.running = false;
    }
  }
}
