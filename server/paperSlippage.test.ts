import assert from 'node:assert/strict';
import test from 'node:test';
import { applyPaperSlippage, estimatePaperSlippageBps, walkPaperLimitOrderBook } from './paperSlippage.js';

test('legacy execution never changes the requested price', () => {
  const quote = applyPaperSlippage('TRX/USD', 0.333, 4_000_000, 'buy', 'legacy');
  assert.equal(quote.executionPrice, 0.333);
  assert.equal(quote.slippageBps, 0);
  assert.equal(quote.source, 'legacy');
});

test('TRX million-dollar orders receive meaningful adverse impact', () => {
  const buy = applyPaperSlippage('TRX/USD', 0.333, 4_000_000, 'buy', 'slippage-v1');
  const sell = applyPaperSlippage('TRX/USD', 0.333, 4_000_000, 'sell', 'slippage-v1');

  assert.ok(buy.slippageBps > 15 && buy.slippageBps < 20);
  assert.ok(buy.executionPrice > buy.requestedPrice);
  assert.ok(sell.executionPrice < sell.requestedPrice);
  assert.equal(sell.slippageBps, buy.slippageBps);
  assert.equal(buy.source, 'model');
});

test('BTC is penalized less than TRX for the same notional', () => {
  const notional = 1_000_000;
  assert.ok(
    estimatePaperSlippageBps('BTC/USD', notional)
      < estimatePaperSlippageBps('TRX/USD', notional),
  );
});

test('small BTC tickets barely move, TRX keeps a real impact', () => {
  const btcSmall = estimatePaperSlippageBps('BTC/USD', 45_000);
  const trxSame = estimatePaperSlippageBps('TRX/USD', 45_000);
  assert.ok(btcSmall < 0.3);
  assert.ok(trxSame > 4 && trxSame < 6);
});

test('unknown crypto impact is capped at 50 bps', () => {
  assert.equal(estimatePaperSlippageBps('BONK/USD', 1_000_000_000), 50);
});

test('non-crypto pairs stay legacy during the crypto experiment', () => {
  assert.equal(estimatePaperSlippageBps('EUR/USD', 1_000_000), 0);
});

test('walks the visible iTick levels to calculate the average fill', () => {
  const quote = applyPaperSlippage(
    'TRX/USD',
    100,
    10,
    'buy',
    'slippage-v1',
    {
      asks: [
        { price: 100.1, volume: 5 },
        { price: 100.2, volume: 5 },
      ],
      bids: [],
    },
  );

  assert.equal(quote.executionPrice, 100.15);
  assert.ok(Math.abs(quote.slippageBps - 15) < 1e-9);
  assert.equal(quote.source, 'itick-l5');
});

test('extrapolates adverse impact after exhausting iTick L5', () => {
  const quote = applyPaperSlippage(
    'TRX/USD',
    0.3333,
    4_000_000,
    'sell',
    'slippage-v1',
    {
      asks: [],
      bids: [
        { price: 0.3333, volume: 1_000_000 },
        { price: 0.3332, volume: 1_000_000 },
      ],
    },
  );

  assert.equal(quote.source, 'itick-l5');
  assert.ok(quote.executionPrice < 0.3332);
  assert.ok(quote.slippageBps > 0);
});

test('limit buy keeps price improvement and stops at the price ceiling', () => {
  const quote = walkPaperLimitOrderBook(100.1, 10, 'buy', {
    asks: [
      { price: 99.9, volume: 3 },
      { price: 100.1, volume: 4 },
      { price: 100.2, volume: 100 },
    ],
    bids: [],
  });

  assert.equal(quote.filledSize, 7);
  assert.equal(quote.remainingSize, 3);
  assert.ok(Math.abs((quote.executionPrice ?? 0) - ((99.9 * 3 + 100.1 * 4) / 7)) < 1e-12);
  assert.deepEqual(quote.fills.map((fill) => fill.price), [99.9, 100.1]);
  assert.ok(quote.fills.every((fill) => fill.source === 'book'));
});

test('limit sell keeps price improvement and stops at the price floor', () => {
  const quote = walkPaperLimitOrderBook(99.9, 10, 'sell', {
    asks: [],
    bids: [
      { price: 100.2, volume: 2 },
      { price: 99.9, volume: 3 },
      { price: 99.8, volume: 100 },
    ],
  });

  assert.equal(quote.filledSize, 5);
  assert.equal(quote.remainingSize, 5);
  assert.ok(Math.abs((quote.executionPrice ?? 0) - ((100.2 * 2 + 99.9 * 3) / 5)) < 1e-12);
  assert.deepEqual(quote.fills.map((fill) => fill.price), [100.2, 99.9]);
});

test('limit walk never extrapolates absent visible liquidity', () => {
  const missing = walkPaperLimitOrderBook(100, 10, 'buy');
  const outside = walkPaperLimitOrderBook(99, 10, 'buy', {
    asks: [{ price: 100, volume: 50 }],
    bids: [],
  });

  assert.equal(missing.filledSize, 0);
  assert.equal(missing.executionPrice, null);
  assert.deepEqual(missing.fills, []);
  assert.equal(outside.filledSize, 0);
  assert.equal(outside.remainingSize, 10);
});
