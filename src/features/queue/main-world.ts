// MAIN world side of the queue feature (design §23): QueueTakeover (intercept
// Add to queue, relabel it), PlayerWatch, page navigation, InnerTube calls,
// and the bridge to the isolated script. Never break the page: every handler
// swallows its own errors.

import { isToMain, TAG, type PlayerEvent, type TakeoverState, type ToIso } from './bridge';
import { isQueueCommand, isWatchedHere, parseQueueAction, QUEUE_ICON, queueView } from './core';
import * as it from './innertube';

const post = (m: Omit<ToIso, 'tag' | 'dir'>) => window.postMessage({ tag: TAG, dir: 'toIso', ...m }, location.origin);

let state: TakeoverState = { decision: 'native', label: '' };
let takeoverInstalled = false;

function app(): HTMLElement {
  const a = document.querySelector<HTMLElement>('ytd-app');
  if (!a) throw new Error('ytd-app not found');
  return a;
}

// ---------- QueueTakeover: intercept (§24.2) ----------

function installTakeover(): void {
  // The action bubbles up from the clicked element, not from ytd-app (§21.2),
  // so listen on document in the capture phase, ahead of the page.
  document.addEventListener('yt-action', (e) => {
    try {
      const p = parseQueueAction((e as CustomEvent).detail);
      if (p.kind === 'other') return;
      if (p.kind === 'malformed') {
        // Better native than an Add to queue that does nothing (§26).
        if (state.decision === 'take') post({ event: 'warn', msg: 'Add to queue had an unexpected shape; left it to YouTube' } as ToIso);
        return;
      }
      if (state.decision === 'take') {
        e.stopImmediatePropagation();
        post({ event: 'add', videoIds: p.videoIds } as ToIso);
      } else if (state.decision !== 'native') {
        post({ event: 'nativeAdd' } as ToIso);
      }
    } catch {
      // leave the event to the page
    }
  }, true);
  takeoverInstalled = true;
}

// ---------- QueueTakeover: relabel (§21.3, §24.3) ----------

type AnyEl = HTMLElement & Record<string, unknown>;

/** New-style menus: title span → what it said before and what we wrote. */
const newMenu = new Map<Element, { orig: string; wrote: string }>();
/** Old-style menus we relabelled. */
const oldMenu = new Set<AnyEl>();
/** Hover buttons: renderer → original tooltip. */
const tips = new WeakMap<Element, unknown>();

/** The sheet's list items, from the component data on an ancestor (§21.3). */
function sheetItems(el: Element): Record<string, unknown>[] | undefined {
  let a: Element | null = el.parentElement;
  for (let depth = 0; a && depth < 20; a = a.parentElement, depth++) {
    const x = a as AnyEl;
    const cands: unknown[] = [x.componentProps, (x.ytSheetViewModel as { componentProps?: unknown } | undefined)?.componentProps];
    for (const k of Object.keys(x)) cands.push((x[k] as { componentProps?: unknown } | undefined)?.componentProps);
    for (const cp of cands) {
      if (!cp || typeof cp !== 'object') continue;
      const raw = (cp as { data?: unknown }).data;
      const data = typeof raw === 'function' ? (raw as () => unknown).call(cp) : raw;
      const items = it.walk(data, 'listItems')[0];
      if (Array.isArray(items)) return items as Record<string, unknown>[];
    }
  }
  return undefined;
}

function isQueueListItem(entry: Record<string, unknown> | undefined): boolean {
  const vm = entry?.listItemViewModel as Record<string, unknown> | undefined;
  if (!vm) return false;
  const icon = it.walk(vm.leadingImage, 'imageName')[0];
  return icon === QUEUE_ICON || isQueueCommand(vm.rendererContext);
}

const titleOf = (entry: Record<string, unknown> | undefined) =>
  ((entry?.listItemViewModel as { title?: { content?: unknown } } | undefined)?.title?.content as string | undefined) ?? undefined;

function relabelNew(take: boolean): void {
  for (const item of document.querySelectorAll('ytd-popup-container yt-list-item-view-model, yt-sheet-view-model yt-list-item-view-model')) {
    const span = item.querySelector('button[role=menuitem] span.ytListItemViewModelTitle, span.ytListItemViewModelTitle');
    if (!span) continue;
    const mine = newMenu.get(span);
    const current = span.textContent ?? '';
    if (mine && current !== mine.wrote) newMenu.delete(span); // the page re-rendered it
    if (!take) {
      const m = newMenu.get(span);
      if (m) {
        span.textContent = m.orig;
        newMenu.delete(span);
      }
      continue;
    }
    if (newMenu.get(span)?.wrote === state.label) continue;
    const items = sheetItems(item);
    if (!items) continue;
    const all = [...(item.parentElement?.closest('yt-list-view-model, yt-sheet-view-model') ?? document).querySelectorAll('yt-list-item-view-model')];
    const orig = newMenu.get(span)?.orig ?? current;
    // Identify by icon/command; the title only checks that the index lines up.
    let entry = items[all.indexOf(item)];
    if (titleOf(entry) !== orig) entry = items.find((e) => titleOf(e) === orig);
    if (!isQueueListItem(entry)) continue;
    span.textContent = state.label;
    newMenu.set(span, { orig, wrote: state.label });
  }
}

function relabelOld(take: boolean): void {
  for (const el of document.querySelectorAll<AnyEl>('ytd-popup-container ytd-menu-service-item-renderer')) {
    const data = el.data as { text?: unknown; icon?: { iconType?: string }; serviceEndpoint?: unknown } | undefined;
    const fs = el.querySelector('yt-formatted-string') as AnyEl | null;
    if (!data || !fs) continue;
    const isQueue = data.icon?.iconType === QUEUE_ICON || isQueueCommand(data.serviceEndpoint);
    if (take && isQueue) {
      // Not textContent: Polymer would add a second text run on reopen (§21.3).
      const now = (fs.text as { runs?: { text?: string }[] } | undefined)?.runs?.[0]?.text;
      if (now !== state.label) fs.text = { runs: [{ text: state.label }] };
      oldMenu.add(el);
    } else if (oldMenu.has(el)) {
      fs.text = data.text;
      oldMenu.delete(el);
    }
  }
}

function relabel(): void {
  try {
    const take = state.decision === 'take' && !!state.label;
    relabelNew(take);
    relabelOld(take);
  } catch {
    // labels are cosmetic
  }
}

let scanQueued = false;
function scheduleRelabel(): void {
  if (scanQueued) return;
  scanQueued = true;
  requestAnimationFrame(() => {
    scanQueued = false;
    relabel();
  });
}

/** Hover button on thumbnails: relabel its tooltip when the pointer reaches it (unverified, §28). */
function onHover(e: Event): void {
  try {
    const el = (e.target as Element | null)?.closest?.('ytd-thumbnail-overlay-toggle-button-renderer') as AnyEl | null;
    const data = el?.data as { untoggledIcon?: { iconType?: string }; untoggledTooltip?: unknown } | undefined;
    if (!el || !data || data.untoggledIcon?.iconType !== QUEUE_ICON) return;
    const take = state.decision === 'take' && !!state.label;
    if (take && data.untoggledTooltip !== state.label) {
      if (!tips.has(el)) tips.set(el, data.untoggledTooltip);
      el.data = { ...data, untoggledTooltip: state.label };
    } else if (!take && tips.has(el)) {
      el.data = { ...data, untoggledTooltip: tips.get(el) };
      tips.delete(el);
    }
  } catch {
    // cosmetic
  }
}

function installRelabel(): void {
  // Popup menus are reused across menus and pages and only re-render when a
  // title changes (§21.3): watch the popup container, and rescan after clicks.
  let watched: Element | null = null;
  const mo = new MutationObserver(scheduleRelabel);
  const attach = () => {
    const pc = document.querySelector('ytd-popup-container');
    if (!pc || pc === watched) return !!pc;
    watched = pc;
    mo.disconnect();
    mo.observe(pc, { childList: true, subtree: true, characterData: true });
    return true;
  };
  const finder = new MutationObserver(() => attach() && finder.disconnect());
  finder.observe(document.documentElement, { childList: true, subtree: true });
  const later = () => {
    attach();
    setTimeout(scheduleRelabel, 60);
    setTimeout(scheduleRelabel, 350);
  };
  document.addEventListener('pointerup', later, true);
  document.addEventListener('keyup', (e) => (e.key === 'Enter' || e.key === ' ') && later(), true);
  document.addEventListener('mouseover', onHover, true);
}

// ---------- PlayerWatch (§24.4) ----------

type PlayerApi = HTMLElement & {
  getVideoData?: () => { video_id?: string; title?: string; author?: string };
  getDuration?: () => number;
  getPlaylistId?: () => string | undefined;
  getPlaylistIndex?: () => number;
  getCurrentTime?: () => number;
  /** 2 = paused */
  getPlayerState?: () => number;
  pauseVideo?: () => void;
};

/** A removal sent by the page itself on unload, when the tab closes in the last 10 s. */
let armed: { videoId: string; listId: string; setVideoId: string; req: { url: string; init: RequestInit }; at: number } | undefined;
let rearming = false;

async function armRemoval(listId: string, setVideoId: string, videoId: string): Promise<void> {
  const req = await it.prepare('browse/edit_playlist', { playlistId: listId, actions: [{ action: 'ACTION_REMOVE_VIDEO', setVideoId }] });
  armed = { videoId, listId, setVideoId, req, at: Date.now() };
}

function player(): PlayerApi | null {
  return document.querySelector<PlayerApi>('#movie_player');
}

function installPlayerWatch(): void {
  let last: PlayerEvent | undefined;
  let nearSent: string | undefined;
  const snapshot = (type: PlayerEvent['type'], v: HTMLVideoElement): PlayerEvent | undefined => {
    const p = player();
    const videoId = p?.getVideoData?.()?.video_id;
    if (!videoId) return undefined;
    const index = p?.getPlaylistIndex?.();
    return {
      type, videoId, playlistId: p?.getPlaylistId?.() ?? undefined, index: typeof index === 'number' && index >= 0 ? index : undefined,
      currentTime: v.currentTime, duration: v.duration || 0,
    };
  };
  const isMain = (v: EventTarget | null): v is HTMLVideoElement =>
    v instanceof HTMLVideoElement && !!v.closest('#movie_player');

  document.addEventListener('timeupdate', (e) => {
    try {
      if (!isMain(e.target)) return;
      const s = snapshot('left', e.target);
      if (!s) return;
      if (last && last.videoId !== s.videoId) {
        // A new video started: report how the previous one was left.
        post({ event: 'player', payload: last } as ToIso);
        if (armed && armed.videoId !== s.videoId) armed = undefined;
      }
      last = s;
      if (nearSent !== s.videoId && isWatchedHere(s.currentTime, s.duration, false)) {
        nearSent = s.videoId;
        post({ event: 'player', payload: { ...s, type: 'near' } } as ToIso);
      }
      // Keep the unload request's signature fresh.
      if (armed && !rearming && Date.now() - armed.at > 60_000) {
        rearming = true;
        const a = armed;
        void armRemoval(a.listId, a.setVideoId, a.videoId).catch(() => {}).finally(() => (rearming = false));
      }
    } catch {
      // never break the page
    }
  }, true);
  document.addEventListener('ended', (e) => {
    try {
      if (!isMain(e.target)) return;
      const s = snapshot('ended', e.target);
      if (s) post({ event: 'player', payload: s } as ToIso);
      last = undefined;
    } catch {
      // never break the page
    }
  }, true);
  window.addEventListener('pagehide', () => {
    try {
      if (armed && last?.videoId === armed.videoId && isWatchedHere(last.currentTime, last.duration, false)) {
        // The isolated side may not get to run any more; send it from here.
        void fetch(armed.req.url, { ...armed.req.init, keepalive: true });
        armed = undefined;
        return;
      }
      if (last) post({ event: 'player', payload: last } as ToIso);
    } catch {
      // never break the page
    }
  });
}

// ---------- navigation ----------

/** SPA navigation like a click on a link; full page load if the page does not start one (§28 item 2). */
function navigate(url: string, endpoint: Record<string, unknown>, meta: Record<string, unknown>): void {
  let started = false;
  const onStart = () => (started = true);
  document.addEventListener('yt-navigate-start', onStart, { once: true });
  try {
    app().dispatchEvent(new CustomEvent('yt-navigate', {
      bubbles: true,
      composed: true,
      detail: { endpoint: { commandMetadata: { webCommandMetadata: { url, ...meta } }, ...endpoint } },
    }));
  } catch {
    // fall through to the full load
  }
  setTimeout(() => {
    document.removeEventListener('yt-navigate-start', onStart);
    if (!started && !location.href.endsWith(url)) location.assign(url);
  }, 1500);
}

function playVideo(videoId: string, listId: string): void {
  const url = `/watch?v=${encodeURIComponent(videoId)}&list=${encodeURIComponent(listId)}`;
  navigate(url, { watchEndpoint: { videoId, playlistId: listId } }, { webPageType: 'WEB_PAGE_TYPE_WATCH', rootVe: 3832 });
}

function openPlaylist(listId: string): void {
  const url = `/playlist?list=${encodeURIComponent(listId)}`;
  navigate(url, { browseEndpoint: { browseId: `VL${listId}` } }, { webPageType: 'WEB_PAGE_TYPE_PLAYLIST', rootVe: 5754 });
}

/** YouTube's playlist manager; the native queue calls these three (§21.4). */
type PlaylistManager = HTMLElement & {
  setAutoplayRenderer?: (a: unknown) => void;
  setPlaylistData?: (d: unknown) => void;
  setPlayerPlaybackControlData?: (d: unknown) => void;
};

/**
 * Watching a video outside any list, on the watch page or in the miniplayer:
 * hand the queue list to the page the way the native queue does, so it shows
 * in the side panel / under the miniplayer and plays after this video, with
 * no reload (§24.2). 'panel' when done that way; 'navigated' when that failed
 * and the watch page was reloaded inside the list instead; false: left alone.
 */
async function attachList(listId: string): Promise<'panel' | 'navigated' | false> {
  const p = player();
  const data = p?.getVideoData?.();
  const videoId = data?.video_id;
  if (!p || !videoId || p.getPlaylistId?.() || p.classList.contains('ad-showing')) return false;
  const mini = app().hasAttribute('miniplayer-is-active');
  const onWatch = location.pathname === '/watch' && new URLSearchParams(location.search).get('v') === videoId;
  // Anywhere else the player is a leftover, not something playing.
  if (!mini && !onWatch) return false;
  const pm = document.querySelector<PlaylistManager>('yt-playlist-manager');
  if (pm?.setPlaylistData && pm.setPlayerPlaybackControlData && pm.setAutoplayRenderer) {
    try {
      const next = await it.call('next', { videoId, playlistId: listId });
      const view = queueView(next, { videoId, title: data.title ?? '', author: data.author ?? '', duration: p.getDuration?.() ?? 0 });
      if (view && player()?.getVideoData?.()?.video_id === videoId && !player()?.getPlaylistId?.()) {
        pm.setAutoplayRenderer(view.autoplay);
        pm.setPlaylistData(view.list);
        pm.setPlayerPlaybackControlData({ playlistPanelRenderer: view.list });
        if (player()?.getPlaylistId?.() === listId) return 'panel';
      }
    } catch {
      // fall back below
    }
  }
  return onWatch && !mini && navigateIntoList(p, videoId, listId) ? 'navigated' : false;
}

/** Fallback: reload the video inside the list at the same second (about 1 s of buffering). */
function navigateIntoList(p: PlayerApi, videoId: string, listId: string): boolean {
  const t = Math.floor(p.getCurrentTime?.() ?? 0);
  if (p.getPlayerState?.() === 2) {
    document.addEventListener('yt-navigate-finish', () => setTimeout(() => {
      try {
        player()?.pauseVideo?.();
      } catch {
        // cosmetic
      }
    }, 300), { once: true });
  }
  const url = `/watch?v=${encodeURIComponent(videoId)}&list=${encodeURIComponent(listId)}${t ? `&t=${t}s` : ''}`;
  navigate(url, { watchEndpoint: { videoId, playlistId: listId, ...(t ? { startTimeSeconds: t } : {}) } }, { webPageType: 'WEB_PAGE_TYPE_WATCH', rootVe: 3832 });
  return true;
}

/** After adding to the list that is playing, let the side panel reload it (§21.4). */
function refreshPlaylist(): void {
  const a = app();
  a.dispatchEvent(new CustomEvent('yt-action', {
    bubbles: true,
    composed: true,
    detail: { actionName: 'yt-refresh-playlist-command', optionalAction: false, returnValue: [], args: [{ refreshPlaylistCommand: {} }, a] },
  }));
}

// ---------- RPC ----------

const methods: Record<string, (...args: never[]) => unknown> = {
  editablePlaylists: it.editablePlaylists,
  createPrivatePlaylist: it.createPrivatePlaylist,
  readPlaylist: it.readPlaylist,
  editPlaylist: it.editPlaylist,
  identity: it.identity,
  setTakeover: (s: TakeoverState) => {
    state = s;
    relabel();
  },
  armRemoval,
  disarm: () => {
    armed = undefined;
  },
  playVideo,
  openPlaylist,
  attachList,
  refreshPlaylist,
  health: () => ({
    app: !!document.querySelector('ytd-app'),
    ytcfg: typeof (window as { ytcfg?: unknown }).ytcfg === 'object',
    takeover: takeoverInstalled,
  }),
  playing: () => {
    const p = player();
    const index = p?.getPlaylistIndex?.();
    return { videoId: p?.getVideoData?.()?.video_id, playlistId: p?.getPlaylistId?.(), index: typeof index === 'number' && index >= 0 ? index : undefined };
  },
};

export function startMainWorld(): void {
  installTakeover();
  installRelabel();
  installPlayerWatch();
  window.addEventListener('message', async (e) => {
    if (e.source !== window || !isToMain(e.data)) return;
    const { id, method, args } = e.data;
    try {
      const fn = methods[method];
      if (!fn) throw new Error(`unknown method ${method}`);
      const result = await (fn as (...a: unknown[]) => unknown)(...args);
      post({ id, ok: true, result } as ToIso);
    } catch (err) {
      post({ id, ok: false, error: err instanceof Error ? err.message : String(err) } as ToIso);
    }
  });
  post({ event: 'ready' } as ToIso);
}
