import assert from 'node:assert/strict';
import test from 'node:test';
import { isRiskLevelTriggered } from './exchangePaperEngine.js';

test('long SL waits for the chart mark, not the synthetic bid', () => {
  const mark = 77_300;
  const sl = 77_299.8;
  assert.equal(isRiskLevelTriggered('long', 'sl', sl, mark), false);
  assert.equal(isRiskLevelTriggered('long', 'sl', sl, 77_299.8), true);
  assert.equal(isRiskLevelTriggered('long', 'sl', sl, 77_299.7), true);
});

test('short SL waits for the chart mark, not the synthetic ask', () => {
  const mark = 77_300;
  const sl = 77_300.2;
  assert.equal(isRiskLevelTriggered('short', 'sl', sl, mark), false);
  assert.equal(isRiskLevelTriggered('short', 'sl', sl, 77_300.2), true);
});

test('TP also triggers on the printed mark', () => {
  assert.equal(isRiskLevelTriggered('long', 'tp', 77_400, 77_399), false);
  assert.equal(isRiskLevelTriggered('long', 'tp', 77_400, 77_400), true);
  assert.equal(isRiskLevelTriggered('short', 'tp', 77_200, 77_201), false);
  assert.equal(isRiskLevelTriggered('short', 'tp', 77_200, 77_200), true);
});
