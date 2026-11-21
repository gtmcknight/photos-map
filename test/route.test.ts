import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hashFor, readRoute, sameYears, searchQuery } from '../src/content/route.ts';

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

// A search page's token: field 1 (tag 0x0a), its length as a varint, the text.
function token(text: string, tail: number[] = []): string {
  const bytes = new TextEncoder().encode(text);
  const length: number[] = [];
  for (let n = bytes.length; ; n >>= 7) {
    if (n < 0x80) {
      length.push(n);
      break;
    }
    length.push((n & 0x7f) | 0x80);
  }
  return Buffer.from([0x0a, ...length, ...bytes, ...tail]).toString('base64url');
}

test('a search page carries the words searched for', () => {
  // Real tokens from Google Photos' search URLs.
  assert.equal(searchQuery('/search/CgViZWFjaCIHCgViZWFjaCiMhormnzQ4Aw%3D%3D'), 'beach');
  assert.equal(searchQuery('/search/CgZzdW5zZXQiCAoGc3Vuc2V0KMzJjeafNDgD'), 'sunset');
  assert.equal(searchQuery('/u/1/search/CgZzdW5zZXQiCAoGc3Vuc2V0KMzJjeafNDgD'), 'sunset');
  // Any language, more fields after the text, and a length that takes two bytes.
  assert.equal(searchQuery(`/search/${token('café au lait', [0x38, 0x03])}`), 'café au lait');
  assert.equal(searchQuery(`/search/${token('東京')}`), '東京');
  assert.equal(searchQuery(`/search/${token('x'.repeat(200))}`), 'x'.repeat(200));
});

test('anything else is not a search', () => {
  assert.equal(searchQuery('/'), null);
  assert.equal(searchQuery('/places'), null);
  // Google's viewer over its own results
  assert.equal(searchQuery('/search/CgZzdW5zZXQiCAoGc3Vuc2V0KMzJjeafNDgD/photo/AF1QipX'), null);
  assert.equal(searchQuery('/search/not+base64!'), null);
  // The text isn't field 1, runs past the end, isn't UTF-8, or is blank.
  assert.equal(searchQuery(`/search/${Buffer.from([0x12, 3, 0x61, 0x62, 0x63]).toString('base64')}`), null);
  assert.equal(searchQuery(`/search/${Buffer.from([0x0a, 9, 0x61]).toString('base64')}`), null);
  assert.equal(searchQuery(`/search/${Buffer.from([0x0a, 2, 0xff, 0xfe]).toString('base64')}`), null);
  assert.equal(searchQuery(`/search/${token('   ')}`), null);
});
