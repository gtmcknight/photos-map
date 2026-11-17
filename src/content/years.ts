import type { YearRange } from '../shared/types.ts';

/** The selection a wanted range comes to within the years the library spans. */
export function clampYears(wanted: YearRange | null, min: number, max: number): YearRange {
  if (!wanted) return { from: min, to: max };
  const from = Math.min(Math.max(wanted.from, min), max);
  const to = Math.min(Math.max(wanted.to, from), max);
  return { from, to };
}

/**
 * Move one handle to a year boundary. `edge` counts boundaries from the first
 * year (0 is before it, n after the last); the start handle sits on the left
 * edge of its year and the end handle on the right edge of its, so the two
 * never cross and one year alone is still a range.
 */
export function moveHandle(sel: YearRange, which: 0 | 1, edge: number, min: number, max: number): YearRange {
  const n = max - min + 1;
  if (which === 0) return { from: min + Math.max(0, Math.min(edge, sel.to - min)), to: sel.to };
  return { from: sel.from, to: min + Math.max(sel.from - min + 1, Math.min(edge, n)) - 1 };
}

const BAR_MAX = 20;
const THUMB = 20;
const STEPS: Record<string, number> = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, PageDown: -5, PageUp: 5 };

function part(tag: string, className: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

/**
 * The years under the map: a bar for each year (how many photos in view were
 * taken then) and two handles that narrow the map and the photos to some of
 * those years.
 */
export class YearBar {
  readonly el = part('div', 'years');
  private readonly labels = [part('span', 'years-label'), part('span', 'years-label')];
  private readonly track = part('div', 'years-track');
  private readonly bars = part('div', 'years-bars');
  private readonly fill = part('div', 'years-fill');
  private readonly thumbs = [part('div', 'years-thumb'), part('div', 'years-thumb')];
  private readonly onChange: (range: YearRange | null, done: boolean) => void;
  private min = 0;
  private max = 0;
  private wanted: YearRange | null = null;
  private sel: YearRange = { from: 0, to: 0 };
  private drag: 0 | 1 | null = null;
  /** Where on the handle it was grabbed, so grabbing doesn't nudge it */
  private grab = 0;
  private settle = 0;

  /** `done` is false while a handle is still moving. */
  constructor(onChange: (range: YearRange | null, done: boolean) => void) {
    this.onChange = onChange;
    this.el.hidden = true;
    this.el.setAttribute('role', 'group');
    this.el.setAttribute('aria-label', 'Years');
    for (const label of this.labels) label.setAttribute('aria-hidden', 'true');
    const rail = part('div', 'years-rail');
    rail.append(this.fill);
    ['Start year', 'End year'].forEach((name, which) => {
      const thumb = this.thumbs[which];
      thumb.tabIndex = 0;
      thumb.setAttribute('role', 'slider');
      thumb.setAttribute('aria-label', name);
      thumb.addEventListener('keydown', (e) => this.key(e, which as 0 | 1));
    });
    this.track.append(this.bars, rail, ...this.thumbs);
    this.el.append(this.labels[0], this.track, this.labels[1]);

    this.track.addEventListener('pointerdown', (e) => this.down(e));
    this.el.addEventListener('keydown', () => this.el.classList.remove('by-pointer'));
    this.track.addEventListener('pointermove', (e) => {
      if (this.drag !== null) this.move(this.drag, this.edgeAt(e.clientX + this.grab));
    });
    const up = () => {
      if (this.drag === null) return;
      this.drag = null;
      this.el.classList.remove('dragging');
      this.onChange(this.range, true);
    };
    this.track.addEventListener('pointerup', up);
    this.track.addEventListener('pointercancel', up);
    this.track.addEventListener('lostpointercapture', up);
  }

  /** The years shown, or null for all of them. */
  get range(): YearRange | null {
    if (this.max <= this.min || (this.sel.from <= this.min && this.sel.to >= this.max)) return null;
    return { ...this.sel };
  }

  /** The years the library spans. Grows while a first pass streams in. */
  setSpan(min: number, max: number): void {
    if (min === this.min && max === this.max) return;
    this.min = min;
    this.max = max;
    const n = max - min + 1;
    while (this.bars.childElementCount < n) this.bars.append(document.createElement('i'));
    while (this.bars.childElementCount > n) this.bars.lastElementChild?.remove();
    this.el.hidden = max <= min;
    this.sel = clampYears(this.wanted, min, max);
    this.render();
  }

  /** From the URL; null for every year. */
  setRange(range: YearRange | null): void {
    this.wanted = range;
    if (this.max <= this.min) return;
    this.sel = clampYears(range, this.min, this.max);
    this.render();
  }

  /** How many photos in view each year has, first year first. */
  setCounts(counts: ArrayLike<number>): void {
    let top = 0;
    for (let i = 0; i < counts.length; i++) if (counts[i] > top) top = counts[i];
    const bars = this.bars.children;
    for (let i = 0; i < bars.length; i++) {
      const c = counts[i] ?? 0;
      // Square root, so a year with a few photos still shows beside one with thousands.
      const h = c ? Math.max(2, Math.sqrt(c / top) * BAR_MAX) : 0;
      (bars[i] as HTMLElement).style.transform = `scaleY(${h / BAR_MAX})`;
    }
  }

  private edgeAt(x: number): number {
    const r = this.track.getBoundingClientRect();
    const n = this.max - this.min + 1;
    return Math.round(Math.max(0, Math.min(1, (x - r.left) / r.width)) * n);
  }

  private down(e: PointerEvent): void {
    if (e.button !== 0 || this.max <= this.min) return;
    e.preventDefault();
    const centers = this.thumbs.map((t) => {
      const r = t.getBoundingClientRect();
      return r.left + r.width / 2;
    });
    const d0 = Math.abs(e.clientX - centers[0]);
    const d1 = Math.abs(e.clientX - centers[1]);
    // The nearer handle; when they touch, the side of the press decides.
    const which: 0 | 1 = d0 < d1 ? 0 : d1 < d0 ? 1 : e.clientX < centers[0] ? 0 : 1;
    this.drag = which;
    this.el.classList.add('by-pointer');
    this.track.setPointerCapture(e.pointerId);
    this.thumbs[which].focus({ preventScroll: true });
    this.el.classList.add('dragging');
    const onHandle = Math.min(d0, d1) <= THUMB / 2 + 2;
    this.grab = onHandle ? centers[which] - e.clientX : 0;
    // A press on the bars or rail moves the nearer handle there.
    if (!onHandle) this.move(which, this.edgeAt(e.clientX));
  }

  private key(e: KeyboardEvent, which: 0 | 1): void {
    const now = which === 0 ? this.sel.from : this.sel.to;
    let year: number;
    if (e.key === 'Home') year = which === 0 ? this.min : this.sel.from;
    else if (e.key === 'End') year = which === 0 ? this.sel.to : this.max;
    else if (e.key in STEPS) year = now + STEPS[e.key];
    else return;
    e.preventDefault();
    e.stopPropagation();
    this.move(which, year - this.min + which);
    clearTimeout(this.settle);
    this.settle = window.setTimeout(() => this.onChange(this.range, true), 300);
  }

  private move(which: 0 | 1, edge: number): void {
    const next = moveHandle(this.sel, which, edge, this.min, this.max);
    if (next.from === this.sel.from && next.to === this.sel.to) return;
    this.sel = next;
    this.wanted = next;
    this.render();
    this.onChange(this.range, false);
  }

  private render(): void {
    const n = this.max - this.min + 1;
    const start = this.sel.from - this.min;
    const end = this.sel.to - this.min + 1;
    this.thumbs[0].style.left = `${(start / n) * 100}%`;
    this.thumbs[1].style.left = `${(end / n) * 100}%`;
    this.fill.style.left = `${(start / n) * 100}%`;
    this.fill.style.width = `${((end - start) / n) * 100}%`;
    this.labels[0].textContent = String(this.sel.from);
    this.labels[1].textContent = String(this.sel.to);
    const aria: [HTMLElement, number, number, number][] = [
      [this.thumbs[0], this.min, this.sel.to, this.sel.from],
      [this.thumbs[1], this.sel.from, this.max, this.sel.to],
    ];
    for (const [thumb, lo, hi, now] of aria) {
      thumb.setAttribute('aria-valuemin', String(lo));
      thumb.setAttribute('aria-valuemax', String(hi));
      thumb.setAttribute('aria-valuenow', String(now));
    }
    const bars = this.bars.children;
    for (let i = 0; i < bars.length; i++) bars[i].classList.toggle('on', i >= start && i < end);
  }
}
