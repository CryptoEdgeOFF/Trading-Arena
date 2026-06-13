/**
 * Traduction automatique best-effort (sans clé API).
 *
 * Utilise le point d'accès public de Google Traduction (gtx). C'est suffisant
 * pour traduire ponctuellement de courts textes admin (promotions). En cas
 * d'échec réseau / rate-limit, on retombe sur le texte source inchangé.
 *
 * Pour basculer plus tard sur DeepL ou un autre provider, il suffit de
 * remplacer l'implémentation de `translateDetect`.
 */

const ENDPOINT = 'https://translate.googleapis.com/translate_a/single';
const TIMEOUT_MS = 6000;

export type Lang = 'fr' | 'en';

interface DetectResult {
  /** Texte traduit. */
  text: string;
  /** Langue source détectée (code court, ex. 'fr', 'en', 'es'…). */
  src: string;
}

/** Traduit `text` vers `to` et renvoie aussi la langue source détectée. */
async function translateDetect(text: string, to: Lang): Promise<DetectResult> {
  const trimmed = (text || '').trim();
  if (!trimmed) return { text: '', src: to };
  try {
    const url = `${ENDPOINT}?client=gtx&sl=auto&tl=${to}&dt=t&q=${encodeURIComponent(trimmed)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    clearTimeout(timer);
    if (!res.ok) return { text: trimmed, src: to };
    const data = (await res.json()) as unknown;
    const chunks = Array.isArray((data as any)?.[0]) ? (data as any)[0] : [];
    const out = chunks.map((part: any) => (Array.isArray(part) ? part[0] ?? '' : '')).join('');
    const src = typeof (data as any)?.[2] === 'string' ? (data as any)[2] : to;
    return { text: out.trim() || trimmed, src };
  } catch {
    return { text: trimmed, src: to };
  }
}

/**
 * Produit les versions FR et EN d'un texte. La langue source est préservée
 * telle quelle (pas de re-traduction destructive), l'autre langue est générée.
 */
export async function bilingual(text: string): Promise<{ fr: string; en: string }> {
  const trimmed = (text || '').trim();
  if (!trimmed) return { fr: '', en: '' };

  const toEn = await translateDetect(trimmed, 'en');
  if (toEn.src === 'en') {
    // Source anglaise : on garde l'original en EN et on traduit vers le FR.
    const toFr = await translateDetect(trimmed, 'fr');
    return { fr: toFr.text, en: trimmed };
  }
  if (toEn.src === 'fr') {
    // Source française : original conservé en FR, EN déjà traduit.
    return { fr: trimmed, en: toEn.text };
  }
  // Source dans une 3e langue : on traduit vers les deux.
  const toFr = await translateDetect(trimmed, 'fr');
  return { fr: toFr.text, en: toEn.text };
}

/**
 * Versions FR/EN d'une liste de puces. On traduit en un seul appel par langue
 * (jointure par sauts de ligne) pour limiter les requêtes ; si le découpage ne
 * correspond plus, on retombe sur la liste source.
 */
export async function bilingualList(items: string[]): Promise<{ fr: string[]; en: string[] }> {
  const clean = items.map((i) => (i || '').trim()).filter((i) => i.length > 0);
  if (clean.length === 0) return { fr: [], en: [] };
  const joined = clean.join('\n');
  const { fr, en } = await bilingual(joined);
  const frArr = fr.split('\n').map((s) => s.trim()).filter((s) => s.length > 0);
  const enArr = en.split('\n').map((s) => s.trim()).filter((s) => s.length > 0);
  return {
    fr: frArr.length === clean.length ? frArr : clean,
    en: enArr.length === clean.length ? enArr : clean,
  };
}
