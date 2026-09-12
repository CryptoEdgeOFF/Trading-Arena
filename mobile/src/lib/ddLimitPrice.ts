export type DdLimitExposure = {
  pair: string
  side: 'long' | 'short'
  size: number
  entryPrice: number
}

function quoteCurrencyOf(pair: string): string {
  return (pair.split('/')[1] || '').toUpperCase()
}

function pnlToAccountCcy(pair: string, rawPnl: number, conversionPrice: number): number {
  const quote = quoteCurrencyOf(pair)
  if (!quote || quote === 'USD') return rawPnl
  if (!Number.isFinite(conversionPrice) || conversionPrice <= 0) return rawPnl
  return rawPnl / conversionPrice
}

function computePositionPnl(
  position: Pick<DdLimitExposure, 'pair' | 'side' | 'size' | 'entryPrice'>,
  markPrice: number,
): number {
  const rawPnl = position.side === 'long'
    ? (markPrice - position.entryPrice) * position.size
    : (position.entryPrice - markPrice) * position.size
  return pnlToAccountCcy(position.pair, rawPnl, markPrice)
}

function signedSize(exposure: DdLimitExposure): number {
  if (!Number.isFinite(exposure.size) || exposure.size <= 0) return 0
  return exposure.side === 'long' ? exposure.size : -exposure.size
}

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
    currentPairPnl += computePositionPnl(item, markPrice)
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
  return price
}
