import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DRAWDOWN_WARNING_RATIO,
  buildTradingPushPayload,
  drawdownBufferConsumedRatio,
  isPodiumLoss,
  shouldAnnounceNewArenaPush,
  shouldNotifyCompletedLimit,
  shouldSendNewsPush,
  shouldWarnDailyDrawdown,
  tradingClosePushKind,
} from './notificationRules.js';

test('daily drawdown warning starts after 80 percent of the buffer is consumed', () => {
  const limit = 95_000;
  assert.ok(drawdownBufferConsumedRatio(100_000, 96_000, limit) >= DRAWDOWN_WARNING_RATIO);
  assert.ok(drawdownBufferConsumedRatio(100_000, 96_001, limit) < DRAWDOWN_WARNING_RATIO);
});

test('drawdown warning is once per UTC day and resets the next day', () => {
  const ratio = drawdownBufferConsumedRatio(100_000, 96_000, 95_000);
  assert.equal(shouldWarnDailyDrawdown(ratio, null, '2026-08-24'), true);
  assert.equal(shouldWarnDailyDrawdown(ratio, '2026-08-24', '2026-08-24'), false);
  assert.equal(shouldWarnDailyDrawdown(ratio, '2026-08-24', '2026-08-25'), true);
});

test('limit notification waits for the final partial fill', () => {
  const trade = { id: 'fill-1', orderId: 'limit-1', action: 'open', orderType: 'limit' };
  assert.equal(shouldNotifyCompletedLimit(trade, new Set(['limit-1'])), false);
  assert.equal(shouldNotifyCompletedLimit(trade, new Set()), true);
  assert.equal(shouldNotifyCompletedLimit({ ...trade, orderType: 'market' }, new Set()), false);
});

test('legacy limit fill without orderId notifies when the parent order is gone', () => {
  const legacy = { id: 'legacy-fill', action: 'open', orderType: 'limit' as const };
  assert.equal(shouldNotifyCompletedLimit(legacy, new Set(['other-order'])), true);
  assert.equal(shouldNotifyCompletedLimit(legacy, new Set(['legacy-fill'])), false);
});

test('TP and SL closes map to the right push kinds', () => {
  assert.equal(tradingClosePushKind('take-profit'), 'take_profit');
  assert.equal(tradingClosePushKind('stop-loss'), 'stop_loss');
  assert.equal(tradingClosePushKind('manual'), null);
  const tp = buildTradingPushPayload({ kind: 'take_profit', pair: 'BTC/USD', price: 100_000, pnl: 42.5 });
  const sl = buildTradingPushPayload({ kind: 'stop_loss', pair: 'ETH/USD', price: 3_000, pnl: -12 });
  assert.match(tp.title, /Take Profit/);
  assert.match(tp.body, /BTC\/USD/);
  assert.match(tp.body, /\+42\.50/);
  assert.match(sl.title, /Stop Loss/);
  assert.match(sl.body, /-12\.00/);
});

test('podium loss only matches a top-three to outside transition', () => {
  assert.equal(isPodiumLoss(3, 4), true);
  assert.equal(isPodiumLoss(2, 5), true);
  assert.equal(isPodiumLoss(4, 5), false);
  assert.equal(isPodiumLoss(3, 2), false);
  assert.equal(isPodiumLoss(undefined, 4), false);
});

test('new arena push is public, not historical, and only once', () => {
  assert.equal(shouldAnnounceNewArenaPush({
    initialized: true, isPublic: true, alreadyNotified: false, status: 'registration',
  }), true);
  assert.equal(shouldAnnounceNewArenaPush({
    initialized: false, isPublic: true, alreadyNotified: false, status: 'registration',
  }), false);
  assert.equal(shouldAnnounceNewArenaPush({
    initialized: true, isPublic: true, alreadyNotified: true, status: 'registration',
  }), false);
  assert.equal(shouldAnnounceNewArenaPush({
    initialized: true, isPublic: false, alreadyNotified: false, status: 'registration',
  }), false);
  assert.equal(shouldAnnounceNewArenaPush({
    initialized: true, isPublic: true, alreadyNotified: false, status: 'ended',
  }), false);
});

test('news push fires on first publish only', () => {
  assert.equal(shouldSendNewsPush({ published: false, pushSentAt: null }), false);
  assert.equal(shouldSendNewsPush({ published: true, pushSentAt: null }), true);
  assert.equal(shouldSendNewsPush({ published: true, pushSentAt: 1 }), false);
});
