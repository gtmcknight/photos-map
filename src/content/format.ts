import type { Photo, YearRange } from '../shared/types.ts';

const DAY = 86_400_000;
const number = new Intl.NumberFormat('en-US');
const day = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const monthYear = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const dayWithYear = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});

export const formatNumber = (n: number) => number.format(n);

export const formatCount = (n: number) => `${number.format(n)} ${n === 1 ? 'photo' : 'photos'}`;

/** The calendar day the photo was taken, in the place it was taken. */
export const dayOf = (p: Photo) => Math.floor((p.t + p.z) / DAY);

/** The calendar year the photo was taken, in the place it was taken. */
export const yearOf = (p: Photo) => new Date(p.t + p.z).getUTCFullYear();

/** "October 2013 – November 2026" from local times, or "November 2026" when it's one month. */
export function formatSpan(oldest: number, newest: number): string {
  const a = monthYear.format(new Date(oldest));
  const b = monthYear.format(new Date(newest));
  return a === b ? a : `${a} – ${b}`;
}

/** "2013–2019", or "2015" for one year. */
export const formatYears = (r: YearRange) => (r.from === r.to ? String(r.from) : `${r.from}–${r.to}`);

/** "Today", "Yesterday", "Sat, Nov 14", or "Sat, Nov 14, 2025", like the Photos grid. */
export function formatDay(d: number, now = new Date()): string {
  const today = Math.floor((now.getTime() - now.getTimezoneOffset() * 60_000) / DAY);
  if (d === today) return 'Today';
  if (d === today - 1) return 'Yesterday';
  const date = new Date(d * DAY);
  return (date.getUTCFullYear() === now.getFullYear() ? day : dayWithYear).format(date);
}

/** "0:10", "12:04", "1:02:03" */
export function formatDuration(ms: number): string {
  const total = Math.max(1, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** The place most of these photos share, if one clearly leads. */
export function leadingPlace(photos: Photo[], indexes: Iterable<number>, share = 0.5): string {
  const counts = new Map<string, number>();
  let total = 0;
  for (const i of indexes) {
    total++;
    const p = photos[i]?.p;
    if (p) counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  let best = '';
  let bestCount = 0;
  for (const [place, c] of counts) {
    if (c > bestCount) {
      best = place;
      bestCount = c;
    }
  }
  return total && bestCount / total >= share ? best : '';
}
