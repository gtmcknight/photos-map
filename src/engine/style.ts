import type { StyleSpecification } from 'maplibre-gl';

export type Theme = 'light' | 'dark';

// Light: colors sampled from Google Maps' roadmap tiles (Nov 2026): cyan water,
// mint parks, light gray land, blue-gray highways, white streets.
// Dark: the same map in Google Photos' dark surfaces (#131314 page, #1e1f20 cards).
// Both drawn on OpenFreeMap's OpenStreetMap vector tiles.
const PALETTES = {
  light: {
    land: '#f5f5f5',
    waterLow: '#72d4e8',
    water: '#90daee',
    waterLabel: '#0b8199',
    park: '#c3f1d5',
    wood: '#cdeed9',
    sand: '#f8f0de',
    ice: '#ffffff',
    building: '#e9eaee',
    buildingLine: '#dcdee3',
    highway: '#abbcd6',
    highwayCase: '#93a8c4',
    arterial: '#d6dee6',
    arterialCase: '#c4ced9',
    street: '#ffffff',
    streetCase: '#dfe3e8',
    border: '#9aa0a6',
    stateBorder: '#c1c6cc',
    label: '#5f6368',
    labelStrong: '#3c4043',
    labelSoft: '#70757a',
    hood: '#2d3436',
    halo: '#ffffff',
    waterHalo: 'rgba(255,255,255,0.6)',
    // Place names by kind, as Google Maps colors them.
    food: '#d45c00',
    arts: '#8443d1',
    green: '#1b825a',
    shop: '#1a73e8',
    school: '#546e7a',
    transit: '#3b5363',
  },
  dark: {
    // Water sits darker than land, as on Apple and Google's night maps, so the
    // photos and their glow are the brightest thing on screen.
    land: '#25272b',
    waterLow: '#0f1a26',
    water: '#122030',
    waterLabel: '#6d8eaa',
    park: '#1f3326',
    wood: '#1e3024',
    sand: '#2d2b26',
    ice: '#2e3034',
    building: '#2e3034',
    buildingLine: '#37393e',
    highway: '#4c5568',
    highwayCase: '#3c4352',
    arterial: '#3d4148',
    arterialCase: '#32353b',
    street: '#35383d',
    streetCase: '#2a2c30',
    border: '#70757a',
    stateBorder: '#4d5156',
    label: '#9aa0a6',
    labelStrong: '#c4c7c5',
    labelSoft: '#80868b',
    hood: '#c4c7c5',
    halo: '#131314',
    waterHalo: 'rgba(19,19,20,0.6)',
    food: '#f29c51',
    arts: '#c49ef5',
    green: '#7fcf9f',
    shop: '#8ab4f8',
    school: '#9aa0a6',
    transit: '#a8c7fa',
  },
} as const;

type Palette = (typeof PALETTES)[Theme];

/** OpenFreeMap's index of its current OpenStreetMap tiles (TileJSON). */
export const BASE_TILES = 'https://tiles.openfreemap.org/planet';

const NAME = ['coalesce', ['get', 'name:en'], ['get', 'name:latin'], ['get', 'name']];
const REGULAR = ['Noto Sans Regular'];
const BOLD = ['Noto Sans Bold'];
const ITALIC = ['Noto Sans Italic'];

const width = (stops: number[]) => ['interpolate', ['exponential', 1.5], ['zoom'], ...stops];
const cls = (...names: string[]) => ['match', ['get', 'class'], names, true, false];

export function buildStyle(theme: Theme = 'light'): StyleSpecification {
  const C = PALETTES[theme];
  const style = {
    version: 8,
    name: `Map for Google Photos ${theme}`,
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: {
      osm: { type: 'vector', url: BASE_TILES },
    },
    layers: [
      { id: 'land', type: 'background', paint: { 'background-color': C.land } },
      {
        id: 'landcover-wood',
        type: 'fill',
        source: 'osm',
        'source-layer': 'landcover',
        filter: cls('wood', 'forest'),
        paint: { 'fill-color': C.wood, 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0.4, 10, 0.8] },
      },
      {
        id: 'landcover-grass',
        type: 'fill',
        source: 'osm',
        'source-layer': 'landcover',
        filter: cls('grass', 'wetland'),
        paint: { 'fill-color': C.park, 'fill-opacity': 0.6 },
      },
      { id: 'landcover-sand', type: 'fill', source: 'osm', 'source-layer': 'landcover', filter: cls('sand'), paint: { 'fill-color': C.sand } },
      { id: 'landcover-ice', type: 'fill', source: 'osm', 'source-layer': 'landcover', filter: cls('ice'), paint: { 'fill-color': C.ice } },
      {
        id: 'park',
        type: 'fill',
        source: 'osm',
        'source-layer': 'park',
        paint: { 'fill-color': C.park, 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 6, 0.5, 11, 1] },
      },
      {
        id: 'landuse-green',
        type: 'fill',
        source: 'osm',
        'source-layer': 'landuse',
        filter: cls('park', 'cemetery', 'pitch', 'garden', 'golf_course', 'recreation_ground', 'playground'),
        paint: { 'fill-color': C.park },
      },
      {
        id: 'water',
        type: 'fill',
        source: 'osm',
        'source-layer': 'water',
        filter: ['!=', ['get', 'brunnel'], 'tunnel'],
        paint: { 'fill-color': ['interpolate', ['linear'], ['zoom'], 3, C.waterLow, 9, C.water] },
      },
      {
        id: 'waterway',
        type: 'line',
        source: 'osm',
        'source-layer': 'waterway',
        minzoom: 8,
        filter: ['!=', ['get', 'brunnel'], 'tunnel'],
        paint: { 'line-color': C.water, 'line-width': width([8, 0.5, 14, 2, 18, 6]) },
      },
      {
        id: 'building',
        type: 'fill',
        source: 'osm',
        'source-layer': 'building',
        minzoom: 15,
        paint: {
          'fill-color': C.building,
          'fill-outline-color': C.buildingLine,
          'fill-opacity': ['interpolate', ['linear'], ['zoom'], 15, 0, 16, 1],
        },
      },
      ...roads(C),
      {
        id: 'border-state',
        type: 'line',
        source: 'osm',
        'source-layer': 'boundary',
        minzoom: 3,
        filter: ['all', ['==', ['get', 'admin_level'], 4], ['!=', ['get', 'maritime'], 1]],
        paint: { 'line-color': C.stateBorder, 'line-width': width([3, 0.6, 10, 1.2]), 'line-dasharray': [3, 2] },
      },
      {
        id: 'border-country',
        type: 'line',
        source: 'osm',
        'source-layer': 'boundary',
        filter: ['all', ['==', ['get', 'admin_level'], 2], ['!=', ['get', 'maritime'], 1], ['!=', ['get', 'disputed'], 1]],
        paint: { 'line-color': C.border, 'line-width': width([1, 0.6, 6, 1.2, 12, 2]) },
      },
      {
        id: 'label-water',
        type: 'symbol',
        source: 'osm',
        'source-layer': 'water_name',
        filter: ['==', ['geometry-type'], 'Point'],
        layout: {
          'text-field': NAME,
          'text-font': ITALIC,
          'text-size': ['interpolate', ['linear'], ['zoom'], 1, 11, 6, 13, 12, 14],
          'text-max-width': 6,
          'text-letter-spacing': 0.04,
        },
        paint: { 'text-color': C.waterLabel, 'text-halo-color': C.waterHalo, 'text-halo-width': 1 },
      },
      {
        id: 'label-road',
        type: 'symbol',
        source: 'osm',
        'source-layer': 'transportation_name',
        minzoom: 13,
        filter: cls('motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor'),
        layout: {
          'symbol-placement': 'line',
          'text-field': NAME,
          'text-font': REGULAR,
          'text-size': ['interpolate', ['linear'], ['zoom'], 13, 10.5, 18, 13],
          'text-rotation-alignment': 'map',
          'text-padding': 8,
        },
        paint: { 'text-color': C.label, 'text-halo-color': C.halo, 'text-halo-width': 1.5 },
      },
      ...pois(C),
      {
        // Google Maps sets neighborhoods in spaced capitals: GREENPOINT, WILLIAMSBURG.
        id: 'label-neighbourhood',
        type: 'symbol',
        source: 'osm',
        'source-layer': 'place',
        minzoom: 12,
        filter: cls('suburb', 'neighbourhood', 'quarter'),
        layout: {
          'text-field': NAME,
          'text-font': BOLD,
          'text-size': ['interpolate', ['linear'], ['zoom'], 12, 10.5, 16, 12.5],
          'text-transform': 'uppercase',
          'text-letter-spacing': 0.1,
          'text-max-width': 8,
          'text-padding': 4,
        },
        paint: { 'text-color': C.hood, 'text-halo-color': C.halo, 'text-halo-width': 1.5 },
      },
      placeLabel(C, 'label-village', ['village', 'hamlet'], 11, REGULAR, C.labelSoft, [11, 11, 16, 14]),
      placeLabel(C, 'label-town', ['town'], 8, REGULAR, C.label, [8, 11, 14, 15]),
      placeLabel(C, 'label-city', ['city'], 3, REGULAR, C.labelStrong, [3, 11, 8, 14, 14, 18]),
      placeLabel(C, 'label-state', ['state', 'province'], 4, REGULAR, C.labelSoft, [4, 10, 8, 13], 8),
      placeLabel(C, 'label-country', ['country'], 1, BOLD, C.label, [1, 10, 4, 12, 7, 15], 8),
    ],
  };
  return style as unknown as StyleSpecification;
}

/** Named places up close, colored by kind the way Google Maps does it. */
function pois(C: Palette) {
  const kinds: [string, string[]][] = [
    [C.food, ['restaurant', 'fast_food', 'cafe', 'bar', 'beer', 'ice_cream', 'bakery']],
    [C.arts, ['museum', 'art_gallery', 'theatre', 'cinema', 'music', 'attraction', 'monument', 'castle', 'zoo', 'stadium']],
    [C.green, ['park', 'garden', 'campsite']],
    [C.shop, ['shop', 'grocery', 'clothing_store', 'alcohol_shop', 'books']],
    [C.school, ['college', 'school', 'library']],
    [C.transit, ['railway']],
  ];
  const classes = kinds.flatMap(([, names]) => names);
  return [
    {
      id: 'poi',
      type: 'symbol',
      source: 'osm',
      'source-layer': 'poi',
      minzoom: 15,
      filter: ['all', cls(...classes), ['has', 'name']],
      layout: {
        'text-field': NAME,
        'text-font': BOLD,
        'text-size': ['interpolate', ['linear'], ['zoom'], 15, 11, 18, 13],
        'text-max-width': 8,
        'text-padding': 6,
        'symbol-sort-key': ['coalesce', ['get', 'rank'], 99],
      },
      paint: {
        'text-color': ['match', ['get', 'class'], ...kinds.flatMap(([color, names]) => [names, color]), C.label],
        'text-halo-color': C.halo,
        'text-halo-width': 1.5,
      },
    },
  ];
}

function placeLabel(
  C: Palette,
  id: string,
  classes: string[],
  minzoom: number,
  font: string[],
  color: string,
  sizes: number[],
  maxzoom = 22,
) {
  return {
    id,
    type: 'symbol',
    source: 'osm',
    'source-layer': 'place',
    minzoom,
    maxzoom,
    filter: cls(...classes),
    layout: {
      'text-field': NAME,
      'text-font': font,
      'text-size': ['interpolate', ['linear'], ['zoom'], ...sizes],
      'text-max-width': 8,
      'text-padding': 4,
      'symbol-sort-key': ['coalesce', ['get', 'rank'], 99],
    },
    paint: { 'text-color': color, 'text-halo-color': C.halo, 'text-halo-width': 1.5 },
  };
}

/** Casings first, then fills, minor roads under major ones. */
function roads(C: Palette) {
  const levels: { classes: string[]; min: number; fill: string; casing: string; w: number[] }[] = [
    { classes: ['minor', 'service'], min: 13, fill: C.street, casing: C.streetCase, w: [13, 1, 16, 5, 18, 14] },
    { classes: ['secondary', 'tertiary'], min: 10, fill: C.street, casing: C.streetCase, w: [10, 0.8, 14, 4, 18, 18] },
    { classes: ['primary'], min: 7, fill: C.arterial, casing: C.arterialCase, w: [7, 0.6, 12, 2.5, 18, 22] },
    { classes: ['motorway', 'trunk'], min: 5, fill: C.highway, casing: C.highwayCase, w: [5, 0.6, 10, 2, 18, 24] },
  ];
  const casing = levels.map((l) => ({
    id: `road-${l.classes[0]}-casing`,
    type: 'line',
    source: 'osm',
    'source-layer': 'transportation',
    minzoom: Math.max(l.min, 12),
    filter: ['all', cls(...l.classes), ['!=', ['get', 'brunnel'], 'tunnel']],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': l.casing, 'line-gap-width': width(l.w), 'line-width': 1 },
  }));
  const fill = levels.map((l) => ({
    id: `road-${l.classes[0]}`,
    type: 'line',
    source: 'osm',
    'source-layer': 'transportation',
    minzoom: l.min,
    filter: ['all', cls(...l.classes), ['!=', ['get', 'brunnel'], 'tunnel']],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': l.fill, 'line-width': width(l.w) },
  }));
  return [...casing, ...fill];
}
