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
