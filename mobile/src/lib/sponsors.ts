export type SponsorConfig = {
  key: string
  name: string
  logoUrl: string
  accent: string
  referralUrl: string
  requiresAccountId: boolean
  accountIdType: 'publicId' | 'email'
  gateFlow: 'standard' | 'intro'
  platformImageUrl?: string
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const SPONSORS: Record<string, SponsorConfig> = {
  ninjatrader: {
    key: 'ninjatrader',
    name: 'NinjaTrader',
    logoUrl: '/assets/pictures/ninjatrader-logo.webp',
    accent: '#e85d04',
    referralUrl: 'https://ninjatrader.com/GetStarted',
    requiresAccountId: true,
    accountIdType: 'email',
    gateFlow: 'intro',
    platformImageUrl: '/assets/pictures/ninjatrader-platform.webp',
  },
  kraken: {
    key: 'kraken',
    name: 'Kraken',
    logoUrl: '/assets/pictures/kraken-logo-white.webp',
    accent: '#5741d9',
    referralUrl: 'https://www.kraken.com/sign-up',
    requiresAccountId: true,
    accountIdType: 'publicId',
    gateFlow: 'standard',
  },
}

export function getSponsor(key?: string | null): SponsorConfig | null {
  if (!key) return null
  return SPONSORS[key] ?? null
}

export function isValidSponsorId(value: string, sponsor: SponsorConfig | null): boolean {
  const trimmed = value.trim()
  if (!trimmed || !sponsor) return false
  if (sponsor.accountIdType === 'email') return EMAIL_PATTERN.test(trimmed.toLowerCase())
  return /^[A-Z0-9]{16}$/.test(trimmed.replace(/\s+/g, '').toUpperCase())
}
