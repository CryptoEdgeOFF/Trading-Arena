/**
 * SMS OTP via Twilio Verify (https://www.twilio.com/docs/verify/api).
 *
 * Twilio Verify gere la generation, l'envoi et la verification du code,
 * ainsi que les rate-limits, le fraud-monitor et les retry. C'est le service
 * recommande par Twilio pour des flows OTP.
 *
 * Variables d'environnement :
 *  - TWILIO_ACCOUNT_SID
 *  - TWILIO_AUTH_TOKEN
 *  - TWILIO_VERIFY_SERVICE_SID  (cree dans la console Twilio > Verify)
 *
 * En l'absence de ces 3 variables, on tombe en mode "console" : le code est
 * loggue dans la console serveur (et renvoye au client en mode dev), exactement
 * comme pour l'email. Cela permet de coder/tester sans depenser un centime.
 *
 * Pour swap vers Firebase Phone Auth plus tard : remplacer le contenu de
 * sendSmsOtp + checkSmsOtp par les calls Firebase Admin SDK. Le reste du code
 * (manager, API, frontend) n'a pas besoin de bouger.
 */

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || '';
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || '';
const VERIFY_SERVICE_SID = process.env.TWILIO_VERIFY_SERVICE_SID || '';

const isLive = Boolean(ACCOUNT_SID && AUTH_TOKEN && VERIFY_SERVICE_SID);
if (!isLive) {
  console.warn('[sms] Twilio non configure - codes SMS loggues en console uniquement');
}

export interface SmsSendResult {
  delivered: boolean;
  error?: string;
  /** Code genere localement si Twilio non configure (mode dev). */
  localCode?: string;
}

export interface SmsCheckResult {
  approved: boolean;
  error?: string;
}

/**
 * Envoie un code SMS au numero E.164. En mode console, on retourne un code
 * deterministe (genere ici) que le manager pourra logger / renvoyer en dev.
 */
export async function sendSmsOtp(phone: string): Promise<SmsSendResult> {
  if (!isLive) {
    const localCode = String(Math.floor(100_000 + Math.random() * 900_000));
    console.log(`[sms] OTP for ${phone}: ${localCode}`);
    return { delivered: false, localCode };
  }

  try {
    const url = `https://verify.twilio.com/v2/Services/${encodeURIComponent(VERIFY_SERVICE_SID)}/Verifications`;
    const auth = Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString('base64');
    const body = new URLSearchParams({ To: phone, Channel: 'sms' });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      console.error('[sms] Twilio verifications HTTP', response.status, text);
      let parsed: { message?: string } | null = null;
      try { parsed = JSON.parse(text); } catch { /* ignore */ }
      const msg = parsed?.message || `HTTP ${response.status}`;
      return { delivered: false, error: msg };
    }
    return { delivered: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'send failed';
    console.error('[sms] Twilio throw:', message);
    return { delivered: false, error: message };
  }
}

/**
 * Verifie le code SMS via Twilio Verify. En mode console (sans Twilio),
 * la verification est deleguee au manager (qui compare au code stocke).
 */
export async function checkSmsOtp(phone: string, code: string): Promise<SmsCheckResult> {
  if (!isLive) {
    return { approved: false, error: 'Twilio non configure' };
  }

  try {
    const url = `https://verify.twilio.com/v2/Services/${encodeURIComponent(VERIFY_SERVICE_SID)}/VerificationCheck`;
    const auth = Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString('base64');
    const body = new URLSearchParams({ To: phone, Code: code });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      console.error('[sms] Twilio check HTTP', response.status, text);
      return { approved: false, error: `Twilio ${response.status}` };
    }

    const data = await response.json().catch(() => ({})) as { status?: string };
    return { approved: data.status === 'approved' };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'check failed';
    console.error('[sms] Twilio throw:', message);
    return { approved: false, error: message };
  }
}

export function isSmsLive(): boolean {
  return isLive;
}
