import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compactPnlSamples,
  getPnlHistory,
  maybeRecordPnlSample,
  reconstructPnlHistoryFromTrades,
  resetPnlHistoryStoreForTests,
} from './pnlHistoryStore.js';

test('records equity from arena start including latent PnL', () => {
  resetPnlHistoryStoreForTests();
  maybeRecordPnlSample(
    'arena-1',
    [{ userId: 'trader-a', rank: 1, pnlPercent: 4.2 }],
    { startAt: 1_000, now: 20_000 },
  );
  const history = getPnlHistory('arena-1');
  assert.equal(history.length, 2);
  assert.equal(history[0].t, 1_000);
  assert.equal(history[0].rows[0]?.pnlPercent, 0);
  assert.equal(history[1].t, 20_000);
  assert.equal(history[1].rows[0]?.pnlPercent, 4.2);
});

test('keeps previous traders when a later sample only has the new leader', () => {
  resetPnlHistoryStoreForTests();
  maybeRecordPnlSample(
    'arena-2',
    [
      { userId: 'alpha', rank: 1, pnlPercent: 1 },
      { userId: 'bravo', rank: 2, pnlPercent: 0.4 },
    ],
    { startAt: 1_000, now: 20_000 },
  );
  maybeRecordPnlSample(
    'arena-2',
    [{ userId: 'alpha', rank: 1, pnlPercent: 2.5 }],
    { startAt: 1_000, now: 40_000 },
  );
  const last = getPnlHistory('arena-2').at(-1);
  const bravo = last?.rows.find((row) => row.userId === 'bravo');
  assert.ok(bravo);
  assert.equal(bravo?.pnlPercent, 0.4);
});

test('compact keeps the first sample, the last sample, and a bounded length', () => {
  const samples = Array.from({ length: 900 }, (_, index) => ({
    t: index * 10_000,
    rows: [{ userId: 'trader-a', pnlPercent: index * 0.01 }],
  }));
  const compacted = compactPnlSamples(samples);
  assert.ok(compacted.length <= 720);
  assert.equal(compacted[0]?.t, 0);
  assert.equal(compacted.at(-1)?.t, 899 * 10_000);
});

test('reconstruction includes latent PnL from open positions', () => {
  resetPnlHistoryStoreForTests();
  const startAt = 1_000_000;
  const now = startAt + 10_000;
  const samples = reconstructPnlHistoryFromTrades(
    'arena-3',
    startAt,
    startAt + 60_000,
    10_000,
    [{
      userId: 'trader-a',
      trades: [{ time: startAt + 1_000, action: 'close', pnl: 100 }],
      openPositions: [{ openedAt: startAt + 2_000, pnl: 200 }],
      finalPnlPercent: 3,
    }],
    now,
  );
  const mid = samples.find((sample) => sample.t === now);
  assert.ok(mid);
  const percent = mid?.rows[0]?.pnlPercent ?? 0;
  assert.ok(percent > 2.9 && percent < 3.1);
});

test('reconstruction does not overwrite a live recorded history', () => {
  resetPnlHistoryStoreForTests();
  maybeRecordPnlSample(
    'arena-4',
    [{ userId: 'trader-a', rank: 1, pnlPercent: 6 }],
    { startAt: 1_000, now: 20_000 },
  );
  const live = getPnlHistory('arena-4');
  const again = reconstructPnlHistoryFromTrades(
    'arena-4',
    1_000,
    80_000,
    10_000,
    [{ userId: 'trader-a', trades: [], finalPnlPercent: 99 }],
  );
  assert.deepEqual(again, live);
});
