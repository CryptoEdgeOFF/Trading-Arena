import { countryFlag } from '../lib/country'

export function PlayerName({ name, country }: { name: string; country?: string | null }) {
  const flag = countryFlag(country)
  return (
    <>
      {name}
      {flag ? <i className="country-flag" aria-label={country || undefined}>{flag}</i> : null}
    </>
  )
}
