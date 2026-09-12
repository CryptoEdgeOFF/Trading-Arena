import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyDepthLevels,
  isContiguousDepthEvent,
  shouldAcceptFirstDepthEvent,
} from './binanceOrderBook.js';

test('first depth event must overlap the REST lastUpdateId', () => {
  assert.equal(shouldAcceptFirstDepthEvent({ U: 10, u: 15 }, 12), true);
  assert.equal(shouldAcceptFirstDepthEvent({ U: 13, u: 15 }, 12), false);
  assert.equal(shouldAcceptFirstDepthEvent({ U: 8, u: 11 }, 12), false);
});

test('later events must be contiguous via pu', () => {
  assert.equal(isContiguousDepthEvent({ pu: 15, u: 18 }, 15), true);
  assert.equal(isContiguousDepthEvent({ pu: 14, u: 18 }, 15), false);
});

test('qty 0 removes a level and positive qty upserts it', () => {
  const side = new Map<string, number>([['100', 4]]);
  applyDepthLevels(side, [['100', '0'], ['101', '2.5'], ['bad', 'x']]);
  assert.equal(side.has('100'), false);
  assert.equal(side.get('101'), 2.5);
});
