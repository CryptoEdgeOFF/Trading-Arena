/** Drapeau emoji à partir d'un code ISO-2 (FR → 🇫🇷). */
export function countryFlag(iso?: string | null): string {
  const code = String(iso || '').toUpperCase()
  if (!/^[A-Z]{2}$/.test(code)) return ''
  return String.fromCodePoint(...[...code].map((char) => 127397 + char.charCodeAt(0)))
}
