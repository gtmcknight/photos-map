import { fetchSession, GoogleError, readSession, searchPage, type Session } from './google.ts';

export type SearchState = 'idle' | 'running' | 'done' | 'busy' | 'error';

/** Between pages. A burst of pages gets a "busy" answer from Google. */
const PAUSE_MS = 1500;
/** After a "busy" answer, try again on its own once, after this wait */
const BUSY_WAITS = [30_000];
/**
 * 6 pages of 500: the newest 3,000 results. Google's search budget is per
 * account and shared with its own search page, which shows "No results" once
 * it runs out, so the map takes a small share of it.
 */
const MAX_PAGES = 6;
/** A finished search is reused for this long, then asked again */
const FRESH_MS = 10 * 60_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * One search, run through Google Photos' own search: the key of every
 * result, newest first, a page at a time. Whatever has been found stays
 * usable when Google says it's busy or a page fails, and start() carries on
 * from the page it stopped at.
 */
export class Search {
  readonly keys = new Set<string>();
  state: SearchState = 'idle';
  signedOut = false;
  /** Results go on past the page cap */
  capped = false;
  finishedAt = 0;

  private cursor: string | null = null;
  private pages = 0;
  private busyCount = 0;
  private retryTimer = 0;
  private running: Promise<void> | null = null;
  private abort: AbortController | null = null;
  private session: Session | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(readonly query: string) {}

  on(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) {
      try {
        fn();
      } catch {
        // The view logs its own errors in dev builds.
      }
    }
  }

  /** Start, or carry on from the page it stopped at. */
  start(): void {
    clearTimeout(this.retryTimer);
    this.retryTimer = 0;
    if (this.state === 'done' || this.running) return;
    this.running = this.run().finally(() => {
      this.running = null;
    });
  }

  /** Stop asking for pages; start() picks up from the same one. */
  stop(): void {
    clearTimeout(this.retryTimer);
    this.retryTimer = 0;
    this.abort?.abort();
  }

  private async run(): Promise<void> {
    const abort = new AbortController();
    this.abort = abort;
    this.state = 'running';
    this.signedOut = false;
    this.emit();
    try {
      for (;;) {
        const page = await this.page(abort.signal);
        for (const k of page.keys) this.keys.add(k);
        this.cursor = page.next;
        this.pages++;
        if (!this.cursor || this.pages >= MAX_PAGES) break;
        this.emit();
        await sleep(PAUSE_MS);
        if (abort.signal.aborted) throw new Error('stopped');
      }
      this.capped = !!this.cursor;
      this.state = 'done';
      this.finishedAt = Date.now();
    } catch (e) {
      if (abort.signal.aborted) this.state = 'idle';
      else if (e instanceof GoogleError && e.busy) {
        this.state = 'busy';
        // Google wants a pause: take one, then carry on by itself (a couple of times).
        const wait = BUSY_WAITS[this.busyCount++];
        if (wait) this.retryTimer = window.setTimeout(() => this.start(), wait);
      } else {
        this.state = 'error';
        this.signedOut = e instanceof GoogleError && e.signedOut;
      }
    }
    this.emit();
  }

  private async page(signal: AbortSignal) {
    for (let attempt = 0; ; attempt++) {
      try {
        this.session ??= readSession() ?? (await fetchSession());
        if (!this.session) throw new GoogleError('Signed out', true);
        // A page that hangs counts as a failure after 30 s.
        return await searchPage(this.session, this.query, this.cursor, AbortSignal.any([signal, AbortSignal.timeout(30_000)]));
      } catch (e) {
        // Busy means wait, and asking again right away only makes it longer.
        if (signal.aborted || attempt >= 2 || (e instanceof GoogleError && e.busy)) throw e;
        // Tokens can expire on a long-open tab: fetch fresh ones, then back off.
        this.session = await fetchSession().catch(() => null);
        await sleep(1500 * (attempt + 1));
      }
    }
  }
}

const searches = new Map<string, Search>();

/**
 * The search for these words in this account. Kept for a while, so going
 * back and forth between the results and the map doesn't ask Google again.
 */
export function searchFor(account: string, query: string): Search {
  const key = `${account}\n${query}`;
  const kept = searches.get(key);
  if (kept && !(kept.state === 'done' && Date.now() - kept.finishedAt > FRESH_MS)) return kept;
  const search = new Search(query);
  searches.delete(key);
  searches.set(key, search);
  if (searches.size > 8) {
    const oldest = searches.keys().next().value;
    if (oldest !== undefined) searches.delete(oldest);
  }
  return search;
}
