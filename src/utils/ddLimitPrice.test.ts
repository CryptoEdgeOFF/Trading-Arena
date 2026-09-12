import assert from 'node:assert/strict'
import test from 'node:test'
import { ddLimitPriceForPair } from './ddLimitPrice'

test('long BTC: 5% daily DD from a flat 100k is 5k below mark', () => {
  const price = ddLimitPriceForPair({
    pair: 'BTC/USD',
    markPrice: 100_000,
    equity: 100_000,
    dailyLimitEquity: 95_000,
    exposures: [{ pair: 'BTC/USD', side: 'long', size: 1, entryPrice: 100_000 }],
  })
  assert.equal(price, 95_000)
})

test('short BTC: same buffer sits 5k above mark', () => {
  const price = ddLimitPriceForPair({
    pair: 'BTC/USD',
    markPrice: 100_000,
    equity: 100_000,
    dailyLimitEquity: 95_000,
    exposures: [{ pair: 'BTC/USD', side: 'short', size: 1, entryPrice: 100_000 }],
  })
  assert.equal(price, 105_000)
})

test('other-asset loss shrinks the BTC buffer and moves the line closer', () => {
  const price = ddLimitPriceForPair({
    pair: 'BTC/USD',
    markPrice: 100_000,
    equity: 98_000,
    dailyLimitEquity: 95_000,
    exposures: [{ pair: 'BTC/USD', side: 'long', size: 1, entryPrice: 100_000 }],
  })
  assert.equal(price, 97_000)
})

test('no exposure on this pair → no line', () => {
  const price = ddLimitPriceForPair({
    pair: 'BTC/USD',
    markPrice: 100_000,
    equity: 100_000,
    dailyLimitEquity: 95_000,
    exposures: [{ pair: 'ETH/USD', side: 'long', size: 10, entryPrice: 4_000 }],
  })
  assert.equal(price, null)
})

test('hedged pair nets to zero → no line', () => {
  const price = ddLimitPriceForPair({
    pair: 'BTC/USD',
    markPrice: 100_000,
    equity: 100_000,
    dailyLimitEquity: 95_000,
    exposures: [
      { pair: 'BTC/USD', side: 'long', size: 1, entryPrice: 100_000 },
      { pair: 'BTC/USD', side: 'short', size: 1, entryPrice: 100_000 },
    ],
  })
  assert.equal(price, null)
})
