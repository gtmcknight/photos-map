import type { Photo } from '../shared/types.ts';
import { dayOf, formatDay, formatDuration, leadingPlace } from './format.ts';

const GAP = 4;
const PAD = 16;
const HEADER_H = 44;
const OVERSCAN = 600;

interface Row {
  /** Same key, same content: the element is reused instead of rebuilt */
  key: string;
  y: number;
  h: number;
  /** Day header label, or null for a row of tiles */
  label: string | null;
  place: string;
  /** Range into `items` */
  start: number;
  end: number;
}

export interface GridHandlers {
  hover(i: number): void;
  open(i: number): void;
}

/**
 * The photos in view, grouped by day like the Photos grid, as square tiles.
 * Virtualized: only rows near the viewport exist in the DOM.
 */
export class Grid {
  private items: number[] = [];
  private rows: Row[] = [];
  private live = new Map<string, HTMLElement>();
  private cols = 3;
  private size = 0;
  private frame = 0;
  private photoBase = '';

  constructor(
    private readonly scroller: HTMLElement,
    private readonly sizer: HTMLElement,
    private readonly photos: () => Photo[],
    private readonly handlers: GridHandlers,
  ) {
    scroller.addEventListener('scroll', () => this.schedule(), { passive: true });
    new ResizeObserver(() => this.layout()).observe(scroller);
    sizer.addEventListener('pointerover', (e) => {
      const tile = (e.target as Element).closest<HTMLElement>('.tile');
      if (tile) this.handlers.hover(Number(tile.dataset.i));
    });
    sizer.addEventListener('pointerleave', () => this.handlers.hover(-1));
    sizer.addEventListener('focusin', (e) => {
      const tile = (e.target as Element).closest<HTMLElement>('.tile');
      if (tile) this.handlers.hover(Number(tile.dataset.i));
    });
    sizer.addEventListener('focusout', () => this.handlers.hover(-1));
    sizer.addEventListener('click', (e) => {
      const tile = (e.target as Element).closest<HTMLAnchorElement>('.tile');
      if (!tile || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      this.handlers.open(Number(tile.dataset.i));
    });
  }

  /** Replace what's shown. Keeps the scroll position when the set is unchanged. */
  setItems(items: number[], keepScroll = false): void {
    const same =
      items.length === this.items.length && items[0] === this.items[0] && items.at(-1) === this.items.at(-1);
    this.items = items;
    if (!(same && keepScroll)) this.scroller.scrollTop = 0;
    this.layout();
  }

  /** Photo i's tile, if it's fully in view in the panel. */
  tileOf(i: number): HTMLElement | null {
    const tile = this.sizer.querySelector<HTMLElement>(`.tile[data-i="${i}"]`);
    if (!tile) return null;
    const r = tile.getBoundingClientRect();
    const view = this.scroller.getBoundingClientRect();
    return r.width > 0 && r.top >= view.top && r.bottom <= view.bottom ? tile : null;
  }

  /** Tiles whose thumbnail URLs changed need rebuilding. */
  refresh(): void {
    this.clear();
    this.render();
  }

  private layout(): void {
    const width = this.scroller.clientWidth - PAD * 2;
    if (width <= 0) return;
    this.cols = width >= 400 ? 4 : 3;
    this.size = (width - GAP * (this.cols - 1)) / this.cols;
    const photos = this.photos();
    const rows: Row[] = [];
    let y = 0;
    let i = 0;
    while (i < this.items.length) {
      const day = dayOf(photos[this.items[i]]);
      let end = i;
      while (end < this.items.length && dayOf(photos[this.items[end]]) === day) end++;
      const label = formatDay(day);
      const place = leadingPlace(photos, this.items.slice(i, end), 0);
      rows.push({ key: `d${day}:${place}`, y, h: HEADER_H, label, place, start: i, end });
      y += HEADER_H;
      for (let s = i; s < end; s += this.cols) {
        const e = Math.min(s + this.cols, end);
        const key = `t${Math.round(this.size)}:${this.items.slice(s, e).join(',')}`;
        rows.push({ key, y, h: this.size + GAP, label: null, place: '', start: s, end: e });
        y += this.size + GAP;
      }
      i = end;
    }
    this.rows = rows;
    this.sizer.style.height = `${Math.ceil(y + PAD)}px`;
    this.render();
  }

  private schedule(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  }

  private clear(): void {
    for (const el of this.live.values()) el.remove();
    this.live.clear();
  }

  private render(): void {
    const top = this.scroller.scrollTop - OVERSCAN;
    const bottom = this.scroller.scrollTop + this.scroller.clientHeight + OVERSCAN;
    // First row that reaches the top edge.
    let lo = 0;
    let hi = this.rows.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.rows[mid].y + this.rows[mid].h < top) lo = mid + 1;
      else hi = mid;
    }
    const wanted = new Map<string, Row>();
    for (let r = lo; r < this.rows.length && this.rows[r].y <= bottom; r++) wanted.set(this.rows[r].key, this.rows[r]);
    for (const [key, el] of this.live) {
      if (!wanted.has(key)) {
        el.remove();
        this.live.delete(key);
      }
    }
    // Rows that only moved keep their element, so thumbnails don't reload.
    for (const [key, row] of wanted) {
      const existing = this.live.get(key);
      if (existing) {
        existing.style.transform = `translateY(${row.y}px)`;
        continue;
      }
      const el = this.buildRow(row);
      this.live.set(key, el);
      this.sizer.append(el);
    }
  }

  private buildRow(row: Row): HTMLElement {
    const el = document.createElement('div');
    el.style.transform = `translateY(${row.y}px)`;
    if (row.label !== null) {
      el.className = 'day';
      el.style.height = `${row.h}px`;
      const date = document.createElement('span');
      date.className = 'date';
      date.textContent = row.label;
      el.append(date);
      if (row.place) {
        const place = document.createElement('span');
        place.className = 'place';
        place.textContent = row.place;
        el.append(place);
      }
      return el;
    }
    el.className = 'row';
    el.style.gridTemplateColumns = `repeat(${this.cols}, 1fr)`;
    const photos = this.photos();
    const px = Math.min(512, Math.ceil((this.size * devicePixelRatio) / 64) * 64);
    for (let k = row.start; k < row.end; k++) el.append(this.tile(this.items[k], photos[this.items[k]], px));
    return el;
  }

  private tile(i: number, p: Photo, px: number): HTMLAnchorElement {
    this.photoBase ||= `${location.pathname.match(/^\/u\/\d+/)?.[0] ?? ''}/photo/`;
    const a = document.createElement('a');
    a.className = 'tile';
    a.href = this.photoBase + p.k;
    a.dataset.i = String(i);
    a.draggable = false;
    a.setAttribute('aria-label', `${p.d ? 'Video' : 'Photo'}, ${formatDay(dayOf(p))}${p.p ? `, ${p.p}` : ''}`);
    const img = document.createElement('img');
    img.alt = '';
    img.decoding = 'async';
    img.loading = 'lazy';
    img.src = `${p.u}=w${px}-h${px}-p-k-no`;
    a.append(img);
    if (p.d) {
      const badge = document.createElement('span');
      badge.className = 'duration';
      badge.textContent = formatDuration(p.d);
      a.append(badge);
    }
    return a;
  }
}
