/**
 * Email d'élimination (drawdown) : uniquement les arènes main Blueberry,
 * et uniquement au moment où le joueur vient d'être éliminé.
 *
 * Ne jamais backfiller les comptes déjà breached (boot / leftover flatten) :
 * ça enverrait un blast historique.
 */

export const DEFAULT_BLUEBERRY_GIFT_SUBTITLE = 'Réservé aux traders BTF Arena pendant 1 semaine';
export const DEFAULT_BLUEBERRY_GIFT_CTA = 'Ouvrir les offres';
export const DEFAULT_BLUEBERRY_GIFT_PATH = '/compete/bonus';

export const DEFAULT_BLUEBERRY_OFFERS: Array<{ title: string; code: string }> = [
  { title: '-50 % sur vos challenges PRIMES', code: 'BTF50' },
  { title: '-30 % sur tous les Challenges', code: 'BTF35' },
];

export function isMainBlueberryArena(competition: {
  title?: string | null;
  sponsor?: string | null;
  sponsorName?: string | null;
  format?: string | null;
  isPublic?: boolean;
}): boolean {
  if (!competition.isPublic) return false;
  if (competition.format === 'blitz') return false;
  if (/^(STAGING|MOBILE STAGING)\b/i.test(competition.title || '')) return false;
  const hay = [competition.title, competition.sponsor, competition.sponsorName]
    .filter(Boolean)
    .join(' ');
  return /blueberry/i.test(hay);
}

/** Seul un breach fraîchement posé peut déclencher l'email. */
export function shouldQueueBreachEmail(input: { newlyBreached: boolean }): boolean {
  return input.newlyBreached === true;
}

export function buildBreachGiftOffers(competition: {
  promoOffer1?: string | null;
  promoCode1?: string | null;
  promoOffer2?: string | null;
  promoCode2?: string | null;
}): Array<{ title: string; code: string }> {
  const offers: Array<{ title: string; code: string }> = [];
  const offer1 = String(competition.promoOffer1 || '').trim();
  const offer2 = String(competition.promoOffer2 || '').trim();
  if (offer1) offers.push({ title: offer1, code: String(competition.promoCode1 || '').trim() });
  if (offer2) offers.push({ title: offer2, code: String(competition.promoCode2 || '').trim() });
  return offers.length ? offers : DEFAULT_BLUEBERRY_OFFERS;
}

export interface BreachEmailClaim {
  email: string;
  userId: string;
  recipientName: string;
  competitionId: string;
  title: string;
  dailyDrawdownPercent: number;
  promo: {
    sponsorName: string;
    subtitle: string;
    hrefPath: string;
    cta: string;
    offers: Array<{ title: string; code: string }>;
  };
}

export function formatDrawdownPercentLabel(value: number | null | undefined): string {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '5';
  return Number.isInteger(n) ? String(n) : String(n).replace('.', ',');
}
