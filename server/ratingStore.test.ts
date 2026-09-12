import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arenaResultPoints } from './ratingStore.ts';

test('2nd place awards 80 plus the field-size bonus', () => {
  assert.equal(arenaResultPoints(2, 99, false), 80 + Math.floor(Math.log2(99)));
});

test('maluses stay negative, unranked stays 0', () => {
  assert.equal(arenaResultPoints(2, 99, true), -25);
  assert.equal(arenaResultPoints(80, 99, false), -10);
  assert.equal(arenaResultPoints(0, 10, false), 0);
});
