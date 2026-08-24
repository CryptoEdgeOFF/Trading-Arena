import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DRAWDOWN_WARNING_RATIO,
  drawdownBufferConsumedRatio,
  isPodiumLoss,
  shouldNotifyCompletedLimit,
} from './notificationRules.js';

test('daily drawdown warning starts after 80 percent of the buffer is consumed', () => {
  const limit = 95_000;
  assert.ok(drawdownBufferConsumedRatio(100_000, 96_000, limit) >= DRAWDOWN_WARNING_RATIO);
  assert.ok(drawdownBufferConsumedRatio(100_000, 96_001, limit) < DRAWDOWN_WARNING_RATIO);
});

test('limit notification waits for the final partial fill', () => {
  const trade = { id: 'fill-1', orderId: 'limit-1', action: 'open', orderType: 'limit' };
  assert.equal(shouldNotifyCompletedLimit(trade, new Set(['limit-1'])), false);
  assert.equal(shouldNotifyCompletedLimit(trade, new Set()), true);
  assert.equal(shouldNotifyCompletedLimit({ ...trade, orderType: 'market' }, new Set()), false);
});

test('podium loss only matches a top-three to outside transition', () => {
  assert.equal(isPodiumLoss(3, 4), true);
  assert.equal(isPodiumLoss(2, 5), true);
  assert.equal(isPodiumLoss(4, 5), false);
  assert.equal(isPodiumLoss(3, 2), false);
  assert.equal(isPodiumLoss(undefined, 4), false);
});
