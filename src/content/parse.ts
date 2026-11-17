import type { Photo } from '../shared/types.ts';

// Keys inside the extension object that ends each timeline item.
const GEO = '129168200';
const VIDEO = '76647426';
const FAVORITE = '163238866';

export interface Page {
  photos: Photo[];
  /** Items on this page with no usable location */
  noLocation: number;
  /** Cursor for the next page, null on the last one */
  next: string | null;
}

/** Coordinates come as E7 integers; accept plain degrees too. */
function degrees(v: number): number {
  return Math.abs(v) > 1000 ? v / 1e7 : v;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function at(v: unknown, ...path: number[]): unknown {
  let cur = v;
  for (const i of path) {
    if (!Array.isArray(cur)) return undefined;
    cur = cur[i];
  }
  return cur;
}

/**
 * One item from the `lcxiM` timeline call.
 * Returns the photo, 'nogeo' when it has no location, or null when it isn't a media item.
 */
export function parseItem(item: unknown): Photo | 'nogeo' | null {
  if (!Array.isArray(item) || typeof item[0] !== 'string' || !item[0]) return null;
  const ext = item[item.length - 1];
  const geo = isRecord(ext) ? at(ext[GEO], 1) : undefined;
  const xy = at(geo, 0);
  if (!Array.isArray(xy) || typeof xy[0] !== 'number' || typeof xy[1] !== 'number') return 'nogeo';
  const la = degrees(xy[0]);
  const lo = degrees(xy[1]);
  const valid = Number.isFinite(la) && Number.isFinite(lo) && Math.abs(la) <= 90 && Math.abs(lo) <= 180;
  if (!valid || (la === 0 && lo === 0)) return 'nogeo';

  const u = at(item, 1, 0);
  if (typeof u !== 'string' || !u.startsWith('https://')) return null;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

  const photo: Photo = {
    k: item[0],
    t: num(item[2]),
    z: num(item[4]),
    la,
    lo,
    u,
    w: num(at(item, 1, 1)),
    h: num(at(item, 1, 2)),
  };
  const duration = isRecord(ext) ? at(ext[VIDEO], 0) : undefined;
  if (typeof duration === 'number' && duration > 0) photo.d = duration;
  if (isRecord(ext) && at(ext[FAVORITE], 0) === true) photo.f = 1;
  const place = at(geo, 4, 0, 1, 0, 0);
  if (typeof place === 'string' && place.trim()) photo.p = place.trim();
  return photo;
}

export function parsePage(data: unknown): Page {
  if (!Array.isArray(data)) throw new Error('The timeline answer changed shape');
  const items = Array.isArray(data[0]) ? data[0] : [];
  const photos: Photo[] = [];
  let noLocation = 0;
  for (const item of items) {
    const parsed = parseItem(item);
    if (parsed === 'nogeo') noLocation++;
    else if (parsed) photos.push(parsed);
  }
  const next = typeof data[1] === 'string' && data[1] ? data[1] : null;
  return { photos, noLocation, next };
}
