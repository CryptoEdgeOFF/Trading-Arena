import assert from 'node:assert/strict';
import test from 'node:test';
import { chunkItickDepthSymbols, parseItickDepthLevels } from './itick.js';

test('Professional depth batches are capped at 20 unique symbols', () => {
  const symbols = Array.from({ length: 50 }, (_, index) => `ASSET${index}USDT`);
  symbols.push('asset0usdt', ' ASSET1USDT ');
  const chunks = chunkItickDepthSymbols(symbols);

  assert.deepEqual(chunks.map((chunk) => chunk.length), [20, 20, 10]);
  assert.equal(new Set(chunks.flat()).size, 50);
  assert.ok(chunks.flat().every((symbol) => symbol === symbol.toUpperCase()));
});

test('depth parser keeps valid iTick levels and rejects malformed rows', () => {
  const levels = parseItickDepthLevels([
    { po: 1, p: 100.1, v: 12.5, o: 2 },
    { po: 2, p: 100.2, o: 3.5 },
    { po: 3, p: 0, v: 10 },
    { po: 4, p: 100.4, v: -1 },
    { po: 5, p: 'invalid', v: 1 },
  ]);

  assert.deepEqual(levels, [
    { position: 1, price: 100.1, volume: 12.5 },
    { position: 2, price: 100.2, volume: 3.5 },
  ]);
});
