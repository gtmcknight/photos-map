import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hashFor, readRoute, sameYears } from '../src/content/route.ts';

test('the map URL carries the view and the years', () => {
  assert.deepEqual(readRoute('#map'), { open: true, viewport: null, years: null });
  assert.deepEqual(readRoute('#map/@48.86000,2.35000,12.00z'), {
    open: true,
    viewport: { center: [2.35, 48.86], zoom: 12 },
    years: null,
  });
  assert.deepEqual(readRoute('#map/@48.86,2.35,12z/2013-2019').years, { from: 2013, to: 2019 });
  assert.deepEqual(readRoute('#map/2015').years, { from: 2015, to: 2015 });
  // Backwards years still mean the same span.
  assert.deepEqual(readRoute('#map/2019-2013').years, { from: 2013, to: 2019 });
  assert.equal(readRoute('#mapper').open, false);
  assert.equal(readRoute('#map/@1,2').open, false);
  assert.equal(readRoute('').open, false);
});

test('out-of-range links are brought within the map', () => {
  // MapLibre throws on a latitude past 90, which would leave the map broken on every visit.
  assert.deepEqual(readRoute('#map/@91,0,3z').viewport, { center: [0, 85], zoom: 3 });
  assert.deepEqual(readRoute('#map/@-120,200,30z').viewport, { center: [-160, -85], zoom: 19 });
});

test('URLs round-trip', () => {
  const viewport = { center: [2.35, 48.86] as [number, number], zoom: 12.5 };
  for (const years of [null, { from: 2013, to: 2019 }, { from: 2015, to: 2015 }]) {
    const r = readRoute(hashFor(viewport, years));
    assert.ok(r.open);
    assert.deepEqual(r.years, years);
    assert.deepEqual(r.viewport, viewport);
  }
  assert.equal(hashFor(null, null), '#map');
  assert.equal(hashFor(null, { from: 2015, to: 2015 }), '#map/2015');
});

test('year ranges compare by value', () => {
  assert.ok(sameYears(null, null));
  assert.ok(sameYears({ from: 1, to: 2 }, { from: 1, to: 2 }));
  assert.ok(!sameYears({ from: 1, to: 2 }, null));
  assert.ok(!sameYears({ from: 1, to: 2 }, { from: 1, to: 3 }));
});
