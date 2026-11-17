import type { Photo } from '../shared/types.ts';

export interface Cells {
  lo: Float64Array;
  la: Float64Array;
  /** 0.3 for a single photo up to 1 for the busiest cell */
  w: Float32Array;
}

/**
 * Photos summed into cells about 1 km across (0.01°), each placed at the mean
 * of its photos. A cell weighs the log of its count, so one photo on a trip
 * still shows and the cell around home doesn't wash out everything else.
 */
export function cellsOf(photos: Photo[], step = 0.01, keep?: (i: number) => boolean): Cells {
  const sums = new Map<number, [number, number, number]>();
  for (let i = 0; i < photos.length; i++) {
    if (keep && !keep(i)) continue;
    const p = photos[i];
    // Rows are 100,000 apart and a row spans at most ±18,000, so keys never collide.
    const key = Math.round(p.la / step) * 100_000 + Math.round(p.lo / step);
    const c = sums.get(key);
    if (c) {
      c[0] += p.lo;
      c[1] += p.la;
      c[2]++;
    } else {
      sums.set(key, [p.lo, p.la, 1]);
    }
  }
  let max = 1;
  for (const c of sums.values()) if (c[2] > max) max = c[2];
  const top = Math.log2(1 + max);
  const n = sums.size;
  const lo = new Float64Array(n);
  const la = new Float64Array(n);
  const w = new Float32Array(n);
  let i = 0;
  for (const [sumLo, sumLa, count] of sums.values()) {
    lo[i] = sumLo / count;
    la[i] = sumLa / count;
    w[i] = max === 1 ? 1 : 0.3 + (0.7 * (Math.log2(1 + count) - 1)) / (top - 1);
    i++;
  }
  return { lo, la, w };
}

/**
 * How good a photo is as the face of a group on the map. A place reads best as
 * a real camera photo (full size, not a video, screenshot or saved meme), so:
 * favorite camera photos, then any camera photo, then other favorites, then
 * the rest.
 */
export function coverTier(p: Photo): number {
  const camera = !p.d && p.w * p.h >= 6_000_000;
  if (camera) return p.f ? 0 : 1;
  return p.f ? 2 : 3;
}
