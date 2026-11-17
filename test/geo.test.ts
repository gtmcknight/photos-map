import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cellsOf, coverTier } from '../src/content/geo.ts';
import type { Photo } from '../src/shared/types.ts';

const at = (la: number, lo: number): Photo => ({ k: `${la},${lo}`, t: 0, z: 0, la, lo, u: '', w: 1, h: 1 });

test('photos in the same ~1 km cell merge at their mean', () => {
  const cells = cellsOf([at(48.8601, 2.3501), at(48.8599, 2.3499), at(51.5, -0.12)]);
  assert.equal(cells.lo.length, 2);
  const i = cells.la[0] < 50 ? 0 : 1;
  assert.ok(Math.abs(cells.la[i] - 48.86) < 1e-9);
  assert.ok(Math.abs(cells.lo[i] - 2.35) < 1e-9);
});

test('a lone photo weighs 0.3 and the busiest cell weighs 1', () => {
  const home = Array.from({ length: 500 }, () => at(48.86, 2.35));
  const cells = cellsOf([...home, at(-22.9, -43.2)]);
  const weights = Array.from(cells.w).sort();
  assert.ok(Math.abs(weights[0] - 0.3) < 1e-6);
  assert.ok(Math.abs(weights[1] - 1) < 1e-6);
});

test('cells never collide across rows or the antimeridian', () => {
  const cells = cellsOf([at(0, 179.999), at(0, -179.999), at(0.01, 0), at(0, 0.01), at(-89.99, 0), at(89.99, 0)]);
  assert.equal(cells.lo.length, 6);
});

test('cells can leave photos out', () => {
  const photos = [at(48.86, 2.35), at(51.5, -0.12), at(51.5, -0.12)];
  const cells = cellsOf(photos, 0.01, (i) => i > 0);
  assert.equal(cells.lo.length, 1);
  assert.ok(Math.abs(cells.la[0] - 51.5) < 1e-9);
});

test('one photo alone still shows at full weight', () => {
  assert.deepEqual(Array.from(cellsOf([at(10, 10)]).w), [1]);
  assert.equal(cellsOf([]).lo.length, 0);
});

test('covers prefer real camera photos, favorites first', () => {
  const base = at(0, 0);
  assert.equal(coverTier({ ...base, f: 1, w: 4080, h: 3072 }), 0);
  assert.equal(coverTier({ ...base, w: 4080, h: 3072 }), 1);
  assert.equal(coverTier({ ...base, f: 1, w: 1080, h: 1350 }), 2);
  assert.equal(coverTier({ ...base, w: 4080, h: 3072, d: 9000 }), 3);
  assert.equal(coverTier({ ...base, w: 1080, h: 2400 }), 3);
});
