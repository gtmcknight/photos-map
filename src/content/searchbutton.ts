import { MAP_ICON } from './nav.ts';

// A Map button on Google Photos' search results, just left of the header's
// More options button and built from it, so it has Google's own size, hover
// and focus ring. On the map it becomes the way back to the grid.

// Material Icons Outlined "grid_view", the same 24px family.
const GRID_ICON =
  'M3 3v8h8V3H3zm6 6H5V5h4v4zm-6 4v8h8v-8H3zm6 6H5v-4h4v4zm4-16v8h8V3h-8zm6 6h-4V5h4v4zm-6 4v8h8v-8h-8zm6 6h-4v-4h4v4z';
const SVG = 'http://www.w3.org/2000/svg';
const GOOGLE_ATTRS = ['id', 'aria-haspopup', 'aria-expanded', 'aria-controls', 'aria-pressed', 'aria-describedby'];

export class SearchMapButton {
  private el: HTMLButtonElement | null = null;
  private onMap = false;
  private checkedAt = 0;

  constructor(toggle: () => void) {
    // Capture on window runs before Google's own click handling.
    window.addEventListener(
      'click',
      (e) => {
        if (!this.el || !e.composedPath().includes(this.el)) return;
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        toggle();
      },
      true,
    );
  }

  /**
   * The search header's last menu button (More options), whatever the page's
   * language. Google hides it when a search finds nothing, but its row stays,
   * so a hidden one still marks the place.
   */
  private anchor(): HTMLElement | null {
    for (const bar of Array.from(document.querySelectorAll<HTMLElement>('[role="main"] [role="menubar"]'))) {
      if (bar.getBoundingClientRect().top > 1 || !bar.checkVisibility()) continue;
      const menus = Array.from(bar.querySelectorAll<HTMLElement>('button[aria-haspopup="menu"]')).filter((b) => b !== this.el);
      if (menus.length) return menus[menus.length - 1];
    }
    return null;
  }

  /**
   * On a search page, put the button in place; anywhere else, take it out.
   * Called on every change to the page, so a full look (which reads styles)
   * happens at most every 300 ms unless forced.
   */
  ensure(show: boolean, force = false): void {
    if (!show) {
      this.el?.remove();
      return;
    }
    const now = performance.now();
    if (!force && now - this.checkedAt < 300) return;
    this.checkedAt = now;
    const more = this.anchor();
    if (!more) return;
    // The flex row the header's buttons sit in, and the slot More options fills in it.
    let slot: Element = more;
    let row = more.parentElement;
    while (row && !row.matches('[role="menubar"]') && !getComputedStyle(row).display.includes('flex')) {
      slot = row;
      row = row.parentElement;
    }
    if (!row) return;
    if (this.el?.isConnected && this.el.parentElement === row && this.el.nextElementSibling === slot) return;
    this.el?.remove();
    this.el = this.build(more);
    row.insertBefore(this.el, slot);
    this.paint();
  }

  /** Whether the map is what's showing: the button then offers the grid. */
  setOnMap(on: boolean): void {
    if (on === this.onMap) return;
    this.onMap = on;
    this.paint();
  }

  private build(more: HTMLElement): HTMLButtonElement {
    const b = more.cloneNode(true) as HTMLButtonElement;
    for (const node of [b, ...Array.from(b.querySelectorAll('*'))]) {
      for (const name of node.getAttributeNames()) {
        if (name.startsWith('js') || name.startsWith('data-') || GOOGLE_ATTRS.includes(name)) node.removeAttribute(name);
      }
    }
    b.type = 'button';
    b.dataset.photosMap = 'search';
    return b;
  }

  private paint(): void {
    const b = this.el;
    if (!b) return;
    const label = this.onMap ? 'Show as grid' : 'Show on map';
    b.setAttribute('aria-label', label);
    b.title = label;
    const svg = b.querySelector('svg');
    if (svg) {
      svg.replaceChildren();
      svg.setAttribute('viewBox', '0 0 24 24');
      const path = document.createElementNS(SVG, 'path');
      path.setAttribute('d', this.onMap ? GRID_ICON : MAP_ICON);
      svg.append(path);
    }
  }
}
