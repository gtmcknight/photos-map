import type { MapViewport, YearRange } from '../shared/types.ts';
import { alive } from './alive.ts';
import { readSession } from './google.ts';
import { Library } from './library.ts';
import { MapNavItem } from './nav.ts';
import { hashFor, readRoute, sameYears, searchQuery } from './route.ts';
import { SearchMapButton } from './searchbutton.ts';
import { loadView, saveView } from './store.ts';
import { dlog, MapView } from './view.ts';

if (__DEV__) {
  // Lets the dev loop reload the extension from the page: dispatch 'photos-map:reload'.
  // Registered first so a crash further down can't take it out.
  window.addEventListener('photos-map:reload', () => {
    if (alive()) void chrome.runtime.sendMessage({ t: 'dev:reload' }).catch(() => {});
  });
  window.addEventListener('error', (e) => dlog(`error: ${e.message} @${e.lineno}`));
  window.addEventListener('unhandledrejection', (e) => dlog(`rejection: ${String(e.reason)}`));
}

let view: MapView | null = null;
let library: Library | null = null;
/** Where the map is and its years, as the URL says */
let lastViewport: MapViewport | null = null;
let lastYears: YearRange | null = null;
/** The full map's, kept apart from a search's so the Map item opens it as it was left */
let mapViewport: MapViewport | null = null;
let mapYears: YearRange | null = null;
/** What the map showed at the last route: a search's words, null for every photo, undefined when closed */
let shown: string | null | undefined;
/** A step back or forward in history happened, until route() reads it */
let traversing = false;
/** The search page the map button opened the map over, to step back to */
let mapOverGrid: string | null = null;
let saveTimer = 0;
let lastHref = '';
/** Where the map was when a photo was opened from it, until the photo viewer closes */
let returnTo: { path: string; hash: string; entry: string | null } | null = null;

interface NavigationLike extends EventTarget {
  currentEntry: { key: string } | null;
  traverseTo(key: string): { committed: Promise<unknown>; finished: Promise<unknown> };
}
const navigation = (window as unknown as { navigation?: NavigationLike }).navigation;

const page = () => location.pathname + location.search;
const isPhoto = (href: string) => /\/photo\/[^/]+/.test(new URL(href, location.href).pathname);

const nav = new MapNavItem(() => {
  if (readRoute(location.hash).open) return;
  history.pushState(null, '', page() + hashFor(mapViewport, mapYears));
  // Cut off by an extension reload or update: reload so the new copy opens it.
  if (!view && !alive()) location.reload();
  else route();
});

// On a search page: show its results on the map, and back.
const searchButton = new SearchMapButton(() => {
  if (readRoute(location.hash).open) {
    // Back to Google's results: undo the button's own step, or take the map off this page.
    if (mapOverGrid === location.pathname) history.back();
    else {
      history.replaceState(null, '', page());
      route();
    }
    return;
  }
  mapOverGrid = location.pathname;
  history.pushState(null, '', page() + '#map');
  if (!view && !alive()) location.reload();
  else route();
});

/**
 * Keep the URL in step with the map: #map/@lat,lng,zoomz/years. The entry's
 * state is cleared on purpose: Google's router remembers the URL of every
 * entry it has tagged and puts it back when you return to that entry, which
 * would undo every move made on the map since. Untagged, it keeps ours.
 */
function writeHash(): void {
  // Only when the map is the page: a move landing just after Google navigated
  // elsewhere must not hide that navigation from route().
  if (!readRoute(location.hash).open) return;
  history.replaceState(null, '', page() + hashFor(lastViewport, lastYears));
  lastHref = location.href;
}

function ensureView(): MapView {
  if (view) return view;
  const session = readSession();
  const account = session?.account ?? '';
  library = new Library(account, session);
  view = new MapView(library, {
    openPhoto(key) {
      // Google's router handles this like its own grid would: no reload.
      const prefix = location.pathname.match(/^\/u\/\d+/)?.[0] ?? '';
      returnTo = { path: location.pathname, hash: hashFor(lastViewport, lastYears), entry: navigation?.currentEntry?.key ?? null };
      history.pushState(null, '', `${prefix}/photo/${key}`);
      window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
      route();
    },
    viewChanged(v) {
      lastViewport = v;
      writeHash();
      // Only the full map's place is kept for next time; a search frames its own.
      if (searchQuery(location.pathname)) return;
      mapViewport = v;
      clearTimeout(saveTimer);
      saveTimer = window.setTimeout(() => void saveView(account, v), 800);
    },
    yearsChanged(years) {
      lastYears = years;
      if (!searchQuery(location.pathname)) mapYears = years;
      writeHash();
    },
  });
  return view;
}

function route(): void {
  const before = lastHref;
  lastHref = location.href;
  const stepped = traversing;
  traversing = false;
  // Google's viewer closes (its back arrow, Escape) by opening the page it
  // thinks the photo came from: the one under the map. For a photo opened
  // from the map, that means the map, just as it was left.
  if (returnTo && !isPhoto(location.href)) {
    const root = (location.pathname.match(/^\/u\/\d+/)?.[0] ?? '') + '/';
    const closed = isPhoto(before) && !location.hash && (location.pathname === returnTo.path || location.pathname === root);
    if (closed) {
      history.replaceState(null, '', page() + returnTo.hash);
      lastHref = location.href;
    }
    returnTo = null;
  }
  const query = searchQuery(location.pathname);
  // A search made while the map shows lands on the map too. Not a step back
  // in history, though: that returns to the page as it was.
  const from = before ? new URL(before).pathname : location.pathname;
  if (query && shown !== undefined && !stepped && !location.hash && !isPhoto(before || location.href) && from !== location.pathname) {
    history.replaceState(null, '', page() + '#map');
    lastHref = location.href;
  }
  nav.ensure();
  searchButton.ensure(!!query, true);
  const r = readRoute(location.hash);
  searchButton.setOnMap(r.open && !!query);
  if (!r.open) {
    // A photo opened from the map shows in Google's viewer, above the map:
    // leave the map where it is, so closing the photo reveals it again.
    if (returnTo && view?.isShown && isPhoto(location.href)) {
      view.photoShown(location.pathname.match(/\/photo\/([^/?#]+)/)?.[1] ?? '');
      return;
    }
    view?.hide();
    view?.setSearch(null, false);
    nav.setSelected(false);
    shown = undefined;
    return;
  }
  // Back or forward into the map after the extension was reloaded or updated:
  // this copy can't open it, the page's next copy can.
  if (!view && !alive()) {
    location.reload();
    return;
  }
  const v = ensureView();
  nav.setSelected(!query);
  const was = v.isShown ? shown : undefined;
  // A new search without a place in its URL frames its own results: forget the old place.
  if (!r.viewport && was !== query) lastViewport = null;
  // The years before the search, so its results are framed with the right ones.
  if (!sameYears(r.years, lastYears)) {
    lastYears = r.years;
    v.setYears(r.years);
  }
  // The search before show(), so the map opens in its place under the search header.
  v.setSearch(query, !r.viewport);
  v.show();
  if (r.viewport) {
    if (!sameViewport(r.viewport, lastViewport)) {
      lastViewport = r.viewport;
      v.setViewport(r.viewport);
    }
  } else if (was !== query) {
    // A search frames its results as they come; the full map opens where it was left last time.
    if (query) v.setViewport('fit');
    else if (library) {
      const account = library.account;
      void loadView(account).then(
        (saved) => v.setViewport(saved ?? 'fit'),
        () => v.setViewport('fit'),
      );
    }
  }
  shown = query;
}

function sameViewport(a: MapViewport, b: MapViewport | null): boolean {
  if (!b) return false;
  return (
    Math.abs(a.center[0] - b.center[0]) < 1e-4 && Math.abs(a.center[1] - b.center[1]) < 1e-4 && Math.abs(a.zoom - b.zoom) < 0.01
  );
}

function checkUrl(): void {
  if (location.href !== lastHref) route();
}

window.addEventListener('hashchange', route);
window.addEventListener('popstate', () => {
  traversing = true;
  setTimeout(route, 0);
});
navigation?.addEventListener('navigatesuccess', () => setTimeout(checkUrl, 0));

/** Leave a photo opened from the map: step back to the map's own history entry. */
function backToMap(): void {
  const key = returnTo?.entry;
  if (key && navigation) {
    try {
      const t = navigation.traverseTo(key);
      // Only a vanished entry needs plain Back; an interrupted step (Back
      // pressed mid-way) has already gone where it was going.
      t.committed.catch((e: unknown) => {
        if (e instanceof DOMException && e.name === 'InvalidStateError') history.back();
      });
      t.finished.catch(() => {});
      return;
    } catch {
      // The entry is gone; plain Back is the next best thing.
    }
  }
  history.back();
}

// Google's viewer closes with a link to its home page (the arrow at top left)
// or Escape. For a photo opened from the map, both go back to the map instead.
window.addEventListener(
  'click',
  (e) => {
    if (!returnTo || !isPhoto(location.href) || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const link = e.composedPath().find((n): n is HTMLAnchorElement => n instanceof HTMLAnchorElement);
    if (!link || link.href !== new URL('./', document.baseURI).href) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    view?.closePhoto();
    backToMap();
  },
  true,
);
window.addEventListener(
  'keydown',
  (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented || !returnTo || !isPhoto(location.href)) return;
    // Escape in a menu, dialog or text field is theirs.
    const target = e.target instanceof Element ? e.target : null;
    if (target?.closest('input, textarea, [contenteditable], [role="menu"], [role="dialog"], [role="listbox"]')) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    view?.closePhoto();
    backToMap();
  },
  true,
);

// Google renders the nav late and re-renders it on some navigations.
let pending = 0;
const watcher = new MutationObserver(() => {
  if (pending) return;
  pending = requestAnimationFrame(() => {
    pending = 0;
    tick();
  });
});
watcher.observe(document.body, { childList: true, subtree: true });
const ticker = setInterval(() => tick(), 500);

function tick(): void {
  // Cut off by an extension update or removal with no map open: stop working.
  // The Map item stays and reloads the page into the new copy if clicked.
  if (!view && !alive()) {
    watcher.disconnect();
    clearInterval(ticker);
    return;
  }
  checkUrl();
  nav.ensure();
  nav.repaint();
  // Google redraws the search header as results load and selections change.
  searchButton.ensure(!!searchQuery(location.pathname));
}

if (__DEV__) {
  window.addEventListener('photos-map:light', () => view?.forceTheme('light'));
  window.addEventListener('photos-map:dark', () => view?.forceTheme('dark'));
  window.addEventListener('photos-map:slow', () => view?.slowMo(0.08));
  window.addEventListener('photos-map:fast', () => view?.slowMo(1));
  // Replays the first visit: forget the cached library.
  window.addEventListener('photos-map:wipe', () => void chrome.storage.local.clear().then(() => dlog('storage wiped')));
}

route();
