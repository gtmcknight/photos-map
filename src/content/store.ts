import type { MapViewport, Photo } from '../shared/types.ts';
import { alive } from './alive.ts';

// The library lives in the extension's own storage, never on a server.
const VERSION = 'pm1';
const CHUNK = 4000;

/** Bump when the photo record gains a field old caches lack. */
export const SCHEMA = 2;

export interface Meta {
  /** Schema of the cached records; older caches get a quiet full refresh */
  v?: number;
  n: number;
  chunks: number;
  noLocation: number;
  /** When the last complete pass finished, 0 if none has */
  fullAt: number;
  /** Where an unfinished first pass stopped */
  cursor: string | null;
  savedAt: number;
}

const key = (account: string, part: string) => `${VERSION}:${account}:${part}`;

/** No account id, no cache: two accounts must never share one. */
const known = (account: string) => account.length > 0;

// A page whose script was cut off by an extension reload reads nothing and
// writes nothing, instead of throwing; real storage errors still surface.
async function get(keys: string | string[]): Promise<Record<string, unknown>> {
  if (!alive()) return {};
  try {
    return await chrome.storage.local.get(keys);
  } catch (e) {
    if (alive()) throw e;
    return {};
  }
}

async function set(items: Record<string, unknown>): Promise<void> {
  if (!alive()) return;
  try {
    await chrome.storage.local.set(items);
  } catch (e) {
    if (alive()) throw e;
  }
}

async function remove(keys: string[]): Promise<void> {
  if (!alive()) return;
  try {
    await chrome.storage.local.remove(keys);
  } catch (e) {
    if (alive()) throw e;
  }
}

export async function loadLibrary(account: string): Promise<{ photos: Photo[]; meta: Meta } | null> {
  if (!known(account)) return null;
  const metaKey = key(account, 'meta');
  const meta = (await get(metaKey))[metaKey] as Meta | undefined;
  if (!meta) return null;
  const keys = Array.from({ length: meta.chunks }, (_, i) => key(account, `c${i}`));
  const stored = keys.length ? await get(keys) : {};
  const photos: Photo[] = [];
  for (const k of keys) {
    const chunk = stored[k] as Photo[] | undefined;
    if (!Array.isArray(chunk)) return null;
    for (const p of chunk) photos.push(p);
  }
  return { photos, meta };
}

export async function saveLibrary(
  account: string,
  photos: Photo[],
  info: { noLocation: number; fullAt: number; cursor: string | null },
): Promise<void> {
  if (!known(account)) return;
  const metaKey = key(account, 'meta');
  const previous = (await get(metaKey))[metaKey] as Meta | undefined;
  const chunks = Math.ceil(photos.length / CHUNK);
  const items: Record<string, unknown> = {};
  for (let i = 0; i < chunks; i++) items[key(account, `c${i}`)] = photos.slice(i * CHUNK, (i + 1) * CHUNK);
  const meta: Meta = { ...info, v: SCHEMA, n: photos.length, chunks, savedAt: Date.now() };
  items[metaKey] = meta;
  await set(items);
  if (previous && previous.chunks > chunks) {
    const stale = Array.from({ length: previous.chunks - chunks }, (_, i) => key(account, `c${chunks + i}`));
    await remove(stale);
  }
}

export async function loadView(account: string): Promise<MapViewport | null> {
  if (!known(account)) return null;
  const k = key(account, 'view');
  const v = (await get(k).catch(() => ({}) as Record<string, unknown>))[k] as MapViewport | undefined;
  return v && Array.isArray(v.center) && typeof v.zoom === 'number' ? v : null;
}

/** Where Google's photo viewer puts a photo, as distances from the window's edges. */
export interface Insets {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const VIEWER_KEY = `${VERSION}:viewer`;

export async function loadViewerInsets(): Promise<Insets | null> {
  const v = (await get(VIEWER_KEY).catch(() => ({}) as Record<string, unknown>))[VIEWER_KEY] as Insets | undefined;
  return v && [v.left, v.top, v.right, v.bottom].every((n) => typeof n === 'number' && n >= 0) ? v : null;
}

export async function saveViewerInsets(v: Insets): Promise<void> {
  await set({ [VIEWER_KEY]: v }).catch(() => {});
}

/** Best effort: the place to reopen the map at next time. */
export async function saveView(account: string, view: MapViewport): Promise<void> {
  if (!known(account)) return;
  await set({ [key(account, 'view')]: view }).catch(() => {});
}
