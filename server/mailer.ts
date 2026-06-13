import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Resend } from 'resend';

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'BTF Trade <onboarding@resend.dev>';
const APP_NAME = process.env.APP_NAME || 'BTF Trade';

// Mode test : si défini, TOUS les emails (OTP + notifications) sont redirigés
// vers cette seule adresse au lieu du vrai destinataire. On garde le
// destinataire d'origine dans le sujet ([TEST → ...]) pour le debug.
// Vider cette variable (ou la retirer du .env) pour repasser en envoi réel.
const TEST_REDIRECT_EMAIL = (process.env.MAIL_TEST_REDIRECT || '').trim();

// Bannière esport intégrée en pièce jointe inline (CID) dans l'email de
// nouvelle arène. On l'embarque en CID plutôt qu'en URL pour qu'elle s'affiche
// même sans hébergement public et qu'elle échappe au re-thème de Gmail (une
// image n'est jamais recolorée). Chargée une seule fois et mise en cache.
const ARENA_BANNER_CID = 'btf-arena-banner';
let arenaBannerCache: Buffer | null | undefined;

function getArenaBanner(): Buffer | null {
  if (arenaBannerCache !== undefined) return arenaBannerCache;
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    arenaBannerCache = readFileSync(join(here, 'assets', 'arena-email-banner.jpg'));
  } catch (err) {
    console.warn('[mailer] bannière arène introuvable, repli sur en-tête texte:', (err as Error)?.message);
    arenaBannerCache = null;
  }
  return arenaBannerCache;
}

const client = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

if (!client) {
  console.warn('[mailer] RESEND_API_KEY missing - emails will be logged to console only');
}

if (TEST_REDIRECT_EMAIL) {
  console.warn(
    `[mailer] MODE TEST : tous les emails sont redirigés vers ${TEST_REDIRECT_EMAIL} (les vrais destinataires ne reçoivent rien).`,
  );
}

/**
 * En mode test, remplace le destinataire réel par l'adresse de test et préfixe
 * le sujet pour savoir à qui l'email aurait dû partir. Sans redirection
 * configurée, renvoie le destinataire/sujet d'origine.
 */
function applyTestRedirect(to: string, subject: string): { to: string; subject: string } {
  if (!TEST_REDIRECT_EMAIL) return { to, subject };
  return { to: TEST_REDIRECT_EMAIL, subject: `[TEST → ${to}] ${subject}` };
}

export interface SendOtpResult {
  delivered: boolean;
  error?: string;
}

export async function sendOtpEmail(
  to: string,
  code: string,
  intent: 'signup' | 'login',
): Promise<SendOtpResult> {
  const subject = intent === 'signup'
    ? `Confirme ton inscription ${APP_NAME} (${code})`
    : `Ton code de connexion ${APP_NAME} (${code})`;

  const html = renderOtpHtml(code, intent);
  const text = renderOtpText(code, intent);

  // Ne jamais logger l'OTP en clair en production (fuite via logs).
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[mailer] OTP for ${to} (${intent}): ${code}`);
  }

  if (!client) {
    return { delivered: false, error: 'no-smtp' };
  }

  const { to: rcpt, subject: subj } = applyTestRedirect(to, subject);

  try {
    const { error } = await client.emails.send({
      from: FROM_EMAIL,
      to: rcpt,
      subject: subj,
      html,
      text,
    });
    if (error) {
      console.error('[mailer] resend error:', error);
      return { delivered: false, error: typeof error === 'string' ? error : (error.message || 'send failed') };
    }
    return { delivered: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'send failed';
    console.error('[mailer] resend throw:', message);
    return { delivered: false, error: message };
  }
}

export function isMailerConfigured(): boolean {
  return Boolean(client);
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
): Promise<SendOtpResult> {
  const html = renderNotificationHtml(options);
  const text = renderNotificationText(options);

  if (process.env.NODE_ENV !== 'production') {
    console.log(`[mailer] notification "${subject}" -> ${to}`);
  }

  if (!client) {
    return { delivered: false, error: 'no-smtp' };
  }

  const { to: rcpt, subject: subj } = applyTestRedirect(to, subject);

  try {
    const { error } = await client.emails.send({
      from: FROM_EMAIL,
      to: rcpt,
      subject: subj,
      html,
      text,
    });
    if (error) {
      console.error('[mailer] resend error:', error);
      return { delivered: false, error: typeof error === 'string' ? error : (error.message || 'send failed') };
    }
    return { delivered: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'send failed';
    console.error('[mailer] resend throw:', message);
    return { delivered: false, error: message };
  }
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
  const subject = `Nouvelle arène : ${options.title}`;
  const banner = getArenaBanner();
  const html = renderNewArenaHtml(options, Boolean(banner));
  const text = renderNewArenaText(options);

  if (process.env.NODE_ENV !== 'production') {
    console.log(`[mailer] new-arena "${options.title}" -> ${to}`);
  }

  if (!client) {
    return { delivered: false, error: 'no-smtp' };
  }

  const { to: rcpt, subject: subj } = applyTestRedirect(to, subject);

  try {
    const { error } = await client.emails.send({
      from: FROM_EMAIL,
      to: rcpt,
      subject: subj,
      html,
      text,
      ...(banner
        ? {
            attachments: [
              {
                filename: 'arena-email-banner.jpg',
                content: banner,
                contentId: ARENA_BANNER_CID,
                contentType: 'image/jpeg',
              },
            ],
          }
        : {}),
    });
    if (error) {
      console.error('[mailer] resend error:', error);
      return { delivered: false, error: typeof error === 'string' ? error : (error.message || 'send failed') };
    }
    return { delivered: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'send failed';
    console.error('[mailer] resend throw:', message);
    return { delivered: false, error: message };
  }
}

function renderNewArenaText(o: NewArenaEmailOptions): string {
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
  if (o.ctaUrl) lines.push(`Rejoindre l'arène : ${o.ctaUrl}`);
  return lines.join('\n');
}

export function renderNewArenaHtml(o: NewArenaEmailOptions, withBanner = false): string {
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
            <a href="${safeUrl}" target="_blank" rel="noopener" style="display:block;background-color:${C.redBtn};color:#ffffff;text-decoration:none;font-size:15px;font-weight:900;letter-spacing:2px;text-transform:uppercase;padding:18px 50px;border-radius:10px;">Rejoindre l'arène ▸</a>
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
            <img src="cid:${ARENA_BANNER_CID}" width="600" alt="BTF Arena — Nouvelle arène" style="display:block;width:100%;max-width:600px;height:auto;border:0;outline:none;text-decoration:none;" />
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
<html>
  <body style="margin:0;padding:0;background:#050507;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#e5e7eb;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#050507;padding:32px 0;">
      <tr><td align="center">
        <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#0c0c10;border:1px solid #1a1a20;border-radius:16px;overflow:hidden;">
          <tr><td style="padding:32px;">
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

function renderOtpText(code: string, intent: 'signup' | 'login'): string {
  const headline = intent === 'signup'
    ? `Bienvenue sur ${APP_NAME} !`
    : `Connexion a ${APP_NAME}`;
  return [
    headline,
    '',
    `Ton code de verification est : ${code}`,
    '',
    'Il expire dans 10 minutes. Ne le partage avec personne.',
  ].join('\n');
}

function renderOtpHtml(code: string, intent: 'signup' | 'login'): string {
  const headline = intent === 'signup'
    ? `Bienvenue sur ${APP_NAME}`
    : `Connexion a ${APP_NAME}`;
  const sub = intent === 'signup'
    ? 'Confirme ton inscription en saisissant le code ci-dessous.'
    : 'Voici ton code de connexion a usage unique.';

  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#0b1020;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#e5e7eb;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0b1020;padding:32px 0;">
      <tr><td align="center">
        <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#111935;border-radius:16px;overflow:hidden;">
          <tr><td style="padding:32px;">
            <h1 style="margin:0 0 8px;font-size:22px;color:#ffffff;">${headline}</h1>
            <p style="margin:0 0 24px;font-size:14px;color:#94a3b8;">${sub}</p>
            <div style="font-family:'SFMono-Regular',Menlo,Consolas,monospace;font-size:36px;letter-spacing:10px;font-weight:700;color:#34d399;background:#0b1325;border:1px solid #1f2a4a;border-radius:12px;padding:18px;text-align:center;">${code}</div>
            <p style="margin:24px 0 0;font-size:12px;color:#64748b;">Le code expire dans 10 minutes. Si tu n'es pas a l'origine de cette demande, ignore cet email.</p>
          </td></tr>
        </table>
        <p style="margin:24px 0 0;font-size:11px;color:#475569;">${APP_NAME}</p>
      </td></tr>
    </table>
  </body>
</html>`;
}
