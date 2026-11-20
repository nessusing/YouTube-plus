// InnerTube calls made from the page (MAIN world), authenticated like the page
// itself (design §21.5). Missing X-Goog-PageId does not fail: it silently acts
// as the primary account, so always send it for brand accounts.

import { playlistPage, type ListAction } from './core';
import type { Identity } from './profiles';
import type { PlaylistData, PlaylistRef } from './rpc';

declare const ytcfg: { get(key: string): unknown };

const ORIGIN = 'https://www.youtube.com';

function cookie(name: string): string | undefined {
  return document.cookie.split('; ').find((c) => c.startsWith(`${name}=`))?.slice(name.length + 1);
}

async function digest(algo: 'SHA-1' | 'SHA-256', s: string): Promise<string> {
  const buf = await crypto.subtle.digest(algo, new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const sha1 = (s: string) => digest('SHA-1', s);

export class InnerTubeError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Our own request inits, so the page's fetch watcher can tell them apart. */
const own = new WeakSet<object>();
export const isOwn = (init: unknown): boolean => !!init && typeof init === 'object' && own.has(init);

/** URL and init for one InnerTube POST, signed now. */
export async function prepare(endpoint: string, body: Record<string, unknown>): Promise<{ url: string; init: RequestInit }> {
  const p3 = cookie('__Secure-3PAPISID');
  const sap = cookie('SAPISID') ?? p3;
  if (!sap || !p3) throw new InnerTubeError(401, 'not signed in (no SAPISID cookie)');
  const ts = Math.floor(Date.now() / 1000);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `SAPISIDHASH ${ts}_${await sha1(`${ts} ${sap} ${ORIGIN}`)} SAPISID3PHASH ${ts}_${await sha1(`${ts} ${p3} ${ORIGIN}`)}`,
    'X-Origin': ORIGIN,
    'X-Goog-AuthUser': String(ytcfg.get('SESSION_INDEX') ?? 0),
    'X-Youtube-Client-Name': '1',
    'X-Youtube-Client-Version': String(ytcfg.get('INNERTUBE_CLIENT_VERSION') ?? ''),
  };
  const pageId = ytcfg.get('DELEGATED_SESSION_ID');
  if (pageId) headers['X-Goog-PageId'] = String(pageId);
  const init: RequestInit = { method: 'POST', credentials: 'include', headers, body: JSON.stringify({ context: ytcfg.get('INNERTUBE_CONTEXT'), ...body }) };
  own.add(init);
  return { url: `/youtubei/v1/${endpoint}?prettyPrint=false`, init };
}

export async function call<T = Record<string, unknown>>(endpoint: string, body: Record<string, unknown>): Promise<T> {
  const req = await prepare(endpoint, body);
  const res = await fetch(req.url, req.init);
  let json: Record<string, unknown> = {};
  try {
    json = await res.json();
  } catch {
    // keep {}
  }
  if (!res.ok) {
    const msg = (json.error as { message?: string } | undefined)?.message ?? res.statusText;
    throw new InnerTubeError(res.status, `${endpoint}: ${res.status} ${msg}`);
  }
  return json as T;
}

export function walk(o: unknown, key: string, out: unknown[] = []): unknown[] {
  if (o && typeof o === 'object') {
    const r = o as Record<string, unknown>;
    if (key in r) out.push(r[key]);
    for (const v of Object.values(r)) walk(v, key, out);
  }
  return out;
}

function text(t: unknown): string {
  const x = t as { simpleText?: string; runs?: { text: string }[] } | undefined;
  return x?.simpleText ?? x?.runs?.map((r) => r.text).join('') ?? '';
}


/** All playlists this channel can edit (incl. Watch Later). */
export async function editablePlaylists(): Promise<PlaylistRef[]> {
  const j = await call('playlist/get_add_to_playlist', { videoIds: ['jNQXAC9IVRw'] });
  return (walk(j, 'playlistAddToOptionRenderer') as Record<string, unknown>[]).map((o) => ({
    id: String(o.playlistId),
    title: text(o.title),
    privacy: String(o.privacy ?? ''),
  }));
}

export async function createPrivatePlaylist(title: string): Promise<string> {
  const j = await call<{ playlistId?: string }>('playlist/create', { title, privacyStatus: 'PRIVATE', videoIds: [] });
  if (!j.playlistId) throw new InnerTubeError(500, 'playlist/create returned no playlistId');
  return j.playlistId;
}

/** Read a whole playlist, following continuations (~100 per page). */
export async function readPlaylist(id: string): Promise<PlaylistData> {
  const first = await call('browse', { browseId: `VL${id}` });
  const alerts = walk(first, 'alertRenderer') as { type?: string }[];
  const editableFlag = walk(first, 'isEditable')[0];
  const header = walk(first, 'playlistHeaderRenderer')[0] as Record<string, unknown> | undefined;
  if (alerts.some((a) => a.type === 'ERROR') && !header) return { exists: false, editable: false, title: '', items: [] };
  // Only the list's own pages, never the recommendations under it (findings F7).
  const page = playlistPage(first);
  const items = page.items;
  let token = page.token;
  for (let i = 0; token && i < 100; i++) {
    const more = playlistPage(await call('browse', { continuation: token }));
    items.push(...more.items);
    token = more.token;
  }
  return { exists: true, editable: editableFlag === true, title: text(header?.title), items };
}

export interface EditResult { ok: boolean; status: number; error?: string; added: string[] }

export async function editPlaylist(id: string, actions: ListAction[]): Promise<EditResult> {
  try {
    const j = await call('browse/edit_playlist', { playlistId: id, actions });
    const added = (walk(j, 'playlistEditVideoAddedResultData') as { setVideoId?: string }[]).map((r) => r.setVideoId ?? '').filter(Boolean);
    return { ok: true, status: 200, added };
  } catch (e) {
    if (e instanceof InnerTubeError) return { ok: false, status: e.status, error: e.message, added: [] };
    return { ok: false, status: 0, error: String(e), added: [] };
  }
}

/**
 * Who this page acts as (design §24.7). The key is a hash of DATASYNC_ID, so a
 * different Google account and a different channel of the same account are
 * different identities. The avatar is read from the top bar (best effort).
 */
export async function identity(): Promise<Identity> {
  const loggedIn = ytcfg.get('LOGGED_IN') === true;
  const brand = !!ytcfg.get('DELEGATED_SESSION_ID');
  if (!loggedIn) return { loggedIn, brand };
  const ds = ytcfg.get('DATASYNC_ID');
  const raw = typeof ds === 'string' && ds ? ds : `${String(ytcfg.get('DELEGATED_SESSION_ID') ?? '')}||${String(ytcfg.get('USER_SESSION_ID') ?? '')}`;
  const name = ytcfg.get('USER_ACCOUNT_NAME');
  const img = document.querySelector<HTMLImageElement>('ytd-masthead #avatar-btn img, ytd-masthead ytd-topbar-menu-button-renderer img');
  return {
    loggedIn,
    brand,
    key: raw === '||' ? undefined : (await digest('SHA-256', `YouTube+ identity ${raw}`)).slice(0, 16),
    name: typeof name === 'string' ? name : undefined,
    avatar: img?.src || undefined,
  };
}
