import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extract, sessionFromText } from '../src/content/google.ts';
import { parseItem, parsePage } from '../src/content/parse.ts';

// Shapes copied from the lcxiM timeline call, with made-up values.
function item(key: string, geo: unknown, extra: Record<string, unknown> = {}) {
  return [
    key,
    ['https://photos.fife.usercontent.google.com/pw/THUMB_' + key, 4080, 3072],
    1763240336000,
    'dedup',
    -18000000,
    1763240400000,
    null,
    [],
    { 129168200: geo, ...extra },
  ];
}
const nyc = [[null, null, null, null, null, 1], [[407127752, -740059728], null, null, false, [[null, [['New York', null, 1]], 'x']], 3]];

test('reads a photo with a location', () => {
  const p = parseItem(item('AF1Qa', nyc));
  assert.ok(p && p !== 'nogeo');
  assert.equal(p.k, 'AF1Qa');
  assert.equal(p.la, 40.7127752);
  assert.equal(p.lo, -74.0059728);
  assert.equal(p.z, -18000000);
  assert.equal(p.w, 4080);
  assert.equal(p.p, 'New York');
  assert.equal(p.d, undefined);
});

test('reads a favorite', () => {
  const p = parseItem(item('AF1Qf', nyc, { 163238866: [true] }));
  assert.ok(p && p !== 'nogeo');
  assert.equal(p.f, 1);
  const q = parseItem(item('AF1Qg', nyc, { 163238866: [false] }));
  assert.ok(q && q !== 'nogeo');
  assert.equal(q.f, undefined);
});

test('reads a video duration', () => {
  const p = parseItem(item('AF1Qv', nyc, { 76647426: [10159, null, 1080, 1920] }));
  assert.ok(p && p !== 'nogeo');
  assert.equal(p.d, 10159);
});

test('counts items with no location, or a null-island one, as no location', () => {
  assert.equal(parseItem(item('a', [[], [null, null, null, false]])), 'nogeo');
  assert.equal(parseItem(item('b', [[], [[0, 0]]])), 'nogeo');
  assert.equal(parseItem(item('c', [[], [[999999999, 5]]])), 'nogeo');
});

test('accepts coordinates already in degrees', () => {
  const p = parseItem(item('d', [[], [[38.7223, -9.1393]]]));
  assert.ok(p && p !== 'nogeo');
  assert.equal(p.la, 38.7223);
});

test('ignores rows that are not media items', () => {
  assert.equal(parseItem(null), null);
  assert.equal(parseItem(['', []]), null);
  assert.equal(parseItem([42]), null);
});

test('reads a page and its cursor', () => {
  const page = parsePage([[item('a', nyc), item('b', [[], [null]]), item('c', nyc)], 'NEXT', '1763240336000']);
  assert.equal(page.photos.length, 2);
  assert.equal(page.noLocation, 1);
  assert.equal(page.next, 'NEXT');
  assert.equal(parsePage([null, null]).next, null);
  assert.throws(() => parsePage('nope'));
});

test('pulls the payload out of a batchexecute answer', () => {
  const payload = JSON.stringify([[item('a', nyc)], null]);
  const text = `)]}'\n\n123\n${JSON.stringify([['wrb.fr', 'lcxiM', payload, null, null, null, 'generic']])}\n57\n[["di",42],["af.httprm",41,"x",1]]\n`;
  const out = extract(text, 'lcxiM') as unknown[];
  assert.equal(parsePage(out).photos.length, 1);
  assert.equal(extract(text, 'other'), undefined);
});

test('reads the session tokens from the page script', () => {
  const text = 'window.WIZ_global_data = {"SNlM0e":"tok\\u003d1","FdrFJe":"-123","cfb2h":"boq_x","eptZe":"/u/1/_/PhotosUi/","S06Grb":"9876"};';
  assert.deepEqual(sessionFromText(text), { at: 'tok=1', sid: '-123', bl: 'boq_x', path: '/u/1/_/PhotosUi/', account: '9876' });
  assert.equal(sessionFromText('nothing here'), null);
});
