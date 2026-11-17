import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec/dist/index.mjs';
import { dayOf, formatCount, formatDay, formatDuration, formatSpan, formatYears, leadingPlace, yearOf } from '../src/content/format.ts';
import type { Photo } from '../src/shared/types.ts';
import { buildStyle } from '../src/engine/style.ts';

const photo = (t: number, z: number, p?: string): Photo => ({ k: String(t), t, z, la: 0, lo: 0, u: '', w: 1, h: 1, p });

test('counts read like Google', () => {
  assert.equal(formatCount(0), '0 photos');
  assert.equal(formatCount(1), '1 photo');
  assert.equal(formatCount(12345), '12,345 photos');
});

test('day labels use the place and time the photo was taken', () => {
  const now = new Date(2026, 10, 16, 12);
  // 11pm in New York on Nov 14 is Nov 15 in UTC; the label must say the 14th.
  const lateNight = Date.UTC(2026, 10, 15, 4, 0);
  assert.equal(formatDay(dayOf(photo(lateNight, -5 * 3600_000)), now), 'Sat, Nov 14');
  assert.equal(formatDay(dayOf(photo(Date.UTC(2025, 6, 4, 12), 0)), now), 'Fri, Jul 4, 2025');
  const today = Math.floor((now.getTime() - now.getTimezoneOffset() * 60_000) / 86_400_000);
  assert.equal(formatDay(today, now), 'Today');
  assert.equal(formatDay(today - 1, now), 'Yesterday');
});

test('the span of photos in view reads like the Photos app', () => {
  assert.equal(formatSpan(Date.UTC(2013, 9, 5), Date.UTC(2026, 10, 16)), 'October 2013 – November 2026');
  assert.equal(formatSpan(Date.UTC(2026, 10, 1), Date.UTC(2026, 10, 16)), 'November 2026');
  assert.equal(formatYears({ from: 2013, to: 2019 }), '2013–2019');
  assert.equal(formatYears({ from: 2015, to: 2015 }), '2015');
});

test('a photo belongs to the year where it was taken', () => {
  // 11pm Dec 31 in New York is already Jan 1 in UTC.
  assert.equal(yearOf(photo(Date.UTC(2016, 0, 1, 4), -5 * 3600_000)), 2015);
  assert.equal(yearOf(photo(Date.UTC(2016, 0, 1, 4), 0)), 2016);
});

test('durations', () => {
  assert.equal(formatDuration(10159), '0:10');
  assert.equal(formatDuration(724000), '12:04');
  assert.equal(formatDuration(3723000), '1:02:03');
  assert.equal(formatDuration(200), '0:01');
});

test('a place leads only with a clear share', () => {
  const photos = [photo(1, 0, 'Lisbon'), photo(2, 0, 'Lisbon'), photo(3, 0, 'Porto'), photo(4, 0)];
  assert.equal(leadingPlace(photos, [0, 1, 2, 3]), 'Lisbon');
  assert.equal(leadingPlace(photos, [0, 2, 3]), '');
  assert.equal(leadingPlace(photos, [0, 2, 3], 0), 'Lisbon');
  assert.equal(leadingPlace(photos, []), '');
});

test('the map style is valid', () => {
  const errors = validateStyleMin(buildStyle());
  assert.deepEqual(errors.map((e: { message: string }) => e.message), []);
});
