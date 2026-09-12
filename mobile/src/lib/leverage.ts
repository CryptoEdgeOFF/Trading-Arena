export const MAX_LEVERAGE_BY_CATEGORY: Record<string, number> = {
  crypto: 10,
  actions: 10,
  forex: 50,
  indices: 30,
  index: 30,
  commodities: 20,
  commodity: 20,
}

export function maxLeverageForCategory(category?: string | null): number {
  if (!category) return MAX_LEVERAGE_BY_CATEGORY.crypto
  return MAX_LEVERAGE_BY_CATEGORY[category] ?? MAX_LEVERAGE_BY_CATEGORY.crypto
}

export function leveragePresets(category?: string | null): number[] {
  const max = maxLeverageForCategory(category)
  if (max <= 10) return [2, 5, 10].filter((value) => value <= max)
  if (max <= 20) return [5, 10, 20].filter((value) => value <= max)
  if (max <= 30) return [10, 20, 30].filter((value) => value <= max)
  return [10, 20, 30, 50].filter((value) => value <= max)
}

export function leverageCategoryLabel(category?: string | null): string {
  if (category === 'forex') return 'Forex'
  if (category === 'indices' || category === 'index') return 'Indices'
  if (category === 'commodities' || category === 'commodity') return 'Matières'
  if (category === 'actions') return 'Actions'
  return 'Crypto'
}
