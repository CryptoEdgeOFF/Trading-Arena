export const MIN_LEVERAGE = 1
export const GLOBAL_MAX_LEVERAGE = 50

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

export function clampLeverage(value: number, category?: string | null): number {
  const max = maxLeverageForCategory(category)
  if (!Number.isFinite(value)) return max
  return Math.max(MIN_LEVERAGE, Math.min(max, Math.floor(value)))
}

export function leveragePresets(category?: string | null): number[] {
  const max = maxLeverageForCategory(category)
  if (max <= 10) return [2, 5, 10].filter((value) => value <= max)
  if (max <= 20) return [5, 10, 20].filter((value) => value <= max)
  if (max <= 30) return [10, 20, 30].filter((value) => value <= max)
  return [10, 20, 30, 50].filter((value) => value <= max)
}

export function leverageCategoryLabelKey(category?: string | null): string {
  if (category === 'forex') return 'terminal.catForex'
  if (category === 'indices' || category === 'index') return 'terminal.catIndices'
  if (category === 'commodities' || category === 'commodity') return 'terminal.catCommodities'
  if (category === 'actions') return 'terminal.catStocks'
  return 'terminal.catCrypto'
}
