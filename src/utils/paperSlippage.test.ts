import assert from 'node:assert/strict';
import test from 'node:test';
import { estimatePaperSlippageBps, previewMarketExecutionPrice } from './paperSlippage';

test('BTC is penalized less than TRX for the same notional', () => {
  assert.ok(
    estimatePaperSlippageBps('BTC/USD', 1_000_000)
      < estimatePaperSlippageBps('TRX/USD', 1_000_000),
  );
});

test('market preview buys worse than ask and sells worse than bid', () => {
  const buy = previewMarketExecutionPrice('TRX/USD', 0.333, 4_000_000, 'long');
  const sell = previewMarketExecutionPrice('TRX/USD', 0.333, 4_000_000, 'short');
  assert.ok(buy > 0.333);
  assert.ok(sell < 0.333);
  assert.equal(previewMarketExecutionPrice('EUR/USD', 1.1, 10_000, 'long'), 1.1);
});
