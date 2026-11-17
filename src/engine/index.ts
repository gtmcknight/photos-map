import { Map as MapLibreMap, Marker, setWorkerUrl, type GeoJSONSource, type VectorTileSource } from 'maplibre-gl';
import type { ExpressionSpecification } from '@maplibre/maplibre-gl-style-spec';
import maplibreCss from 'maplibre-gl/dist/maplibre-gl.css';
import type { Bounds, YearRange } from '../shared/types.ts';
import { BASE_TILES, buildStyle, type Theme } from './style.ts';

// Loaded on demand (dynamic import) the first time the map opens, so Google
// Photos pages that never show the map don't pay for MapLibre.

export type { Theme };
export type CellLevel = 'wide' | 'fine';

export interface EngineEvents {
  moved(view: { bounds: Bounds; center: [number, number]; zoom: number }): void;
  /** A one-photo bubble was clicked; from is where its photo sits */
  pick(i: number, from?: DOMRect): void;
  /** Something the map couldn't do, for the dev log */
  problem(message: string): void;
}

export interface Engine {
  /**
   * tier ranks each photo as a cover: 0 favorite, 1 full-size camera photo,
   * 2 anything else. A group's bubble shows its best tier, newest first.
   * year is the year each photo was taken.
   */
  setPoints(lo: Float64Array, la: Float64Array, tier: Uint8Array, year: Uint16Array, start: number, reset: boolean): void;
  /** Show only the photos from these years; null for all. */
  setYears(range: YearRange | null): void;
  /** Photos summed into cells; w is each cell's weight, 0..1 */
  setCells(level: CellLevel, lo: Float64Array, la: Float64Array, w: Float32Array): void;
  jumpTo(center: [number, number], zoom: number): void;
  fit(bounds: Bounds, animate: boolean): void;
  zoomBy(by: number): void;
  /** Pin an element (the photo bubble) to a spot; it follows the map. */
  showPin(el: HTMLElement, lo: number, la: number): void;
  hidePin(): void;
  contains(lo: number, la: number): boolean;
  /** Where a spot is in the map's own pixels */
  project(lo: number, la: number): [number, number];
  setTheme(theme: Theme): void;
}

interface Options {
  container: HTMLElement;
  /** Where MapLibre's stylesheet goes; the view lives in a shadow root */
  styleRoot: ShadowRoot;
  /** chrome-extension:// URL of maplibre-gl-worker.mjs */
  workerUrl: string;
  theme: Theme;
  /** Builds the element for a group of photos: i is the photo to show, count how many */
  bubble(i: number, count: number): HTMLElement;
  on: EngineEvents;
}

type PhotoFeature = GeoJSON.Feature<GeoJSON.Point, { s: number; y: number }>;

interface Group {
  i: number;
  count: number;
  at: [number, number];
  /** cluster_id; none for a single photo */
  group?: number;
}

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
const PHOTO_LAYERS = ['heat', 'heat-fine', 'heat-photos', 'groups', 'highlight'];
const PHOTO_SOURCES = ['photos', 'groups', 'cells-wide', 'cells-fine', 'highlight'];
/** A photo's cover score is tier * TIER + index; the lowest score in a group wins. */
const TIER = 1_000_000_000;
const MAX_BUBBLES = 120;
/** Room for the zoom buttons on the right and the years bar along the bottom. */
const FIT_PADDING = { top: 48, right: 72, bottom: 104, left: 48 };

// The heat by density: violet, magenta, coral, then warm cream where you've
// taken the most photos in the dark theme; raspberry at the top in the light
// one. Transparent at zero so the map shows through.
const HEAT: Record<Theme, (number | string)[]> = {
  dark: [0, 'rgba(96,40,190,0)', 0.04, 'rgba(96,40,190,0.28)', 0.18, 'rgba(132,48,206,0.52)', 0.38, 'rgba(196,58,178,0.7)', 0.6, 'rgba(246,94,122,0.84)', 0.8, 'rgba(255,158,92,0.92)', 1, 'rgba(255,226,168,0.97)'],
  light: [0, 'rgba(130,60,220,0)', 0.04, 'rgba(150,90,235,0.26)', 0.18, 'rgba(160,70,220,0.46)', 0.38, 'rgba(196,58,190,0.6)', 0.6, 'rgba(222,52,140,0.72)', 0.8, 'rgba(232,62,104,0.8)', 1, 'rgba(226,78,82,0.86)'],
};

/** The ring under the pinned photo, from the middle of the heat. */
const ACCENT: Record<Theme, string> = { dark: '#f2668f', light: '#c8358a' };

const heatColor = (theme: Theme) =>
  ['interpolate', ['linear'], ['heatmap-density'], ...HEAT[theme]] as unknown as ExpressionSpecification;

const inYears = (f: PhotoFeature, r: YearRange | null) => !r || (f.properties.y >= r.from && f.properties.y <= r.to);

let workerReady: Promise<void> | null = null;

/**
 * Google's page won't run a worker from an extension URL, but it will run one
 * from a blob made in this script's world: fetch the worker code and wrap it.
 */
function prepareWorker(url: string): Promise<void> {
  workerReady ??= (async () => {
    const code = await (await fetch(url)).text();
    setWorkerUrl(URL.createObjectURL(new Blob([code], { type: 'text/javascript' })));
  })();
  return workerReady;
}

type CellData = Record<CellLevel, GeoJSON.FeatureCollection>;

function addPhotoLayers(map: MapLibreMap, theme: Theme, data: GeoJSON.FeatureCollection, cells: CellData): void {
  map.addSource('photos', { type: 'geojson', data, maxzoom: 18, tolerance: 0, buffer: 64 });
  // The same photos grouped for the bubbles. Each group keeps its lowest
  // cover score: its newest favorite, else its newest camera photo.
  map.addSource('groups', {
    type: 'geojson',
    data,
    cluster: true,
    clusterRadius: 80,
    clusterMaxZoom: 17,
    clusterProperties: { s: ['min', ['get', 's']] },
  });
  map.addSource('cells-wide', { type: 'geojson', data: cells.wide, maxzoom: 12, tolerance: 0, buffer: 64 });
  map.addSource('cells-fine', { type: 'geojson', data: cells.fine, maxzoom: 16, tolerance: 0, buffer: 64 });
  map.addSource('highlight', { type: 'geojson', data: EMPTY });
  // Three scales of the same heat, cross-fading: ~1 km cells for the world and
  // the region, ~100 m cells for the city, and each photo on its own up close,
  // so the heat follows the exact streets and spots, as in the Photos app.
  // Cells weigh the log of their count, so one photo still shows and home
  // doesn't drown the rest.
  const color = heatColor(theme);
  map.addLayer({
    id: 'heat',
    type: 'heatmap',
    source: 'cells-wide',
    maxzoom: 11.5,
    paint: {
      'heatmap-weight': ['get', 'w'],
      'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 0, 0.6, 4, 0.9, 8, 1.4, 11, 2],
      'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 0, 7, 3, 10, 6, 14, 9, 20, 11, 26],
      'heatmap-color': color,
      'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 9.5, 1, 11.5, 0],
    },
  });
  map.addLayer({
    id: 'heat-fine',
    type: 'heatmap',
    source: 'cells-fine',
    minzoom: 9.5,
    maxzoom: 15.5,
    paint: {
      'heatmap-weight': ['get', 'w'],
      'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 9.5, 0.8, 12, 1.2, 15, 1.6],
      'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 9.5, 8, 12, 14, 15, 24],
      'heatmap-color': color,
      'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 9.5, 0, 11.5, 1, 14.2, 1, 15.5, 0],
    },
  });
  map.addLayer({
    id: 'heat-photos',
    type: 'heatmap',
    source: 'photos',
    minzoom: 14.2,
    paint: {
      // A lone photo is a faint glow; a spot shot many times runs hot. Wide
      // and soft, so nearby photos pool along the streets you walked.
      'heatmap-weight': 1,
      'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 14.2, 0.1, 17, 0.12, 19, 0.16],
      'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 14.2, 18, 17, 30, 19, 44],
      'heatmap-color': color,
      'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 14.2, 0, 15.5, 1],
    },
  });
  // Invisible: only here so the rendered groups can be read for the bubbles.
  map.addLayer({ id: 'groups', type: 'circle', source: 'groups', paint: { 'circle-radius': 20, 'circle-opacity': 0 } });
  map.addLayer({
    id: 'highlight',
    type: 'circle',
    source: 'highlight',
    paint: { 'circle-radius': 6, 'circle-color': ACCENT[theme], 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2.5 },
  });
}

export async function createEngine(opts: Options): Promise<Engine> {
  await prepareWorker(opts.workerUrl);
  if (!opts.styleRoot.querySelector('style[data-maplibre]')) {
    const style = document.createElement('style');
    style.dataset.maplibre = '';
    style.textContent = maplibreCss;
    opts.styleRoot.prepend(style);
  }

  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let theme = opts.theme;
  const map = new MapLibreMap({
    container: opts.container,
    style: buildStyle(theme),
    center: [-20, 28],
    zoom: 1.3,
    minZoom: 0.6,
    maxZoom: 19,
    attributionControl: false,
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
    maxPitch: 0,
  });
  map.touchZoomRotate.disableRotation();
  map.keyboard.disableRotation();

  // Every photo sent, by index; `shown` is the ones in the chosen years.
  let all: PhotoFeature[] = [];
  let shown: PhotoFeature[] = [];
  let years: YearRange | null = null;
  const cells: CellData = { wide: EMPTY, fine: EMPTY };
  let marker: Marker | null = null;
  const bubbles = new Map<string, { marker: Marker; group: Group }>();
  let groupsTimer = 0;
  let bubbleTimer = 0;
  let lastBubbles = 0;

  const source = (id: string) => map.getSource(id) as GeoJSONSource | undefined;
  const collection = (): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features: shown.slice() });
  const report = (e: unknown) => opts.on.problem(e instanceof Error ? e.message : String(e));
  const setData = (id: string, data: GeoJSON.FeatureCollection) => void source(id)?.setData(data)?.catch(report);
  const setHighlight = (lo: number | null, la = 0) =>
    setData(
      'highlight',
      lo === null
        ? EMPTY
        : { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [lo, la] }, properties: {} }] },
    );

  const openGroup = (g: Group, el: HTMLElement) => {
    if (g.group === undefined) {
      opts.on.pick(g.i, (el.querySelector('img') ?? el).getBoundingClientRect());
      return;
    }
    const zoomTo = (zoom: number) => map.easeTo({ center: g.at, zoom: Math.min(zoom, 18), duration: reduceMotion ? 0 : 350 });
    const src = source('groups');
    if (!src) return;
    src
      .getClusterExpansionZoom(g.group)
      .then(zoomTo)
      // The group changed under the click (the years moved): just go closer.
      .catch(() => zoomTo(map.getZoom() + 2));
  };

  /** Show a bubble for each group on screen, reusing the ones already there. */
  const refreshBubbles = () => {
    lastBubbles = performance.now();
    if (!map.getLayer('groups')) return;
    const found = new Map<string, Group>();
    for (const f of map.queryRenderedFeatures({ layers: ['groups'] })) {
      const p = f.properties as { cluster?: boolean; cluster_id?: number; point_count?: number; s?: number };
      const s = Number(p.s);
      if (!Number.isFinite(s)) continue;
      const i = s % TIER;
      const count = p.cluster ? Number(p.point_count) : 1;
      // A group is known by its cover and size, not its cluster_id: those are
      // handed to other groups whenever the photos change.
      const key = `${i}:${count}`;
      if (found.has(key)) continue;
      const at = (f.geometry as GeoJSON.Point).coordinates as [number, number];
      found.set(key, { i, count, at, group: p.cluster ? p.cluster_id : undefined });
    }
    let next = [...found];
    if (next.length > MAX_BUBBLES) next = next.sort((a, b) => b[1].count - a[1].count).slice(0, MAX_BUBBLES);
    const keep = new Set(next.map(([key]) => key));
    for (const [key, live] of bubbles) {
      if (!keep.has(key)) {
        live.marker.remove();
        bubbles.delete(key);
      }
    }
    for (const [key, group] of next) {
      const live = bubbles.get(key);
      if (live) {
        live.group = group;
        live.marker.setLngLat(group.at);
        continue;
      }
      const el = opts.bubble(group.i, group.count);
      const entry = { marker: new Marker({ element: el, anchor: 'center' }).setLngLat(group.at), group };
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        openGroup(entry.group, el);
      });
      entry.marker.addTo(map);
      bubbles.set(key, entry);
    }
  };
  /** While the map moves, regroup at most every 150 ms. */
  const refreshSoon = () => {
    if (bubbleTimer) return;
    const wait = Math.max(0, 150 - (performance.now() - lastBubbles));
    bubbleTimer = window.setTimeout(() => {
      bubbleTimer = 0;
      refreshBubbles();
    }, wait);
  };

  await new Promise<void>((resolve) => map.once('load', () => resolve()));
  addPhotoLayers(map, theme, collection(), cells);

  const moved = () => {
    const b = map.getBounds();
    const c = map.getCenter().wrap();
    opts.on.moved({ bounds: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], center: [c.lng, c.lat], zoom: map.getZoom() });
  };
  map.on('move', refreshSoon);
  map.on('moveend', () => {
    moved();
    refreshBubbles();
  });
  // After a jump, old tiles still draw until new ones arrive; once everything
  // has loaded and settled, read the groups again so no bubble is stale.
  map.on('idle', refreshBubbles);
  // Like the Photos app: click a glow to fly into it.
  map.on('click', (e) => {
    const zoom = map.getZoom();
    if (zoom >= 15) return;
    const r = 10;
    const near = map.querySourceFeatures(zoom < 10.5 ? 'cells-wide' : 'cells-fine').some((f) => {
      const [lo, la] = (f.geometry as GeoJSON.Point).coordinates;
      const p = map.project([lo, la]);
      return Math.abs(p.x - e.point.x) <= r && Math.abs(p.y - e.point.y) <= r;
    });
    if (near) map.easeTo({ center: e.lngLat, zoom: Math.min(zoom + 3, 16), duration: reduceMotion ? 0 : 350 });
  });

  // The base map's tiles and fonts come from OpenFreeMap. A request that fails
  // (offline, asleep, a blip) would leave that part of the map blank, so ask
  // again after a pause, backing off, and as soon as the connection is back.
  let retries = 0;
  let retryTimer = 0;
  let baseFailed = false;
  const reloadBase = () => {
    clearTimeout(retryTimer);
    retryTimer = 0;
    baseFailed = false;
    (map.getSource('osm') as VectorTileSource | undefined)?.setUrl(BASE_TILES);
  };
  map.on('error', (e) => {
    const { sourceId } = e as unknown as { sourceId?: string };
    report(`${sourceId ?? 'map'}: ${e.error?.message ?? 'error'}`);
    if (sourceId !== 'osm' || retryTimer) return;
    baseFailed = true;
    retryTimer = window.setTimeout(reloadBase, Math.min(60_000, 3000 * 2 ** retries++));
  });
  map.on('sourcedata', (e) => {
    if (e.sourceId === 'groups' && e.isSourceLoaded) refreshSoon();
    if (e.sourceId === 'osm' && e.isSourceLoaded && !baseFailed) retries = 0;
  });
  window.addEventListener('online', () => {
    if (!baseFailed) return;
    retries = 0;
    reloadBase();
  });
  moved();

  const setGroups = (now: boolean) => {
    clearTimeout(groupsTimer);
    groupsTimer = 0;
    if (now) setData('groups', collection());
    else groupsTimer = window.setTimeout(() => setGroups(true), 1000);
  };
  const update = (id: string, add: PhotoFeature[], remove: number[]) =>
    void source(id)?.updateData({ add, remove })?.catch(report);

  return {
    setPoints(lo, la, tier, year, start, reset) {
      const added: PhotoFeature[] = new Array(lo.length);
      for (let k = 0; k < lo.length; k++) {
        const i = start + k;
        added[k] = {
          type: 'Feature',
          id: i,
          geometry: { type: 'Point', coordinates: [lo[k], la[k]] },
          properties: { s: tier[k] * TIER + i, y: year[k] },
        };
      }
      const fresh = years ? added.filter((f) => inYears(f, years)) : added;
      if (reset) {
        all = added;
        shown = fresh.slice();
        setData('photos', collection());
        setGroups(true);
        return;
      }
      for (const f of added) all.push(f);
      if (!fresh.length) return;
      for (const f of fresh) shown.push(f);
      update('photos', fresh, []);
      // Grouping is rebuilt from every photo; while a first pass streams in, once a second.
      setGroups(false);
    },
    setYears(next) {
      const prev = years;
      if (prev === next || (prev && next && prev.from === next.from && prev.to === next.to)) return;
      years = next;
      // Send only what changed: MapLibre merges the changes that pile up
      // while its worker is busy, so dragging the years stays smooth.
      const add: PhotoFeature[] = [];
      const remove: number[] = [];
      const kept: PhotoFeature[] = [];
      for (const f of all) {
        const now = inYears(f, next);
        if (now) kept.push(f);
        if (now !== inYears(f, prev)) {
          if (now) add.push(f);
          else remove.push(f.id as number);
        }
      }
      shown = kept;
      if (!add.length && !remove.length) return;
      update('photos', add, remove);
      update('groups', add.slice(), remove.slice());
    },
    setCells(level, lo, la, w) {
      const features: GeoJSON.Feature[] = new Array(lo.length);
      for (let i = 0; i < lo.length; i++) {
        features[i] = { type: 'Feature', geometry: { type: 'Point', coordinates: [lo[i], la[i]] }, properties: { w: w[i] } };
      }
      cells[level] = { type: 'FeatureCollection', features };
      setData(`cells-${level}`, cells[level]);
    },
    jumpTo(center, zoom) {
      map.jumpTo({ center, zoom });
    },
    fit([w, s, e, n], animate) {
      map.fitBounds(
        [
          [w, s],
          [e, n],
        ],
        { padding: FIT_PADDING, maxZoom: 13, duration: animate && !reduceMotion ? 400 : 0 },
      );
    },
    zoomBy(by) {
      map.easeTo({ zoom: map.getZoom() + by, duration: reduceMotion ? 0 : 250 });
    },
    showPin(el, lo, la) {
      setHighlight(lo, la);
      if (!marker || marker.getElement() !== el) {
        marker?.remove();
        marker = new Marker({ element: el, anchor: 'bottom' });
      }
      marker.setLngLat([lo, la]).addTo(map);
    },
    hidePin() {
      setHighlight(null);
      marker?.remove();
    },
    contains(lo, la) {
      return map.getBounds().contains([lo, la]);
    },
    project(lo, la) {
      const p = map.project([lo, la]);
      return [p.x, p.y];
    },
    setTheme(next) {
      if (next === theme) return;
      theme = next;
      // A full reload (not a diff), so 'style.load' fires and the photo layers come back.
      map.setStyle(buildStyle(theme), { diff: false });
      map.once('style.load', () => {
        for (const id of PHOTO_LAYERS) if (map.getLayer(id)) map.removeLayer(id);
        for (const id of PHOTO_SOURCES) if (map.getSource(id)) map.removeSource(id);
        addPhotoLayers(map, theme, collection(), cells);
      });
    },
  };
}
