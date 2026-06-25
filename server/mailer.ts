import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Resend } from 'resend';
import {
  getEmailSettingsCached,
  resolveEmailText,
  logEmail,
  type EmailKind,
  type EmailSettings,
} from './emailSettingsStore.js';

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'BTF Trade <onboarding@resend.dev>';
const APP_NAME = process.env.APP_NAME || 'BTF Trade';

// Mode test filtré : si défini, seuls les emails destinés aux comptes listés
// dans MAIL_TEST_ONLY_RECIPIENTS (défaut : artemtest987@test.local) sont
// relayés vers cette adresse. Tous les autres destinataires sont bloqués.
// Vider cette variable pour repasser en envoi réel à tous les users.
const TEST_REDIRECT_EMAIL = (process.env.MAIL_TEST_REDIRECT || '').trim();
const TEST_FILTER_RECIPIENTS = new Set(
  (process.env.MAIL_TEST_ONLY_RECIPIENTS || 'artemtest987@test.local')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
);

// Bannière BTF Arena intégrée en pièce jointe inline (CID) en haut de TOUS les
// emails. On l'embarque en CID plutôt qu'en URL pour qu'elle s'affiche même
// sans hébergement public et qu'elle échappe au re-thème de Gmail (une image
// n'est jamais recolorée). Chargée une seule fois et mise en cache.
const EMAIL_BANNER_CID = 'btf-arena-banner';
let emailBannerCache: Buffer | null | undefined;

function getEmailBanner(): Buffer | null {
  if (emailBannerCache !== undefined) return emailBannerCache;
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    emailBannerCache = readFileSync(join(here, 'assets', 'email-banner.png'));
  } catch (err) {
    console.warn('[mailer] bannière email introuvable, repli sur en-tête texte:', (err as Error)?.message);
    emailBannerCache = null;
  }
  return emailBannerCache;
}

/** Pièce jointe inline (CID) de la bannière, à fusionner dans les options Resend. */
function bannerAttachments(): { attachments: Array<{ filename: string; content: Buffer; contentId: string; contentType: string }> } | Record<string, never> {
  const banner = getEmailBanner();
  if (!banner) return {};
  return {
    attachments: [
      {
        filename: 'btf-arena-banner.png',
        content: banner,
        contentId: EMAIL_BANNER_CID,
        contentType: 'image/png',
      },
    ],
  };
}

/** Ligne <tr> contenant la bannière, à insérer en première ligne de la carte email. */
function bannerRowHtml(): string {
  const banner = getEmailBanner();
  if (!banner) {
    return `<tr><td bgcolor="#e11d2a" style="background-color:#e11d2a;height:5px;font-size:0;line-height:0;">&nbsp;</td></tr>`;
  }
  return `<tr><td bgcolor="#000000" style="background-color:#000000;font-size:0;line-height:0;">
    <img src="cid:${EMAIL_BANNER_CID}" width="600" alt="BTF Arena" style="display:block;width:100%;max-width:600px;height:auto;border:0;outline:none;text-decoration:none;" />
  </td></tr>`;
}

const client = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

if (!client) {
  console.warn('[mailer] RESEND_API_KEY missing - emails will be logged to console only');
}

if (TEST_REDIRECT_EMAIL) {
  console.warn(
    `[mailer] MODE TEST FILTRÉ : seuls [${[...TEST_FILTER_RECIPIENTS].join(', ')}] sont relayés vers ${TEST_REDIRECT_EMAIL}. Les autres emails sont bloqués.`,
  );
}

/** Vrai quand MAIL_TEST_REDIRECT active le filtre dev (pas d'envoi aux vrais users). */
export function isEmailTestFilterActive(): boolean {
  return Boolean(TEST_REDIRECT_EMAIL);
}

function normalizeEmailAddr(addr: string): string {
  return String(addr || '').trim().toLowerCase();
}

/** Emails admin/contact livrés tels quels ; comptes de test relayés. */
function shouldDeliverInTestFilter(to: string): boolean {
  const n = normalizeEmailAddr(to);
  if (TEST_REDIRECT_EMAIL && n === normalizeEmailAddr(TEST_REDIRECT_EMAIL)) return true;
  const prizeContact = normalizeEmailAddr(process.env.PRIZE_CONTACT_EMAIL || 'contact.cryptoedge@gmail.com');
  if (prizeContact && n === prizeContact) return true;
  return TEST_FILTER_RECIPIENTS.has(n);
}

export interface SendOtpResult {
  delivered: boolean;
  error?: string;
}

interface DispatchParams {
  kind: EmailKind;
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  /** Paramètres déjà chargés (évite un 2e fetch quand le caller les a lus pour le texte). */
  settings?: EmailSettings;
}

/**
 * Point d'envoi unique : applique les réglages admin (activé / bloqué / test),
 * envoie via Resend puis journalise le résultat. Ne throw jamais.
 *  - mode `off`        → rien n'est envoyé (statut `blocked`).
 *  - mode `test` ou test global → redirigé vers `testRedirect`.
 *  - sinon              → envoi réel.
 */
async function dispatch(p: DispatchParams): Promise<SendOtpResult> {
  let settings: EmailSettings;
  try {
    settings = p.settings ?? (await getEmailSettingsCached());
  } catch {
    // Si la config est inaccessible, on retombe sur un envoi normal (best-effort).
    settings = {
      globalTest: Boolean(TEST_REDIRECT_EMAIL),
      testRedirect: TEST_REDIRECT_EMAIL,
      kinds: {} as EmailSettings['kinds'],
      updatedAt: Date.now(),
    };
  }
  const kindSetting = settings.kinds[p.kind] ?? { mode: 'on' as const, overrides: {} };

  if (kindSetting.mode === 'off') {
    await logEmail({ kind: p.kind, to: p.to, subject: p.subject, status: 'blocked', error: 'désactivé' });
    return { delivered: false, error: 'blocked' };
  }

  const testFilterActive = Boolean(TEST_REDIRECT_EMAIL);
  const wantAdminRedirect = !testFilterActive && (settings.globalTest || kindSetting.mode === 'test');
  const adminTestAddr = (settings.testRedirect || '').trim();
  let rcpt = p.to;
  let subj = p.subject;
  let redirectedTo: string | undefined;

  if (testFilterActive) {
    if (!shouldDeliverInTestFilter(p.to)) {
      await logEmail({
        kind: p.kind,
        to: p.to,
        subject: p.subject,
        status: 'blocked',
        error: 'hors filtre test (MAIL_TEST_ONLY_RECIPIENTS)',
      });
      return { delivered: false, error: 'blocked-test-filter' };
    }
    if (normalizeEmailAddr(p.to) !== normalizeEmailAddr(TEST_REDIRECT_EMAIL)) {
      rcpt = TEST_REDIRECT_EMAIL;
      redirectedTo = TEST_REDIRECT_EMAIL;
      subj = `[TEST → ${p.to}] ${p.subject}`;
    }
  } else if (wantAdminRedirect) {
    if (!adminTestAddr) {
      await logEmail({ kind: p.kind, to: p.to, subject: p.subject, status: 'blocked', error: 'mode test sans adresse de redirection' });
      return { delivered: false, error: 'test-no-address' };
    }
    rcpt = adminTestAddr;
    redirectedTo = adminTestAddr;
    subj = `[TEST → ${p.to}] ${p.subject}`;
  }

  if (!client) {
    await logEmail({ kind: p.kind, to: p.to, subject: p.subject, status: 'no-smtp', error: 'no-smtp', redirectedTo });
    return { delivered: false, error: 'no-smtp' };
  }

  try {
    const { error } = await client.emails.send({
      from: FROM_EMAIL,
      to: rcpt,
      subject: subj,
      html: p.html,
      text: p.text,
      ...(p.replyTo ? { replyTo: p.replyTo } : {}),
      ...bannerAttachments(),
    });
    if (error) {
      const msg = typeof error === 'string' ? error : (error.message || 'send failed');
      console.error('[mailer] resend error:', error);
      await logEmail({ kind: p.kind, to: p.to, subject: p.subject, status: 'failed', error: msg, redirectedTo });
      return { delivered: false, error: msg };
    }
    await logEmail({ kind: p.kind, to: p.to, subject: p.subject, status: redirectedTo ? 'test' : 'sent', redirectedTo });
    return { delivered: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'send failed';
    console.error('[mailer] resend throw:', message);
    await logEmail({ kind: p.kind, to: p.to, subject: p.subject, status: 'failed', error: message, redirectedTo });
    return { delivered: false, error: message };
  }
}

export async function sendOtpEmail(
  to: string,
  code: string,
  intent: 'signup' | 'login',
): Promise<SendOtpResult> {
  const settings = await getEmailSettingsCached().catch(() => undefined);
  const T = (key: string) => resolveEmailText(settings, 'otp', key, { code });

  const subject = T(intent === 'signup' ? 'subjectSignup' : 'subjectLogin');
  const heading = T(intent === 'signup' ? 'headingSignup' : 'headingLogin');
  const intro = T(intent === 'signup' ? 'introSignup' : 'introLogin');
  const expiryNote = T('expiryNote');

  const html = renderOtpHtml(code, heading, intro, expiryNote);
  const text = renderOtpText(code, heading, expiryNote);

  // Ne jamais logger l'OTP en clair en production (fuite via logs).
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[mailer] OTP for ${to} (${intent}): ${code}`);
  }

  return dispatch({ kind: 'otp', to, subject, html, text, settings });
}

export function isMailerConfigured(): boolean {
  return Boolean(client);
}

// Adresse de contact pour la remise des lots (réponses des gagnants).
export const PRIZE_CONTACT_EMAIL = (process.env.PRIZE_CONTACT_EMAIL || 'contact.cryptoedge@gmail.com').trim();
const APP_PUBLIC_URL = (process.env.APP_PUBLIC_URL || 'https://btfarena.com').trim().replace(/\/$/, '');
const PAYOUT_PAGE_URL = `${APP_PUBLIC_URL}/compete/payouts`;

export interface PrizeWinnerEmailOptions {
  recipientName: string;
  competitionTitle: string;
  rank: number;
  rankLabel: string;
  /** Lignes de lots gagnés (ex. ["2 500 USDT", "MacBook Pro"]). */
  prizeLines: string[];
  totalParticipants: number;
}

/**
 * Email dédié aux GAGNANTS d'un lot : félicitations + demande de l'adresse
 * de réception ERC20 (réseau Ethereum) pour envoyer la récompense. Distinct de
 * l'email de résultats générique.
 */
interface PrizeTexts {
  eyebrow: string;
  claimTitle: string;
  claimText: string;
  buttonLabel: string;
  warning: string;
}

export async function sendPrizeWinnerEmail(
  to: string,
  options: PrizeWinnerEmailOptions,
): Promise<SendOtpResult> {
  const settings = await getEmailSettingsCached().catch(() => undefined);
  const vars = { title: options.competitionTitle, rank: options.rankLabel };
  const T = (key: string) => resolveEmailText(settings, 'prize_winner', key, vars);
  const subject = T('subject');
  const texts: PrizeTexts = {
    eyebrow: T('eyebrow'),
    claimTitle: T('claimTitle'),
    claimText: T('claimText'),
    buttonLabel: T('buttonLabel'),
    warning: T('warning'),
  };
  const html = renderPrizeWinnerHtml(options, texts);
  const text = renderPrizeWinnerText(options, texts);

  if (process.env.NODE_ENV !== 'production') {
    console.log(`[mailer] prize-winner "${options.competitionTitle}" (#${options.rank}) -> ${to}`);
  }

  return dispatch({ kind: 'prize_winner', to, subject, html, text, replyTo: PRIZE_CONTACT_EMAIL, settings });
}

function renderPrizeWinnerText(o: PrizeWinnerEmailOptions, texts: PrizeTexts): string {
  const lines: string[] = [];
  lines.push(`Felicitations ${o.recipientName} !`, '');
  lines.push(`Tu termines ${o.rankLabel} de l'arene "${o.competitionTitle}" sur ${o.totalParticipants} participants et tu remportes un lot :`);
  for (const prize of o.prizeLines) lines.push(`- ${prize}`);
  lines.push('');
  lines.push(`${texts.claimTitle.toUpperCase()} :`);
  lines.push(texts.claimText);
  lines.push(PAYOUT_PAGE_URL);
  lines.push('');
  lines.push(texts.warning);
  return lines.join('\n');
}

function renderPrizeWinnerHtml(o: PrizeWinnerEmailOptions, texts: PrizeTexts): string {
  const C = {
    page: '#050507',
    card: '#0a0c12',
    tile: '#13151d',
    border: '#23262f',
    red: '#ff3344',
    redBtn: '#e11d2a',
    white: '#ffffff',
    text: '#aab0c0',
    faint: '#6b7180',
    gold: '#ffd166',
    green: '#34d399',
  };

  const prizeRows = o.prizeLines
    .map((prize, i) => `
      <tr>
        <td width="40" style="padding:12px 0 12px 16px;font-size:20px;line-height:1;">${i === 0 ? '🏆' : '🎁'}</td>
        <td style="padding:12px 16px 12px 0;font-size:16px;color:${C.white};font-weight:700;${i > 0 ? `border-top:1px solid ${C.border};` : ''}">${escapeHtml(prize)}</td>
      </tr>`)
    .join('');

  const ctaUrl = PAYOUT_PAGE_URL;

  return `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="dark only" />
    <meta name="supported-color-schemes" content="dark only" />
  </head>
  <body style="margin:0;padding:0;background-color:${C.page};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#e5e7eb;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${C.page}" style="background-color:${C.page};padding:24px 0;">
      <tr><td align="center" bgcolor="${C.page}" style="background-color:${C.page};">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" bgcolor="${C.card}" style="width:600px;max-width:100%;background-color:${C.card};border:1px solid ${C.border};border-radius:16px;overflow:hidden;">
          ${bannerRowHtml()}

          <tr><td bgcolor="${C.card}" style="background-color:${C.card};padding:30px 30px 4px;">
            <div style="font-size:11px;letter-spacing:3px;text-transform:uppercase;color:${C.gold};font-weight:800;">${escapeHtml(texts.eyebrow)}</div>
            <h1 style="margin:14px 0 6px;font-size:30px;line-height:1.08;color:${C.white};font-weight:900;letter-spacing:-0.5px;">Félicitations, ${escapeHtml(o.recipientName)} !</h1>
            <div style="font-size:15px;font-weight:700;color:${C.red};letter-spacing:0.5px;">${escapeHtml(o.rankLabel)} sur ${o.totalParticipants} · ${escapeHtml(o.competitionTitle)}</div>
          </td></tr>

          <tr><td bgcolor="${C.card}" style="background-color:${C.card};padding:18px 30px 8px;">
            <div style="font-size:11px;letter-spacing:3px;text-transform:uppercase;color:${C.gold};font-weight:800;margin:8px 0 10px;">▍ Ton lot</div>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${C.tile}" style="background-color:${C.tile};border:1px solid ${C.border};border-radius:14px;">
              ${prizeRows}
            </table>
          </td></tr>

          <tr><td bgcolor="${C.card}" style="background-color:${C.card};padding:18px 30px 8px;">
            <div style="font-size:11px;letter-spacing:3px;text-transform:uppercase;color:${C.green};font-weight:800;margin:8px 0 10px;">▍ ${escapeHtml(texts.claimTitle)}</div>
            <p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:${C.text};">${escapeHtml(texts.claimText)}</p>
            <table role="presentation" cellpadding="0" cellspacing="0" align="left" style="margin:2px 0 6px;">
              <tr><td align="center" bgcolor="${C.redBtn}" style="background-color:${C.redBtn};border-radius:12px;border:2px solid #000000;">
                <a href="${ctaUrl}" style="display:block;background-color:${C.redBtn};color:#ffffff;text-decoration:none;font-size:14px;font-weight:900;letter-spacing:1px;text-transform:uppercase;padding:15px 34px;border-radius:10px;">${escapeHtml(texts.buttonLabel)}</a>
              </td></tr>
            </table>
            <div style="clear:both;"></div>
            <p style="margin:16px 0 0;font-size:12px;line-height:1.6;color:${C.faint};">⚠️ ${escapeHtml(texts.warning)}</p>
          </td></tr>

          <tr><td bgcolor="${C.card}" style="background-color:${C.card};padding:14px 30px 30px;">
            <p style="margin:0;font-size:12px;line-height:1.6;color:${C.faint};">Une question ? Écris-nous à <a href="mailto:${PRIZE_CONTACT_EMAIL}" style="color:${C.red};text-decoration:underline;">${PRIZE_CONTACT_EMAIL}</a>.</p>
          </td></tr>

          <tr><td bgcolor="#08090e" style="background-color:#08090e;border-top:1px solid ${C.border};padding:18px 30px;text-align:center;">
            <div style="font-size:13px;font-weight:900;letter-spacing:4px;color:${C.white};text-transform:uppercase;">BTF<span style="color:${C.red};">·</span>ARENA</div>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

export interface NotificationEmailOptions {
  /** Petit texte au-dessus du titre (ex. "Kraken Cup"). */
  eyebrow?: string;
  heading: string;
  /** Paragraphes du corps (chaque entrée = un <p>). */
  bodyLines: string[];
  /** Bloc mis en avant (ex. "#2 · +12.4%"). */
  highlight?: string;
  ctaLabel?: string;
  ctaUrl?: string;
}

/**
 * Email de notification générique (arène qui démarre, podium perdu, résultats
 * de fin). Même thème sombre que la plateforme. Best-effort : ne throw jamais,
 * retourne delivered=false en cas d'échec.
 */
export async function sendNotificationEmail(
  to: string,
  subject: string,
  options: NotificationEmailOptions,
  kind: EmailKind = 'arena_results',
): Promise<SendOtpResult> {
  const html = renderNotificationHtml(options);
  const text = renderNotificationText(options);

  if (process.env.NODE_ENV !== 'production') {
    console.log(`[mailer] notification "${subject}" -> ${to}`);
  }

  return dispatch({ kind, to, subject, html, text });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface NewArenaEmailOptions {
  recipientName: string;
  title: string;
  sponsor?: string | null;
  /** Date/heure de début déjà formatée (ex. "lundi 12 juin 18:00"). */
  startLabel: string;
  endLabel: string;
  durationLabel: string;
  /** Récompense principale mise en avant (ex. "5 000 €"). */
  prizeHeadline?: string;
  /** Répartition par place (ex. ["1er · 2 500 €", "2e · 1 500 €"]). */
  prizeBreakdown?: string[];
  /** Lots additionnels (ex. ["MacBook Pro", "Place BTF Paris"]). */
  prizeItems?: string[];
  prizeDescription?: string;
  /** Lien de la page d'arène — rend le bouton « Rejoindre l'arène » cliquable. */
  ctaUrl?: string;
}

/**
 * Email d'annonce « nouvelle arène disponible ». Template dédié (différent de
 * la notification générique) : mise en avant des horaires, des récompenses et
 * un gros bouton rouge & noir « Rejoindre l'arène » cliquable.
 */
export async function sendNewArenaEmail(
  to: string,
  options: NewArenaEmailOptions,
): Promise<SendOtpResult> {
  const settings = await getEmailSettingsCached().catch(() => undefined);
  const subject = resolveEmailText(settings, 'new_arena', 'subject', { title: options.title });
  const ctaLabel = resolveEmailText(settings, 'new_arena', 'ctaLabel');
  const banner = getEmailBanner();
  const html = renderNewArenaHtml(options, Boolean(banner), ctaLabel);
  const text = renderNewArenaText(options, ctaLabel);

  if (process.env.NODE_ENV !== 'production') {
    console.log(`[mailer] new-arena "${options.title}" -> ${to}`);
  }

  return dispatch({ kind: 'new_arena', to, subject, html, text, settings });
}

function renderNewArenaText(o: NewArenaEmailOptions, ctaLabel: string): string {
  const lines: string[] = [];
  lines.push('NOUVELLE ARÈNE', '');
  lines.push(`${o.title} vient d'ouvrir !`, '');
  lines.push(`Salut ${o.recipientName},`, '');
  lines.push("Une nouvelle arène est disponible sur BTF Trade. Inscris-toi pour participer et tenter de remporter les récompenses.", '');
  lines.push('— HORAIRES —');
  lines.push(`Début : ${o.startLabel}`);
  lines.push(`Fin : ${o.endLabel}`);
  lines.push(`Durée : ${o.durationLabel}`, '');
  if (o.prizeHeadline || (o.prizeBreakdown && o.prizeBreakdown.length) || (o.prizeItems && o.prizeItems.length)) {
    lines.push('— RÉCOMPENSES —');
    if (o.prizeHeadline) lines.push(`Dotation : ${o.prizeHeadline}`);
    if (o.prizeBreakdown && o.prizeBreakdown.length) lines.push(`Répartition : ${o.prizeBreakdown.join(' · ')}`);
    if (o.prizeItems && o.prizeItems.length) lines.push(`Lots : ${o.prizeItems.join(' · ')}`);
    if (o.prizeDescription) lines.push(o.prizeDescription);
    lines.push('');
  }
  if (o.ctaUrl) lines.push(`${ctaLabel} : ${o.ctaUrl}`);
  return lines.join('\n');
}

export function renderNewArenaHtml(o: NewArenaEmailOptions, withBanner = false, ctaLabel = "Rejoindre l'arène ▸"): string {
  // Couleurs verrouillées en inline + attributs bgcolor : Gmail ignore la
  // propriété raccourcie `background:` et certaines règles, donc on utilise
  // systématiquement `background-color` + l'attribut HTML bgcolor pour que le
  // thème sombre survive (sinon Gmail repasse tout en blanc).
  const C = {
    page: '#000000',
    card: '#070809',
    tile: '#13151d',
    border: '#23262f',
    red: '#ff3344',
    redBtn: '#e11d2a',
    white: '#ffffff',
    text: '#aab0c0',
    faint: '#6b7180',
    gold: '#ffd166',
  };

  const safeUrl = o.ctaUrl ? escapeHtml(o.ctaUrl) : '';
  const sponsorTag = o.sponsor && o.sponsor.trim()
    ? ` <span style="color:${C.faint};">·</span> <span style="color:${C.text};">Sponsor ${escapeHtml(o.sponsor.trim())}</span>`
    : '';

  // Bloc "stat sheet" des horaires : libellé rouge + valeur blanche, gère les
  // longues dates (pas de colonnes étroites).
  const statRow = (label: string, value: string, withBorder: boolean) => `
    <tr>
      <td style="padding:14px 18px;${withBorder ? `border-top:1px solid ${C.border};` : ''}">
        <div style="font-size:10px;letter-spacing:2px;text-transform:uppercase;color:${C.red};font-weight:800;margin-bottom:4px;">${escapeHtml(label)}</div>
        <div style="font-size:15px;color:${C.white};font-weight:700;line-height:1.35;">${escapeHtml(value)}</div>
      </td>
    </tr>`;

  const scheduleBlock = `
    <div style="font-size:11px;letter-spacing:3px;text-transform:uppercase;color:${C.red};font-weight:800;margin:26px 0 10px;">▍ Programme</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${C.tile}" style="background-color:${C.tile};border:1px solid ${C.border};border-radius:14px;">
      ${statRow('Début', o.startLabel, false)}
      ${statRow('Fin', o.endLabel, true)}
      ${statRow('Durée', o.durationLabel, true)}
    </table>`;

  // Podium de dotation : médaille par position, source = répartition cash si
  // dispo, sinon les lots.
  const medals = ['🥇', '🥈', '🥉'];
  const tierSource = (o.prizeBreakdown && o.prizeBreakdown.length)
    ? o.prizeBreakdown
    : (o.prizeItems || []);
  const tierRows = tierSource.slice(0, 6).map((label, i) => `
    <tr>
      <td width="46" style="padding:12px 0 12px 16px;font-size:22px;line-height:1;">${medals[i] || '🎖️'}</td>
      <td style="padding:12px 16px 12px 0;font-size:15px;color:${C.white};font-weight:700;${i > 0 ? `border-top:1px solid ${C.border};` : ''}">
        <span style="color:${C.faint};font-size:12px;font-weight:800;letter-spacing:1px;margin-right:8px;">#${i + 1}</span>${escapeHtml(label)}
      </td>
    </tr>`).join('');
  const prizeDesc = o.prizeDescription && o.prizeDescription.trim()
    ? `<p style="margin:12px 0 0;font-size:12px;line-height:1.6;color:${C.faint};">${escapeHtml(o.prizeDescription.trim())}</p>`
    : '';
  const hasPrize = Boolean(o.prizeHeadline || tierRows || prizeDesc);
  const prizeBlock = hasPrize ? `
    <div style="font-size:11px;letter-spacing:3px;text-transform:uppercase;color:${C.gold};font-weight:800;margin:26px 0 10px;">▍ Dotation</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${C.tile}" style="background-color:${C.tile};border:1px solid ${C.border};border-radius:14px;">
      ${o.prizeHeadline ? `<tr><td style="padding:18px 16px 6px;"><div style="font-size:30px;font-weight:900;color:${C.gold};letter-spacing:-0.5px;">${escapeHtml(o.prizeHeadline)}</div></td></tr>` : ''}
      ${tierRows ? `<tr><td style="padding:6px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${tierRows}</table></td></tr>` : ''}
      ${prizeDesc ? `<tr><td style="padding:0 16px 16px;">${prizeDesc}</td></tr>` : ''}
    </table>` : '';

  const cta = o.ctaUrl ? `
    <table role="presentation" cellpadding="0" cellspacing="0" align="center" width="100%" style="margin:28px 0 0;">
      <tr><td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" align="center">
          <tr><td align="center" bgcolor="${C.redBtn}" style="background-color:${C.redBtn};border-radius:12px;border:2px solid #000000;">
            <a href="${safeUrl}" target="_blank" rel="noopener" style="display:block;background-color:${C.redBtn};color:#ffffff;text-decoration:none;font-size:15px;font-weight:900;letter-spacing:2px;text-transform:uppercase;padding:18px 50px;border-radius:10px;">${escapeHtml(ctaLabel)}</a>
          </td></tr>
        </table>
      </td></tr>
    </table>
    <p style="margin:14px 0 0;font-size:11px;line-height:1.6;color:${C.faint};text-align:center;">Le bouton ne s'ouvre pas ?<br/><a href="${safeUrl}" target="_blank" rel="noopener" style="color:${C.red};font-weight:700;word-break:break-all;text-decoration:underline;">${safeUrl}</a></p>` : '';

  return `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="dark only" />
    <meta name="supported-color-schemes" content="dark only" />
  </head>
  <body style="margin:0;padding:0;background-color:${C.page};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${C.page}" style="background-color:${C.page};padding:24px 0;">
      <tr><td align="center" bgcolor="${C.page}" style="background-color:${C.page};">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" bgcolor="${C.card}" style="width:600px;max-width:100%;background-color:${C.card};border:1px solid ${C.border};border-radius:16px;overflow:hidden;">
          ${withBanner
            ? `<!-- bannière image (immunisée contre le re-thème de Gmail) -->
          <tr><td bgcolor="#000000" style="background-color:#000000;font-size:0;line-height:0;">
            <img src="cid:${EMAIL_BANNER_CID}" width="600" alt="BTF Arena — Nouvelle arène" style="display:block;width:100%;max-width:600px;height:auto;border:0;outline:none;text-decoration:none;" />
          </td></tr>`
            : `<!-- accent rouge -->
          <tr><td bgcolor="${C.redBtn}" style="background-color:${C.redBtn};height:5px;font-size:0;line-height:0;">&nbsp;</td></tr>`}

          <!-- hero -->
          <tr><td bgcolor="${C.card}" style="background-color:${C.card};padding:30px 30px 4px;">
            <div style="font-size:11px;letter-spacing:3px;text-transform:uppercase;color:${C.red};font-weight:800;">● Arène en ligne${sponsorTag}</div>
            <h1 style="margin:14px 0 6px;font-size:34px;line-height:1.05;color:${C.white};font-weight:900;letter-spacing:-1px;text-transform:uppercase;">${escapeHtml(o.title)}</h1>
            <div style="font-size:16px;font-weight:800;color:${C.red};letter-spacing:1px;text-transform:uppercase;">vient d'ouvrir</div>
            <table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px 0 0;"><tr><td bgcolor="${C.redBtn}" style="background-color:${C.redBtn};width:54px;height:4px;font-size:0;line-height:0;">&nbsp;</td></tr></table>
          </td></tr>

          <!-- corps -->
          <tr><td bgcolor="${C.card}" style="background-color:${C.card};padding:18px 30px 32px;">
            <p style="margin:0 0 6px;font-size:14px;line-height:1.6;color:${C.text};">Salut ${escapeHtml(o.recipientName)},</p>
            <p style="margin:0;font-size:14px;line-height:1.6;color:${C.text};">Une nouvelle arène est ouverte sur BTF&nbsp;Arena. Inscris-toi, prends position et grimpe au classement pour rafler les récompenses.</p>
            ${scheduleBlock}
            ${prizeBlock}
            ${cta}
            <p style="margin:24px 0 0;font-size:11px;line-height:1.6;color:${C.faint};text-align:center;text-transform:uppercase;letter-spacing:1px;">Chaque trade compte — que le meilleur gagne</p>
          </td></tr>

          <!-- footer -->
          <tr><td bgcolor="#08090e" style="background-color:#08090e;border-top:1px solid ${C.border};padding:18px 30px;text-align:center;">
            <div style="font-size:13px;font-weight:900;letter-spacing:4px;color:${C.white};text-transform:uppercase;">BTF<span style="color:${C.red};">·</span>ARENA</div>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

function renderNotificationText(options: NotificationEmailOptions): string {
  const lines: string[] = [];
  if (options.eyebrow) lines.push(options.eyebrow.toUpperCase(), '');
  lines.push(options.heading, '');
  lines.push(...options.bodyLines, '');
  if (options.highlight) lines.push(options.highlight, '');
  if (options.ctaUrl) lines.push(`${options.ctaLabel || 'Ouvrir'} : ${options.ctaUrl}`);
  return lines.join('\n');
}

function renderNotificationHtml(options: NotificationEmailOptions): string {
  const eyebrow = options.eyebrow
    ? `<div style="font-size:10px;letter-spacing:3px;text-transform:uppercase;color:#dc2626;font-weight:700;margin-bottom:8px;">${escapeHtml(options.eyebrow)}</div>`
    : '';
  const paragraphs = options.bodyLines
    .map((line) => `<p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#b8b8c2;">${escapeHtml(line)}</p>`)
    .join('');
  const highlight = options.highlight
    ? `<div style="font-family:'SFMono-Regular',Menlo,Consolas,monospace;font-size:26px;font-weight:700;color:#fbbf24;background:#15100a;border:1px solid #3a2c12;border-radius:12px;padding:16px;text-align:center;margin:8px 0 16px;">${escapeHtml(options.highlight)}</div>`
    : '';
  const cta = options.ctaUrl
    ? `<a href="${escapeHtml(options.ctaUrl)}" style="display:inline-block;background:#dc2626;color:#ffffff;text-decoration:none;font-size:13px;font-weight:700;letter-spacing:1px;text-transform:uppercase;padding:13px 26px;border-radius:10px;margin-top:4px;">${escapeHtml(options.ctaLabel || 'Ouvrir')}</a>`
    : '';

  return `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="dark only" />
    <meta name="supported-color-schemes" content="dark only" />
  </head>
  <body style="margin:0;padding:0;background-color:#050507;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#e5e7eb;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#050507" style="background-color:#050507;padding:24px 0;">
      <tr><td align="center" bgcolor="#050507" style="background-color:#050507;">
        <table role="presentation" width="480" cellpadding="0" cellspacing="0" bgcolor="#0c0c10" style="width:480px;max-width:100%;background-color:#0c0c10;border:1px solid #1a1a20;border-radius:16px;overflow:hidden;">
          ${bannerRowHtml()}
          <tr><td bgcolor="#0c0c10" style="background-color:#0c0c10;padding:32px;">
            ${eyebrow}
            <h1 style="margin:0 0 16px;font-size:22px;color:#ffffff;">${escapeHtml(options.heading)}</h1>
            ${paragraphs}
            ${highlight}
            ${cta}
          </td></tr>
        </table>
        <p style="margin:24px 0 0;font-size:11px;color:#475569;">${APP_NAME}</p>
      </td></tr>
    </table>
  </body>
</html>`;
}

function renderOtpText(code: string, headline: string, expiryNote: string): string {
  return [
    headline,
    '',
    `Ton code de verification est : ${code}`,
    '',
    expiryNote,
  ].join('\n');
}

function renderOtpHtml(code: string, headline: string, sub: string, expiryNote: string): string {
  return `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="dark only" />
    <meta name="supported-color-schemes" content="dark only" />
  </head>
  <body style="margin:0;padding:0;background-color:#050507;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#e5e7eb;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#050507" style="background-color:#050507;padding:24px 0;">
      <tr><td align="center" bgcolor="#050507" style="background-color:#050507;">
        <table role="presentation" width="480" cellpadding="0" cellspacing="0" bgcolor="#0a0c12" style="width:480px;max-width:100%;background-color:#0a0c12;border:1px solid #1d2233;border-radius:16px;overflow:hidden;">
          ${bannerRowHtml()}
          <tr><td bgcolor="#0a0c12" style="background-color:#0a0c12;padding:32px;">
            <h1 style="margin:0 0 8px;font-size:22px;color:#ffffff;">${escapeHtml(headline)}</h1>
            <p style="margin:0 0 24px;font-size:14px;color:#94a3b8;">${escapeHtml(sub)}</p>
            <div style="font-family:'SFMono-Regular',Menlo,Consolas,monospace;font-size:36px;letter-spacing:10px;font-weight:700;color:#34d399;background-color:#0b1325;border:1px solid #1f2a4a;border-radius:12px;padding:18px;text-align:center;">${code}</div>
            <p style="margin:24px 0 0;font-size:12px;color:#64748b;">${escapeHtml(expiryNote)}</p>
          </td></tr>
        </table>
        <p style="margin:24px 0 0;font-size:11px;color:#475569;">${APP_NAME}</p>
      </td></tr>
    </table>
  </body>
</html>`;
}

export interface PayoutRequestEmailOptions {
  recipientName: string;
  arenaTitle: string;
  rankLabel: string;
  amountLabel: string;
  erc20Address?: string;
}

/** Confirmation joueur après soumission d'une demande de payout. */
export async function sendPayoutRequestSubmittedEmail(
  to: string,
  options: PayoutRequestEmailOptions,
): Promise<SendOtpResult> {
  return sendNotificationEmail(
    to,
    `Demande de payout reçue — ${options.arenaTitle}`,
    {
      eyebrow: 'BTF Arena · Payout',
      heading: 'Ta demande de payout a bien été enregistrée',
      bodyLines: [
        `Salut ${options.recipientName},`,
        `Nous avons bien reçu ta demande de versement pour l'arène « ${options.arenaTitle} » (${options.rankLabel}, ${options.amountLabel}).`,
        'Notre équipe va traiter ta demande sous 48 h ouvrées. Tu recevras un email de confirmation dès que le virement sera effectué.',
        'En cas de question, réponds à cet email ou contacte-nous.',
      ],
      highlight: `${options.rankLabel} · ${options.amountLabel}`,
      ctaLabel: 'Voir mes payouts',
      ctaUrl: PAYOUT_PAGE_URL,
    },
    'payout_request_submitted',
  );
}

/** Notification admin : nouvelle demande de payout à traiter. */
export async function sendPayoutRequestAdminEmail(
  to: string,
  options: PayoutRequestEmailOptions & { userEmail: string },
): Promise<SendOtpResult> {
  return sendNotificationEmail(
    to,
    `[Payout] ${options.recipientName} — ${options.amountLabel}`,
    {
      eyebrow: 'Nouvelle demande de payout',
      heading: `${options.recipientName} demande un versement`,
      bodyLines: [
        `Joueur : ${options.recipientName} (${options.userEmail})`,
        `Arène : ${options.arenaTitle}`,
        `Place : ${options.rankLabel}`,
        `Montant : ${options.amountLabel}`,
        `Adresse ERC20 : ${options.erc20Address || '—'}`,
        'Connecte-toi à l’admin pour valider le virement une fois effectué.',
      ],
      highlight: options.erc20Address || '—',
    },
    'payout_request_admin',
  );
}

/** Confirmation joueur après approbation admin du virement. */
export async function sendPayoutApprovedEmail(
  to: string,
  options: PayoutRequestEmailOptions,
): Promise<SendOtpResult> {
  return sendNotificationEmail(
    to,
    `Payout confirmé — ${options.arenaTitle}`,
    {
      eyebrow: 'BTF Arena · Payout',
      heading: 'Ton payout a été envoyé',
      bodyLines: [
        `Salut ${options.recipientName},`,
        `Bonne nouvelle : le versement de ${options.amountLabel} pour l'arène « ${options.arenaTitle} » (${options.rankLabel}) a été effectué vers ton adresse ERC20.`,
        'Le délai d’apparition on-chain peut varier selon le réseau. Merci d’avoir participé à BTF Arena !',
      ],
      highlight: `${options.rankLabel} · ${options.amountLabel}`,
      ctaLabel: 'Voir mes payouts',
      ctaUrl: PAYOUT_PAGE_URL,
    },
    'payout_approved',
  );
}
