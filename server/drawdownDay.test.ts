import assert from 'node:assert/strict';
import test from 'node:test';
import { drawdownDayKey } from './drawdownDay.js';

test('drawdown day rolls at 09:00 Paris in winter (UTC+1)', () => {
  assert.equal(drawdownDayKey(Date.UTC(2026, 0, 15, 7, 59)), '2026-01-14');
  assert.equal(drawdownDayKey(Date.UTC(2026, 0, 15, 8, 0)), '2026-01-15');
});

test('drawdown day rolls at 09:00 Paris in summer (UTC+2)', () => {
  assert.equal(drawdownDayKey(Date.UTC(2026, 6, 15, 6, 59)), '2026-07-14');
  assert.equal(drawdownDayKey(Date.UTC(2026, 6, 15, 7, 0)), '2026-07-15');
});

test('drawdown day follows the Paris spring DST jump', () => {
  assert.equal(drawdownDayKey(Date.UTC(2026, 2, 29, 6, 59)), '2026-03-28');
  assert.equal(drawdownDayKey(Date.UTC(2026, 2, 29, 7, 0)), '2026-03-29');
});
