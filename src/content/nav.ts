// "Map" in Google's left nav, built from Google's own Places item so it
// inherits the exact type, spacing, hover and selected styles.

// Material Icons Outlined "map", the same 24px family as Google's nav icons.
const MAP_ICON =
  'M20.5 3l-.16.03L15 5.1 9 3 3.36 4.9c-.21.07-.36.25-.36.48V20.5c0 .28.22.5.5.5l.16-.03L9 18.9l6 2.1 5.64-1.9c.21-.07.36-.25.36-.48V3.5c0-.28-.22-.5-.5-.5zM10 5.47l4 1.4v11.66l-4-1.4V5.47zm-5 .99l3-1.01v11.7l-3 1.16V6.46zm14 11.08l-3 1.01V6.86l3-1.16v11.84z';
const SVG = 'http://www.w3.org/2000/svg';
const GOOGLE_ATTRS = ['jscontroller', 'jsaction', 'jsname', 'jslog', 'jsmodel', 'data-location', 'id'];
const FALLBACK_SELECTED_CLASS = 'uprWmb';

export class MapNavItem {
  el: HTMLAnchorElement | null = null;
  private selectedClass = '';
  private selected = false;
  /** Google's item we un-lit while the map is open, to light again on close */
  private displaced: HTMLAnchorElement | null = null;

  constructor(onOpen: () => void) {
    // Capture on window runs before Google's own click handling.
    window.addEventListener(
      'click',
      (e) => {
        if (!this.el || !e.composedPath().includes(this.el)) return;
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        onOpen();
      },
      true,
    );
  }

  private tabs(): HTMLAnchorElement[] {
    return Array.from(document.querySelectorAll<HTMLAnchorElement>('a[role="tab"][href]')).filter(
      (a) => a !== this.el,
    );
  }

  private places(): HTMLAnchorElement | null {
    return this.tabs().find((a) => /\/places\/?$/.test(new URL(a.href, location.href).pathname)) ?? null;
  }

  /** Insert or re-insert the item. Cheap when it's already in place. */
  ensure(): void {
    const places = this.places();
    if (!places) return;
    if (this.el?.isConnected && places.nextElementSibling === this.el) return;
    this.el?.remove();
    this.learnSelectedClass();
    this.el = this.build(places);
    places.after(this.el);
    this.paint();
    // Google re-lights its own item when a page re-renders under the map;
    // that's an attribute change, so watch the nav for exactly that.
    this.watcher?.disconnect();
    const nav = places.parentElement;
    if (nav) {
      this.watcher = new MutationObserver(() => this.repaint());
      this.watcher.observe(nav, { subtree: true, attributes: true, attributeFilter: ['aria-selected', 'class'] });
    }
  }

  private watcher: MutationObserver | null = null;

  setSelected(on: boolean): void {
    if (on === this.selected) return;
    this.selected = on;
    this.paint();
  }

  /** The class Google adds to the lit item: what the lit tab has and the others share none of. */
  private learnSelectedClass(): void {
    if (this.selectedClass) return;
    const tabs = this.tabs();
    const lit = tabs.find((a) => a.getAttribute('aria-selected') === 'true');
    const rest = tabs.filter((a) => a !== lit);
    if (lit && rest.length) {
      const unique = Array.from(lit.classList).filter((c) => rest.every((a) => !a.classList.contains(c)));
      if (unique.length === 1) this.selectedClass = unique[0];
    }
    this.selectedClass ||= FALLBACK_SELECTED_CLASS;
  }

  private build(places: HTMLAnchorElement): HTMLAnchorElement {
    const a = places.cloneNode(true) as HTMLAnchorElement;
    for (const node of [a, ...Array.from(a.querySelectorAll('*'))]) {
      for (const name of GOOGLE_ATTRS) node.removeAttribute(name);
    }
    a.classList.remove(this.selectedClass);
    a.setAttribute('aria-selected', 'false');
    a.setAttribute('aria-label', 'Map');
    a.setAttribute('href', '#map');
    a.dataset.photosMap = 'nav';

    const label = places.textContent?.trim() ?? '';
    const leaf = Array.from(a.querySelectorAll<HTMLElement>('*')).find(
      (n) => n.childElementCount === 0 && n.textContent?.trim() === label,
    );
    if (leaf) leaf.textContent = 'Map';

    const svg = a.querySelector('svg');
    if (svg) {
      svg.replaceChildren();
      svg.setAttribute('viewBox', '0 0 24 24');
      const path = document.createElementNS(SVG, 'path');
      path.setAttribute('d', MAP_ICON);
      svg.append(path);
    }
    return a;
  }

  private paint(): void {
    const a = this.el;
    if (!a) return;
    const cls = this.selectedClass;
    if (this.selected) {
      const lit = this.tabs().find((t) => t.getAttribute('aria-selected') === 'true');
      if (lit) {
        this.displaced = lit;
        lit.classList.remove(cls);
        lit.setAttribute('aria-selected', 'false');
      }
      a.classList.add(cls);
      a.setAttribute('aria-selected', 'true');
      a.setAttribute('aria-current', 'page');
    } else {
      a.classList.remove(cls);
      a.setAttribute('aria-selected', 'false');
      a.removeAttribute('aria-current');
      const back = this.displaced;
      this.displaced = null;
      // Only re-light Google's item if Google hasn't lit another since.
      if (back?.isConnected && !this.tabs().some((t) => t.getAttribute('aria-selected') === 'true')) {
        back.classList.add(cls);
        back.setAttribute('aria-selected', 'true');
      }
    }
  }

  /** Google may re-render the nav while the map is open; keep Map lit. */
  repaint(): void {
    const a = this.el;
    // If Google lit another item because it navigated away, let it.
    if (!a || !this.selected || !location.hash.startsWith('#map')) return;
    const cls = this.selectedClass;
    const stray = this.tabs().find((t) => t.getAttribute('aria-selected') === 'true');
    if (stray) {
      this.displaced = stray;
      stray.classList.remove(cls);
      stray.setAttribute('aria-selected', 'false');
    }
    if (!a.classList.contains(cls)) {
      a.classList.add(cls);
      a.setAttribute('aria-selected', 'true');
    }
  }
}
