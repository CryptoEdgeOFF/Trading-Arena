/**
 * Registre des sponsors d'arènes (côté client).
 *
 * Le serveur ne connaît que la clé du sponsor (ex. 'kraken') et sait quels
 * sponsors imposent la saisie d'un identifiant public au join
 * (cf. SPONSOR_DEFS dans server/competitionManager.ts). Tout ce qui est
 * présentation (logo, couleurs, lien de parrainage) vit ici.
 *
 * Pour ajouter un sponsor : ajouter une entrée ici ET la clé correspondante
 * dans SPONSOR_DEFS côté serveur.
 */
export type SponsorAccountIdType = 'publicId' | 'email';
export type SponsorGateFlow = 'standard' | 'intro';

export interface SponsorConfig {
  key: string;
  /** Nom affiché du sponsor (ex. "Kraken"). */
  name: string;
  /** Logo blanc (transparent) affiché en badge dans le coin des cartes. */
  logoUrl: string;
  /** Couleur d'accent principale (hex). Remplace le rouge BTF sur les éléments themés. */
  accent: string;
  /** Variante claire de l'accent (hex) pour les textes/contours. */
  accentSoft: string;
  /** Lien de parrainage vers lequel envoyer le participant pour s'inscrire. */
  referralUrl: string;
  /** Le participant doit-il saisir un identifiant public pour accéder à l'arène ? */
  requiresAccountId: boolean;
  /** Type d'identifiant attendu (ID public Kraken vs email NinjaTrader). */
  accountIdType?: SponsorAccountIdType;
  /** Parcours d'inscription : standard (Kraken) ou intro multi-étapes (NinjaTrader). */
  gateFlow?: SponsorGateFlow;
  /** Capture d'écran / visuel de la plateforme sponsor (modale intro). */
  platformImageUrl?: string;
  /** Exemple d'identifiant affiché en placeholder (pas un vrai compte). */
  accountIdExample?: string;
  /**
   * Valide le format de l'identifiant saisi (espaces ignorés). Retourne true
   * si le format est plausible. Utilisé côté UI pour bloquer la soumission.
   */
  validateAccountId?: (value: string) => boolean;
}

/** Forme canonique d'un identifiant public (espaces retirés, majuscules). */
export function cleanAccountId(value: string): string {
  return value.replace(/\s+/g, '').toUpperCase();
}

/** Normalise l'identifiant sponsor avant envoi API. */
export function normalizeSponsorAccountId(value: string, sponsor: SponsorConfig | null): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (sponsor?.accountIdType === 'email') return trimmed.toLowerCase();
  return cleanAccountId(trimmed);
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const SPONSORS: Record<string, SponsorConfig> = {
  kraken: {
    key: 'kraken',
    name: 'Kraken',
    logoUrl: '/assets/pictures/kraken-logo-white.webp',
    accent: '#5741d9',
    accentSoft: '#a99bff',
    referralUrl: 'https://www.kraken.com/sign-up',
    requiresAccountId: true,
    accountIdType: 'publicId',
    gateFlow: 'standard',
    accountIdExample: 'AA38 N84G TUDE DOOA',
    validateAccountId: (value) => /^[A-Z0-9]{16}$/.test(cleanAccountId(value)),
  },
  ninjatrader: {
    key: 'ninjatrader',
    name: 'NinjaTrader',
    logoUrl: '/assets/pictures/ninjatrader-logo.webp',
    accent: '#e85d04',
    accentSoft: '#ffb366',
    referralUrl: 'https://ninjatrader.com/GetStarted',
    requiresAccountId: true,
    accountIdType: 'email',
    gateFlow: 'intro',
    platformImageUrl: '/assets/pictures/ninjatrader-platform.webp',
    accountIdExample: 'trader@email.com',
    validateAccountId: (value) => EMAIL_PATTERN.test(value.trim().toLowerCase()),
  },
};

export function getSponsor(key?: string | null): SponsorConfig | null {
  if (!key) return null;
  return SPONSORS[key] ?? null;
}

/** Liste utilisable dans un <select> admin. */
export const SPONSOR_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'Aucun (BTF)' },
  ...Object.values(SPONSORS).map((sponsor) => ({ value: sponsor.key, label: sponsor.name })),
];
