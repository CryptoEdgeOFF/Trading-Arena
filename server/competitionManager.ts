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
  /**
   * Preuve de consentement RGPD recueillie à l'inscription : acceptation des
   * CGU/Confidentialité + opt-in newsletter. `acceptedAt` horodate le moment
   * où l'utilisateur a coché la case et soumis le formulaire.
   */
  consent?: {
    termsAccepted: boolean;
    newsletter: boolean;
    acceptedAt: number;
  } | null;
  createdAt: number;
}

/**
 * Payout (versement de gains) attribué manuellement par un admin à un joueur.
 * Sert à générer un certificat de payout affiché sur le profil public.
 * `amount` est en unités de la devise (`currency`), `paidAt` est la date du
 * versement (timestamp ms).
 */
export type PayoutStatus = 'available' | 'pending' | 'approved';

export interface PlayerPayout {
  id: string;
  userId: string;
  amount: number;
  currency: string;
  paidAt: number;
  createdAt: number;
  /** Arène d'origine si le payout a été généré automatiquement à la clôture. */
  competitionId?: string | null;
  /** Place récompensée (1 = 1er) pour les payouts auto. */
  rank?: number | null;
  /** Origine : 'auto' (généré à la clôture via le prize table) ou 'manual' (admin). */
  source?: 'auto' | 'manual';
  /** Cycle de demande de versement : available → pending → approved. */
  status?: PayoutStatus;
  erc20Address?: string | null;
  requestedAt?: number | null;
  approvedAt?: number | null;
}

function normalizePayout(p: PlayerPayout): PlayerPayout {
  return {
    ...p,
    status: p.status || 'available',
    erc20Address: p.erc20Address ?? null,
    requestedAt: p.requestedAt ?? null,
    approvedAt: p.approvedAt ?? null,
  };
}

export function isValidErc20Address(addr: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(String(addr || '').trim());
}

export interface CompetitionEntry {
  userId: string;
  joinedAt: number;
  pnlUsd: number;
  pnlPercent: number;
  tradesCount: number;
  updatedAt: number;
  paperPlayerId?: string;
  /**
   * Identifiant public fourni par le participant pour satisfaire la condition
   * d'accès d'une arène sponsorisée (ex. identifiant public Kraken). Renseigné
   * au moment du join quand le sponsor de l'arène l'exige.
   */
  sponsorAccountId?: string | null;
  /**
   * Règle de drawdown journalier (si l'arène en définit une).
   * - `dailyBaselineDayKey` : jour UTC ('YYYY-MM-DD') pour lequel la baseline
   *   ci-dessous est valable. La baseline est recapturée au premier calcul
   *   d'équité de chaque nouveau jour UTC.
   * - `dailyBaselineEquity` : équité (mark-to-market) de début de journée.
   * - `breachedAt` : timestamp d'élimination (drawdown atteint). Une fois posé,
   *   le joueur est éliminé DÉFINITIVEMENT de l'arène et ne peut plus trader.
   */
  dailyBaselineDayKey?: string | null;
  dailyBaselineEquity?: number | null;
  breachedAt?: number | null;
}

export interface CashPrizeBreakdownEntry {
  rank: number;
  amount: number;
}

/**
 * Un lot additionnel (récompense physique ou autre) : photo + titre + texte
 * libre. Permet d'afficher plusieurs lots, pas seulement un montant en USD.
 */
export interface CashPrizeItem {
  /** Place associée au lot (1 = 1er, 2 = 2e, ...). Optionnel. */
  rank?: number;
  imageUrl?: string;
  title?: string;
  description?: string;
}

export interface CashPrize {
  currency: string;
  total: number;
  breakdown?: CashPrizeBreakdownEntry[];
  label?: string;
  imageUrl?: string;
  /**
   * Free-form text (rules, prize description, qualification info) shown on
   * the public leaderboard under the prize block. Edited by the admin
   * through the competition admin form. Multi-line, kept short-ish (a few
   * paragraphs). Supports plain newlines.
   */
  description?: string;
  /**
   * Lots additionnels (photos + texte libre). Chaque entrée est un lot à
   * gagner en plus (ou à la place) du cash. Affiché sur la carte et le
   * leaderboard public.
   */
  items?: CashPrizeItem[];
}

const MAX_PRIZE_ITEMS = 12;

/**
 * Vrai si le titre correspond à une arène de qualification (exclue du
 * classement global). Couvre "BTF QUALIFICATIONS" et variantes.
 */
function isQualificationCompetition(title: string | undefined | null): boolean {
  return /qualif/i.test(String(title || ''));
}

/**
 * Badges collectionnables affichés à côté du pseudo :
 * - 'btf2026'         : a participé à une arène de qualification BTF (événement physique Paris 2026).
 * - 'champion'        : a terminé 1er d'au moins une arène terminée.
 * - 'paris-champion'  : vainqueur de la finale amateur physique BTF à Paris (4-5 juin 2026).
 * - 'summer-champion'  : leader du leaderboard global Summer Season (en fin de saison).
 * - 'autumn-champion'  : idem Autumn Season.
 */
export type UserBadge =
  | 'btf2026'
  | 'champion'
  | 'paris-champion'
  | 'summer-champion'
  | 'autumn-champion';

export type SeasonTheme = 'summer' | 'autumn' | 'winter' | 'spring';

/** Saison du leaderboard global (Summer, Autumn, …). */
export interface LeaderboardSeason {
  id: string;
  slug: string;
  /** Clé i18n du nom affiché, ex. seasons.summer2026.name */
  nameKey: string;
  startAt: number;
  endAt: number;
  /** Saison affichée par défaut sur le leaderboard global. */
  isActive: boolean;
  championBadge: UserBadge;
  rewardEyebrowKey: string;
  rewardTitleKey: string;
  rewardDescKey: string;
  theme: SeasonTheme;
  /** Bannière affichée en haut du leaderboard de la saison (URL publique). */
  bannerImage?: string | null;
  /** Maillot officiel remporté par le #1 (invitation BTF physique). */
  shirtImage?: string | null;
  /** Visuel de l'arène physique BTF 2027 (lot du #1). */
  arenaImage?: string | null;
  /** Bannière promotionnelle affichée sur la page d'accueil quand la saison est active. */
  homeBannerImage?: string | null;
}

function buildDefaultSeasons(): LeaderboardSeason[] {
  return [
    {
      id: 'summer-2026',
      slug: 'summer-2026',
      nameKey: 'seasons.summer2026.name',
      startAt: Date.parse('2026-06-21T00:00:00+02:00'),
      endAt: Date.parse('2026-09-22T23:59:59.999+02:00'),
      isActive: true,
      championBadge: 'summer-champion',
      rewardEyebrowKey: 'seasons.summer2026.rewardEyebrow',
      rewardTitleKey: 'seasons.summer2026.rewardTitle',
      rewardDescKey: 'seasons.summer2026.rewardDesc',
      theme: 'summer',
      bannerImage: '/assets/Seasons/Summer Season BTF Arena.png',
      shirtImage: '/assets/badges/Summer Season Shirt BTF Arena.png',
      arenaImage: '/assets/pictures/arena3d.png',
      homeBannerImage: '/assets/pictures/SummerSeasonBannerHomeBTfarena.png',
    },
    {
      id: 'autumn-2026',
      slug: 'autumn-2026',
      nameKey: 'seasons.autumn2026.name',
      startAt: Date.parse('2026-09-23T00:00:00+02:00'),
      endAt: Date.parse('2026-12-21T23:59:59.999+01:00'),
      isActive: false,
      championBadge: 'autumn-champion',
      rewardEyebrowKey: 'seasons.autumn2026.rewardEyebrow',
      rewardTitleKey: 'seasons.autumn2026.rewardTitle',
      rewardDescKey: 'seasons.autumn2026.rewardDesc',
      theme: 'autumn',
      bannerImage: null,
      shirtImage: null,
      arenaImage: '/assets/pictures/arena3d.png',
      homeBannerImage: null,
    },
  ];
}

export type SeasonStatus = 'upcoming' | 'active' | 'ended';

export function inferSeasonStatus(season: Pick<LeaderboardSeason, 'startAt' | 'endAt'>, now = Date.now()): SeasonStatus {
  if (now < season.startAt) return 'upcoming';
  if (now > season.endAt) return 'ended';
  return 'active';
}

/**
 * Vainqueurs de la compétition amateur en présentiel (Paris, 4-5 juin 2026).
 * Liste fixe d'IDs utilisateurs : badge attribué manuellement (hors logique
 * d'arène). Éditer ici pour ajouter/retirer un gagnant.
 */
const PARIS_CHAMPION_USER_IDS: ReadonlySet<string> = new Set([
  'd8d54a95-9bf2-4f21-a604-cc8ada178ee4', // EVO
  'ed09da92-fa40-431d-9525-61ae4c12ba34', // yoyo
  '020c58bc-6b39-4803-93dd-4385d1b8fd9f', // Martin Gale
  'c426b642-893f-456e-8cb7-1ae7e699f974', // Celia
]);

function normalizeCashPrizeItems(input: unknown): CashPrizeItem[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const items = input
    .map((row: unknown): CashPrizeItem | null => {
      if (!row || typeof row !== 'object') return null;
      const r = row as { rank?: unknown; imageUrl?: unknown; title?: unknown; description?: unknown };
      const rankRaw = Number(r.rank);
      const rank = Number.isFinite(rankRaw) && rankRaw >= 1 ? Math.min(Math.floor(rankRaw), 999) : undefined;
      const imageUrl = String(r.imageUrl ?? '').trim().slice(0, 5000);
      const title = String(r.title ?? '').trim().slice(0, 120);
      const description = String(r.description ?? '')
        .replace(/\r\n?/g, '\n')
        .replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '')
        .trim()
        .slice(0, 1500);
      if (!imageUrl && !title && !description) return null;
      return {
        ...(rank ? { rank } : {}),
        ...(imageUrl ? { imageUrl } : {}),
        ...(title ? { title } : {}),
        ...(description ? { description } : {}),
      };
    })
    .filter((row): row is CashPrizeItem => row !== null)
    .slice(0, MAX_PRIZE_ITEMS)
    .sort((a, b) => (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER));
  return items.length > 0 ? items : undefined;
}

export interface Competition {
  id: string;
  title: string;
  code: string;
  executionMode: 'paper' | 'real';
  startAt: number;
  endAt: number;
  /**
   * Fin de la phase d'inscription (join). Par défaut = `startAt` (inscriptions
   * jusqu'au début du trading). Peut être antérieure pour fermer les
   * inscriptions avant le départ.
   */
  registrationEndsAt?: number | null;
  /**
   * Limite de drawdown JOURNALIER en pourcentage (ex. 5 = 5%). Si l'équité d'un
   * joueur descend de plus de ce % sous son équité de début de journée (UTC),
   * il est éliminé définitivement de l'arène. `null`/absent = pas de règle.
   */
  dailyDrawdownPercent?: number | null;
  /**
   * Bannière visuelle (URL `/api/prize-images/:id`) mise en avant sur le
   * leaderboard de l'arène, ex. pour annoncer une CUP. `null`/absent = aucune.
   */
  bannerImageUrl?: string | null;
  isPublic: boolean;
  createdAt: number;
  entries: CompetitionEntry[];
  cashPrize?: CashPrize | null;
  finalizedAt?: number | null;
  /**
   * Timestamp de génération automatique des payouts des gagnants (prize table).
   * Garde d'idempotence : une arène ne génère ses payouts qu'une seule fois.
   */
  payoutsGeneratedAt?: number | null;
  /**
   * Clé du sponsor de l'arène (ex. 'kraken'). null = arène standard BTF.
   * Détermine le thème (couleurs + logo) et la condition d'accès (saisie d'un
   * identifiant public sponsor au moment du join). Voir SPONSOR_DEFS.
   */
  sponsor?: string | null;
  /**
   * Lien d'affiliation/parrainage du sponsor, saisi par l'admin à la création
   * de l'arène. Affiché dans la modale de join (bouton « S'inscrire »). Si
   * vide, le client retombe sur le lien par défaut du registre sponsor.
   */
  sponsorReferralUrl?: string | null;
  /** Timestamp d'envoi de l'email « l'arène démarre bientôt » (anti-doublon). */
  notifiedStartSoonAt?: number | null;
  /** Timestamp d'envoi des emails de résultats de fin d'arène (anti-doublon). */
  notifiedEndedAt?: number | null;
  /** Timestamp d'envoi de l'email « nouvelle arène disponible » (anti-doublon). */
  notifiedNewArenaAt?: number | null;
  /** Saison du leaderboard global à laquelle cette arène contribue. */
  seasonId?: string | null;
}

export type CompetitionStatus = 'registration' | 'starting_soon' | 'live' | 'ended';

/**
 * Sponsors connus. Le serveur ne stocke que la clé + sait quels sponsors
 * imposent la saisie d'un identifiant public au join. Le thème (couleurs,
 * logo, lien de parrainage) vit côté client dans src/lib/sponsors.ts.
 */
const SPONSOR_DEFS: Record<
  string,
  { requiresAccountId: boolean; accountIdPattern?: RegExp; accountIdNormalize?: 'uppercase' | 'lowercase' }
> = {
  // Un identifiant public Kraken ressemble à « AA38 N84G TUDE DOOA » :
  // 16 caractères alphanumériques, regroupés par 4. On ignore les espaces.
  kraken: { requiresAccountId: true, accountIdPattern: /^[A-Z0-9]{16}$/, accountIdNormalize: 'uppercase' },
  // NinjaTrader : l'email du compte est vérifié côté sponsor.
  ninjatrader: {
    requiresAccountId: true,
    accountIdPattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/i,
    accountIdNormalize: 'lowercase',
  },
};

function normalizeSponsor(input: unknown): string | null {
  const key = String(input ?? '').trim().toLowerCase();
  if (!key) return null;
  return SPONSOR_DEFS[key] ? key : null;
}

function normalizeSponsorReferralUrl(input: unknown): string | null {
  const raw = String(input ?? '').trim();
  if (!raw) return null;
  // On n'accepte que des URL http(s) pour éviter les schémas dangereux
  // (javascript:, data:, etc.) injectés dans un href.
  if (!/^https?:\/\//i.test(raw)) return null;
  return raw.slice(0, 2000);
}

interface CompetitionStore {
  users: CompetitionUser[];
  competitions: Competition[];
  /** Saisons du leaderboard global (Summer, Autumn, …). */
  seasons?: LeaderboardSeason[];
  /** Payouts (certificats de gains) attribués manuellement aux joueurs. */
  payouts?: PlayerPayout[];
  /**
   * Balance de départ (paper) des joueurs des arènes online. Indépendante de
   * la config de l'événement LIVE (`PlayerManager.paperStartingBalance`) pour
   * que régler l'un ne touche jamais l'autre.
   */
  competitionStartingBalance?: number;
  // Legacy fields kept for backwards-compatibility while migrating to dedicated
  // tables. Not written anymore.
  sessions?: Array<{ token: string; userId: string }>;
  pendingOtps?: PendingOtp[];
  traderSessions?: Array<{ token: string; playerId: string; competitionId?: string | null }>;
}

const DEFAULT_COMPETITION_STARTING_BALANCE = 10_000;

const STORE_FILE = path.join(process.cwd(), 'data', 'competition-platform.json');
const STORE_DB_KEY = 'competition-platform';

// Durée de vie des sessions. Au-delà, le token est considéré expiré (et
// purgé). Les sessions user/trader durent plus longtemps qu'une session
// admin (privilèges élevés). Valeurs entières inlinées dans les intervalles
// SQL (sûr car constantes).
const USER_SESSION_TTL_DAYS = 30;
const ADMIN_SESSION_TTL_DAYS = 7;

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

type CompetitionTiming = Pick<Competition, 'startAt' | 'endAt' | 'registrationEndsAt'>;

function getRegistrationEndsAt(competition: CompetitionTiming): number {
  const raw = competition.registrationEndsAt;
  if (raw != null && Number.isFinite(raw)) return raw;
  return competition.startAt;
}

function inferCompetitionStatus(competition: CompetitionTiming, now = Date.now()): CompetitionStatus {
  if (now > competition.endAt) return 'ended';
  if (now >= competition.startAt) return 'live';
  const registrationEndsAt = getRegistrationEndsAt(competition);
  if (now >= registrationEndsAt) return 'starting_soon';
  return 'registration';
}

function canJoinCompetition(competition: CompetitionTiming, now = Date.now()): boolean {
  if (now > competition.endAt) return false;
  return now < getRegistrationEndsAt(competition);
}

function canTradeCompetition(competition: CompetitionTiming, now = Date.now()): boolean {
  return now >= competition.startAt && now <= competition.endAt;
}

/** Clé de jour UTC ('YYYY-MM-DD') pour le reset journalier du drawdown. */
function utcDayKey(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

/**
 * Normalise une limite de drawdown journalier en %.
 * Retourne `null` si absente/invalide/<=0. Bornée à 100 max.
 */
function normalizeDrawdownPercent(input: unknown): number | null {
  if (input === null || input === undefined || input === '') return null;
  const value = Number(input);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.min(100, Math.round(value * 100) / 100);
}

/** Normalise l'URL de bannière d'arène (string bornée, `null` si vide). */
function normalizeBannerImageUrl(input: unknown): string | null {
  if (input === null || input === undefined) return null;
  const value = String(input).trim().slice(0, 5000);
  return value || null;
}

/**
 * Trie et classe un leaderboard. Les participants qui n'ont pas encore tradé
 * (tradesCount === 0) ne sont jamais classés : ils reçoivent `rank = 0` et sont
 * relégués en bas (sous les traders classés). Évite qu'un compte à 0 % (pas de
 * trade) se retrouve sur le podium devant un trader en perte.
 */
function sortAndRankLeaderboard<T extends { pnlPercent: number; pnlUsd: number; tradesCount: number; breached?: boolean; breachedAt?: number | null }>(
  rows: T[],
): Array<T & { rank: number }> {
  // Trois paliers, dans cet ordre :
  //   2 = trader actif (a tradé et NON éliminé) → seul à être classé (rank ≥ 1)
  //   1 = compte éliminé (drawdown atteint) → relégué, jamais classé ni au podium
  //   0 = inscrit sans trade → relégué en bas
  const tier = (row: T): number => {
    if (row.breached || row.breachedAt) return 1;
    return row.tradesCount > 0 ? 2 : 0;
  };
  const sorted = rows.slice().sort((a, b) => {
    const ta = tier(a);
    const tb = tier(b);
    if (ta !== tb) return tb - ta;
    return b.pnlPercent - a.pnlPercent || b.pnlUsd - a.pnlUsd;
  });
  let rank = 0;
  return sorted.map((row) => {
    if (tier(row) !== 2) {
      return { ...row, rank: 0 };
    }
    rank += 1;
    return { ...row, rank };
  });
}

function normalizeCashPrize(input: unknown): CashPrize | null {
  if (input === null || input === undefined) return null;
  if (typeof input !== 'object') return null;
  const data = input as {
    currency?: unknown;
    total?: unknown;
    breakdown?: unknown;
    label?: unknown;
    imageUrl?: unknown;
    description?: unknown;
    items?: unknown;
  };
  const total = Number(data.total);
  const safeTotal = Number.isFinite(total) && total > 0 ? total : 0;
  const currency = String(data.currency || 'USD').trim().toUpperCase().slice(0, 6) || 'USD';
  const label = String(data.label || '').trim().slice(0, 80);
  const imageUrl = String(data.imageUrl || '').trim().slice(0, 5000);
  const description = String(data.description || '')
    // Normalize CRLF to LF, drop other control chars except \n.
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '')
    .trim()
    .slice(0, 1500);

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

  const items = normalizeCashPrizeItems(data.items);

  if (
    safeTotal === 0 &&
    (!breakdown || breakdown.length === 0) &&
    !label &&
    !imageUrl &&
    !description &&
    (!items || items.length === 0)
  ) {
    return null;
  }

  return {
    currency,
    total: safeTotal,
    breakdown,
    ...(label ? { label } : {}),
    ...(imageUrl ? { imageUrl } : {}),
    ...(description ? { description } : {}),
    ...(items ? { items } : {}),
  };
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
  // Anti-amplification du brute-force : nombre de renvois de code et
  // timestamp du dernier envoi (cooldown). Voir requestOtp.
  resends?: number;
  lastSentAt?: number;
  // Consentement RGPD (signup uniquement) : acceptation conditions + newsletter,
  // horodaté au moment de la soumission du formulaire.
  consent?: boolean;
  consentAt?: number;
}

const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
// Nombre maximal de participants par arène (configurable via env). Borne la
// charge WebSocket/DB et évite qu'une arène publique soit floodée.
const MAX_ARENA_PARTICIPANTS = Math.max(
  1,
  Number(process.env.MAX_ARENA_PARTICIPANTS) || 2000,
);
// Cooldown minimal entre deux envois de code pour un même email, et nombre
// maximal de renvois dans la durée de vie d'une demande. Empêche de remettre
// le compteur de tentatives à zéro en boucle pour brute-forcer l'OTP.
const OTP_RESEND_COOLDOWN_MS = 30 * 1000;
const OTP_MAX_RESENDS = 4;

function generateOtp(): string {
  // crypto.randomInt est cryptographiquement sûr (vs Math.random prédictible).
  return String(crypto.randomInt(100_000, 1_000_000));
}

export class CompetitionManager {
  private users = new Map<string, CompetitionUser>();
  private competitions = new Map<string, Competition>();
  private seasons = new Map<string, LeaderboardSeason>();
  private payouts = new Map<string, PlayerPayout>();
  // In serverless, sessions/OTPs/trader-sessions use dedicated Postgres
  // tables (one row per token/email). The maps below are only used as a
  // local fallback when no Postgres pool is configured (development mode).
  private sessions = new Map<string, string>();
  private pendingOtps = new Map<string, PendingOtp>();
  private traderSessions = new Map<string, { playerId: string; competitionId: string | null }>();
  private competitionStartingBalance = DEFAULT_COMPETITION_STARTING_BALANCE;
  private localAdminTokens = new Set<string>();
  private pool: Pool | null = null;
  readonly ready: Promise<void>;

  constructor() {
    const databaseUrl = process.env.DATABASE_URL?.trim();
    if (databaseUrl) {
      this.pool = new Pool({
        connectionString: databaseUrl,
        ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
        // Borne les connexions (auth, sessions, store compétitions). Pool le
        // plus sollicité pendant le trading des arènes online → défaut relevé.
        max: Number(process.env.PG_POOL_MAX_COMPETITION) || 12,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 10_000,
      });
      // Prevent the entire process from crashing when the Postgres pool emits
      // an asynchronous error (e.g. transient network drops on Neon).
      this.pool.on('error', (err) => {
        console.error('[competition pool] idle client error:', err.message || err);
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

  private findUserByName(name: string, exceptId?: string): CompetitionUser | null {
    const normalized = String(name || '').trim().toLowerCase();
    if (!normalized) return null;
    return Array.from(this.users.values()).find((entry) => (
      entry.id !== exceptId && (entry.name || '').trim().toLowerCase() === normalized
    )) || null;
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
  async requestOtp(input: { email: string; name?: string; phone?: string; intent: 'signup' | 'login'; consent?: boolean }): Promise<{ code: string; expiresAt: number }> {
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
      if (!input.consent) {
        throw new Error('Tu dois accepter les conditions et le consentement pour t inscrire');
      }
      if (!name) {
        throw new Error('Pseudo requis pour l inscription');
      }
      if (name.length < 2 || name.length > 32) {
        throw new Error('Pseudo invalide (2 a 32 caracteres)');
      }
      if (this.findUserByName(name)) {
        throw new Error('Ce pseudo est deja pris');
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

    // Anti-spam / anti-amplification : si une demande est déjà en cours pour
    // cet email, on impose un cooldown entre deux envois et on plafonne le
    // nombre de renvois. Sinon un attaquant pourrait redemander un code en
    // boucle pour repartir à OTP_MAX_ATTEMPTS et brute-forcer le code.
    const existing = await this.readPendingOtp(email);
    let resends = 0;
    if (existing && existing.step === 'email') {
      const now = Date.now();
      if (existing.lastSentAt && now - existing.lastSentAt < OTP_RESEND_COOLDOWN_MS) {
        const wait = Math.ceil((OTP_RESEND_COOLDOWN_MS - (now - existing.lastSentAt)) / 1000);
        throw new Error(`Patiente ${wait}s avant de redemander un code`);
      }
      resends = (existing.resends ?? 0) + 1;
      if (resends > OTP_MAX_RESENDS) {
        throw new Error('Trop de demandes de code, reessaie plus tard');
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
      resends,
      lastSentAt: Date.now(),
      ...(input.intent === 'signup'
        ? { consent: Boolean(input.consent), consentAt: Date.now() }
        : {}),
    });

    return { code, expiresAt };
  }

  /**
   * Backdoor pour le compte de test : pas de mail, pas de SMS, le user
   * tape simplement le pseudo magique dans le champ email/login. Utilisé
   * pour pouvoir tester rapidement la plateforme depuis n'importe quel
   * navigateur sans avoir à recevoir un OTP. Le pseudo est case-sensitive.
   */
  static readonly TEST_ACCOUNT_USERNAME = 'ARTEMTEST987';

  async loginTestAccount(username: string): Promise<{ token: string; user: CompetitionUser }> {
    const trimmed = String(username || '').trim();
    if (trimmed !== CompetitionManager.TEST_ACCOUNT_USERNAME) {
      throw new Error('Compte de test invalide');
    }
    const fakeEmail = `${trimmed.toLowerCase()}@test.local`;
    let user = this.findUserByEmail(fakeEmail);
    if (!user) {
      user = {
        id: crypto.randomUUID(),
        email: fakeEmail,
        name: trimmed,
        phone: null,
        phoneVerifiedAt: Date.now(),
        createdAt: Date.now(),
      };
      this.users.set(user.id, user);
      await this.persist();
    }
    const token = crypto.randomBytes(24).toString('hex');
    await this.writeSession(token, user.id);
    return { token, user };
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
    const finalName = pending.name || email.split('@')[0];
    if (this.findUserByName(finalName)) {
      throw new Error('Ce pseudo est deja pris');
    }

    const user: CompetitionUser = {
      id: crypto.randomUUID(),
      email,
      name: finalName,
      phone: pending.phone,
      phoneVerifiedAt: Date.now(),
      consent: {
        termsAccepted: Boolean(pending.consent),
        newsletter: Boolean(pending.consent),
        acceptedAt: pending.consentAt ?? Date.now(),
      },
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
    this.seasons.clear();
    this.payouts.clear();
    if (Number.isFinite(parsed.competitionStartingBalance) && (parsed.competitionStartingBalance as number) > 0) {
      this.competitionStartingBalance = parsed.competitionStartingBalance as number;
    }
    // La config des saisons (bannière, badges, dates, récompenses, thème) est
    // définie dans le code : on l'applique toujours par-dessus le store persisté.
    const defaults = buildDefaultSeasons();
    const defaultsById = new Map(defaults.map((s) => [s.id, s]));
    const hadNoSeasonsInStore = !parsed.seasons?.length;
    for (const season of defaults) this.seasons.set(season.id, season);
    for (const season of parsed.seasons || []) {
      if (!season?.id) continue;
      const def = defaultsById.get(season.id);
      this.seasons.set(season.id, def ? { ...season, ...def } : season);
    }
    for (const user of parsed.users || []) {
      this.users.set(user.id, user);
    }
    for (const payout of parsed.payouts || []) {
      if (payout && payout.id && payout.userId) this.payouts.set(payout.id, normalizePayout(payout));
    }
    for (const competition of parsed.competitions || []) {
      this.competitions.set(competition.id, {
        ...competition,
        executionMode: competition.executionMode === 'real' ? 'real' : 'paper',
      });
    }
    this.migrateCompetitionSeasonIds();
    if (hadNoSeasonsInStore) this.save();
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
      seasons: Array.from(this.seasons.values()),
      payouts: Array.from(this.payouts.values()),
      competitionStartingBalance: this.competitionStartingBalance,
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
        `select player_id, competition_id from comp_trader_sessions
         where token = $1 and created_at > now() - interval '${USER_SESSION_TTL_DAYS} days'
         limit 1`,
        [token],
      );
      const row = result.rows[0];
      if (!row) {
        void this.pool.query('delete from comp_trader_sessions where token = $1', [token]).catch(() => undefined);
        return null;
      }
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
    // Avatars stockés directement en Postgres (BYTEA) — survivent aux
    // redéploiements Railway et n'ont pas besoin d'un disk volume. Servis
    // via GET /api/avatars/:userId.
    await this.pool.query(`
      create table if not exists comp_user_avatars (
        user_id text primary key,
        mime text not null,
        data bytea not null,
        updated_at timestamptz not null default now()
      )
    `);
    // Photos de lot (PS5, BTC, etc.) gérées en admin et servies via
    // GET /api/prize-images/:id. Même approche que les avatars : durable
    // sans disk volume Railway, un seul SELECT par hit.
    await this.pool.query(`
      create table if not exists comp_prize_images (
        id text primary key,
        mime text not null,
        data bytea not null,
        created_at timestamptz not null default now()
      )
    `);
  }

  async putPrizeImage(id: string, mime: string, data: Buffer): Promise<void> {
    if (!this.pool) {
      throw new Error('Database non configurée pour stocker les images');
    }
    await this.pool.query(
      `insert into comp_prize_images (id, mime, data, created_at)
       values ($1, $2, $3, now())
       on conflict (id) do update
         set mime = excluded.mime,
             data = excluded.data,
             created_at = now()`,
      [id, mime, data],
    );
  }

  async getPrizeImage(id: string): Promise<{ mime: string; data: Buffer } | null> {
    if (!this.pool) return null;
    const result = await this.pool.query(
      'select mime, data from comp_prize_images where id = $1 limit 1',
      [id],
    );
    const row = result.rows[0];
    if (!row) return null;
    return { mime: String(row.mime), data: row.data as Buffer };
  }

  /**
   * Persiste l'image en DB et met à jour `avatarUrl` du user vers une URL
   * relative servie par GET /api/avatars/:userId. La query string `v=…`
   * casse le cache navigateur quand l'utilisateur change sa photo.
   */
  async setUserAvatarBlob(
    userId: string,
    mime: string,
    data: Buffer,
  ): Promise<CompetitionUser> {
    const user = this.users.get(userId);
    if (!user) throw new Error('Utilisateur introuvable');
    if (this.pool) {
      await this.pool.query(
        `insert into comp_user_avatars (user_id, mime, data, updated_at)
         values ($1, $2, $3, now())
         on conflict (user_id) do update
           set mime = excluded.mime,
               data = excluded.data,
               updated_at = now()`,
        [userId, mime, data],
      );
    }
    const version = Date.now();
    const avatarUrl = `/api/avatars/${userId}?v=${version}`;
    const nextUser = { ...user, avatarUrl };
    this.users.set(user.id, nextUser);
    this.save();
    return nextUser;
  }

  async getUserAvatarBlob(userId: string): Promise<{ mime: string; data: Buffer } | null> {
    if (!this.pool) return null;
    const result = await this.pool.query(
      'select mime, data from comp_user_avatars where user_id = $1 limit 1',
      [userId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return { mime: String(row.mime), data: row.data as Buffer };
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
        `select 1 from comp_admin_sessions
         where token = $1 and created_at > now() - interval '${ADMIN_SESSION_TTL_DAYS} days'
         limit 1`,
        [token],
      );
      if (result.rowCount! === 0) {
        void this.pool.query('delete from comp_admin_sessions where token = $1', [token]).catch(() => undefined);
        return false;
      }
      return true;
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
  private parseAvatarVersion(avatarUrl?: string | null): number {
    if (!avatarUrl) return 0;
    try {
      const base = 'http://local';
      const v = new URL(avatarUrl, base).searchParams.get('v');
      const parsed = v ? Number.parseInt(v, 10) : 0;
      return Number.isFinite(parsed) ? parsed : 0;
    } catch {
      return 0;
    }
  }

  /**
   * Aligne `avatarUrl` sur `comp_user_avatars.updated_at` pour éviter
   * les URLs sans `?v=` (uploads antérieurs) et la mémoire stale serverless.
   */
  private async hydrateUserAvatar(user: CompetitionUser): Promise<CompetitionUser> {
    if (!this.pool) return user;
    const result = await this.pool.query(
      'select updated_at from comp_user_avatars where user_id = $1 limit 1',
      [user.id],
    );
    const row = result.rows[0];
    if (!row) return user;

    const updatedAt = new Date(row.updated_at as string | Date).getTime();
    if (!Number.isFinite(updatedAt) || updatedAt <= 0) return user;

    const currentVersion = this.parseAvatarVersion(user.avatarUrl);
    if (currentVersion >= updatedAt) return user;

    const avatarUrl = `/api/avatars/${user.id}?v=${updatedAt}`;
    const nextUser = { ...user, avatarUrl };
    this.users.set(user.id, nextUser);
    return nextUser;
  }

  async getUserFromToken(token: string): Promise<CompetitionUser | null> {
    if (!token) return null;
    if (this.pool) {
      const result = await this.pool.query(
        `select user_id from comp_user_sessions
         where token = $1 and created_at > now() - interval '${USER_SESSION_TTL_DAYS} days'
         limit 1`,
        [token],
      );
      const userId = result.rows[0]?.user_id as string | undefined;
      if (!userId) {
        // Purge paresseuse des sessions expirées rencontrées.
        void this.pool.query('delete from comp_user_sessions where token = $1', [token]).catch(() => undefined);
        return null;
      }
      let user = this.users.get(userId) || null;
      if (!user) {
        // Le user a peut-etre ete cree par un autre Lambda (signup tres recent).
        await this.refresh();
        user = this.users.get(userId) || null;
      }
      if (!user) return null;
      return this.hydrateUserAvatar(user);
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
    if (this.findUserByName(name, user.id)) throw new Error('Ce pseudo est deja pris');

    const phone = user.phone || null;
    const phoneVerifiedAt = user.phoneVerifiedAt || null;
    if (input.phone !== undefined) {
      const nextPhone = normalizePhone(String(input.phone || ''));
      // Le numéro est vérifié par SMS à l'inscription. Comme il n'existe pas
      // (encore) de flux de re-vérification, on refuse tout changement vers un
      // numéro différent : sinon on associerait un numéro non vérifié au
      // compte, ce qui casse l'anti multi-comptes. Renvoyer le même numéro
      // est sans effet (le formulaire profil pré-remplit ce champ).
      if (phone && nextPhone && nextPhone !== phone) {
        throw new Error('Le numero de telephone ne peut pas etre modifie');
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
    registrationEndsAt?: unknown;
    dailyDrawdownPercent?: unknown;
    bannerImageUrl?: unknown;
    isPublic: boolean;
    cashPrize?: unknown;
    sponsor?: unknown;
    sponsorReferralUrl?: unknown;
    seasonId?: unknown;
  }): Competition {
    const title = String(input.title || '').trim();
    const code = normalizeCode(input.code);
    const executionMode = input.executionMode === 'real' ? 'real' : 'paper';
    const startAt = Number(input.startAt);
    const endAt = Number(input.endAt);
    let registrationEndsAt: number | null = null;
    if (input.registrationEndsAt != null && input.registrationEndsAt !== '') {
      registrationEndsAt = Number(input.registrationEndsAt);
      if (!Number.isFinite(registrationEndsAt)) throw new Error('Date fin inscriptions invalide');
    }
    const isPublic = Boolean(input.isPublic);
    const cashPrize = normalizeCashPrize(input.cashPrize);
    const sponsor = normalizeSponsor(input.sponsor);
    const sponsorReferralUrl = normalizeSponsorReferralUrl(input.sponsorReferralUrl);
    const dailyDrawdownPercent = normalizeDrawdownPercent(input.dailyDrawdownPercent);
    const bannerImageUrl = normalizeBannerImageUrl(input.bannerImageUrl);
    const seasonIdRaw = input.seasonId != null && String(input.seasonId).trim()
      ? String(input.seasonId).trim()
      : null;
    const seasonId = seasonIdRaw && this.seasons.has(seasonIdRaw)
      ? seasonIdRaw
      : this.getActiveSeason(startAt)?.id ?? this.inferSeasonIdForTimestamp(startAt) ?? null;

    if (!title) throw new Error('Titre requis');
    // Code optionnel : une arène sans code est accessible librement (pas de
    // saisie demandée au join). Si un code est fourni, il doit faire ≥ 4
    // caractères et rester unique.
    if (code) {
      if (code.length < 4) throw new Error('Code competition invalide');
      if (Array.from(this.competitions.values()).some((entry) => entry.code && entry.code === code)) {
        throw new Error('Code competition deja utilise');
      }
    }
    if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || endAt <= startAt) {
      throw new Error('Dates competition invalides');
    }
    const effectiveRegistrationEndsAt = registrationEndsAt ?? startAt;
    if (effectiveRegistrationEndsAt > startAt) {
      throw new Error('Les inscriptions doivent se terminer avant ou au debut du trading');
    }
    if (effectiveRegistrationEndsAt > endAt) {
      throw new Error('La fin des inscriptions doit etre avant la fin de l arene');
    }

    const competition: Competition = {
      id: crypto.randomUUID(),
      title,
      code,
      executionMode,
      startAt,
      endAt,
      registrationEndsAt: effectiveRegistrationEndsAt,
      dailyDrawdownPercent,
      bannerImageUrl,
      isPublic,
      createdAt: Date.now(),
      entries: [],
      cashPrize,
      sponsor,
      sponsorReferralUrl,
      seasonId,
    };

    this.competitions.set(competition.id, competition);
    this.save();
    return competition;
  }

  listAdminCompetitions(): Array<Competition & { status: CompetitionStatus; participants: number; entriesDetailed: Array<CompetitionEntry & { user: CompetitionUser | null }> }> {
    const competitions = Array.from(this.competitions.values())
      .sort((a, b) => b.createdAt - a.createdAt);

    return competitions.map((competition) => ({
      ...competition,
      status: inferCompetitionStatus(competition),
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
    registrationEndsAt: number;
    dailyDrawdownPercent: number | null;
    isPublic: boolean;
    participants: number;
    status: CompetitionStatus;
    canJoin: boolean;
    canTrade: boolean;
    cashPrize: CashPrize | null;
    sponsor: string | null;
    sponsorReferralUrl: string | null;
    bannerImageUrl: string | null;
  }> {
    const now = Date.now();
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
        registrationEndsAt: getRegistrationEndsAt(competition),
        dailyDrawdownPercent: competition.dailyDrawdownPercent ?? null,
        isPublic: competition.isPublic,
        participants: competition.entries.length,
        status: inferCompetitionStatus(competition, now),
        canJoin: canJoinCompetition(competition, now),
        canTrade: canTradeCompetition(competition, now),
        cashPrize: competition.cashPrize ?? null,
        sponsor: competition.sponsor ?? null,
        sponsorReferralUrl: competition.sponsorReferralUrl ?? null,
        bannerImageUrl: competition.bannerImageUrl ?? null,
      }));
  }

  joinCompetition(userId: string, codeInput: string, sponsorAccountIdInput?: unknown, competitionIdInput?: unknown): Competition {
    const code = normalizeCode(codeInput);
    let competition: Competition | undefined;
    if (code) {
      // Join classique par code (on n'apparie jamais sur un code vide).
      competition = Array.from(this.competitions.values()).find((entry) => entry.code && entry.code === code);
    } else {
      // Pas de code fourni → join d'une arène ouverte (sans code) via son id.
      const competitionId = String(competitionIdInput ?? '').trim();
      const found = competitionId ? this.competitions.get(competitionId) : undefined;
      // On refuse l'accès sans code à une arène protégée par un code.
      if (found && !found.code) competition = found;
      else if (found && found.code) throw new Error('Code requis');
    }
    if (!competition) throw new Error('Competition introuvable');

    // Condition d'accès sponsor : si l'arène est sponsorisée par un partenaire
    // qui exige un identifiant public (ex. Kraken), il doit être fourni.
    const sponsorDef = competition.sponsor ? SPONSOR_DEFS[competition.sponsor] : null;
    let sponsorAccountId: string | null = null;
    if (sponsorDef?.requiresAccountId) {
      const raw = String(sponsorAccountIdInput ?? '').trim();
      const cleaned =
        sponsorDef.accountIdNormalize === 'lowercase'
          ? raw.toLowerCase().slice(0, 128)
          : String(raw).replace(/\s+/g, '').toUpperCase().slice(0, 64);
      if (!cleaned) throw new Error('Identifiant sponsor requis');
      if (sponsorDef.accountIdPattern && !sponsorDef.accountIdPattern.test(cleaned)) {
        throw new Error('Identifiant sponsor invalide');
      }
      sponsorAccountId = cleaned;
    }

    const existing = competition.entries.find((entry) => entry.userId === userId);
    if (!existing && !canJoinCompetition(competition)) {
      throw new Error('Les inscriptions sont fermees pour cette arene');
    }

    if (existing) {
      // Inscrit : on permet de (re)renseigner / corriger l'identifiant sponsor.
      if (sponsorAccountId && existing.sponsorAccountId !== sponsorAccountId) {
        existing.sponsorAccountId = sponsorAccountId;
        existing.updatedAt = Date.now();
        this.competitions.set(competition.id, competition);
        this.save();
      }
      return competition;
    }

    // Plafond de participants (anti-DoS / charge WS+DB). Les inscrits déjà
    // présents peuvent toujours rejouer ; on ne refuse que les nouveaux.
    if (competition.entries.length >= MAX_ARENA_PARTICIPANTS) {
      throw new Error('Cette arene est complete');
    }
    competition.entries.push({
      userId,
      joinedAt: Date.now(),
      pnlUsd: 0,
      pnlPercent: 0,
      tradesCount: 0,
      updatedAt: Date.now(),
      ...(sponsorAccountId ? { sponsorAccountId } : {}),
    });
    this.competitions.set(competition.id, competition);
    this.save();
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
    return inferCompetitionStatus(competition);
  }

  assertCompetitionTradingOpen(competitionId: string): Competition {
    const competition = this.competitions.get(competitionId);
    if (!competition) throw new Error('Competition introuvable');
    if (!canTradeCompetition(competition)) {
      const status = inferCompetitionStatus(competition);
      if (status === 'ended') {
        throw new Error('La competition est terminee');
      }
      throw new Error('La competition n a pas encore commence');
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

  getPaperPlayerIdsForCompetition(competitionId: string): string[] {
    const competition = this.competitions.get(competitionId);
    if (!competition) return [];
    return competition.entries
      .map((entry) => entry.paperPlayerId)
      .filter((playerId): playerId is string => Boolean(playerId));
  }

  getCompetitionStartingBalance(): number {
    return this.competitionStartingBalance;
  }

  async setCompetitionStartingBalance(balance: number): Promise<void> {
    if (!Number.isFinite(balance) || balance <= 0) {
      throw new Error('Balance arène invalide');
    }
    this.competitionStartingBalance = Math.floor(balance);
    await this.persist();
  }

  /**
   * Agrégation PnL / arènes sans résolution des badges (évite la récursion
   * avec getAllUserBadges).
   */
  private listUserParticipationsCore(options?: { seasonId?: string | null }): Array<{
    userId: string;
    name: string;
    avatarUrl: string | null;
    pnlUsd: number;
    arenas: number;
    paperPlayerIds: string[];
  }> {
    const seasonId = options?.seasonId ?? null;
    const byUser = new Map<string, { pnlUsd: number; arenas: number; paperPlayerIds: string[] }>();
    for (const competition of this.competitions.values()) {
      if (isQualificationCompetition(competition.title)) continue;
      if (seasonId && competition.seasonId !== seasonId) continue;
      for (const entry of competition.entries) {
        let rec = byUser.get(entry.userId);
        if (!rec) {
          rec = { pnlUsd: 0, arenas: 0, paperPlayerIds: [] };
          byUser.set(entry.userId, rec);
        }
        rec.pnlUsd += Number(entry.pnlUsd) || 0;
        rec.arenas += 1;
        if (entry.paperPlayerId) rec.paperPlayerIds.push(entry.paperPlayerId);
      }
    }
    return Array.from(byUser.entries()).map(([userId, rec]) => {
      const user = this.users.get(userId);
      return {
        userId,
        name: user?.name || 'Participant',
        avatarUrl: user?.avatarUrl || null,
        pnlUsd: rec.pnlUsd,
        arenas: rec.arenas,
        paperPlayerIds: rec.paperPlayerIds,
      };
    });
  }

  /**
   * Regroupe toutes les participations par utilisateur pour le leaderboard
   * global : nom, avatar, total PnL (somme des entries), nombre d'arènes et
   * la liste des paperPlayerId (pour calculer winrate / RR / profit factor à
   * partir des trades dans index.ts).
   * Si `seasonId` est fourni, seules les arènes de cette saison comptent.
   */
  listUserParticipations(options?: { seasonId?: string | null }): Array<{
    userId: string;
    name: string;
    avatarUrl: string | null;
    badges: UserBadge[];
    pnlUsd: number;
    arenas: number;
    paperPlayerIds: string[];
  }> {
    const badges = this.getAllUserBadges();
    return this.listUserParticipationsCore(options).map((row) => ({
      ...row,
      badges: badges.get(row.userId) ?? [],
    }));
  }

  /** Saisons du leaderboard global, de la plus récente à la plus ancienne. */
  listSeasons(): LeaderboardSeason[] {
    return Array.from(this.seasons.values()).sort((a, b) => b.startAt - a.startAt);
  }

  getSeason(id: string): LeaderboardSeason | null {
    return this.seasons.get(String(id || '')) || null;
  }

  /** Saison marquée active, sinon celle dont la fenêtre contient `now`. */
  getActiveSeason(now = Date.now()): LeaderboardSeason | null {
    const flagged = this.listSeasons().find((s) => s.isActive);
    if (flagged) return flagged;
    return this.listSeasons().find((s) => now >= s.startAt && now <= s.endAt) || null;
  }

  /** Déduit la saison d'une arène à partir de sa date de début de trading. */
  inferSeasonIdForTimestamp(ts: number): string | null {
    if (!Number.isFinite(ts)) return null;
    for (const season of this.listSeasons()) {
      if (ts >= season.startAt && ts <= season.endAt) return season.id;
    }
    return null;
  }

  /** Attribue `seasonId` aux arènes existantes qui n'en ont pas encore. */
  private migrateCompetitionSeasonIds(): void {
    let dirty = false;
    for (const competition of this.competitions.values()) {
      if (competition.seasonId) continue;
      const inferred = this.inferSeasonIdForTimestamp(competition.startAt);
      if (!inferred) continue;
      competition.seasonId = inferred;
      this.competitions.set(competition.id, competition);
      dirty = true;
    }
    if (dirty) this.save();
  }

  private pushBadge(map: Map<string, UserBadge[]>, userId: string, badge: UserBadge): void {
    const list = map.get(userId);
    if (list) {
      if (!list.includes(badge)) list.push(badge);
    } else {
      map.set(userId, [badge]);
    }
  }

  private applySeasonLeaderboardBadges(map: Map<string, UserBadge[]>, season: LeaderboardSeason): void {
    // Les badges de saison ne sont décernés qu'une fois la saison terminée.
    if (inferSeasonStatus(season) !== 'ended') return;
    const ranked = this.listUserParticipationsCore({ seasonId: season.id })
      .filter((row) => row.arenas > 0)
      .sort((a, b) => b.pnlUsd - a.pnlUsd);
    if (ranked[0]) this.pushBadge(map, ranked[0].userId, season.championBadge);
  }

  private badgesCacheAt = 0;
  private badgesCache: Map<string, UserBadge[]> = new Map();

  /**
   * Badges par utilisateur (cf. UserBadge). Mis en cache 10s : les arènes
   * terminées ne changent plus et les leaderboards sont pollés toutes les 2s,
   * inutile de re-classer chaque arène terminée à chaque appel.
   */
  getAllUserBadges(): Map<string, UserBadge[]> {
    const now = Date.now();
    if (now - this.badgesCacheAt < 10_000) return this.badgesCache;

    const champions = new Set<string>();
    const btf2026 = new Set<string>();
    for (const competition of this.competitions.values()) {
      if (isQualificationCompetition(competition.title)) {
        for (const entry of competition.entries) btf2026.add(entry.userId);
      }
      if (inferCompetitionStatus(competition) !== 'ended') continue;
      const ranked = sortAndRankLeaderboard(competition.entries.slice());
      const winner = ranked.find((entry) => entry.rank === 1);
      if (winner) champions.add(winner.userId);
    }

    const map = new Map<string, UserBadge[]>();
    // Vainqueurs Paris en premier (badge le plus prestigieux).
    for (const userId of PARIS_CHAMPION_USER_IDS) map.set(userId, ['paris-champion']);
    for (const userId of champions) {
      const list = map.get(userId);
      if (list) list.push('champion');
      else map.set(userId, ['champion']);
    }
    for (const userId of btf2026) {
      const list = map.get(userId);
      if (list) list.push('btf2026');
      else map.set(userId, ['btf2026']);
    }
    for (const season of this.listSeasons()) {
      this.applySeasonLeaderboardBadges(map, season);
    }
    this.badgesCache = map;
    this.badgesCacheAt = now;
    return map;
  }

  getUserBadges(userId: string): UserBadge[] {
    return this.getAllUserBadges().get(userId) ?? [];
  }

  /** Total PnL (somme des entries) d'un user, tous arènes confondues. */
  getUserTotalPnl(userId: string): number {
    let total = 0;
    for (const competition of this.competitions.values()) {
      for (const entry of competition.entries) {
        if (entry.userId === userId) total += Number(entry.pnlUsd) || 0;
      }
    }
    return total;
  }

  /** Tous les paperPlayerId associés à un user (1 par compétition rejointe). */
  getPaperPlayerIdsForUser(userId: string): string[] {
    const out: string[] = [];
    for (const competition of this.competitions.values()) {
      for (const entry of competition.entries) {
        if (entry.userId === userId && entry.paperPlayerId) {
          out.push(entry.paperPlayerId);
        }
      }
    }
    return out;
  }

  /**
   * Comme getPaperPlayerIdsForUser mais en excluant les arènes de
   * qualification — utilisé pour les stats du profil (winrate, RR, profit
   * factor) afin de ne pas compter la BTF Qualification.
   */
  getPaperPlayerIdsForUserStats(userId: string): string[] {
    const out: string[] = [];
    for (const competition of this.competitions.values()) {
      if (isQualificationCompetition(competition.title)) continue;
      for (const entry of competition.entries) {
        if (entry.userId === userId && entry.paperPlayerId) {
          out.push(entry.paperPlayerId);
        }
      }
    }
    return out;
  }

  /**
   * Paper players d'un user avec l'arène associée (hors qualification) —
   * utilisé par le journal de trades pour rattacher chaque trade à son arène.
   */
  listUserArenaPlayers(userId: string): Array<{
    paperPlayerId: string;
    competitionId: string;
    competitionTitle: string;
  }> {
    const out: Array<{ paperPlayerId: string; competitionId: string; competitionTitle: string }> = [];
    for (const competition of this.competitions.values()) {
      if (isQualificationCompetition(competition.title)) continue;
      for (const entry of competition.entries) {
        if (entry.userId === userId && entry.paperPlayerId) {
          out.push({
            paperPlayerId: entry.paperPlayerId,
            competitionId: competition.id,
            competitionTitle: competition.title,
          });
        }
      }
    }
    return out;
  }

  getCompetitionsNeedingFinalization(now = Date.now()): Array<{ competitionId: string; paperPlayerIds: string[] }> {
    return Array.from(this.competitions.values())
      .filter((competition) => (
        !competition.finalizedAt
        && inferCompetitionStatus(competition, now) === 'ended'
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
      if (inferCompetitionStatus(competition, now) !== 'ended') continue;
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
    result: { pnlUsd: number; pnlPercent: number; tradesCount: number; equity?: number },
  ): { newlyBreached: boolean; competitionId: string } | null {
    let changed = false;
    let breachResult: { newlyBreached: boolean; competitionId: string } | null = null;
    const now = Date.now();
    for (const competition of this.competitions.values()) {
      if (competition.finalizedAt) continue;
      const entry = competition.entries.find((item) => item.paperPlayerId === paperPlayerId);
      if (!entry) continue;

      entry.pnlUsd = Number(result.pnlUsd) || 0;
      entry.pnlPercent = Number(result.pnlPercent) || 0;
      entry.tradesCount = Math.max(0, Math.floor(Number(result.tradesCount) || 0));
      entry.updatedAt = now;
      changed = true;

      // Règle de drawdown journalier : on n'évalue que pendant le live, avec
      // une équité finie. La baseline se recapture au 1er échantillon du jour UTC.
      const ddPercent = competition.dailyDrawdownPercent;
      const equity = Number(result.equity);
      if (ddPercent && ddPercent > 0 && Number.isFinite(equity)
        && inferCompetitionStatus(competition, now) === 'live') {
        const dayKey = utcDayKey(now);
        if (entry.dailyBaselineDayKey !== dayKey || entry.dailyBaselineEquity == null) {
          entry.dailyBaselineDayKey = dayKey;
          entry.dailyBaselineEquity = equity;
        }
        if (!entry.breachedAt && entry.dailyBaselineEquity != null) {
          const limit = entry.dailyBaselineEquity * (1 - ddPercent / 100);
          if (equity <= limit) {
            entry.breachedAt = now;
            breachResult = { newlyBreached: true, competitionId: competition.id };
          }
        }
      }
    }

    if (changed) this.save();
    return breachResult;
  }

  /** Le joueur (paperPlayerId) est-il éliminé (drawdown atteint) sur cette arène ? */
  isPaperPlayerBreached(competitionId: string, paperPlayerId: string): boolean {
    const competition = this.competitions.get(competitionId);
    if (!competition) return false;
    const entry = competition.entries.find((item) => item.paperPlayerId === paperPlayerId);
    return Boolean(entry?.breachedAt);
  }

  listUserCompetitions(userId: string): Array<{
    id: string;
    title: string;
    code: string;
    executionMode: 'paper' | 'real';
    startAt: number;
    endAt: number;
    status: CompetitionStatus;
    registrationEndsAt: number;
    dailyDrawdownPercent: number | null;
    canJoin: boolean;
    canTrade: boolean;
    myEntry: CompetitionEntry;
    breached: boolean;
    cashPrize: CashPrize | null;
    participants: number;
    rank: number | null;
    sponsor: string | null;
    sponsorReferralUrl: string | null;
    bannerImageUrl: string | null;
  }> {
    return Array.from(this.competitions.values())
      .filter((competition) => competition.entries.some((entry) => entry.userId === userId))
      .map((competition) => {
        const myEntry = competition.entries.find((entry) => entry.userId === userId)!;
        const ranked = sortAndRankLeaderboard(competition.entries.slice());
        const myRanked = ranked.find((entry) => entry.userId === userId);
        const now = Date.now();
        return {
          id: competition.id,
          title: competition.title,
          code: competition.code,
          executionMode: competition.executionMode,
          startAt: competition.startAt,
          endAt: competition.endAt,
          registrationEndsAt: getRegistrationEndsAt(competition),
          dailyDrawdownPercent: competition.dailyDrawdownPercent ?? null,
          status: inferCompetitionStatus(competition, now),
          canJoin: canJoinCompetition(competition, now),
          canTrade: canTradeCompetition(competition, now),
          myEntry,
          breached: Boolean(myEntry.breachedAt),
          cashPrize: competition.cashPrize ?? null,
          participants: competition.entries.length,
          // rank 0 = pas classé (aucun trade) → null côté client.
          rank: myRanked && myRanked.rank > 0 ? myRanked.rank : null,
          sponsor: competition.sponsor ?? null,
          sponsorReferralUrl: competition.sponsorReferralUrl ?? null,
          bannerImageUrl: competition.bannerImageUrl ?? null,
        };
      })
      .sort((a, b) => b.startAt - a.startAt);
  }

  // ---------------------------------------------------------------------------
  // Payouts (certificats de gains, gérés par l'admin)
  // ---------------------------------------------------------------------------

  /** Recherche de joueurs (admin) par nom ou email, pour attribuer un payout. */
  searchUsers(query: string, limit = 20): Array<{ id: string; name: string; email: string; avatarUrl: string | null }> {
    const q = String(query || '').trim().toLowerCase();
    const all = Array.from(this.users.values());
    const matched = q
      ? all.filter(
          (u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || u.id.toLowerCase() === q,
        )
      : all;
    return matched
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, Math.max(1, Math.min(100, limit)))
      .map((u) => ({ id: u.id, name: u.name, email: u.email, avatarUrl: u.avatarUrl || null }));
  }

  /** Payouts d'un joueur, du plus récent au plus ancien. */
  listPayoutsForUser(userId: string): PlayerPayout[] {
    return Array.from(this.payouts.values())
      .filter((p) => p.userId === userId)
      .map(normalizePayout)
      .sort((a, b) => b.paidAt - a.paidAt);
  }

  /** Payouts d'un joueur enrichis du titre d'arène. */
  listPayoutsForUserDetailed(userId: string): Array<PlayerPayout & { arenaTitle: string | null }> {
    return this.listPayoutsForUser(userId).map((p) => {
      const arena = p.competitionId ? this.competitions.get(p.competitionId) : null;
      return { ...p, arenaTitle: arena?.title || null };
    });
  }

  getPayoutById(id: string): PlayerPayout | null {
    const payout = this.payouts.get(String(id || ''));
    return payout ? normalizePayout(payout) : null;
  }

  requestPayout(payoutId: string, userId: string, erc20Address: string): PlayerPayout {
    const payout = this.payouts.get(String(payoutId || ''));
    if (!payout) throw new Error('Payout introuvable');
    if (payout.userId !== userId) throw new Error('Accès refusé');
    const status = payout.status || 'available';
    if (status !== 'available') throw new Error('Cette demande a déjà été soumise');
    const addr = String(erc20Address || '').trim();
    if (!isValidErc20Address(addr)) throw new Error('Adresse ERC20 invalide (format 0x… requis)');
    const updated: PlayerPayout = {
      ...normalizePayout(payout),
      status: 'pending',
      erc20Address: addr,
      requestedAt: Date.now(),
    };
    this.payouts.set(updated.id, updated);
    this.save();
    return updated;
  }

  approvePayout(payoutId: string): PlayerPayout & { userName: string; userEmail: string; arenaTitle: string | null } {
    const payout = this.payouts.get(String(payoutId || ''));
    if (!payout) throw new Error('Payout introuvable');
    const status = payout.status || 'available';
    if (status !== 'pending') throw new Error('Seules les demandes en attente peuvent être approuvées');
    const updated: PlayerPayout = {
      ...normalizePayout(payout),
      status: 'approved',
      approvedAt: Date.now(),
    };
    this.payouts.set(updated.id, updated);
    this.save();
    const user = this.users.get(updated.userId);
    const arena = updated.competitionId ? this.competitions.get(updated.competitionId) : null;
    return {
      ...updated,
      userName: user?.name || '—',
      userEmail: user?.email || '',
      arenaTitle: arena?.title || null,
    };
  }

  /** Demandes de payout soumises (pending ou approved), pour l'admin. */
  listPayoutRequests(): Array<PlayerPayout & { userName: string; userEmail: string; arenaTitle: string | null }> {
    return Array.from(this.payouts.values())
      .map(normalizePayout)
      .filter((p) => p.status === 'pending' || p.status === 'approved')
      .sort((a, b) => {
        const pendingFirst = (s: PayoutStatus | undefined) => (s === 'pending' ? 0 : 1);
        const byStatus = pendingFirst(a.status) - pendingFirst(b.status);
        if (byStatus !== 0) return byStatus;
        return (b.requestedAt || 0) - (a.requestedAt || 0);
      })
      .map((p) => {
        const user = this.users.get(p.userId);
        const arena = p.competitionId ? this.competitions.get(p.competitionId) : null;
        return {
          ...p,
          userName: user?.name || '—',
          userEmail: user?.email || '',
          arenaTitle: arena?.title || null,
        };
      });
  }

  /** Tous les payouts (admin), enrichis du nom/email du joueur et de l'arène. */
  listAllPayouts(): Array<PlayerPayout & { userName: string; userEmail: string; arenaTitle: string | null }> {
    return Array.from(this.payouts.values())
      .sort((a, b) => b.paidAt - a.paidAt)
      .map((p) => {
        const user = this.users.get(p.userId);
        const arena = p.competitionId ? this.competitions.get(p.competitionId) : null;
        return {
          ...p,
          userName: user?.name || '—',
          userEmail: user?.email || '',
          arenaTitle: arena?.title || null,
        };
      });
  }

  createPayout(input: { userId: string; amount: number; currency?: string; paidAt?: number }): PlayerPayout {
    const user = this.users.get(String(input.userId || ''));
    if (!user) throw new Error('Joueur introuvable');
    const amount = Number(input.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('Montant invalide');
    const currency = String(input.currency || 'USD').trim().toUpperCase().slice(0, 6) || 'USD';
    const paidAt = Number.isFinite(input.paidAt) && (input.paidAt as number) > 0 ? (input.paidAt as number) : Date.now();
    const payout: PlayerPayout = {
      id: crypto.randomUUID(),
      userId: user.id,
      amount: Math.round(amount * 100) / 100,
      currency,
      paidAt,
      createdAt: Date.now(),
      source: 'manual',
      status: 'available',
    };
    this.payouts.set(payout.id, payout);
    this.save();
    return payout;
  }

  deletePayout(id: string): boolean {
    const existed = this.payouts.delete(String(id || ''));
    if (existed) this.save();
    return existed;
  }

  /**
   * Arènes terminées dont les payouts des gagnants n'ont pas encore été
   * générés (couvre aussi celles finalisées avant l'arrivée de cette feature).
   */
  getCompetitionsNeedingPayouts(now = Date.now()): string[] {
    const ids: string[] = [];
    for (const competition of this.competitions.values()) {
      if (competition.payoutsGeneratedAt) continue;
      if (inferCompetitionStatus(competition, now) !== 'ended') continue;
      ids.push(competition.id);
    }
    return ids;
  }

  /**
   * Génère automatiquement les payouts des gagnants d'une arène terminée à
   * partir du prize table (`cashPrize.breakdown`). Le gagnant de chaque place
   * récompensée reçoit un certificat. Idempotent via `payoutsGeneratedAt`.
   * À défaut de breakdown, un total seul récompense le 1er.
   */
  generateCompetitionPayouts(competitionId: string): PlayerPayout[] {
    const competition = this.competitions.get(competitionId);
    if (!competition) return [];
    if (competition.payoutsGeneratedAt) return [];
    if (inferCompetitionStatus(competition) !== 'ended') return [];

    const currency = competition.cashPrize?.currency || 'USD';
    const paidAt = competition.endAt || Date.now();
    const created: PlayerPayout[] = [];

    // Prix par place : breakdown explicite, sinon repli sur le total → 1er.
    const breakdown = competition.cashPrize?.breakdown;
    const tiers: CashPrizeBreakdownEntry[] =
      breakdown && breakdown.length > 0
        ? breakdown
        : competition.cashPrize && competition.cashPrize.total > 0
          ? [{ rank: 1, amount: competition.cashPrize.total }]
          : [];

    if (tiers.length > 0) {
      const ranked = sortAndRankLeaderboard(competition.entries.slice());
      for (const { rank, amount } of tiers) {
        if (!Number.isFinite(amount) || amount <= 0) continue;
        // Seuls les joueurs réellement classés (ont tradé, non éliminés) gagnent.
        const winner = ranked.find((entry) => entry.rank === rank);
        if (!winner) continue;
        const payout: PlayerPayout = {
          id: crypto.randomUUID(),
          userId: winner.userId,
          amount: Math.round(amount * 100) / 100,
          currency,
          paidAt,
          createdAt: Date.now(),
          competitionId: competition.id,
          rank,
          source: 'auto',
          status: 'available',
        };
        this.payouts.set(payout.id, payout);
        created.push(payout);
      }
    }

    competition.payoutsGeneratedAt = Date.now();
    this.competitions.set(competition.id, competition);
    this.save();
    return created;
  }

  /**
   * Profil public d'un joueur : infos non sensibles (jamais d'email/téléphone),
   * badges, et historique des arènes PUBLIQUES auxquelles il a participé.
   * Les stats de trading sont calculées dans index.ts à partir de
   * paperPlayerIds (arènes hors qualification, comme le leaderboard global).
   */
  getPublicPlayerProfile(userId: string): {
    user: {
      id: string;
      name: string;
      avatarUrl: string | null;
      socials: { x?: string; instagram?: string; discord?: string; website?: string };
    };
    badges: UserBadge[];
    totalPnlUsd: number;
    paperPlayerIds: string[];
    payouts: Array<{ id: string; amount: number; currency: string; paidAt: number }>;
    arenas: Array<{
      id: string;
      title: string;
      status: CompetitionStatus;
      startAt: number;
      endAt: number;
      participants: number;
      rank: number | null;
      pnlUsd: number;
      pnlPercent: number;
      tradesCount: number;
    }>;
  } | null {
    const user = this.users.get(userId);
    if (!user) return null;

    let totalPnlUsd = 0;
    const paperPlayerIds: string[] = [];
    const arenas: Array<{
      id: string;
      title: string;
      status: CompetitionStatus;
      startAt: number;
      endAt: number;
      participants: number;
      rank: number | null;
      pnlUsd: number;
      pnlPercent: number;
      tradesCount: number;
    }> = [];

    for (const competition of this.competitions.values()) {
      const entry = competition.entries.find((item) => item.userId === userId);
      if (!entry) continue;
      const isQualif = isQualificationCompetition(competition.title);
      if (!isQualif) {
        totalPnlUsd += Number(entry.pnlUsd) || 0;
        if (entry.paperPlayerId) paperPlayerIds.push(entry.paperPlayerId);
      }
      // Seules les arènes publiques apparaissent dans l'historique consultable.
      if (!competition.isPublic) continue;
      const ranked = sortAndRankLeaderboard(competition.entries.slice());
      const myRanked = ranked.find((item) => item.userId === userId);
      arenas.push({
        id: competition.id,
        title: competition.title,
        status: inferCompetitionStatus(competition),
        startAt: competition.startAt,
        endAt: competition.endAt,
        participants: competition.entries.length,
        rank: myRanked && myRanked.rank > 0 ? myRanked.rank : null,
        pnlUsd: Number(entry.pnlUsd) || 0,
        pnlPercent: Number(entry.pnlPercent) || 0,
        tradesCount: Math.max(0, Math.floor(Number(entry.tradesCount) || 0)),
      });
    }
    arenas.sort((a, b) => b.startAt - a.startAt);

    return {
      user: {
        id: user.id,
        name: user.name,
        avatarUrl: user.avatarUrl || null,
        socials: {
          x: user.socials?.x,
          instagram: user.socials?.instagram,
          discord: user.socials?.discord,
          website: user.socials?.website,
        },
      },
      badges: this.getUserBadges(userId),
      totalPnlUsd,
      paperPlayerIds,
      payouts: this.listPayoutsForUser(userId).map((p) => ({
        id: p.id,
        amount: p.amount,
        currency: p.currency,
        paidAt: p.paidAt,
      })),
      arenas,
    };
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
    registrationEndsAt: number | null;
    dailyDrawdownPercent: number | null;
    bannerImageUrl: unknown;
    isPublic: boolean;
    cashPrize: unknown;
    sponsor: unknown;
    sponsorReferralUrl: unknown;
    seasonId: unknown;
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
      // Code vide autorisé → arène ouverte (sans saisie de code au join).
      if (code) {
        if (code.length < 4) throw new Error('Code competition invalide');
        const taken = Array.from(this.competitions.values())
          .some((entry) => entry.id !== id && entry.code && entry.code === code);
        if (taken) throw new Error('Code competition deja utilise');
      }
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
    let nextRegistrationEndsAt = patch.registrationEndsAt !== undefined
      ? (patch.registrationEndsAt == null ? nextStart : Number(patch.registrationEndsAt))
      : getRegistrationEndsAt(competition);
    if (!Number.isFinite(nextRegistrationEndsAt)) {
      throw new Error('Date fin inscriptions invalide');
    }
    if (nextRegistrationEndsAt > nextStart) {
      throw new Error('Les inscriptions doivent se terminer avant ou au debut du trading');
    }
    if (nextRegistrationEndsAt > nextEnd) {
      throw new Error('La fin des inscriptions doit etre avant la fin de l arene');
    }
    competition.startAt = nextStart;
    competition.endAt = nextEnd;
    competition.registrationEndsAt = nextRegistrationEndsAt;

    if (patch.dailyDrawdownPercent !== undefined) {
      competition.dailyDrawdownPercent = normalizeDrawdownPercent(patch.dailyDrawdownPercent);
    }

    if (patch.bannerImageUrl !== undefined) {
      competition.bannerImageUrl = normalizeBannerImageUrl(patch.bannerImageUrl);
    }

    if (patch.isPublic !== undefined) {
      competition.isPublic = Boolean(patch.isPublic);
    }

    if (patch.cashPrize !== undefined) {
      competition.cashPrize = normalizeCashPrize(patch.cashPrize);
    }

    if (patch.sponsor !== undefined) {
      competition.sponsor = normalizeSponsor(patch.sponsor);
    }

    if (patch.sponsorReferralUrl !== undefined) {
      competition.sponsorReferralUrl = normalizeSponsorReferralUrl(patch.sponsorReferralUrl);
    }

    if (patch.seasonId !== undefined) {
      const raw = patch.seasonId == null || patch.seasonId === '' ? null : String(patch.seasonId).trim();
      if (raw && !this.seasons.has(raw)) throw new Error('Saison introuvable');
      competition.seasonId = raw;
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
    // Une fois la compétition finalisée, les résultats sont figés : on
    // interdit toute réécriture (même côté admin) pour préserver l'intégrité
    // du classement officiel.
    if (competition.finalizedAt) {
      throw new Error('Competition finalisee : resultats verrouilles');
    }

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
      registrationEndsAt: number;
      status: CompetitionStatus;
      canJoin: boolean;
      canTrade: boolean;
      participants: number;
      cashPrize: CashPrize | null;
      dailyDrawdownPercent: number | null;
    };
    rank: number | null;
    userId: string | null;
    pnlPercent: number;
    pnlUsd: number;
    tradesCount: number;
    breached: boolean;
    breachedAt: number | null;
    dailyBaselineEquity: number | null;
    dailyLimitEquity: number | null;
  } | null {
    const competition = this.competitions.get(competitionId);
    if (!competition) return null;

    const ranked = sortAndRankLeaderboard(competition.entries.slice());
    const myEntry = ranked.find((entry) => entry.paperPlayerId === paperPlayerId) ?? null;

    const ddPercent = competition.dailyDrawdownPercent ?? null;
    const baseline = myEntry?.dailyBaselineEquity ?? null;
    const dailyLimitEquity = ddPercent && baseline != null
      ? baseline * (1 - ddPercent / 100)
      : null;

    const now = Date.now();
    return {
      competition: {
        id: competition.id,
        title: competition.title,
        code: competition.code,
        executionMode: competition.executionMode,
        startAt: competition.startAt,
        endAt: competition.endAt,
        registrationEndsAt: getRegistrationEndsAt(competition),
        status: inferCompetitionStatus(competition, now),
        canJoin: canJoinCompetition(competition, now),
        canTrade: canTradeCompetition(competition, now),
        participants: competition.entries.length,
        cashPrize: competition.cashPrize ?? null,
        dailyDrawdownPercent: ddPercent,
      },
      // rank null = pas (encore) classé (aucun trade).
      rank: myEntry && myEntry.rank > 0 ? myEntry.rank : null,
      userId: myEntry?.userId ?? null,
      pnlPercent: myEntry?.pnlPercent ?? 0,
      pnlUsd: myEntry?.pnlUsd ?? 0,
      tradesCount: myEntry?.tradesCount ?? 0,
      breached: Boolean(myEntry?.breachedAt),
      breachedAt: myEntry?.breachedAt ?? null,
      dailyBaselineEquity: baseline,
      dailyLimitEquity,
    };
  }

  /**
   * Vue minimale des compétitions pour le moteur de notifications email
   * (départ imminent, podium perdu, résultats de fin).
   */
  listCompetitionsForNotifier(): Array<{
    id: string;
    title: string;
    startAt: number;
    endAt: number;
    status: CompetitionStatus;
    entriesCount: number;
    isPublic: boolean;
    createdAt: number;
    notifiedStartSoonAt: number | null;
    notifiedEndedAt: number | null;
    notifiedNewArenaAt: number | null;
  }> {
    return Array.from(this.competitions.values()).map((competition) => ({
      id: competition.id,
      title: competition.title,
      startAt: competition.startAt,
      endAt: competition.endAt,
      status: inferCompetitionStatus(competition),
      entriesCount: competition.entries.length,
      isPublic: competition.isPublic,
      createdAt: competition.createdAt,
      notifiedStartSoonAt: competition.notifiedStartSoonAt ?? null,
      notifiedEndedAt: competition.notifiedEndedAt ?? null,
      notifiedNewArenaAt: competition.notifiedNewArenaAt ?? null,
    }));
  }

  /** Dotation d'une arène (cash + lots), pour déterminer les gagnants à la fin. */
  getCompetitionCashPrize(competitionId: string): CashPrize | null {
    return this.competitions.get(competitionId)?.cashPrize ?? null;
  }

  /** Marque une notification comme envoyée (persisté, anti-doublon). */
  markCompetitionNotified(competitionId: string, kind: 'startSoon' | 'ended' | 'newArena'): void {
    const competition = this.competitions.get(competitionId);
    if (!competition) return;
    if (kind === 'startSoon') competition.notifiedStartSoonAt = Date.now();
    else if (kind === 'ended') competition.notifiedEndedAt = Date.now();
    else competition.notifiedNewArenaAt = Date.now();
    this.competitions.set(competition.id, competition);
    this.save();
  }

  /**
   * Marque sans envoyer les notifications d'arène encore en attente (arènes
   * déjà terminées / live). Évite de rejouer un blast historique au redémarrage
   * quand on réactive les emails en mode test filtré.
   */
  skipPendingHistoricalArenaNotifications(now = Date.now()): number {
    let skipped = 0;
    for (const competition of this.competitions.values()) {
      const status = inferCompetitionStatus(competition, now);
      let dirty = false;

      if (!competition.notifiedEndedAt && status === 'ended') {
        competition.notifiedEndedAt = now;
        dirty = true;
        skipped += 1;
      }
      if (!competition.notifiedStartSoonAt && (status === 'live' || status === 'ended')) {
        competition.notifiedStartSoonAt = now;
        dirty = true;
      }
      if (!competition.notifiedNewArenaAt && status === 'ended') {
        competition.notifiedNewArenaAt = now;
        dirty = true;
      }

      if (dirty) this.competitions.set(competition.id, competition);
    }
    if (skipped > 0) this.save();
    return skipped;
  }

  /**
   * Détails d'une arène + liste de diffusion pour l'email « nouvelle arène
   * disponible ». On notifie tous les utilisateurs inscrits sur la plateforme,
   * sauf ceux déjà inscrits à cette arène (inutile de les inviter).
   */
  /** Statistiques runtime pour le monitoring admin (lecture seule). */
  getRuntimeStats(): {
    users: number;
    competitions: number;
    liveCompetitions: number;
    pool: { max: number | null; total: number; idle: number; waiting: number } | null;
  } {
    let liveCompetitions = 0;
    const now = Date.now();
    for (const c of this.competitions.values()) {
      if (inferCompetitionStatus(c, now) === 'live') liveCompetitions += 1;
    }
    return {
      users: this.users.size,
      competitions: this.competitions.size,
      liveCompetitions,
      pool: this.pool
        ? {
            max: (this.pool.options?.max as number) ?? null,
            total: this.pool.totalCount,
            idle: this.pool.idleCount,
            waiting: this.pool.waitingCount,
          }
        : null,
    };
  }

  getNewArenaPayload(competitionId: string): {
    title: string;
    startAt: number;
    endAt: number;
    cashPrize: CashPrize | null;
    sponsor: string | null;
    recipients: Array<{ name: string; email: string }>;
  } | null {
    const competition = this.competitions.get(competitionId);
    if (!competition) return null;
    const alreadyIn = new Set(competition.entries.map((entry) => entry.userId));
    const recipients: Array<{ name: string; email: string }> = [];
    for (const user of this.users.values()) {
      if (alreadyIn.has(user.id)) continue;
      if (!user.email) continue;
      recipients.push({ name: user.name || 'Trader', email: user.email });
    }
    return {
      title: competition.title,
      startAt: competition.startAt,
      endAt: competition.endAt,
      cashPrize: competition.cashPrize ?? null,
      sponsor: competition.sponsor ?? null,
      recipients,
    };
  }

  /**
   * Classement courant avec emails — utilisé par le notifier pour les emails
   * de podium et de résultats. Ne vérifie pas isPublic (notifie aussi les
   * arènes privées).
   */
  getRankedEntriesForNotifier(competitionId: string): Array<{
    rank: number;
    userId: string;
    name: string;
    email: string;
    pnlUsd: number;
    pnlPercent: number;
    tradesCount: number;
  }> {
    const competition = this.competitions.get(competitionId);
    if (!competition) return [];
    return sortAndRankLeaderboard(
      competition.entries.map((entry) => {
        const user = this.users.get(entry.userId);
        return {
          userId: entry.userId,
          name: user?.name || 'Participant',
          email: user?.email || '',
          pnlPercent: entry.pnlPercent,
          pnlUsd: entry.pnlUsd,
          tradesCount: entry.tradesCount,
        };
      }),
    );
  }

  getPublicLeaderboard(competitionId: string): {
    competition: {
      id: string;
      title: string;
      startAt: number;
      endAt: number;
      registrationEndsAt: number;
      status: CompetitionStatus;
      canJoin: boolean;
      canTrade: boolean;
      participants: number;
      cashPrize: CashPrize | null;
      sponsor: string | null;
      sponsorReferralUrl: string | null;
      bannerImageUrl: string | null;
    };
    leaderboard: Array<{
      rank: number;
      userId: string;
      name: string;
      avatarUrl: string | null;
      badges: UserBadge[];
      pnlPercent: number;
      pnlUsd: number;
      tradesCount: number;
      updatedAt: number;
      breached: boolean;
    }>;
  } {
    const competition = this.competitions.get(competitionId);
    if (!competition || !competition.isPublic) throw new Error('Leaderboard introuvable');

    const badges = this.getAllUserBadges();
    const leaderboard = sortAndRankLeaderboard(
      competition.entries.map((entry) => {
        const user = this.users.get(entry.userId);
        return {
          userId: entry.userId,
          name: user?.name || 'Participant',
          avatarUrl: user?.avatarUrl || null,
          badges: badges.get(entry.userId) ?? [],
          pnlPercent: entry.pnlPercent,
          pnlUsd: entry.pnlUsd,
          tradesCount: entry.tradesCount,
          updatedAt: entry.updatedAt,
          breached: Boolean(entry.breachedAt),
        };
      }),
    );

    const now = Date.now();
    return {
      competition: {
        id: competition.id,
        title: competition.title,
        startAt: competition.startAt,
        endAt: competition.endAt,
        registrationEndsAt: getRegistrationEndsAt(competition),
        status: inferCompetitionStatus(competition, now),
        canJoin: canJoinCompetition(competition, now),
        canTrade: canTradeCompetition(competition, now),
        participants: competition.entries.length,
        cashPrize: competition.cashPrize ?? null,
        sponsor: competition.sponsor ?? null,
        sponsorReferralUrl: competition.sponsorReferralUrl ?? null,
        bannerImageUrl: competition.bannerImageUrl ?? null,
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
      registrationEndsAt: number;
      status: CompetitionStatus;
      canJoin: boolean;
      canTrade: boolean;
      participants: number;
      cashPrize: CashPrize | null;
    };
    leaderboard: Array<{
      rank: number;
      userId: string;
      name: string;
      avatarUrl: string | null;
      badges: UserBadge[];
      pnlPercent: number;
      pnlUsd: number;
      tradesCount: number;
      updatedAt: number;
      breached: boolean;
    }>;
  } | null {
    const competition = this.competitions.get(competitionId);
    if (!competition) return null;

    const badges = this.getAllUserBadges();
    const leaderboard = sortAndRankLeaderboard(
      competition.entries.map((entry) => {
        const user = this.users.get(entry.userId);
        return {
          userId: entry.userId,
          name: user?.name || 'Participant',
          avatarUrl: user?.avatarUrl || null,
          badges: badges.get(entry.userId) ?? [],
          pnlPercent: entry.pnlPercent,
          pnlUsd: entry.pnlUsd,
          tradesCount: entry.tradesCount,
          updatedAt: entry.updatedAt,
          breached: Boolean(entry.breachedAt),
        };
      }),
    );

    const now = Date.now();
    return {
      competition: {
        id: competition.id,
        title: competition.title,
        code: competition.code,
        startAt: competition.startAt,
        endAt: competition.endAt,
        registrationEndsAt: getRegistrationEndsAt(competition),
        status: inferCompetitionStatus(competition, now),
        canJoin: canJoinCompetition(competition, now),
        canTrade: canTradeCompetition(competition, now),
        participants: competition.entries.length,
        cashPrize: competition.cashPrize ?? null,
      },
      leaderboard,
    };
  }
}
