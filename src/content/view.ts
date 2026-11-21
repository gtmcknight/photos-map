import type { Engine, Theme } from '../engine/index.ts';
import type { Bounds, MapViewport, Photo, YearRange } from '../shared/types.ts';
import { alive } from './alive.ts';
import { formatCount, formatNumber, formatSpan, formatYears, leadingPlace, yearOf } from './format.ts';
import { containRect, Flight, rectOf, type Rect } from './flight.ts';
import { cellsOf, coverTier } from './geo.ts';
import { Grid } from './grid.ts';
import type { Library } from './library.ts';
import { fitViewport, sameYears } from './route.ts';
import { searchFor, type Search } from './search.ts';
import { loadViewerInsets, saveViewerInsets, type Insets } from './store.ts';
import { CSS } from './styles.ts';
import { YearBar } from './years.ts';

interface Options {
  openPhoto(key: string): void;
  viewChanged(view: MapViewport): void;
  yearsChanged(years: YearRange | null): void;
}

const ICON_ADD = 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z';
const ICON_REMOVE = 'M19 13H5v-2h14v2z';
const SVG = 'http://www.w3.org/2000/svg';

function icon(d: string): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', d);
  svg.append(path);
  return svg;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

/**
 * Google Photos' content card: the visible role=main element. Google's photo
 * viewer has one too, covering the whole window; that one isn't the card.
 */
function findCard(): HTMLElement | null {
  for (const node of Array.from(document.querySelectorAll<HTMLElement>('[role="main"]'))) {
    const r = node.getBoundingClientRect();
    const wholeWindow = r.top <= 0 && r.left <= 0 && r.width >= innerWidth - 2 && r.height >= innerHeight - 2;
    if (r.width > 200 && r.height > 200 && !wholeWindow) return node;
  }
  return null;
}

/** Follow Google: it switches with the system setting, so read what it painted. */
function pageTheme(): Theme {
  const rgb = (getComputedStyle(document.body).backgroundColor.match(/\d+/g) ?? ['255', '255', '255']).map(Number);
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2] < 128 ? 'dark' : 'light';
}

const wrap = (lng: number) => ((((lng + 180) % 360) + 360) % 360) - 180;

/**
 * Above Google's page (its nav at 100, its date scrubber at 150) and under its
 * header (200), whose search suggestions drop down over the page, and its
 * photo viewer (450) and menus.
 */
const BASE_Z = '199';
/** On a search page: above its results (a layer at 300), under its search box and suggestions (350). */
const SEARCH_Z = '349';

/** Where a search page's results start: under its header, the visible menubar. */
function searchTop(): number {
  for (const bar of Array.from(document.querySelectorAll<HTMLElement>('[role="main"] [role="menubar"]'))) {
    const r = bar.getBoundingClientRect();
    if (r.height > 0 && r.top <= 1 && bar.checkVisibility()) return Math.round(r.bottom);
  }
  return 64;
}

/** The photo Google's viewer is showing: its largest visible image. */
function viewerImage(layer: Element): HTMLImageElement | null {
  let best: HTMLImageElement | null = null;
  let most = 0;
  for (const img of Array.from(layer.querySelectorAll('img'))) {
    const r = img.getBoundingClientRect();
    const area = r.width * r.height;
    if (r.width > 100 && area > most && img.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) {
      best = img;
      most = area;
    }
  }
  return best;
}

/** Google has drawn its nav again (it skips the page while a photo is open). */
const pageReady = () => document.querySelector('a[role="tab"][href]:not([data-photos-map])')?.checkVisibility() ?? true;

/**
 * The outermost ancestor with a stacking order of its own: the viewer's whole
 * layer. Never one that also holds Google's menu, which would be the whole app.
 */
function layerOf(node: Element): Element | null {
  let layer: Element | null = null;
  for (let n: Element | null = node; n && n !== document.body; n = n.parentElement) {
    if (getComputedStyle(n).zIndex !== 'auto') layer = n;
  }
  return layer?.querySelector('a[role="tab"][href]') ? null : layer;
}
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

const devLines: string[] = [];
/** Dev builds: a trail the dev loop can read from the page (<html data-pm-log>). */
export function dlog(text: string): void {
  if (!__DEV__) return;
  devLines.push(`${Math.round(performance.now())} ${text}`);
  if (devLines.length > 40) devLines.shift();
  document.documentElement.setAttribute('data-pm-log', JSON.stringify(devLines));
}

/**
 * The Map page, drawn over Google's content card so the nav, search bar and
 * page chrome stay Google's own. Everything lives in this page, so it uses
 * Google's fonts and the signed-in session for thumbnails.
 */
export class MapView {
  readonly host = el('div');
  private readonly root: ShadowRoot;
  private readonly view = el('section', 'view');
  private readonly status = el('div', 'status');
  private readonly retry = el('button', 'text-button', 'Try again');
  private readonly progress = el('div', 'progress');
  private readonly mapEl = el('div', 'map');
  private readonly mapNote = el('p', 'map-note');
  private readonly pin = el('div', 'pin');
  private readonly pinImg = el('img');
  private readonly title = el('span', 'title');
  private readonly count = el('span', 'count');
  private readonly dates = el('p', 'dates');
  private readonly scroller = el('div', 'scroller');
  private readonly empty = el('div', 'empty');
  private readonly emptyText = el('p');
  private readonly emptyButton = el('button', 'text-button');
  private readonly yearBar = new YearBar((range, done) => this.pickYears(range, done));
  private readonly grid: Grid;

  private engine: Engine | null = null;
  private engineLoad: Promise<void> | null = null;
  private theme: Theme = pageTheme();
  private bounds: Bounds | null = null;
  private visible: number[] = [];
  private span = '';
  private pending: MapViewport | 'fit' | null = 'fit';
  private shown = false;
  private tracker = 0;
  private visibleTimer = 0;
  private lastState = '';
  private doneUntil = 0;
  private emptyAction: 'fit' | 'all' = 'fit';
  /** A photo opened from the map is showing in Google's viewer, over the map */
  private underPhoto = false;
  /** Google's viewer layer, once seen over the map */
  private viewerLayer: Element | null = null;
  /** Keeps Google's viewer out of sight, and out of reach of clicks, while our photo shrinks home */
  private viewerHidden: Animation | null = null;
  /** Where Google's viewer puts a photo, learned from the last one it showed */
  private viewerInsets: Insets | null = null;
  /** The photo showing in Google's viewer (its arrows can move on from the one opened) */
  private photoKey = '';
  private closing = false;
  private keyIndex: Map<string, number> | null = null;
  private readonly flight = new Flight();
  private placed = false;

  /** The years shown (null for all), and what the map last drew */
  private years: YearRange | null = null;
  private drawnYears: YearRange | null = null;
  private yearsTimer = 0;
  /** Each photo's year, by index, and the years the library spans */
  private yearOf = new Uint16Array(0);
  private minYear = 0;
  private maxYear = 0;

  /** On a search page: the search, and the photos it found (1 by index) */
  private search: Search | null = null;
  private unwatchSearch: (() => void) | null = null;
  private match: Uint8Array | null = null;
  private matches = 0;
  private drawnMatch: Uint8Array | null = null;
  /** Frame the results as they come in, until the person moves the map */
  private fitSearch = false;
  private searchFramed = false;
  private touched = false;
  private retryAction: (() => void) | null = null;

  constructor(private readonly lib: Library, private readonly opts: Options) {
    this.host.dataset.photosMap = 'view';
    this.host.style.cssText = `position:fixed;z-index:${BASE_Z};visibility:hidden;overflow:hidden;contain:strict;`;
    // Open in dev builds so the page console can inspect it.
    this.root = this.host.attachShadow({ mode: __DEV__ ? 'open' : 'closed' });
    const style = el('style');
    style.textContent = CSS;

    this.view.setAttribute('aria-label', 'Map');
    this.view.dataset.theme = this.theme;

    const bar = el('header', 'bar');
    this.status.setAttribute('role', 'status');
    this.retry.hidden = true;
    this.retry.addEventListener('click', () => this.retryAction?.());
    bar.append(el('h1', '', 'Map'), this.status, this.retry);

    const body = el('div', 'body');
    this.progress.hidden = true;

    const stage = el('div', 'stage');
    const zoom = el('div', 'zoom');
    const zoomIn = el('button');
    zoomIn.setAttribute('aria-label', 'Zoom in');
    zoomIn.append(icon(ICON_ADD));
    zoomIn.addEventListener('click', () => this.engine?.zoomBy(1));
    const zoomOut = el('button');
    zoomOut.setAttribute('aria-label', 'Zoom out');
    zoomOut.append(icon(ICON_REMOVE));
    zoomOut.addEventListener('click', () => this.engine?.zoomBy(-1));
    zoom.append(zoomIn, el('hr'), zoomOut);

    const credit = el('div', 'credit');
    const ofm = el('a', '', 'OpenFreeMap');
    ofm.href = 'https://openfreemap.org';
    const osm = el('a', '', '© OpenStreetMap');
    osm.href = 'https://www.openstreetmap.org/copyright';
    for (const a of [ofm, osm]) {
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
    }
    const own = el('a', '', 'Map for Google Photos');
    own.href = 'https://github.com/gtmcknight/photos-map';
    for (const a of [own, ofm, osm]) {
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
    }
    credit.append(own, ' · ', ofm, ' ', osm);
    this.mapNote.hidden = true;
    stage.append(this.mapEl, this.mapNote, zoom, this.yearBar.el, credit);
    // Once the person moves the map, results still coming in don't move it again.
    for (const type of ['pointerdown', 'wheel', 'keydown'] as const) {
      stage.addEventListener(type, () => (this.touched = true), { passive: true });
    }

    const photo = el('div', 'pin-photo');
    this.pinImg.alt = '';
    photo.append(this.pinImg);
    this.pin.append(photo, el('div', 'pin-tail'));
    this.pin.setAttribute('aria-hidden', 'true');

    const panel = el('aside', 'panel');
    panel.setAttribute('aria-label', 'Photos in view');
    const head = el('div', 'head');
    const line = el('div', 'head-line');
    line.append(this.title, this.count);
    head.append(line, this.dates);
    const sizer = el('div', 'sizer');
    this.scroller.append(sizer);
    this.empty.hidden = true;
    this.emptyButton.addEventListener('click', () => {
      if (this.emptyAction === 'all') this.showAllYears();
      else this.fit(true);
    });
    this.empty.append(this.emptyText, this.emptyButton);
    panel.append(head, this.scroller, this.empty);

    body.append(this.progress, stage, panel);
    this.view.append(bar, body);
    this.root.append(style, this.view);

    this.grid = new Grid(this.scroller, sizer, () => this.lib.photos, {
      hover: (i) => this.hoverFromPanel(i),
      open: (i) => this.open(i),
    });

    lib.on((e) => {
      if (e.type !== 'status') this.keyIndex = null;
      if (e.type === 'reset') {
        this.indexYears(0);
        this.sendPoints(0, true);
        // The indexes changed: find the search's results again.
        this.rebuildMatch();
        if (this.pending === 'fit') this.fit(false);
        this.updateVisible();
      } else if (e.type === 'append') {
        // A first pass is streaming in: leave the map where the person put it.
        if (this.pending === 'fit' && !this.search) this.pending = null;
        this.indexYears(e.from);
        this.sendPoints(e.from, false);
        if (this.search) this.rebuildMatch();
        this.updateVisibleSoon();
      }
      if (e.type === 'status') {
        // The first full map is a rare first: say so for a few seconds.
        if (this.lastState === 'first-pass' && lib.state === 'ready') {
          this.doneUntil = Date.now() + 5000;
          setTimeout(() => this.renderStatus(), 5100);
        }
        this.lastState = lib.state;
      }
      this.renderStatus();
    });
    window.addEventListener('resize', () => this.place());
    void loadViewerInsets().then((v) => {
      this.viewerInsets ??= v;
    });
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => setTimeout(() => this.applyTheme(), 50));
  }

  show(): void {
    if (!this.host.isConnected) document.body.append(this.host);
    // Back from a photo: the map never left; the photo shrinks home into it.
    const fromPhoto = this.underPhoto;
    if (fromPhoto) this.closePhoto();
    this.underPhoto = false;
    this.shown = true;
    if (!fromPhoto) this.applyTheme();
    this.place();
    this.host.style.visibility = 'visible';
    clearInterval(this.tracker);
    // The card moves when the nav collapses or the window resizes.
    this.tracker = window.setInterval(() => this.place(), 400);
    void this.loadEngine();
    this.renderStatus();
    void this.lib.start().catch(() => {});
  }

  hide(): void {
    this.shown = false;
    this.underPhoto = false;
    this.closing = false;
    this.flight.stop();
    this.host.style.visibility = 'hidden';
    clearInterval(this.tracker);
    this.engine?.hidePin();
  }

  get isShown(): boolean {
    return this.shown;
  }

  /**
   * Google's viewer opens over the map, as it does over its own grid. If it
   * hasn't covered the map within a moment and a half (say its layers moved),
   * get out of its way instead.
   */
  private coverWithPhoto(p: Photo, from: Rect | null, src: string): void {
    this.underPhoto = true;
    this.closing = false;
    this.photoKey = p.k;
    this.viewerHidden?.cancel();
    this.viewerHidden = null;
    this.engine?.hidePin();
    // The photo grows out of its tile toward where Google's viewer will show it.
    const ins = this.viewerInsets ?? { left: 0, top: 0, right: 0, bottom: 0 };
    const area = { left: ins.left, top: ins.top, width: innerWidth - ins.left - ins.right, height: innerHeight - ins.top - ins.bottom };
    const to = containRect(p.w || 1, p.h || 1, area);
    const sharper = `${p.u}=w${Math.round(to.width * devicePixelRatio)}-h${Math.round(to.height * devicePixelRatio)}-no`;
    const grown = from ? this.flight.grow(src, from, to, sharper) : null;
    const until = performance.now() + 1500;
    const check = () => {
      if (!this.underPhoto) return;
      const r = this.host.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (hit && hit !== this.host) {
        // Google's viewer is up under the flight: hand the photo over.
        const layer = layerOf(hit);
        this.viewerLayer = layer;
        // Google may still be easing its photo into place: hand over once it's still.
        let last = '';
        let still = 0;
        const deadline = performance.now() + 600;
        const settle = () => {
          if (!this.underPhoto || this.closing) return;
          const img = layer ? viewerImage(layer) : null;
          const at = img ? rectOf(img.getBoundingClientRect()) : null;
          const key = at ? `${Math.round(at.left)},${Math.round(at.top)},${Math.round(at.width)},${Math.round(at.height)}` : '';
          still = key && key === last ? still + 1 : 0;
          last = key;
          if (still < 2 && performance.now() < deadline) {
            requestAnimationFrame(settle);
            return;
          }
          if (at) this.learnViewerArea(at);
          if (__DEV__ && img && at) {
            const box = (r: Rect) => [r.left, r.top, r.width, r.height].map(Math.round).join(',');
            dlog(`handoff to ${box(at)} natural ${img.naturalWidth}x${img.naturalHeight} fit ${getComputedStyle(img).objectFit}`);
          }
          this.flight.handOff(at);
        };
        if (grown) void grown.then(settle);
        return;
      }
      if (performance.now() < until) requestAnimationFrame(check);
      else this.hide();
    };
    requestAnimationFrame(check);
  }

  /** Google centers the photo in its area: one photo's place gives the area. */
  private learnViewerArea(at: Rect): void {
    const cx = at.left + at.width / 2;
    const cy = at.top + at.height / 2;
    const w = Math.min(innerWidth, cx * 2);
    const h = Math.min(innerHeight, cy * 2);
    const area =
      at.width / at.height < w / h
        ? { left: cx - w / 2, top: at.top, width: w, height: at.height }
        : { left: at.left, top: cy - h / 2, width: at.width, height: h };
    const next: Insets = {
      left: Math.max(0, Math.round(area.left)),
      top: Math.max(0, Math.round(area.top)),
      right: Math.max(0, Math.round(innerWidth - area.left - area.width)),
      bottom: Math.max(0, Math.round(innerHeight - area.top - area.height)),
    };
    const was = this.viewerInsets;
    this.viewerInsets = next;
    // Kept, so the first photo opened next time lands in the right place too.
    if (!was || was.left !== next.left || was.top !== next.top || was.right !== next.right || was.bottom !== next.bottom) {
      void saveViewerInsets(next);
    }
  }

  /** The photo Google's viewer moved to, while one opened from the map is up. */
  photoShown(key: string): void {
    if (this.underPhoto && !this.closing) this.photoKey = key;
  }

  private indexOfKey(key: string): number {
    if (!this.keyIndex) {
      this.keyIndex = new Map();
      this.lib.photos.forEach((p, i) => this.keyIndex?.set(p.k, i));
    }
    return this.keyIndex.get(key) ?? -1;
  }

  /**
   * Leaving a photo: Google's viewer takes half a second to close and draws
   * the page back late, so cover the moment ourselves. The photo shrinks back
   * into its tile (or its spot on the map) while the black clears, as when
   * Google closes a photo opened from its own grid.
   */
  closePhoto(): void {
    if (!this.underPhoto || this.closing) return;
    this.closing = true;
    this.flight.stop();
    const layer = this.viewerLayer?.isConnected ? this.viewerLayer : null;
    const img = layer ? viewerImage(layer) : null;
    const from = img ? rectOf(img.getBoundingClientRect()) : null;
    const src = img ? img.currentSrc || img.src : null;
    const i = this.indexOfKey(this.photoKey);
    let to: Rect | null = null;
    let round = false;
    const tile = i >= 0 ? this.grid.tileOf(i) : null;
    if (tile) to = rectOf(tile.getBoundingClientRect());
    else if (i >= 0) {
      const spot = this.screenPoint(this.lib.photos[i]);
      if (spot) {
        to = { left: spot[0] - 22, top: spot[1] - 22, width: 44, height: 44 };
        round = true;
      }
    }
    // Out of sight and out of reach of clicks at once; the flight covers the
    // window meanwhile. Google hides its layer itself when it's done, and then
    // it's handed back.
    if (layer) {
      const off = { opacity: 0, pointerEvents: 'none' };
      const hidden = layer.animate([off, off], { duration: 4000, fill: 'forwards' });
      this.viewerHidden = hidden;
      const until = performance.now() + 4000;
      const giveBack = () => {
        if (this.viewerHidden !== hidden) return;
        const style = layer.isConnected ? getComputedStyle(layer) : null;
        if (!style || style.display === 'none' || style.visibility === 'hidden' || performance.now() > until) {
          hidden.cancel();
          this.viewerHidden = null;
        } else requestAnimationFrame(giveBack);
      };
      requestAnimationFrame(giveBack);
    }
    void this.flight.shrink(src, from, to, round, pageReady).then(() => {
      this.closing = false;
    });
  }

  /** Where a photo sits on the map, in window coordinates, if on screen. */
  private screenPoint(p: Photo | undefined): [number, number] | null {
    const at = p && this.engine?.project(p.lo, p.la);
    if (!at) return null;
    const r = this.mapEl.getBoundingClientRect();
    const x = r.left + at[0];
    const y = r.top + at[1];
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom ? [x, y] : null;
  }

  /** Move the map. 'fit' frames every photo shown once photos exist. */
  setViewport(asked: MapViewport | 'fit'): void {
    const view = asked === 'fit' ? 'fit' : (fitViewport(asked) ?? 'fit');
    this.pending = view;
    if (!this.engine) return;
    if (view === 'fit') this.fit(false);
    else {
      // Settled first, so the jump itself is reported and lands in the URL.
      this.pending = null;
      this.engine.jumpTo(view.center, view.zoom);
    }
  }

  /** Show only these years (from the URL); null for all. */
  setYears(range: YearRange | null): void {
    this.yearBar.setRange(range);
    this.syncYears();
  }

  /**
   * On a search page, show only what Google Photos' search finds for these
   * words; null shows every photo. frame: fit the map to the results as they
   * arrive (when the URL doesn't say where to look).
   */
  setSearch(query: string | null, frame: boolean): void {
    if ((this.search?.query ?? null) === query) return;
    this.unwatchSearch?.();
    this.unwatchSearch = null;
    // Left unfinished, it carries on from the same page if this search comes back.
    this.search?.stop();
    this.search = query ? searchFor(this.lib.account, query) : null;
    this.fitSearch = !!query && frame;
    this.searchFramed = false;
    this.touched = false;
    if (this.search) {
      this.unwatchSearch = this.search.on(() => this.searchChanged());
      this.search.start();
    }
    this.rebuildMatch();
    this.place();
    this.renderStatus();
  }

  private searchChanged(): void {
    const s = this.search;
    if (!s) return;
    this.rebuildMatch();
    if (this.fitSearch && !this.touched && this.matches) {
      // Jump to the first results, then ease out to frame them all once every page is in.
      if (!this.searchFramed) this.searchFramed = this.fit(false);
      else if (s.state === 'done') {
        this.fit(true);
        this.fitSearch = false;
      }
    }
    this.renderStatus();
  }

  /** Mark the photos the search found, by index, and redraw if that changed anything. */
  private rebuildMatch(): void {
    const s = this.search;
    if (!s) {
      this.match = null;
      this.matches = 0;
    } else {
      const photos = this.lib.photos;
      const match = new Uint8Array(photos.length);
      let n = 0;
      for (let i = 0; i < photos.length; i++) {
        if (s.keys.has(photos[i].k)) {
          match[i] = 1;
          n++;
        }
      }
      this.match = match;
      this.matches = n;
    }
    this.applyFilter(true);
  }

  private loadEngine(): Promise<void> {
    this.engineLoad ??= (async () => {
      const started = performance.now();
      // Cut off by an extension reload: the engine file can't be reached.
      if (!alive()) throw new Error('extension reloaded');
      const mod = (await import(chrome.runtime.getURL('engine.js'))) as typeof import('../engine/index.ts');
      this.engine = await mod.createEngine({
        container: this.mapEl,
        styleRoot: this.root,
        workerUrl: chrome.runtime.getURL('maplibre-gl-worker.mjs'),
        theme: this.theme,
        bubble: (i, count) => this.bubble(i, count),
        on: {
          moved: (v) => this.moved(v.bounds, v.center, v.zoom),
          pick: (i, from) => this.open(i, from ? rectOf(from) : null),
          problem: (message) => dlog(`map: ${message}`),
        },
      });
      dlog(`engine ready in ${Math.round(performance.now() - started)}ms`);
      this.engine.setFilter(this.years, this.match);
      this.drawnYears = this.years;
      this.drawnMatch = this.match;
      this.sendPoints(0, true);
      if (this.pending) this.setViewport(this.pending);
    })().catch((e: unknown) => {
      dlog(`engine failed: ${e instanceof Error ? e.message : String(e)}`);
      this.mapNote.textContent = 'The map couldn’t load. Reload the page to try again.';
      this.mapNote.hidden = false;
    });
    return this.engineLoad;
  }

  /**
   * A group of photos on the map: the cover photo in a white ring, with the
   * count beside it. Bigger groups are a little bigger and sit on top.
   */
  private bubble(i: number, count: number): HTMLElement {
    const p = this.lib.photos[i];
    const size = Math.round(Math.min(56, 40 + 5 * Math.log10(Math.max(1, count))));
    const wrap = el('div', 'bubble');
    wrap.style.zIndex = String(Math.round(Math.log10(Math.max(1, count)) * 10));
    wrap.tabIndex = 0;
    wrap.setAttribute('role', 'button');
    wrap.setAttribute('aria-label', count > 1 ? `${formatCount(count)} here` : 'Open photo');
    wrap.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        wrap.click();
      }
    });
    const face = el('div', 'bubble-face');
    face.style.width = face.style.height = `${size}px`;
    const img = el('img');
    img.alt = '';
    img.decoding = 'async';
    const px = Math.ceil((size * devicePixelRatio) / 32) * 32;
    if (p) img.src = `${p.u}=w${px}-h${px}-p-k-no`;
    face.append(img);
    if (count > 1) face.append(el('span', 'bubble-count', compact.format(count)));
    wrap.append(face);
    return wrap;
  }

  /** Dev builds: play the photo flights slowly, to check them frame by frame. */
  slowMo(rate: number): void {
    this.flight.slowMo = rate;
  }

  /** Dev builds: preview the other theme without changing the system setting. */
  forceTheme(theme: Theme | null): void {
    this.forcedTheme = theme;
    this.applyTheme();
  }

  private forcedTheme: Theme | null = null;

  private applyTheme(): void {
    const theme = this.forcedTheme ?? pageTheme();
    if (theme === this.theme && this.view.dataset.theme === theme) return;
    this.theme = theme;
    this.view.dataset.theme = theme;
    this.engine?.setTheme(theme);
  }

  private place(): void {
    if (!this.shown) return;
    if (this.search) {
      // A search page has no card: its results fill the window under its header.
      const top = searchTop();
      const st = this.host.style;
      st.top = `${top}px`;
      st.left = '0';
      st.width = '100vw';
      st.height = `calc(100dvh - ${top}px)`;
      st.borderRadius = '0';
      st.zIndex = SEARCH_Z;
      this.placed = true;
      return;
    }
    this.host.style.zIndex = BASE_Z;
    const card = findCard();
    // No card while Google's viewer is up (it hides the page): stay put.
    if (!card && this.placed) return;
    this.placed = true;
    const s = this.host.style;
    if (card) {
      const r = card.getBoundingClientRect();
      s.top = `${r.top}px`;
      s.left = `${r.left}px`;
      s.width = `${r.width}px`;
      s.height = `${r.height}px`;
      s.borderRadius = getComputedStyle(card).borderTopLeftRadius;
    } else {
      s.top = '64px';
      s.left = '0';
      s.width = '100vw';
      s.height = 'calc(100dvh - 64px)';
      s.borderRadius = '0';
    }
  }

  /** Each photo's year and the years the library spans, from photo `from` on. */
  private indexYears(from: number): void {
    const photos = this.lib.photos;
    if (from === 0) {
      this.yearOf = new Uint16Array(photos.length);
      this.minYear = 0;
      this.maxYear = 0;
    } else if (this.yearOf.length < photos.length) {
      const grown = new Uint16Array(Math.max(photos.length, this.yearOf.length * 2));
      grown.set(this.yearOf);
      this.yearOf = grown;
    }
    for (let i = from; i < photos.length; i++) {
      const y = yearOf(photos[i]);
      this.yearOf[i] = y;
      if (!this.minYear || y < this.minYear) this.minYear = y;
      if (y > this.maxYear) this.maxYear = y;
    }
    this.yearBar.setSpan(this.minYear, this.maxYear);
    this.syncYears();
  }

  /** The bar's years changed without a drag (the URL set them, or the span grew). */
  private syncYears(): void {
    const range = this.yearBar.range;
    if (sameYears(range, this.years)) return;
    this.years = range;
    this.opts.yearsChanged(range);
    this.applyFilter(true);
  }

  private pickYears(range: YearRange | null, done: boolean): void {
    if (!sameYears(range, this.years)) {
      this.years = range;
      this.opts.yearsChanged(range);
    }
    this.applyFilter(done);
  }

  private showAllYears(): void {
    this.yearBar.setRange(null);
    this.syncYears();
  }

  /**
   * New years or search results redraw the heat, regroup the bubbles and
   * refill the photos: while a handle moves, at most every 150 ms, then once
   * more when it stops.
   */
  private applyFilter(now: boolean): void {
    if (!now) {
      this.yearsTimer ||= window.setTimeout(() => this.applyFilter(true), 150);
      return;
    }
    clearTimeout(this.yearsTimer);
    this.yearsTimer = 0;
    if (sameYears(this.years, this.drawnYears) && this.match === this.drawnMatch) return;
    const started = performance.now();
    this.drawnYears = this.years;
    this.drawnMatch = this.match;
    this.engine?.setFilter(this.years, this.match);
    this.sendCells();
    this.updateVisible();
    dlog(`filter ${this.years ? formatYears(this.years) : 'all'}${this.match ? ` · ${this.matches} found` : ''} in ${Math.round(performance.now() - started)}ms`);
  }

  /** The photos the years and the search let through; undefined when that's all of them. */
  private keep(): ((i: number) => boolean) | undefined {
    const r = this.years;
    const match = this.match;
    if (!r && !match) return undefined;
    const years = this.yearOf;
    return (i) => (!match || match[i] === 1) && (!r || (years[i] >= r.from && years[i] <= r.to));
  }

  private sendPoints(start: number, reset: boolean): void {
    if (!this.engine) return;
    const photos = this.lib.photos;
    const n = photos.length - start;
    const lo = new Float64Array(n);
    const la = new Float64Array(n);
    const tier = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const p = photos[start + i];
      lo[i] = p.lo;
      la[i] = p.la;
      tier[i] = coverTier(p);
    }
    this.engine.setPoints(lo, la, tier, this.yearOf.subarray(start, photos.length), start, reset);
    // The heat is rebuilt from every photo, so while a first pass streams in,
    // redraw it at most once a second instead of on every page.
    if (reset) this.sendCells();
    else this.cellsTimer ||= window.setTimeout(() => this.sendCells(), 1000);
  }

  private cellsTimer = 0;

  private sendCells(): void {
    clearTimeout(this.cellsTimer);
    this.cellsTimer = 0;
    if (!this.engine) return;
    const photos = this.lib.photos;
    const keep = this.keep();
    const wide = cellsOf(photos, 0.01, keep);
    this.engine.setCells('wide', wide.lo, wide.la, wide.w);
    const fine = cellsOf(photos, 0.001, keep);
    this.engine.setCells('fine', fine.lo, fine.la, fine.w);
  }

  private moved(bounds: Bounds, center: [number, number], zoom: number): void {
    this.bounds = bounds;
    // Until the opening view is applied, the map sits at its default spot: don't save that.
    if (this.pending === null) this.opts.viewChanged({ center, zoom });
    this.updateVisible();
  }

  /** Frame every photo shown; false when there's nothing to frame yet. */
  private fit(animate: boolean): boolean {
    const bounds = this.lib.bounds(this.keep());
    if (!bounds || !this.engine) return false;
    this.pending = null;
    this.engine.fit(bounds, animate);
    return true;
  }

  private open(i: number, from: Rect | null = null): void {
    const photo = this.lib.photos[i];
    if (!photo) return;
    const tile = from ? null : this.grid.tileOf(i);
    const thumb = tile?.querySelector('img');
    const src = thumb?.currentSrc || `${photo.u}=w256-h256-p-k-no`;
    this.coverWithPhoto(photo, from ?? (tile ? rectOf(tile.getBoundingClientRect()) : null), src);
    this.opts.openPhoto(photo.k);
  }

  private hoverFromPanel(i: number): void {
    const p = this.lib.photos[i];
    if (p && this.engine?.contains(p.lo, p.la)) this.showPin(i);
    else this.engine?.hidePin();
  }

  private showPin(i: number): void {
    const p = this.lib.photos[i];
    if (!p || !this.engine) return;
    const src = `${p.u}=w160-h160-p-k-no`;
    if (this.pinImg.getAttribute('src') !== src) {
      this.pinImg.src = src;
      // Restart the small pop for each new photo.
      this.pin.classList.remove('on');
      void this.pin.offsetWidth;
    }
    this.pin.classList.add('on');
    this.engine.showPin(this.pin, p.lo, p.la);
  }

  private updateVisibleSoon(): void {
    if (this.visibleTimer) return;
    this.visibleTimer = window.setTimeout(() => {
      this.visibleTimer = 0;
      this.updateVisible();
    }, 1000);
  }

  /** The photos in view and in the years shown, and each year's count for the bar. */
  private updateVisible(): void {
    const photos = this.lib.photos;
    const years = this.yearOf;
    const r = this.years;
    const match = this.match;
    const first = this.minYear;
    const counts = new Uint32Array(this.maxYear >= first && first ? this.maxYear - first + 1 : 0);
    const out: number[] = [];
    let oldest = Infinity;
    let newest = -Infinity;
    const b = this.bounds;
    const everyLng = !b || b[2] - b[0] >= 360;
    const w = b ? wrap(b[0]) : 0;
    const e = b ? wrap(b[2]) : 0;
    const crosses = !everyLng && w > e;
    for (let i = 0; i < photos.length; i++) {
      const p = photos[i];
      if (b && (p.la < b[1] || p.la > b[3])) continue;
      if (!everyLng && (crosses ? p.lo < w && p.lo > e : p.lo < w || p.lo > e)) continue;
      if (match && !match[i]) continue;
      const y = years[i];
      counts[y - first]++;
      if (r && (y < r.from || y > r.to)) continue;
      out.push(i);
      const local = p.t + p.z;
      if (local < oldest) oldest = local;
      if (local > newest) newest = local;
    }
    this.yearBar.setCounts(counts);
    this.span = out.length ? formatSpan(oldest, newest) : '';
    const newSet = out[0] !== this.visible[0];
    this.visible = out;
    this.grid.setItems(out, !newSet);
    this.renderPanel();
  }

  private renderPanel(): void {
    const photos = this.lib.photos;
    const n = this.visible.length;
    const place = n ? leadingPlace(photos, this.visible) : '';
    this.title.textContent = place || (n ? formatCount(n) : '');
    this.count.textContent = place ? formatCount(n) : '';
    this.dates.textContent = this.span;

    let message = '';
    let action: 'fit' | 'all' | null = null;
    const r = this.years;
    const s = this.search;
    const what = s ? 'results' : 'photos';
    if (!photos.length) {
      if (this.lib.state === 'ready') message = 'None of your photos have a location yet.';
    } else if (s && !this.matches) {
      // While it runs, the status line says so.
      if (s.state === 'done') message = s.keys.size ? 'None of these results have a location.' : 'No results.';
    } else if (!n) {
      if (r && !this.lib.bounds(this.keep())) {
        message = `No ${what} from ${formatYears(r)}.`;
        action = 'all';
      } else {
        message = r ? `No ${what} from ${formatYears(r)} in this area.` : `No ${what} in this area.`;
        action = 'fit';
      }
    }
    this.emptyAction = action ?? 'fit';
    this.empty.hidden = !message;
    this.emptyText.textContent = message;
    this.emptyButton.hidden = !action;
    this.emptyButton.textContent = action === 'all' ? 'Show all years' : 'Show all';
  }

  private renderStatus(): void {
    const { state, error, photos } = this.lib;
    const s = this.search;
    let text = '';
    let retry: (() => void) | null = null;
    if (error?.signedOut) text = 'Sign in to Google Photos to see your map.';
    else if (state === 'first-pass') {
      text = photos.length ? `Mapping your photos… ${formatNumber(photos.length)}` : 'Mapping your photos…';
    } else if (s && (s.state === 'running' || s.state === 'idle')) {
      text = this.matches ? `Searching… ${formatNumber(this.matches)} on the map` : 'Searching…';
    } else if (s?.state === 'busy') {
      text = 'Google Photos is busy. Showing the results so far.';
      retry = () => s.start();
    } else if (s?.state === 'error') {
      text = s.signedOut ? 'Sign in to Google Photos to search.' : 'Couldn’t finish the search.';
      if (!s.signedOut) retry = () => s.start();
    } else if (state === 'ready' && Date.now() < this.doneUntil) {
      text = `${formatCount(photos.length)} mapped`;
    } else if (error) {
      text = state === 'error' ? (photos.length ? `Stopped at ${formatCount(photos.length)}.` : 'Couldn’t reach Google Photos.') : 'Couldn’t check for new photos.';
      retry = () => void this.lib.start().catch(() => {});
    } else if (s?.state === 'done' && this.matches) {
      // Not every result has a location; say how many made it onto the map.
      const found = this.matches;
      text = `${formatNumber(found)} of ${s.capped ? 'the newest ' : ''}${formatNumber(s.keys.size)} ${found === 1 ? 'has' : 'have'} a location`;
    }
    this.status.textContent = text;
    this.retryAction = retry;
    this.retry.hidden = !retry;
    this.progress.hidden = state !== 'first-pass' && !(s && s.state === 'running');
    this.renderPanel();
  }
}
