import { parsePage, type Page } from './parse.ts';

/** The tokens Google Photos' own web client sends with each request. */
export interface Session {
  at: string;
  sid: string;
  bl: string;
  /** e.g. "/_/PhotosUi/" or "/u/1/_/PhotosUi/" */
  path: string;
  /** Stable per Google account; keys the local cache */
  account: string;
}

export class GoogleError extends Error {
  readonly signedOut: boolean;
  constructor(message: string, signedOut = false) {
    super(message);
    this.signedOut = signedOut;
  }
}

function field(text: string, key: string): string {
  const m = text.match(new RegExp(`"${key}":"((?:[^"\\\\]|\\\\.)*)"`));
  if (!m) return '';
  try {
    return JSON.parse(`"${m[1]}"`) as string;
  } catch {
    return '';
  }
}

export function sessionFromText(text: string): Session | null {
  const at = field(text, 'SNlM0e');
  if (!at) return null;
  return {
    at,
    sid: field(text, 'FdrFJe'),
    bl: field(text, 'cfb2h'),
    path: field(text, 'eptZe') || '/_/PhotosUi/',
    account: field(text, 'S06Grb') || '',
  };
}

/** Read the session from the inline WIZ_global_data script already on the page. */
export function readSession(): Session | null {
  for (const script of Array.from(document.scripts)) {
    const text = script.textContent ?? '';
    if (!text.includes('WIZ_global_data')) continue;
    const session = sessionFromText(text);
    if (session) return session;
  }
  return null;
}

/** Fresh tokens, for when the page has been open long enough for them to expire. */
export async function fetchSession(): Promise<Session | null> {
  const prefix = location.pathname.match(/^\/u\/\d+\//)?.[0] ?? '/';
  const res = await fetch(location.origin + prefix, { credentials: 'include' });
  if (!res.ok) return null;
  return sessionFromText(await res.text());
}

/** Pull one RPC's payload out of a batchexecute response. */
export function extract(text: string, id: string): unknown {
  for (const line of text.split('\n')) {
    if (!line.includes('wrb.fr')) continue;
    let rows: unknown;
    try {
      rows = JSON.parse(line);
    } catch {
      continue;
    }
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if (Array.isArray(row) && row[0] === 'wrb.fr' && row[1] === id && typeof row[2] === 'string') {
        return JSON.parse(row[2]);
      }
    }
  }
  return undefined;
}

let requestId = 1000 + Math.floor(Math.random() * 8000);

async function rpc(session: Session, id: string, payload: unknown, signal: AbortSignal): Promise<unknown> {
  const body = new URLSearchParams({
    'f.req': JSON.stringify([[[id, JSON.stringify(payload), null, 'generic']]]),
    at: session.at,
  });
  const query = new URLSearchParams({
    rpcids: id,
    'source-path': location.pathname,
    'f.sid': session.sid,
    bl: session.bl,
    hl: document.documentElement.lang || 'en',
    _reqid: String((requestId += 100000)),
    rt: 'c',
  });
  const res = await fetch(`${session.path}data/batchexecute?${query}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body,
    signal,
  });
  if (res.status === 401) throw new GoogleError('Signed out', true);
  if (!res.ok) throw new GoogleError(`Google Photos answered ${res.status}`);
  const data = extract(await res.text(), id);
  if (data === undefined) throw new GoogleError('Google Photos sent an answer we could not read');
  return data;
}

/**
 * One page of the library, newest first. Read-only: `lcxiM` is the call
 * the Photos grid makes while you scroll. Source 3 includes archived items.
 */
export async function timelinePage(session: Session, cursor: string | null, signal: AbortSignal): Promise<Page> {
  return parsePage(await rpc(session, 'lcxiM', [cursor, null, 500, null, 1, 3], signal));
}
