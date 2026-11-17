import type { MapViewport, YearRange } from '../shared/types.ts';
import { alive } from './alive.ts';
import { readSession } from './google.ts';
import { Library } from './library.ts';
import { MapNavItem } from './nav.ts';
import { hashFor, readRoute, sameYears } from './route.ts';
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
let lastViewport: MapViewport | null = null;
let lastYears: YearRange | null = null;
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
  history.pushState(null, '', page() + hashFor(lastViewport, lastYears));
  // Cut off by an extension reload or update: reload so the new copy opens it.
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
      clearTimeout(saveTimer);
      saveTimer = window.setTimeout(() => void saveView(account, v), 800);
    },
    yearsChanged(years) {
      lastYears = years;
      writeHash();
    },
  });
  return view;
}

function route(): void {
  const before = lastHref;
  lastHref = location.href;
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
  nav.ensure();
  const r = readRoute(location.hash);
  if (!r.open) {
    // A photo opened from the map shows in Google's viewer, above the map:
    // leave the map where it is, so closing the photo reveals it again.
    if (returnTo && view?.isShown && isPhoto(location.href)) {
      view.photoShown(location.pathname.match(/\/photo\/([^/?#]+)/)?.[1] ?? '');
      return;
    }
    view?.hide();
    nav.setSelected(false);
    return;
  }
  // Back or forward into the map after the extension was reloaded or updated:
  // this copy can't open it, the page's next copy can.
  if (!view && !alive()) {
    location.reload();
    return;
  }
  const v = ensureView();
  nav.setSelected(true);
  const firstShow = !v.isShown && !lastViewport;
  v.show();
  if (r.viewport) {
    if (!sameViewport(r.viewport, lastViewport)) {
      lastViewport = r.viewport;
      v.setViewport(r.viewport);
    }
  } else if (firstShow && library) {
    const account = library.account;
    void loadView(account).then(
      (saved) => v.setViewport(saved ?? 'fit'),
      () => v.setViewport('fit'),
    );
  }
  if (!sameYears(r.years, lastYears)) {
    lastYears = r.years;
    v.setYears(r.years);
  }
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
window.addEventListener('popstate', () => setTimeout(route, 0));
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
