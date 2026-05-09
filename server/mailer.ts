import { Resend } from 'resend';

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'BTF Trade <onboarding@resend.dev>';
const APP_NAME = process.env.APP_NAME || 'BTF Trade';

const client = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

if (!client) {
  console.warn('[mailer] RESEND_API_KEY missing - emails will be logged to console only');
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

  console.log(`[mailer] OTP for ${to} (${intent}): ${code}`);

  if (!client) {
    return { delivered: false, error: 'no-smtp' };
  }

  try {
    const { error } = await client.emails.send({
      from: FROM_EMAIL,
      to,
      subject,
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
