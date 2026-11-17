/** One photo or video that has a location. Short keys keep the cache small. */
export interface Photo {
  /** Google Photos media key, the id in /photo/<key> */
  k: string;
  /** When it was taken, ms since epoch (UTC) */
  t: number;
  /** Timezone offset at capture, ms. Local time is t + z */
  z: number;
  la: number;
  lo: number;
  /** Thumbnail base URL. Append =w256-h256-p-k-no for a square */
  u: string;
  w: number;
  h: number;
  /** Video duration in ms, only for videos */
  d?: number;
  /** Google's place label, e.g. "Lisbon" or "Home" */
  p?: string;
  /** 1 when it's a favorite */
  f?: 1;
}

export type Bounds = [west: number, south: number, east: number, north: number];

/** Calendar years, both included */
export interface YearRange {
  from: number;
  to: number;
}

export interface MapViewport {
  center: [number, number];
  zoom: number;
}
