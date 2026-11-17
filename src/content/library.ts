import type { Bounds, Photo } from '../shared/types.ts';
import { fetchSession, GoogleError, readSession, timelinePage, type Session } from './google.ts';
import type { Page } from './parse.ts';
import { loadLibrary, saveLibrary, SCHEMA } from './store.ts';

export type LibraryEvent =
  /** `photos` was replaced; indexes changed */
  | { type: 'reset' }
  /** photos were added at the end, starting at `from` */
  | { type: 'append'; from: number }
  /** state, counts or error changed */
  | { type: 'status' };

export type LibraryState = 'loading' | 'first-pass' | 'ready' | 'error';

const WEEK = 7 * 24 * 3600 * 1000;
const PAUSE_MS = 80;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The photos with a location, newest first, kept in sync with Google Photos.
 * First visit: pages through the whole library once, streaming photos in and
 * checkpointing so a closed tab picks up where it stopped. Later visits: the
 * cache shows at once, new photos are fetched quietly, and a weekly full pass
 * drops deleted ones.
 */
export class Library {
  photos: Photo[] = [];
  noLocation = 0;
  state: LibraryState = 'loading';
  error: { message: string; signedOut: boolean } | null = null;

  private listeners = new Set<(e: LibraryEvent) => void>();
  private session: Session | null;
  private running: Promise<void> | null = null;
  private fullAt = 0;
  /** Where the first pass continues from; null before it starts and after it ends */
  private cursor: string | null = null;
  private loaded = false;
  private schema = SCHEMA;
  /** When new photos were last checked for */
  private checkedAt = 0;
  private readonly abort = new AbortController();

  constructor(readonly account: string, session: Session | null) {
    this.session = session;
  }

  on(fn: (e: LibraryEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(e: LibraryEvent): void {
    for (const fn of this.listeners) {
      // One listener failing mustn't stop the sync or the others.
      try {
        fn(e);
      } catch {
        // The view logs its own errors in dev builds.
      }
    }
  }

  /** Load the cache and sync. A second call while one runs waits for it. */
  start(): Promise<void> {
    this.running ??= this.run().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  /** The box around every photo, or around the ones `keep` picks. */
  bounds(keep?: (i: number) => boolean): Bounds | null {
    let w = 180, s = 90, e = -180, n = -90;
    let any = false;
    for (let i = 0; i < this.photos.length; i++) {
      if (keep && !keep(i)) continue;
      const p = this.photos[i];
      any = true;
      if (p.lo < w) w = p.lo;
      if (p.lo > e) e = p.lo;
      if (p.la < s) s = p.la;
      if (p.la > n) n = p.la;
    }
    return any ? [w, s, e, n] : null;
  }

  private async run(): Promise<void> {
    if (!this.loaded) {
      this.loaded = true;
      const cached = await loadLibrary(this.account).catch(() => null);
      if (cached) {
        this.photos = cached.photos;
        this.noLocation = cached.meta.noLocation;
        this.fullAt = cached.meta.fullAt;
        this.cursor = cached.meta.cursor;
        this.schema = cached.meta.v ?? 1;
        this.emit({ type: 'reset' });
      }
    }
    if (!this.fullAt) return this.firstPass();
    this.state = 'ready';
    this.error = null;
    this.emit({ type: 'status' });
    // Opening the map again a minute later (back from a photo, say) needn't ask Google again.
    if (Date.now() - this.checkedAt < 2 * 60_000) return;
    this.checkedAt = Date.now();
    try {
      // Weekly, or once after an upgrade adds a field (like favorites) old caches lack.
      if (Date.now() - this.fullAt > WEEK || this.schema < SCHEMA) await this.fullPass();
      else await this.newPhotos();
    } catch (e) {
      // The cached map stays usable; the error only says it couldn't refresh.
      this.fail(e, false);
    }
  }

  private async firstPass(): Promise<void> {
    this.state = 'first-pass';
    this.error = null;
    this.emit({ type: 'status' });
    const seen = new Set(this.photos.map((p) => p.k));
    let pages = 0;
    try {
      do {
        const page = await this.page(this.cursor);
        const from = this.photos.length;
        for (const p of page.photos) {
          if (seen.has(p.k)) continue;
          seen.add(p.k);
          this.photos.push(p);
        }
        this.noLocation += page.noLocation;
        this.cursor = page.next;
        if (this.photos.length > from) this.emit({ type: 'append', from });
        this.emit({ type: 'status' });
        if (++pages % 20 === 0 && this.cursor) await this.save();
        if (this.cursor) await sleep(PAUSE_MS);
      } while (this.cursor);
      this.fullAt = Date.now();
      await this.save();
      this.state = 'ready';
      this.emit({ type: 'status' });
    } catch (e) {
      if (this.cursor) await this.save().catch(() => {});
      this.fail(e, true);
    }
  }

  /** Newest photos only: stops at the first page with nothing new. */
  private async newPhotos(): Promise<void> {
    const known = new Set(this.photos.map((p) => p.k));
    const fresh: Photo[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 6; i++) {
      const page = await this.page(cursor);
      const added = page.photos.filter((p) => !known.has(p.k));
      fresh.push(...added);
      cursor = page.next;
      if (!added.length || !cursor) break;
      await sleep(PAUSE_MS);
    }
    if (!fresh.length) return;
    this.photos = [...fresh, ...this.photos].sort((a, b) => b.t - a.t);
    await this.save();
    this.emit({ type: 'reset' });
  }

  /** A quiet full pass in the background; swaps in the result when done. */
  private async fullPass(): Promise<void> {
    const photos: Photo[] = [];
    const seen = new Set<string>();
    let noLocation = 0;
    let cursor: string | null = null;
    do {
      const page = await this.page(cursor);
      for (const p of page.photos) {
        if (seen.has(p.k)) continue;
        seen.add(p.k);
        photos.push(p);
      }
      noLocation += page.noLocation;
      cursor = page.next;
      if (cursor) await sleep(PAUSE_MS * 2);
    } while (cursor);
    this.photos = photos;
    this.noLocation = noLocation;
    this.fullAt = Date.now();
    this.schema = SCHEMA;
    await this.save();
    this.emit({ type: 'reset' });
  }

  private async page(cursor: string | null): Promise<Page> {
    for (let attempt = 0; ; attempt++) {
      try {
        this.session ??= readSession() ?? (await fetchSession());
        if (!this.session) throw new GoogleError('Signed out', true);
        // A page that hangs counts as a failure after 30 s and gets retried.
        const signal = AbortSignal.any([this.abort.signal, AbortSignal.timeout(30_000)]);
        return await timelinePage(this.session, cursor, signal);
      } catch (e) {
        if (attempt >= 3 || this.abort.signal.aborted) throw e;
        // Tokens can expire on a long-open tab: fetch fresh ones, then back off.
        this.session = await fetchSession().catch(() => null);
        await sleep(1500 * (attempt + 1));
      }
    }
  }

  private save(): Promise<void> {
    return saveLibrary(this.account, this.photos, {
      noLocation: this.noLocation,
      fullAt: this.cursor ? 0 : this.fullAt,
      cursor: this.cursor,
    });
  }

  private fail(e: unknown, fatal: boolean): void {
    const signedOut = e instanceof GoogleError && e.signedOut;
    this.error = { message: e instanceof Error ? e.message : String(e), signedOut };
    if (fatal) this.state = 'error';
    this.emit({ type: 'status' });
  }
}
