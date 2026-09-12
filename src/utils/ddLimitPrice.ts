import { computePositionPnl, pnlToAccountCcy } from './positionPnl'

export type DdLimitExposure = {
  pair: string
  side: 'long' | 'short'
  size: number
  entryPrice: number
}

function quoteCurrencyOf(pair: string): string {
  return (pair.split('/')[1] || '').toUpperCase()
}

function signedSize(exposure: DdLimitExposure): number {
  if (!Number.isFinite(exposure.size) || exposure.size <= 0) return 0
  return exposure.side === 'long' ? exposure.size : -exposure.size
}

/**
 * Prix sur `pair` auquel l'équité totale atteint `dailyLimitEquity`.
 * Les autres actifs sont figés à leur mark courant (via `equity`).
 */
export function ddLimitPriceForPair(args: {
  pair: string
  markPrice: number
  equity: number
  dailyLimitEquity: number
  exposures: DdLimitExposure[]
}): number | null {
  const { pair, markPrice, equity, dailyLimitEquity, exposures } = args
  if (
    !Number.isFinite(markPrice) || markPrice <= 0
    || !Number.isFinite(equity)
    || !Number.isFinite(dailyLimitEquity)
  ) {
    return null
  }

  const onPair = exposures.filter((item) => item.pair === pair && signedSize(item) !== 0)
  if (onPair.length === 0) return null

  let signedQty = 0
  let entryTerm = 0
  let currentPairPnl = 0
  for (const item of onPair) {
    const qty = signedSize(item)
    signedQty += qty
    entryTerm += qty * item.entryPrice
    currentPairPnl += computePositionPnl(
      {
        pair,
        side: item.side,
        size: item.size,
        entryPrice: item.entryPrice,
        markPrice,
      },
      markPrice,
    )
  }
  if (Math.abs(signedQty) < 1e-12) return null

  const targetPairPnl = dailyLimitEquity - equity + currentPairPnl
  const quote = quoteCurrencyOf(pair)
  const usdQuoted = !quote || quote === 'USD'

  let price: number
  if (usdQuoted) {
    price = (targetPairPnl + entryTerm) / signedQty
  } else {
    const denom = signedQty - targetPairPnl
    if (Math.abs(denom) < 1e-12) return null
    price = entryTerm / denom
  }

  if (!Number.isFinite(price) || price <= 0) return null

  const check = onPair.reduce((total, item) => {
    const raw = item.side === 'long'
      ? (price - item.entryPrice) * item.size
      : (item.entryPrice - price) * item.size
    return total + pnlToAccountCcy(pair, raw, price)
  }, 0)
  if (!Number.isFinite(check)) return null
  return price
}
