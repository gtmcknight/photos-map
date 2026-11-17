// The photo's flight between the map's photo panel and Google's photo viewer:
// it grows out of its tile when opened and shrinks back into it when closed,
// over a black backdrop, the way Google's own grid hands a photo to the viewer.

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Material's emphasized easing, which Google Photos moves with. */
const EASE = 'cubic-bezier(0.2, 0, 0, 1)';
const GROW_MS = 300;
const SHRINK_MS = 300;
const FADE_MS = 220;
/** Opening darkens fast, so Google's viewer never shows through half-dark. */
const DARKEN_MS = 150;

export const rectOf = (r: DOMRect | Rect): Rect => ({ left: r.left, top: r.top, width: r.width, height: r.height });

/** An image w×h fitted inside an area and centered, as object-fit: contain does. */
export function containRect(w: number, h: number, area: Rect): Rect {
  const s = Math.min(area.width / Math.max(1, w), area.height / Math.max(1, h));
  const width = w * s;
  const height = h * s;
  return { left: area.left + (area.width - width) / 2, top: area.top + (area.height - height) / 2, width, height };
}

const frames = (r: Rect, radius: string): Keyframe => ({
  left: `${r.left}px`,
  top: `${r.top}px`,
  width: `${r.width}px`,
  height: `${r.height}px`,
  borderRadius: radius,
});

/** One full-window layer above everything, used for a moment at a time. */
export class Flight {
  private readonly host = document.createElement('div');
  private readonly backdrop = document.createElement('div');
  private readonly img = document.createElement('img');
  private animations: Animation[] = [];
  private readonly reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  /** Dev builds: slow every flight down to study it frame by frame */
  slowMo = 1;

  constructor() {
    this.host.dataset.photosMap = 'flight';
    // Above Google's viewer (450) and menus; it never takes a click.
    this.host.style.cssText = 'position:fixed;inset:0;z-index:2000;pointer-events:none;visibility:hidden;contain:strict;';
    const root = this.host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent =
      '.backdrop{position:absolute;inset:0;background:#000}' +
      'img{position:absolute;display:block;object-fit:cover;max-width:none}';
    this.backdrop.className = 'backdrop';
    this.img.alt = '';
    this.img.decoding = 'sync';
    root.append(style, this.backdrop, this.img);
  }

  private get still(): boolean {
    return this.reduceMotion.matches;
  }

  private show(src: string | null, at: Rect | null, backdrop: number): void {
    this.stop();
    if (!this.host.isConnected) document.body.append(this.host);
    this.backdrop.style.opacity = String(backdrop);
    if (src && at) {
      this.img.src = src;
      this.img.hidden = false;
      Object.assign(this.img.style, frames(at, '0px'));
    } else {
      this.img.hidden = true;
    }
    this.host.style.visibility = 'visible';
  }

  private run(a: Animation): Animation {
    if (this.slowMo !== 1) a.playbackRate = this.slowMo;
    this.animations.push(a);
    return a;
  }

  stop(): void {
    for (const a of this.animations) a.cancel();
    this.animations = [];
    this.host.style.opacity = '';
    this.host.style.visibility = 'hidden';
  }

  /**
   * Opening: the backdrop darkens and the photo grows from its tile toward
   * where the viewer will show it. Resolves when the photo has arrived.
   */
  grow(src: string, from: Rect, to: Rect, sharper?: string): Promise<void> {
    this.show(src, from, 0);
    // The tile's thumbnail flies at once; a sharper copy takes over if it lands in time.
    if (sharper) {
      const big = new Image();
      big.onload = () => {
        if (this.img.getAttribute('src') === src) this.img.src = sharper;
      };
      big.src = sharper;
    }
    const duration = this.still ? 0 : GROW_MS;
    this.run(this.backdrop.animate([{ opacity: 0 }, { opacity: 1 }], { duration: this.still ? 0 : DARKEN_MS, easing: 'ease-out', fill: 'forwards' }));
    const flight = this.run(this.img.animate([frames(from, '0px'), frames(to, '0px')], { duration, easing: EASE, fill: 'forwards' }));
    return flight.finished.then(
      () => {},
      () => {},
    );
  }

  /** Google's viewer is up under the flight: line up with its photo, then get out of the way. */
  handOff(to: Rect | null): void {
    const fade = () => {
      const a = this.run(this.host.animate([{ opacity: 1 }, { opacity: 0 }], { duration: this.still ? 0 : 120, easing: 'ease-out', fill: 'forwards' }));
      a.finished.then(() => this.stop(), () => {});
    };
    if (!to || this.img.hidden || this.still) {
      fade();
      return;
    }
    const now = rectOf(this.img.getBoundingClientRect());
    const off = Math.abs(now.left - to.left) + Math.abs(now.top - to.top) + Math.abs(now.width - to.width) + Math.abs(now.height - to.height);
    if (off < 2) {
      fade();
      return;
    }
    const a = this.run(this.img.animate([frames(now, '0px'), frames(to, '0px')], { duration: 120, easing: EASE, fill: 'forwards' }));
    a.finished.then(fade, () => {});
  }

  /**
   * Closing: the photo shrinks from where the viewer showed it back into its
   * tile (or its spot on the map), and the backdrop clears once the page
   * behind is ready.
   */
  shrink(src: string | null, from: Rect | null, to: Rect | null, round: boolean, pageReady: () => boolean): Promise<void> {
    this.show(src, from, 1);
    const duration = this.still ? 0 : SHRINK_MS;
    const done: Promise<unknown>[] = [];
    if (src && from && to) {
      const radius = round ? `${Math.min(to.width, to.height) / 2}px` : '0px';
      done.push(this.run(this.img.animate([frames(from, '0px'), frames(to, radius)], { duration, easing: EASE, fill: 'forwards' })).finished);
    } else if (src && from) {
      done.push(this.run(this.img.animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(0.92)' }], { duration: FADE_MS, easing: 'ease-out', fill: 'forwards' })).finished);
    }
    // Google draws its nav and header back a frame or so after the photo
    // closes; clearing before that would show the bare page around the map.
    const cleared = new Promise<void>((resolve) => {
      const start = performance.now();
      const wait = () => {
        if (pageReady() || performance.now() - start > 250) {
          const fade = this.run(this.backdrop.animate([{ opacity: 1 }, { opacity: 0 }], { duration: this.still ? 0 : FADE_MS, easing: 'ease-out', fill: 'forwards' }));
          fade.finished.then(() => resolve(), () => resolve());
        } else {
          requestAnimationFrame(wait);
        }
      };
      wait();
    });
    done.push(cleared);
    return Promise.all(done.map((p) => p.catch(() => {}))).then(() => this.stop());
  }
}
