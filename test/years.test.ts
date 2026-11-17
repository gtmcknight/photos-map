import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clampYears, moveHandle } from '../src/content/years.ts';

test('a wanted range fits the years the library spans', () => {
  assert.deepEqual(clampYears(null, 2005, 2026), { from: 2005, to: 2026 });
  assert.deepEqual(clampYears({ from: 2013, to: 2019 }, 2005, 2026), { from: 2013, to: 2019 });
  // While a first pass streams in, older years aren't there yet.
  assert.deepEqual(clampYears({ from: 2013, to: 2019 }, 2015, 2026), { from: 2015, to: 2019 });
  // A range wholly outside comes to the nearest year, never a backwards span.
  assert.deepEqual(clampYears({ from: 1990, to: 1995 }, 2005, 2026), { from: 2005, to: 2005 });
  assert.deepEqual(clampYears({ from: 2030, to: 2040 }, 2005, 2026), { from: 2026, to: 2026 });
});

test('handles move by whole years and never cross', () => {
  const min = 2005;
  const max = 2026; // 22 years, edges 0..22
  const all = { from: 2005, to: 2026 };
  assert.deepEqual(moveHandle(all, 0, 8, min, max), { from: 2013, to: 2026 });
  assert.deepEqual(moveHandle(all, 1, 15, min, max), { from: 2005, to: 2019 });
  // Dragged past each other, they stop at one year.
  assert.deepEqual(moveHandle({ from: 2013, to: 2019 }, 0, 22, min, max), { from: 2019, to: 2019 });
  assert.deepEqual(moveHandle({ from: 2013, to: 2019 }, 1, 0, min, max), { from: 2013, to: 2013 });
  // Out past the ends, they stop at the first and last year.
  assert.deepEqual(moveHandle(all, 0, -4, min, max), all);
  assert.deepEqual(moveHandle(all, 1, 40, min, max), all);
});
