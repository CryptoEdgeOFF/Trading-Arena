import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';

export interface CompetitionUser {
  id: string;
  email: string;
  name: string;
  phone?: string | null;
  phoneVerifiedAt?: number | null;
  avatarUrl?: string | null;
  socials?: {
    x?: string;
    instagram?: string;
    discord?: string;
    website?: string;
  };
  createdAt: number;
}

export interface CompetitionEntry {
  userId: string;
  joinedAt: number;
  pnlUsd: number;
  pnlPercent: number;
  tradesCount: number;
  updatedAt: number;
  paperPlayerId?: string;
}

export interface CashPrizeBreakdownEntry {
  rank: number;
  amount: number;
}

export interface CashPrize {
  currency: string;
  total: number;
  breakdown?: CashPrizeBreakdownEntry[];
}

export interface Competition {
  id: string;
  title: string;
  code: string;
  executionMode: 'paper' | 'real';
  startAt: number;
  endAt: number;
  isPublic: boolean;
  createdAt: number;
  entries: CompetitionEntry[];
  cashPrize?: CashPrize | null;
  finalizedAt?: number | null;
}

export type CompetitionStatus = 'upcoming' | 'live' | 'ended';

interface CompetitionStore {
  users: CompetitionUser[];
  competitions: Competition[];
  // Legacy fields kept for backwards-compatibility while migrating to dedicated
  // tables. Not written anymore.
  sessions?: Array<{ token: string; userId: string }>;
  pendingOtps?: PendingOtp[];
  traderSessions?: Array<{ token: string; playerId: string; competitionId?: string | null }>;
}

const STORE_FILE = path.join(process.cwd(), 'data', 'competition-platform.json');
const STORE_DB_KEY = 'competition-platform';

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeCode(value: string): string {
  return value.trim().toUpperCase();
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/**
 * Normalise un numero E.164. Accepte +33612345678, +33 6 12 34 56 78,
 * 0612345678 (defaut FR si commence par 0), etc.
 */
function normalizePhone(value: string): string {
  const raw = String(value || '').replace(/[^\d+]/g, '');
  if (!raw) return '';
  if (raw.startsWith('+')) return raw;
  if (raw.startsWith('00')) return '+' + raw.slice(2);
  if (raw.startsWith('0')) return '+33' + raw.slice(1);
  return '+' + raw;
}

function isValidPhone(value: string): boolean {
  return /^\+[1-9]\d{6,14}$/.test(value);
}

function maskPhone(value: string): string {
  if (!value) return '';
  const visible = 2;
  const tail = value.slice(-visible);
  return value.slice(0, 4) + '****' + tail;
}

function normalizeSocialUrl(value: unknown): string | undefined {
  const raw = String(value || '').trim();
  if (!raw) return undefined;
  if (raw.length > 180) return raw.slice(0, 180);
  return raw;
}

function inferCompetitionStatus(startAt: number, endAt: number, now = Date.now()): CompetitionStatus {
  if (now < startAt) return 'upcoming';
  if (now > endAt) return 'ended';
  return 'live';
}

function normalizeCashPrize(input: unknown): CashPrize | null {
  if (input === null || input === undefined) return null;
  if (typeof input !== 'object') return null;
  const data = input as { currency?: unknown; total?: unknown; breakdown?: unknown };
  const total = Number(data.total);
  if (!Number.isFinite(total) || total < 0) return null;
  const currency = String(data.currency || 'USD').trim().toUpperCase().slice(0, 6) || 'USD';

  let breakdown: CashPrizeBreakdownEntry[] | undefined;
  if (Array.isArray(data.breakdown)) {
    breakdown = data.breakdown
      .map((row: unknown) => {
        if (!row || typeof row !== 'object') return null;
        const r = row as { rank?: unknown; amount?: unknown };
        const rank = Math.max(1, Math.floor(Number(r.rank) || 0));
        const amount = Number(r.amount);
        if (!rank || !Number.isFinite(amount) || amount < 0) return null;
        return { rank, amount };
      })
      .filter((row): row is CashPrizeBreakdownEntry => row !== null)
      .sort((a, b) => a.rank - b.rank);
    if (breakdown.length === 0) breakdown = undefined;
  }

  if (total === 0 && (!breakdown || breakdown.length === 0)) return null;

  return { currency, total, breakdown };
}

interface PendingOtp {
  email: string;
  name?: string;
  phone?: string;
  intent: 'signup' | 'login';
  code: string;
  expiresAt: number;
  attempts: number;
  // Etape franchie : 'email' = email pas encore verifie, 'phone' = email ok, en attente du SMS
  step: 'email' | 'phone';
}

const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;

function generateOtp(): string {
  return String(Math.floor(100_000 + Math.random() * 900_000));
}

export class CompetitionManager {
  private users = new Map<string, CompetitionUser>();
  private competitions = new Map<string, Competition>();
  // In serverless, sessions/OTPs/trader-sessions use dedicated Postgres
  // tables (one row per token/email). The maps below are only used as a
  // local fallback when no Postgres pool is configured (development mode).
  private sessions = new Map<string, string>();
  private pendingOtps = new Map<string, PendingOtp>();
  private traderSessions = new Map<string, { playerId: string; competitionId: string | null }>();
  private localAdminTokens = new Set<string>();
  private pool: Pool | null = null;
  readonly ready: Promise<void>;

  constructor() {
    const databaseUrl = process.env.DATABASE_URL?.trim();
    if (databaseUrl) {
      this.pool = new Pool({
        connectionString: databaseUrl,
        ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
      });
    }
    this.ready = this.load();
  }

  private findUserByEmail(email: string): CompetitionUser | null {
    const normalized = normalizeEmail(email);
    return Array.from(this.users.values()).find((entry) => entry.email === normalized) || null;
  }

  private findUserByPhone(phone: string): CompetitionUser | null {
    const normalized = normalizePhone(phone);
    if (!normalized) return null;
    return Array.from(this.users.values()).find((entry) => entry.phone === normalized) || null;
  }

  private async findPendingByPhone(phone: string, exceptEmail?: string): Promise<PendingOtp | null> {
    const normalized = normalizePhone(phone);
    if (!normalized) return null;
    const normalizedEmail = exceptEmail ? normalizeEmail(exceptEmail) : '';
    if (this.pool) {
      const result = await this.pool.query(
        `select email, data from comp_pending_otps
         where data->>'phone' = $1 and expires_at > now()`,
        [normalized],
      );
      for (const row of result.rows) {
        if (row.email !== normalizedEmail) return row.data as PendingOtp;
      }
      return null;
    }
    return Array.from(this.pendingOtps.values()).find((entry) => (
      entry.phone === normalized && entry.email !== normalizedEmail
    )) || null;
  }

  private async readPendingOtp(email: string): Promise<PendingOtp | null> {
    const normalized = normalizeEmail(email);
    if (this.pool) {
      const result = await this.pool.query(
        `select data from comp_pending_otps where email = $1 and expires_at > now()`,
        [normalized],
      );
      if (!result.rows[0]?.data) return null;
      return result.rows[0].data as PendingOtp;
    }
    return this.pendingOtps.get(normalized) || null;
  }

  private async writePendingOtp(otp: PendingOtp): Promise<void> {
    if (this.pool) {
      await this.pool.query(
        `insert into comp_pending_otps (email, data, expires_at, updated_at)
         values ($1, $2::jsonb, to_timestamp($3 / 1000.0), now())
         on conflict (email) do update set data = excluded.data, expires_at = excluded.expires_at, updated_at = now()`,
        [otp.email, JSON.stringify(otp), otp.expiresAt],
      );
      return;
    }
    this.pendingOtps.set(otp.email, otp);
  }

  private async deletePendingOtp(email: string): Promise<void> {
    const normalized = normalizeEmail(email);
    if (this.pool) {
      await this.pool.query('delete from comp_pending_otps where email = $1', [normalized]);
      return;
    }
    this.pendingOtps.delete(normalized);
  }

  emailExists(email: string): boolean {
    return this.findUserByEmail(email) != null;
  }

  /**
   * Etape 1 : Cree une demande OTP email. Pour 'signup' on exige
   * email + pseudo + telephone (anti-multi-comptes). Le numero est valide
   * et son unicite verifiee tout de suite, mais le SMS n'est envoye qu'apres
   * la validation du code email (etape 2).
   */
  async requestOtp(input: { email: string; name?: string; phone?: string; intent: 'signup' | 'login' }): Promise<{ code: string; expiresAt: number }> {
    const email = normalizeEmail(input.email);
    if (!isValidEmail(email)) {
      throw new Error('Email invalide');
    }

    const exists = this.emailExists(email);
    if (input.intent === 'signup' && exists) {
      throw new Error('Cet email a deja un compte. Utilise la connexion.');
    }
    if (input.intent === 'login' && !exists) {
      throw new Error('Aucun compte trouve. Inscris-toi d abord.');
    }

    const name = String(input.name || '').trim();
    let phone: string | undefined;
    if (input.intent === 'signup') {
      if (!name) {
        throw new Error('Pseudo requis pour l inscription');
      }
      phone = normalizePhone(String(input.phone || ''));
      if (!isValidPhone(phone)) {
        throw new Error('Numero de telephone invalide (format international ex: +33612345678)');
      }
      const phoneOwner = this.findUserByPhone(phone);
      if (phoneOwner) {
        throw new Error('Ce numero est deja associe a un compte');
      }
      const pendingPhoneOwner = await this.findPendingByPhone(phone, email);
      if (pendingPhoneOwner) {
        throw new Error('Ce numero est deja en cours de verification');
      }
    }

    const code = generateOtp();
    const expiresAt = Date.now() + OTP_TTL_MS;
    await this.writePendingOtp({
      email,
      name: name || undefined,
      phone,
      intent: input.intent,
      code,
      expiresAt,
      attempts: 0,
      step: 'email',
    });

    return { code, expiresAt };
  }

  /**
   * Etape 2 (login) : valide directement et cree la session.
   * Etape 2 (signup) : valide le code email puis bascule en attente du SMS.
   * Retourne soit { token, user } soit { needsPhone: true, phoneMasked }.
   */
  async verifyOtp(input: { email: string; code: string }): Promise<
    | { token: string; user: CompetitionUser }
    | { needsPhone: true; phoneMasked: string }
  > {
    const email = normalizeEmail(input.email);
    const code = String(input.code || '').trim();
    if (!email || !code) {
      throw new Error('Email et code requis');
    }

    const pending = await this.readPendingOtp(email);
    if (!pending) {
      throw new Error('Aucune demande de code en cours pour cet email');
    }
    if (pending.step !== 'email') {
      throw new Error('Verifie le code SMS pour terminer ton inscription');
    }

    if (Date.now() > pending.expiresAt) {
      await this.deletePendingOtp(email);
      throw new Error('Code expire, redemande un nouveau code');
    }

    if (pending.attempts >= OTP_MAX_ATTEMPTS) {
      await this.deletePendingOtp(email);
      throw new Error('Trop de tentatives, redemande un nouveau code');
    }

    if (pending.code !== code) {
      pending.attempts += 1;
      await this.writePendingOtp(pending);
      throw new Error('Code incorrect');
    }

    if (pending.intent === 'login') {
      await this.deletePendingOtp(email);
      const user = this.findUserByEmail(email);
      if (!user) throw new Error('Aucun compte trouve. Inscris-toi d abord.');
      const token = crypto.randomBytes(24).toString('hex');
      await this.writeSession(token, user.id);
      return { token, user };
    }

    // Signup : email valide, on passe au SMS
    if (this.findUserByEmail(email)) {
      await this.deletePendingOtp(email);
      throw new Error('Cet email a deja un compte');
    }
    if (!pending.phone) {
      await this.deletePendingOtp(email);
      throw new Error('Telephone manquant');
    }
    if (this.findUserByPhone(pending.phone)) {
      await this.deletePendingOtp(email);
      throw new Error('Ce numero est deja associe a un compte');
    }
    if (await this.findPendingByPhone(pending.phone, email)) {
      await this.deletePendingOtp(email);
      throw new Error('Ce numero est deja en cours de verification');
    }

    pending.step = 'phone';
    pending.code = generateOtp(); // nouveau code dedie au SMS (utilise en mode console fallback)
    pending.expiresAt = Date.now() + OTP_TTL_MS;
    pending.attempts = 0;
    await this.writePendingOtp(pending);

    return { needsPhone: true, phoneMasked: maskPhone(pending.phone) };
  }

  /**
   * Lit l'etat de l'OTP en cours pour l'envoi SMS (utilise par /api/.../verify
   * apres validation du code email). Retourne le numero + un code local au cas
   * ou Twilio n'est pas configure.
   */
  async getPendingPhoneInfo(email: string): Promise<{ phone: string; localCode: string } | null> {
    const pending = await this.readPendingOtp(email);
    if (!pending || pending.step !== 'phone' || !pending.phone) return null;
    return { phone: pending.phone, localCode: pending.code };
  }

  /**
   * Etape 3 (signup uniquement) : valide le code SMS et cree definitivement
   * le compte. `smsApprovedExternally` doit etre true si Twilio Verify a
   * confirme le code (sinon on compare au code local genere).
   */
  async verifyPhoneOtp(input: { email: string; code: string; smsApprovedExternally: boolean }): Promise<{ token: string; user: CompetitionUser }> {
    const email = normalizeEmail(input.email);
    const code = String(input.code || '').trim();
    if (!email || !code) {
      throw new Error('Email et code requis');
    }

    const pending = await this.readPendingOtp(email);
    if (!pending) {
      throw new Error('Aucune verification SMS en cours');
    }
    if (pending.step !== 'phone') {
      throw new Error('Code SMS non requis a cette etape');
    }
    if (Date.now() > pending.expiresAt) {
      await this.deletePendingOtp(email);
      throw new Error('Code expire, redemande un nouveau code');
    }
    if (pending.attempts >= OTP_MAX_ATTEMPTS) {
      await this.deletePendingOtp(email);
      throw new Error('Trop de tentatives, redemande un nouveau code');
    }

    const matchesLocal = pending.code === code;
    if (!input.smsApprovedExternally && !matchesLocal) {
      pending.attempts += 1;
      await this.writePendingOtp(pending);
      throw new Error('Code SMS incorrect');
    }

    await this.deletePendingOtp(email);

    if (this.findUserByEmail(email)) {
      throw new Error('Cet email a deja un compte');
    }
    if (!pending.phone) {
      throw new Error('Telephone manquant');
    }
    if (this.findUserByPhone(pending.phone)) {
      throw new Error('Ce numero est deja associe a un compte');
    }

    const user: CompetitionUser = {
      id: crypto.randomUUID(),
      email,
      name: pending.name || email.split('@')[0],
      phone: pending.phone,
      phoneVerifiedAt: Date.now(),
      createdAt: Date.now(),
    };
    this.users.set(user.id, user);
    await this.persist();

    const token = crypto.randomBytes(24).toString('hex');
    await this.writeSession(token, user.id);
    return { token, user };
  }

  private applyStore(parsed: CompetitionStore): void {
    this.users.clear();
    this.competitions.clear();
    for (const user of parsed.users || []) {
      this.users.set(user.id, user);
    }
    for (const competition of parsed.competitions || []) {
      this.competitions.set(competition.id, {
        ...competition,
        executionMode: competition.executionMode === 'real' ? 'real' : 'paper',
      });
    }
    // En mode local (sans Postgres), on hydrate les sessions/OTPs/traders
    // depuis le blob. En mode Postgres elles vivent dans leurs propres tables.
    if (!this.pool) {
      this.sessions.clear();
      for (const session of parsed.sessions || []) {
        if (session.token && session.userId) this.sessions.set(session.token, session.userId);
      }
      this.pendingOtps.clear();
      for (const pending of parsed.pendingOtps || []) {
        if (pending.email && pending.expiresAt > Date.now()) this.pendingOtps.set(pending.email, pending);
      }
      this.traderSessions.clear();
      for (const session of parsed.traderSessions || []) {
        if (session.token && session.playerId) {
          this.traderSessions.set(session.token, {
            playerId: session.playerId,
            competitionId: session.competitionId || null,
          });
        }
      }
    }
  }

  private currentStore(): CompetitionStore {
    // Le blob ne contient plus que users + competitions. Les sessions, OTPs
    // et trader sessions ont leurs propres tables (Postgres) ou Maps locales.
    const payload: CompetitionStore = {
      users: Array.from(this.users.values()),
      competitions: Array.from(this.competitions.values()),
    };
    if (!this.pool) {
      const now = Date.now();
      payload.sessions = Array.from(this.sessions.entries()).map(([token, userId]) => ({ token, userId }));
      payload.pendingOtps = Array.from(this.pendingOtps.values()).filter((entry) => entry.expiresAt > now);
      payload.traderSessions = Array.from(this.traderSessions.entries()).map(([token, info]) => ({
        token,
        playerId: info.playerId,
        competitionId: info.competitionId,
      }));
    }
    return payload;
  }

  /**
   * Lors du tout premier deploiement avec les nouvelles tables, on migre
   * les anciennes sessions/OTPs/trader-sessions du blob legacy vers
   * leurs tables dediees pour ne pas deconnecter les utilisateurs deja logges.
   */
  private async migrateLegacySessions(parsed: CompetitionStore): Promise<void> {
    if (!this.pool) return;
    try {
      for (const session of parsed.sessions || []) {
        if (session.token && session.userId) {
          await this.pool.query(
            `insert into comp_user_sessions (token, user_id) values ($1, $2)
             on conflict (token) do nothing`,
            [session.token, session.userId],
          );
        }
      }
      for (const otp of parsed.pendingOtps || []) {
        if (otp.email && otp.expiresAt > Date.now()) {
          await this.pool.query(
            `insert into comp_pending_otps (email, data, expires_at) values ($1, $2::jsonb, to_timestamp($3 / 1000.0))
             on conflict (email) do nothing`,
            [otp.email, JSON.stringify(otp), otp.expiresAt],
          );
        }
      }
      for (const session of parsed.traderSessions || []) {
        if (session.token && session.playerId) {
          await this.pool.query(
            `insert into comp_trader_sessions (token, player_id, competition_id) values ($1, $2, $3)
             on conflict (token) do nothing`,
            [session.token, session.playerId, session.competitionId || null],
          );
        }
      }
    } catch (error) {
      console.error('Competition legacy session migration failed:', error);
    }
  }

  async setTraderSession(token: string, playerId: string, competitionId: string | null): Promise<void> {
    if (this.pool) {
      await this.pool.query(
        `insert into comp_trader_sessions (token, player_id, competition_id) values ($1, $2, $3)
         on conflict (token) do update set player_id = excluded.player_id, competition_id = excluded.competition_id`,
        [token, playerId, competitionId],
      );
      this.traderSessions.set(token, { playerId, competitionId });
      return;
    }
    this.traderSessions.set(token, { playerId, competitionId });
    this.save();
  }

  async getTraderSession(token: string): Promise<{ playerId: string; competitionId: string | null } | null> {
    if (!token) return null;
    if (this.pool) {
      const result = await this.pool.query(
        'select player_id, competition_id from comp_trader_sessions where token = $1 limit 1',
        [token],
      );
      const row = result.rows[0];
      if (!row) return null;
      return { playerId: row.player_id as string, competitionId: (row.competition_id as string | null) || null };
    }
    return this.traderSessions.get(token) || null;
  }

  async deleteTraderSession(token: string): Promise<void> {
    if (!token) return;
    if (this.pool) {
      await this.pool.query('delete from comp_trader_sessions where token = $1', [token]);
    }
    this.traderSessions.delete(token);
  }

  async deleteTraderSessionsForPlayer(playerId: string): Promise<void> {
    if (this.pool) {
      await this.pool.query('delete from comp_trader_sessions where player_id = $1', [playerId]);
    }
    for (const [token, info] of this.traderSessions.entries()) {
      if (info.playerId === playerId) this.traderSessions.delete(token);
    }
  }

  async persist(): Promise<void> {
    if (this.pool) {
      await this.saveToDb();
      return;
    }
    this.save();
  }

  /**
   * Re-read the store from Postgres and overwrite in-memory state.
   * Required on serverless platforms where multiple Lambda instances
   * may hold stale in-memory copies of the same store.
   */
  async refresh(): Promise<void> {
    if (!this.pool) return;
    try {
      const result = await this.pool.query('select value from competition_store where key = $1 limit 1', [STORE_DB_KEY]);
      if (result.rows[0]?.value) {
        this.applyStore(result.rows[0].value as CompetitionStore);
      }
    } catch (error) {
      console.error('Competition store refresh failed:', error);
    }
  }

  private async ensureDbStore(): Promise<void> {
    if (!this.pool) return;
    await this.pool.query(`
      create table if not exists competition_store (
        key text primary key,
        value jsonb not null,
        updated_at timestamptz not null default now()
      )
    `);
    await this.pool.query(`
      create table if not exists comp_user_sessions (
        token text primary key,
        user_id text not null,
        created_at timestamptz not null default now()
      )
    `);
    await this.pool.query(`
      create table if not exists comp_trader_sessions (
        token text primary key,
        player_id text not null,
        competition_id text,
        created_at timestamptz not null default now()
      )
    `);
    await this.pool.query(`
      create table if not exists comp_pending_otps (
        email text primary key,
        data jsonb not null,
        expires_at timestamptz not null,
        updated_at timestamptz not null default now()
      )
    `);
    await this.pool.query(`create index if not exists idx_trader_sessions_player on comp_trader_sessions(player_id)`);
    await this.pool.query(`create index if not exists idx_pending_otps_phone on comp_pending_otps((data->>'phone'))`);
    await this.pool.query(`
      create table if not exists comp_admin_sessions (
        token text primary key,
        created_at timestamptz not null default now()
      )
    `);
  }

  async addAdminToken(token: string): Promise<void> {
    if (!token) return;
    if (this.pool) {
      await this.pool.query(
        `insert into comp_admin_sessions (token) values ($1) on conflict (token) do nothing`,
        [token],
      );
      return;
    }
    this.localAdminTokens.add(token);
  }

  async hasAdminToken(token: string): Promise<boolean> {
    if (!token) return false;
    if (this.pool) {
      const result = await this.pool.query(
        'select 1 from comp_admin_sessions where token = $1 limit 1',
        [token],
      );
      return result.rowCount! > 0;
    }
    return this.localAdminTokens.has(token);
  }

  async deleteAdminToken(token: string): Promise<void> {
    if (!token) return;
    if (this.pool) {
      await this.pool.query('delete from comp_admin_sessions where token = $1', [token]);
      return;
    }
    this.localAdminTokens.delete(token);
  }

  private async load(): Promise<void> {
    try {
      if (this.pool) {
        await this.ensureDbStore();
        const result = await this.pool.query('select value from competition_store where key = $1 limit 1', [STORE_DB_KEY]);
        if (result.rows[0]?.value) {
          const parsed = result.rows[0].value as CompetitionStore;
          this.applyStore(parsed);
          await this.migrateLegacySessions(parsed);
          console.log('Competition store loaded from Postgres');
          return;
        }

        if (fs.existsSync(STORE_FILE)) {
          const raw = fs.readFileSync(STORE_FILE, 'utf-8');
          const parsed = JSON.parse(raw) as CompetitionStore;
          this.applyStore(parsed);
          await this.migrateLegacySessions(parsed);
          await this.saveToDb();
          console.log('Competition store imported from JSON into Postgres');
          return;
        }

        await this.saveToDb();
        console.log('Competition store initialized in Postgres');
        return;
      }

      if (!fs.existsSync(STORE_FILE)) return;
      const raw = fs.readFileSync(STORE_FILE, 'utf-8');
      this.applyStore(JSON.parse(raw) as CompetitionStore);
    } catch (error) {
      console.error('Competition store load failed:', error);
    }
  }

  private save(): void {
    if (this.pool) {
      void this.saveToDb();
      return;
    }
    try {
      const dir = path.dirname(STORE_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const payload = this.currentStore();
      fs.writeFileSync(STORE_FILE, JSON.stringify(payload, null, 2));
    } catch (error) {
      console.error('Competition store save failed:', error);
    }
  }

  private async saveToDb(): Promise<void> {
    if (!this.pool) return;
    try {
      await this.ensureDbStore();
      await this.pool.query(
        `insert into competition_store (key, value, updated_at)
         values ($1, $2::jsonb, now())
         on conflict (key) do update set value = excluded.value, updated_at = now()`,
        [STORE_DB_KEY, JSON.stringify(this.currentStore())],
      );
    } catch (error) {
      console.error('Competition store Postgres save failed:', error);
    }
  }

  /**
   * Resout un session token vers un utilisateur en allant directement
   * dans Postgres (table comp_user_sessions). Cela evite les pertes
   * d'updates dues aux ecritures concurrentes sur le blob JSON.
   */
  async getUserFromToken(token: string): Promise<CompetitionUser | null> {
    if (!token) return null;
    if (this.pool) {
      const result = await this.pool.query(
        'select user_id from comp_user_sessions where token = $1 limit 1',
        [token],
      );
      const userId = result.rows[0]?.user_id as string | undefined;
      if (!userId) return null;
      let user = this.users.get(userId) || null;
      if (!user) {
        // Le user a peut-etre ete cree par un autre Lambda (signup tres recent).
        await this.refresh();
        user = this.users.get(userId) || null;
      }
      return user;
    }
    const userId = this.sessions.get(token);
    if (!userId) return null;
    return this.users.get(userId) || null;
  }

  async writeSession(token: string, userId: string): Promise<void> {
    if (this.pool) {
      await this.pool.query(
        `insert into comp_user_sessions (token, user_id) values ($1, $2)
         on conflict (token) do update set user_id = excluded.user_id`,
        [token, userId],
      );
      this.sessions.set(token, userId);
      return;
    }
    this.sessions.set(token, userId);
    this.save();
  }

  async deleteSession(token: string): Promise<void> {
    if (!token) return;
    if (this.pool) {
      await this.pool.query('delete from comp_user_sessions where token = $1', [token]);
    }
    this.sessions.delete(token);
  }

  updateUserProfile(userId: string, input: {
    name?: unknown;
    phone?: unknown;
    socials?: unknown;
  }): CompetitionUser {
    const user = this.users.get(userId);
    if (!user) throw new Error('Utilisateur introuvable');

    const name = String(input.name ?? user.name).trim();
    if (!name || name.length < 2) throw new Error('Pseudo invalide');
    if (name.length > 32) throw new Error('Pseudo trop long');

    let phone = user.phone || null;
    let phoneVerifiedAt = user.phoneVerifiedAt || null;
    if (input.phone !== undefined) {
      const nextPhone = normalizePhone(String(input.phone || ''));
      if (!isValidPhone(nextPhone)) {
        throw new Error('Numero de telephone invalide (format international ex: +33612345678)');
      }
      const owner = this.findUserByPhone(nextPhone);
      if (owner && owner.id !== user.id) {
        throw new Error('Ce numero est deja associe a un compte');
      }
      if (nextPhone !== user.phone) {
        phone = nextPhone;
        // Pour le MVP on accepte le changement, mais on marque explicitement
        // que ce nouveau numero n'a pas encore repasse un challenge SMS.
        phoneVerifiedAt = null;
      }
    }

    const rawSocials = (input.socials && typeof input.socials === 'object') ? input.socials as Record<string, unknown> : {};
    const socials = {
      x: normalizeSocialUrl(rawSocials.x),
      instagram: normalizeSocialUrl(rawSocials.instagram),
      discord: normalizeSocialUrl(rawSocials.discord),
      website: normalizeSocialUrl(rawSocials.website),
    };

    const nextUser: CompetitionUser = {
      ...user,
      name,
      phone,
      phoneVerifiedAt,
      socials,
    };
    this.users.set(user.id, nextUser);
    this.save();
    return nextUser;
  }

  setUserAvatar(userId: string, avatarUrl: string): CompetitionUser {
    const user = this.users.get(userId);
    if (!user) throw new Error('Utilisateur introuvable');
    const nextUser = { ...user, avatarUrl };
    this.users.set(user.id, nextUser);
    this.save();
    return nextUser;
  }

  createCompetition(input: {
    title: string;
    code: string;
    executionMode: 'paper' | 'real';
    startAt: number;
    endAt: number;
    isPublic: boolean;
    cashPrize?: unknown;
  }): Competition {
    const title = String(input.title || '').trim();
    const code = normalizeCode(input.code);
    const executionMode = input.executionMode === 'real' ? 'real' : 'paper';
    const startAt = Number(input.startAt);
    const endAt = Number(input.endAt);
    const isPublic = Boolean(input.isPublic);
    const cashPrize = normalizeCashPrize(input.cashPrize);

    if (!title) throw new Error('Titre requis');
    if (!code || code.length < 4) throw new Error('Code competition invalide');
    if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || endAt <= startAt) {
      throw new Error('Dates competition invalides');
    }
    if (Array.from(this.competitions.values()).some((entry) => entry.code === code)) {
      throw new Error('Code competition deja utilise');
    }

    const competition: Competition = {
      id: crypto.randomUUID(),
      title,
      code,
      executionMode,
      startAt,
      endAt,
      isPublic,
      createdAt: Date.now(),
      entries: [],
      cashPrize,
    };

    this.competitions.set(competition.id, competition);
    this.save();
    return competition;
  }

  listAdminCompetitions(): Array<Competition & { status: 'upcoming' | 'live' | 'ended'; participants: number; entriesDetailed: Array<CompetitionEntry & { user: CompetitionUser | null }> }> {
    const competitions = Array.from(this.competitions.values())
      .sort((a, b) => b.createdAt - a.createdAt);

    return competitions.map((competition) => ({
      ...competition,
      status: inferCompetitionStatus(competition.startAt, competition.endAt),
      participants: competition.entries.length,
      entriesDetailed: competition.entries
        .map((entry) => ({ ...entry, user: this.users.get(entry.userId) || null }))
        .sort((a, b) => b.pnlPercent - a.pnlPercent),
    }));
  }

  listPublicCompetitions(): Array<{
    id: string;
    title: string;
    code: string;
    executionMode: 'paper' | 'real';
    startAt: number;
    endAt: number;
    isPublic: boolean;
    participants: number;
    status: 'upcoming' | 'live' | 'ended';
    cashPrize: CashPrize | null;
  }> {
    return Array.from(this.competitions.values())
      .filter((competition) => competition.isPublic)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((competition) => ({
        id: competition.id,
        title: competition.title,
        code: competition.code,
        executionMode: competition.executionMode,
        startAt: competition.startAt,
        endAt: competition.endAt,
        isPublic: competition.isPublic,
        participants: competition.entries.length,
        status: inferCompetitionStatus(competition.startAt, competition.endAt),
        cashPrize: competition.cashPrize ?? null,
      }));
  }

  joinCompetition(userId: string, codeInput: string): Competition {
    const code = normalizeCode(codeInput);
    const competition = Array.from(this.competitions.values()).find((entry) => entry.code === code);
    if (!competition) throw new Error('Competition introuvable');
    if (inferCompetitionStatus(competition.startAt, competition.endAt) === 'ended') {
      throw new Error('Competition terminee');
    }
    const already = competition.entries.some((entry) => entry.userId === userId);
    if (!already) {
      competition.entries.push({
        userId,
        joinedAt: Date.now(),
        pnlUsd: 0,
        pnlPercent: 0,
        tradesCount: 0,
        updatedAt: Date.now(),
      });
      this.competitions.set(competition.id, competition);
      this.save();
    }
    return competition;
  }

  getCompetitionForUser(competitionId: string, userId: string): { competition: Competition; entry: CompetitionEntry } {
    const competition = this.competitions.get(competitionId);
    if (!competition) throw new Error('Competition introuvable');
    const entry = competition.entries.find((item) => item.userId === userId);
    if (!entry) throw new Error('Utilisateur non inscrit a cette competition');
    return { competition, entry };
  }

  getCompetitionStatus(competitionId: string): CompetitionStatus {
    const competition = this.competitions.get(competitionId);
    if (!competition) throw new Error('Competition introuvable');
    return inferCompetitionStatus(competition.startAt, competition.endAt);
  }

  assertCompetitionTradingOpen(competitionId: string): Competition {
    const competition = this.competitions.get(competitionId);
    if (!competition) throw new Error('Competition introuvable');
    const status = inferCompetitionStatus(competition.startAt, competition.endAt);
    if (status === 'upcoming') {
      throw new Error('La competition n a pas encore commence');
    }
    if (status === 'ended') {
      throw new Error('La competition est terminee');
    }
    return competition;
  }

  linkPaperPlayer(competitionId: string, userId: string, paperPlayerId: string): void {
    const competition = this.competitions.get(competitionId);
    if (!competition) throw new Error('Competition introuvable');
    const entry = competition.entries.find((item) => item.userId === userId);
    if (!entry) throw new Error('Utilisateur non inscrit a cette competition');
    entry.paperPlayerId = paperPlayerId;
    entry.updatedAt = Date.now();
    this.competitions.set(competition.id, competition);
    this.save();
  }

  getPaperPlayerIds(): string[] {
    return Array.from(this.competitions.values()).flatMap((competition) => (
      competition.entries
        .map((entry) => entry.paperPlayerId)
        .filter((playerId): playerId is string => Boolean(playerId))
    ));
  }

  getCompetitionsNeedingFinalization(now = Date.now()): Array<{ competitionId: string; paperPlayerIds: string[] }> {
    return Array.from(this.competitions.values())
      .filter((competition) => (
        !competition.finalizedAt
        && inferCompetitionStatus(competition.startAt, competition.endAt, now) === 'ended'
      ))
      .map((competition) => ({
        competitionId: competition.id,
        paperPlayerIds: competition.entries
          .map((entry) => entry.paperPlayerId)
          .filter((playerId): playerId is string => Boolean(playerId)),
      }))
      .filter((entry) => entry.paperPlayerIds.length > 0);
  }

  /**
   * Cheap predicate used on hot read paths to short-circuit the heavier
   * finalization routine when there is nothing to finalize.
   */
  hasCompetitionsNeedingFinalization(now = Date.now()): boolean {
    for (const competition of this.competitions.values()) {
      if (competition.finalizedAt) continue;
      if (inferCompetitionStatus(competition.startAt, competition.endAt, now) !== 'ended') continue;
      if (competition.entries.some((entry) => Boolean(entry.paperPlayerId))) return true;
    }
    return false;
  }

  markCompetitionFinalized(competitionId: string): void {
    const competition = this.competitions.get(competitionId);
    if (!competition) throw new Error('Competition introuvable');
    if (competition.finalizedAt) return;
    competition.finalizedAt = Date.now();
    this.competitions.set(competition.id, competition);
    this.save();
  }

  updatePaperResultByPlayerId(
    paperPlayerId: string,
    result: { pnlUsd: number; pnlPercent: number; tradesCount: number },
  ): void {
    let changed = false;
    for (const competition of this.competitions.values()) {
      if (competition.finalizedAt) continue;
      const entry = competition.entries.find((item) => item.paperPlayerId === paperPlayerId);
      if (!entry) continue;

      entry.pnlUsd = Number(result.pnlUsd) || 0;
      entry.pnlPercent = Number(result.pnlPercent) || 0;
      entry.tradesCount = Math.max(0, Math.floor(Number(result.tradesCount) || 0));
      entry.updatedAt = Date.now();
      changed = true;
    }

    if (changed) this.save();
  }

  listUserCompetitions(userId: string): Array<{
    id: string;
    title: string;
    code: string;
    executionMode: 'paper' | 'real';
    startAt: number;
    endAt: number;
    status: 'upcoming' | 'live' | 'ended';
    myEntry: CompetitionEntry;
    cashPrize: CashPrize | null;
  }> {
    return Array.from(this.competitions.values())
      .filter((competition) => competition.entries.some((entry) => entry.userId === userId))
      .map((competition) => {
        const myEntry = competition.entries.find((entry) => entry.userId === userId)!;
        return {
          id: competition.id,
          title: competition.title,
          code: competition.code,
          executionMode: competition.executionMode,
          startAt: competition.startAt,
          endAt: competition.endAt,
          status: inferCompetitionStatus(competition.startAt, competition.endAt),
          myEntry,
          cashPrize: competition.cashPrize ?? null,
        };
      })
      .sort((a, b) => b.startAt - a.startAt);
  }

  deleteCompetition(id: string): { paperPlayerIds: string[] } {
    const competition = this.competitions.get(id);
    if (!competition) throw new Error('Competition introuvable');
    const paperPlayerIds = competition.entries
      .map((entry) => entry.paperPlayerId)
      .filter((value): value is string => Boolean(value));
    this.competitions.delete(id);
    this.save();
    return { paperPlayerIds };
  }

  updateCompetition(id: string, patch: Partial<{
    title: string;
    code: string;
    executionMode: 'paper' | 'real';
    startAt: number;
    endAt: number;
    isPublic: boolean;
    cashPrize: unknown;
  }>): Competition {
    const competition = this.competitions.get(id);
    if (!competition) throw new Error('Competition introuvable');

    if (patch.title !== undefined) {
      const title = String(patch.title || '').trim();
      if (!title) throw new Error('Titre requis');
      competition.title = title;
    }

    if (patch.code !== undefined) {
      const code = normalizeCode(patch.code);
      if (!code || code.length < 4) throw new Error('Code competition invalide');
      const taken = Array.from(this.competitions.values())
        .some((entry) => entry.id !== id && entry.code === code);
      if (taken) throw new Error('Code competition deja utilise');
      competition.code = code;
    }

    if (patch.executionMode !== undefined) {
      competition.executionMode = patch.executionMode === 'real' ? 'real' : 'paper';
    }

    const nextStart = patch.startAt !== undefined ? Number(patch.startAt) : competition.startAt;
    const nextEnd = patch.endAt !== undefined ? Number(patch.endAt) : competition.endAt;
    if (!Number.isFinite(nextStart) || !Number.isFinite(nextEnd) || nextEnd <= nextStart) {
      throw new Error('Dates competition invalides');
    }
    competition.startAt = nextStart;
    competition.endAt = nextEnd;

    if (patch.isPublic !== undefined) {
      competition.isPublic = Boolean(patch.isPublic);
    }

    if (patch.cashPrize !== undefined) {
      competition.cashPrize = normalizeCashPrize(patch.cashPrize);
    }

    this.competitions.set(competition.id, competition);
    this.save();
    return competition;
  }

  upsertResult(input: {
    competitionId: string;
    userId: string;
    pnlUsd: number;
    pnlPercent: number;
    tradesCount: number;
  }): Competition {
    const competition = this.competitions.get(input.competitionId);
    if (!competition) throw new Error('Competition introuvable');
    if (!this.users.has(input.userId)) throw new Error('Participant introuvable');

    const existing = competition.entries.find((entry) => entry.userId === input.userId);
    if (existing) {
      existing.pnlUsd = Number(input.pnlUsd) || 0;
      existing.pnlPercent = Number(input.pnlPercent) || 0;
      existing.tradesCount = Math.max(0, Math.floor(Number(input.tradesCount) || 0));
      existing.updatedAt = Date.now();
    } else {
      competition.entries.push({
        userId: input.userId,
        joinedAt: Date.now(),
        pnlUsd: Number(input.pnlUsd) || 0,
        pnlPercent: Number(input.pnlPercent) || 0,
        tradesCount: Math.max(0, Math.floor(Number(input.tradesCount) || 0)),
        updatedAt: Date.now(),
      });
    }

    this.competitions.set(competition.id, competition);
    this.save();
    return competition;
  }

  getCompetitionContextForPaperPlayer(competitionId: string, paperPlayerId: string): {
    competition: {
      id: string;
      title: string;
      code: string;
      executionMode: 'paper' | 'real';
      startAt: number;
      endAt: number;
      status: 'upcoming' | 'live' | 'ended';
      participants: number;
      cashPrize: CashPrize | null;
    };
    rank: number | null;
    userId: string | null;
    pnlPercent: number;
    pnlUsd: number;
    tradesCount: number;
  } | null {
    const competition = this.competitions.get(competitionId);
    if (!competition) return null;

    const sorted = competition.entries
      .slice()
      .sort((a, b) => b.pnlPercent - a.pnlPercent || b.pnlUsd - a.pnlUsd);

    const idx = sorted.findIndex((entry) => entry.paperPlayerId === paperPlayerId);
    const myEntry = idx >= 0 ? sorted[idx] : null;

    return {
      competition: {
        id: competition.id,
        title: competition.title,
        code: competition.code,
        executionMode: competition.executionMode,
        startAt: competition.startAt,
        endAt: competition.endAt,
        status: inferCompetitionStatus(competition.startAt, competition.endAt),
        participants: competition.entries.length,
        cashPrize: competition.cashPrize ?? null,
      },
      rank: idx >= 0 ? idx + 1 : null,
      userId: myEntry?.userId ?? null,
      pnlPercent: myEntry?.pnlPercent ?? 0,
      pnlUsd: myEntry?.pnlUsd ?? 0,
      tradesCount: myEntry?.tradesCount ?? 0,
    };
  }

  getPublicLeaderboard(competitionId: string): {
    competition: {
      id: string;
      title: string;
      code: string;
      startAt: number;
      endAt: number;
      status: 'upcoming' | 'live' | 'ended';
      participants: number;
      cashPrize: CashPrize | null;
    };
    leaderboard: Array<{
      rank: number;
      userId: string;
      name: string;
      pnlPercent: number;
      pnlUsd: number;
      tradesCount: number;
      updatedAt: number;
    }>;
  } {
    const competition = this.competitions.get(competitionId);
    if (!competition || !competition.isPublic) throw new Error('Leaderboard introuvable');

    const leaderboard = competition.entries
      .map((entry) => {
        const user = this.users.get(entry.userId);
        return {
          userId: entry.userId,
          name: user?.name || 'Participant',
          pnlPercent: entry.pnlPercent,
          pnlUsd: entry.pnlUsd,
          tradesCount: entry.tradesCount,
          updatedAt: entry.updatedAt,
        };
      })
      .sort((a, b) => b.pnlPercent - a.pnlPercent || b.pnlUsd - a.pnlUsd)
      .map((entry, index) => ({ rank: index + 1, ...entry }));

    return {
      competition: {
        id: competition.id,
        title: competition.title,
        code: competition.code,
        startAt: competition.startAt,
        endAt: competition.endAt,
        status: inferCompetitionStatus(competition.startAt, competition.endAt),
        participants: competition.entries.length,
        cashPrize: competition.cashPrize ?? null,
      },
      leaderboard,
    };
  }

  /**
   * Same shape as getPublicLeaderboard but does not check isPublic.
   * Used to push live leaderboard diffs over WS to authenticated traders
   * regardless of the competition's listing status.
   */
  getLiveLeaderboard(competitionId: string): {
    competition: {
      id: string;
      title: string;
      code: string;
      startAt: number;
      endAt: number;
      status: 'upcoming' | 'live' | 'ended';
      participants: number;
      cashPrize: CashPrize | null;
    };
    leaderboard: Array<{
      rank: number;
      userId: string;
      name: string;
      pnlPercent: number;
      pnlUsd: number;
      tradesCount: number;
      updatedAt: number;
    }>;
  } | null {
    const competition = this.competitions.get(competitionId);
    if (!competition) return null;

    const leaderboard = competition.entries
      .map((entry) => {
        const user = this.users.get(entry.userId);
        return {
          userId: entry.userId,
          name: user?.name || 'Participant',
          pnlPercent: entry.pnlPercent,
          pnlUsd: entry.pnlUsd,
          tradesCount: entry.tradesCount,
          updatedAt: entry.updatedAt,
        };
      })
      .sort((a, b) => b.pnlPercent - a.pnlPercent || b.pnlUsd - a.pnlUsd)
      .map((entry, index) => ({ rank: index + 1, ...entry }));

    return {
      competition: {
        id: competition.id,
        title: competition.title,
        code: competition.code,
        startAt: competition.startAt,
        endAt: competition.endAt,
        status: inferCompetitionStatus(competition.startAt, competition.endAt),
        participants: competition.entries.length,
        cashPrize: competition.cashPrize ?? null,
      },
      leaderboard,
    };
  }
}
