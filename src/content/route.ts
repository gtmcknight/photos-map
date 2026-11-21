import type { MapViewport, YearRange } from '../shared/types.ts';

// URL state, like Google Maps: #map, #map/@lat,lng,zoomz, and /2013-2019 (or
// /2015) when the map shows only some years.
const HASH = /^#map(?:\/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(\d+(?:\.\d+)?)z)?(?:\/(\d{4})(?:-(\d{4}))?)?$/;

export interface Route {
  open: boolean;
  viewport: MapViewport | null;
  years: YearRange | null;
}

/** A view the map can show: latitude within the map's edge, longitude wrapped, a sane zoom. */
export function fitViewport(v: MapViewport): MapViewport | null {
  const [lng, lat] = v.center;
  if (![lng, lat, v.zoom].every(Number.isFinite)) return null;
  return {
    center: [lng >= -180 && lng <= 180 ? lng : ((((lng + 180) % 360) + 360) % 360) - 180, Math.max(-85, Math.min(85, lat))],
    zoom: Math.max(0, Math.min(19, v.zoom)),
  };
}

export function readRoute(hash: string): Route {
  const m = hash.match(HASH);
  if (!m) return { open: false, viewport: null, years: null };
  const viewport = m[1] ? fitViewport({ center: [Number(m[2]), Number(m[1])], zoom: Number(m[3]) }) : null;
  let years: YearRange | null = null;
  if (m[4]) {
    const a = Number(m[4]);
    const b = m[5] ? Number(m[5]) : a;
    years = { from: Math.min(a, b), to: Math.max(a, b) };
  }
  return { open: true, viewport, years };
}

export function hashFor(viewport: MapViewport | null, years: YearRange | null): string {
  let hash = '#map';
  if (viewport) {
    const [lng, lat] = viewport.center;
    hash += `/@${lat.toFixed(5)},${lng.toFixed(5)},${viewport.zoom.toFixed(2)}z`;
  }
  if (years) hash += years.from === years.to ? `/${years.from}` : `/${years.from}-${years.to}`;
  return hash;
}

export const sameYears = (a: YearRange | null, b: YearRange | null) =>
  a === b || (!!a && !!b && a.from === b.from && a.to === b.to);

/**
 * The words of a Google Photos search page, or null for any other page. Its
 * URL is /search/<token>, where the token is a base64 protobuf whose first
 * field is the text that was searched for.
 */
export function searchQuery(pathname: string): string | null {
  const m = pathname.match(/^(?:\/u\/\d+)?\/search\/([^/]+)\/?$/);
  if (!m) return null;
  let bytes: Uint8Array;
  try {
    const b64 = decodeURIComponent(m[1]).replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
    const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
  // Field 1 as length-delimited bytes: the tag 0x0a, a varint length, the text.
  if (bytes[0] !== 0x0a) return null;
  let i = 1;
  let length = 0;
  for (let shift = 0; ; shift += 7) {
    if (i >= bytes.length || shift > 21) return null;
    const b = bytes[i++];
    length += (b & 0x7f) * 2 ** shift;
    if (b < 0x80) break;
  }
  if (length < 1 || length > 500 || i + length > bytes.length) return null;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(i, i + length)).trim();
    return text || null;
  } catch {
    return null;
  }
}
