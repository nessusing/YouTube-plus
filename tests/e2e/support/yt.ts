// Talking to YouTube and to the extension from a test.
//
// - rpc(): the extension's own page script (the same postMessage bridge the
//   content script uses), for reads: identity, readPlaylist, playing…
// - api(): a signed InnerTube call made from a page, like the page's own
//   requests. Made in the tab under test it is a *page edit* (the extension's
//   fetch watcher sees it); made in another tab it is an edit *from elsewhere*.
// - Extension storage through its service worker.

import { expect, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { LIST_PREFIX } from './env';

export interface Identity { loggedIn: boolean; key?: string; name?: string; brand: boolean }
export interface ListItem { videoId: string; setVideoId: string }
export interface PlaylistData { exists: boolean; editable: boolean; title: string; items: ListItem[] }
export type ListAction =
  | { action: 'ACTION_ADD_VIDEO'; addedVideoId: string }
  | { action: 'ACTION_REMOVE_VIDEO'; setVideoId: string };

export async function rpc<T>(page: Page, method: string, ...args: unknown[]): Promise<T> {
  return (await page.evaluate(async ({ method, args }) => {
    const id = 1e9 + Math.floor(Math.random() * 1e9);
    return new Promise((resolve, reject) => {
      const on = (e: MessageEvent) => {
        const d = e.data;
        if (e.source !== window || !d || d.tag !== 'ytpp-queue' || d.dir !== 'toIso' || d.id !== id) return;
        window.removeEventListener('message', on);
        if (d.ok) resolve(d.result);
        else reject(new Error(d.error));
      };
      window.addEventListener('message', on);
      window.postMessage({ tag: 'ytpp-queue', dir: 'toMain', id, method, args }, location.origin);
      setTimeout(() => reject(new Error(`${method}: no answer from the page script`)), 30_000);
    });
  }, { method, args })) as T;
}

/** The page script is installed and answering. */
export async function waitForExtension(page: Page): Promise<void> {
  await expect.poll(async () => {
    try {
      return (await rpc<{ app: boolean; takeover: boolean }>(page, 'health')).takeover;
    } catch {
      return false;
    }
  }, { timeout: 30_000 }).toBe(true);
}

/** A signed InnerTube POST from `page`, the way innertube.ts makes it. */
export async function api<T = Record<string, unknown>>(page: Page, endpoint: string, body: Record<string, unknown>): Promise<{ ok: boolean; status: number; json: T }> {
  return page.evaluate(async ({ endpoint, body }) => {
    const ytcfg = (window as unknown as { ytcfg: { get(k: string): unknown } }).ytcfg;
    const cookie = (n: string) => document.cookie.split('; ').find((c) => c.startsWith(`${n}=`))?.slice(n.length + 1);
    const sha1 = async (s: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s)))]
      .map((b) => b.toString(16).padStart(2, '0')).join('');
    const origin = 'https://www.youtube.com';
    const p3 = cookie('__Secure-3PAPISID');
    const sap = cookie('SAPISID') ?? p3;
    if (!sap || !p3) throw new Error('not signed in');
    const ts = Math.floor(Date.now() / 1000);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `SAPISIDHASH ${ts}_${await sha1(`${ts} ${sap} ${origin}`)} SAPISID3PHASH ${ts}_${await sha1(`${ts} ${p3} ${origin}`)}`,
      'X-Origin': origin,
      'X-Goog-AuthUser': String(ytcfg.get('SESSION_INDEX') ?? 0),
      'X-Youtube-Client-Name': '1',
      'X-Youtube-Client-Version': String(ytcfg.get('INNERTUBE_CLIENT_VERSION') ?? ''),
    };
    const pageId = ytcfg.get('DELEGATED_SESSION_ID');
    if (pageId) headers['X-Goog-PageId'] = String(pageId);
    const res = await fetch(`/youtubei/v1/${endpoint}?prettyPrint=false`, {
      method: 'POST', credentials: 'include', headers, body: JSON.stringify({ context: ytcfg.get('INNERTUBE_CONTEXT'), ...body }),
    });
    let json = {};
    try {
      json = await res.json();
    } catch {
      // keep {}
    }
    return { ok: res.ok, status: res.status, json };
  }, { endpoint, body }) as Promise<{ ok: boolean; status: number; json: T }>;
}

// ---------- test lists (the only lists the suite may change) ----------

export class TestLists {
  private mine = new Set<string>();

  constructor(private helper: Page) {}

  /** A new private list named "YouTube+ e2e …" holding these videos. */
  async create(videoIds: string[], label = ''): Promise<string> {
    const title = `${LIST_PREFIX} ${new Date().toISOString()}${label ? ` ${label}` : ''}`;
    const id = await rpc<string>(this.helper, 'createPrivatePlaylist', title);
    this.mine.add(id);
    if (videoIds.length) await this.edit(this.helper, id, videoIds.map((v) => ({ action: 'ACTION_ADD_VIDEO', addedVideoId: v })));
    // A new list's entries take a few seconds to show in reads (findings A4).
    await expect.poll(async () => (await this.read(id)).items.length, { timeout: 30_000 }).toBeGreaterThanOrEqual(videoIds.length);
    return id;
  }

  async read(id: string): Promise<PlaylistData> {
    return rpc<PlaylistData>(this.helper, 'readPlaylist', id);
  }

  /** Video IDs as reads show them now. */
  async videos(id: string): Promise<string[]> {
    return (await this.read(id)).items.map((i) => i.videoId);
  }

  /** Edit one of our lists from `from` (the tab under test = a page edit; another tab = elsewhere). */
  async edit(from: Page, id: string, actions: ListAction[]): Promise<void> {
    await this.guard(id);
    const r = await api(from, 'browse/edit_playlist', { playlistId: id, actions });
    if (!r.ok) throw new Error(`edit_playlist ${id}: HTTP ${r.status}`);
  }

  async remove(from: Page, id: string, videoId: string): Promise<void> {
    const item = (await this.read(id)).items.find((i) => i.videoId === videoId);
    if (!item) throw new Error(`${videoId} is not in ${id}`);
    await this.edit(from, id, [{ action: 'ACTION_REMOVE_VIDEO', setVideoId: item.setVideoId }]);
  }

  async delete(id: string): Promise<void> {
    await this.guard(id);
    const r = await api(this.helper, 'playlist/delete', { playlistId: id });
    if (!r.ok) throw new Error(`playlist/delete ${id}: HTTP ${r.status}`);
    this.mine.delete(id);
  }

  async deleteAll(): Promise<void> {
    for (const id of [...this.mine]) await this.delete(id).catch(() => {});
  }

  /** Refuse to touch any list that is not a test list. */
  private async guard(id: string): Promise<void> {
    if (this.mine.has(id)) return;
    const d = await this.read(id);
    if (!d.exists || !d.title.startsWith(LIST_PREFIX)) throw new Error(`refusing to change list ${id} ("${d.title}"): not a test list`);
  }

  /** Delete what earlier runs left behind. */
  static async sweep(helper: Page): Promise<string[]> {
    const lists = await rpc<{ id: string; title: string }[]>(helper, 'editablePlaylists');
    const left = lists.filter((l) => l.title.startsWith(LIST_PREFIX));
    for (const l of left) await api(helper, 'playlist/delete', { playlistId: l.id });
    return left.map((l) => l.title);
  }
}

// ---------- extension storage and settings ----------

export async function serviceWorker(ctx: BrowserContext): Promise<Worker> {
  const sw = ctx.serviceWorkers().find((w) => w.url().startsWith('chrome-extension://'));
  return sw ?? ctx.waitForEvent('serviceworker');
}

export async function storageSet(ctx: BrowserContext, area: 'sync' | 'local', items: Record<string, unknown>): Promise<void> {
  const sw = await serviceWorker(ctx);
  await sw.evaluate(([area, items]) => (globalThis as unknown as { chrome: { storage: Record<string, { set(i: unknown): Promise<void> }> } }).chrome.storage[area as string]!.set(items), [area, items] as const);
}

export async function storageGet(ctx: BrowserContext, area: 'sync' | 'local', key: string): Promise<unknown> {
  const sw = await serviceWorker(ctx);
  return sw.evaluate(async ([area, key]) => (await (globalThis as unknown as { chrome: { storage: Record<string, { get(k: string): Promise<Record<string, unknown>> }> } }).chrome.storage[area as string]!.get(key as string))[key as string], [area, key] as const);
}

export interface QueueProfile { mode: 'native' | 'playlist'; listId?: string; listName?: string; removeWatched: boolean }

export async function setQueueProfile(ctx: BrowserContext, identityKey: string, p: QueueProfile): Promise<void> {
  await storageSet(ctx, 'sync', { [`queue/profile/${identityKey}`]: p });
}

// ---------- what the page shows ----------

export interface PlayerState {
  videoId?: string;
  playlistId?: string;
  index?: number;
  mini: boolean;
  time: number;
  duration: number;
  paused: boolean;
  ad: boolean;
}

export async function player(page: Page): Promise<PlayerState> {
  return page.evaluate(() => {
    type P = HTMLElement & { getVideoData?(): { video_id?: string }; getPlaylistId?(): string | undefined; getPlaylistIndex?(): number };
    const p = document.querySelector<P>('#movie_player');
    const v = p?.querySelector('video');
    const index = p?.getPlaylistIndex?.();
    return {
      videoId: p?.getVideoData?.()?.video_id || undefined,
      playlistId: p?.getPlaylistId?.() || undefined,
      index: typeof index === 'number' && index >= 0 ? index : undefined,
      mini: !!document.querySelector('ytd-app')?.hasAttribute('miniplayer-is-active'),
      time: v?.currentTime ?? 0,
      duration: v?.duration || 0,
      paused: v?.paused ?? true,
      ad: !!p?.classList.contains('ad-showing'),
    };
  });
}

export async function waitForVideo(page: Page, videoId: string, timeout = 30_000): Promise<void> {
  await expect.poll(async () => (await player(page)).videoId, { timeout }).toBe(videoId);
  await expect.poll(async () => (await player(page)).duration > 0, { timeout }).toBe(true);
}

/** Jump to `left` seconds before the end and let it play. */
export async function seekToEnd(page: Page, left: number): Promise<void> {
  await page.evaluate((left) => {
    const v = document.querySelector<HTMLVideoElement>('#movie_player video')!;
    v.currentTime = Math.max(0, v.duration - left);
    void v.play();
  }, left);
}

/** Rows of the playlist panel as the playlist manager holds them (videoIds, in order). */
export async function panelData(page: Page): Promise<{ playlistId?: string; videoIds: string[] }> {
  return page.evaluate(() => {
    const pm = document.querySelector('yt-playlist-manager') as (HTMLElement & { getPlaylistData?(): unknown }) | null;
    const d = pm?.getPlaylistData?.() as { playlistId?: string; contents?: { playlistPanelVideoRenderer?: { videoId?: string } }[] } | undefined;
    return {
      playlistId: d?.playlistId,
      videoIds: (d?.contents ?? []).map((c) => c.playlistPanelVideoRenderer?.videoId).filter((v): v is string => !!v),
    };
  });
}

/** The panel rows actually on screen under the miniplayer, or beside the watch page. */
export async function panelRowsShown(page: Page, where: 'mini' | 'watch'): Promise<string[]> {
  return page.evaluate((where) => {
    const root = where === 'mini' ? document.querySelector('ytd-miniplayer') : document.querySelector('ytd-watch-flexy #secondary, ytd-watch-flexy');
    const rows = [...(root?.querySelectorAll('ytd-playlist-panel-video-renderer') ?? [])] as (HTMLElement & { data?: { videoId?: string } })[];
    return rows.filter((r) => r.offsetParent !== null || r.getClientRects().length > 0).map((r) => r.data?.videoId ?? '').filter(Boolean);
  }, where);
}

export function playButton(page: Page) {
  const host = page.locator('ytpp-queue-play');
  return {
    host,
    count: async () => {
      const n = await host.getAttribute('data-count', { timeout: 1000 }).catch(() => null);
      return n === null ? undefined : Number(n);
    },
    name: () => host.getAttribute('data-name'),
  };
}

export async function lastToast(page: Page): Promise<string | undefined> {
  return (await page.locator('ytpp-toast').getAttribute('data-text', { timeout: 1000 }).catch(() => null)) ?? undefined;
}

/**
 * "The user comes back to this tab": fire the visibilitychange the browser
 * fires then. Playwright never really hides a tab (focus emulation, windows
 * never occluded; minimising and switching tabs were tried), so the page is
 * visible throughout; the extension only checks it is visible when the event
 * comes, so this runs the same path.
 */
export async function comeBack(page: Page): Promise<void> {
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
}
