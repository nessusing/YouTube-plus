// MAIN world side of the queue feature (F-05): QueueTakeover (intercept
// Add to queue, relabel it), PlayerWatch, page navigation, InnerTube calls,
// the official ⋮ menus and drag out to delete (page-menus.ts, F-06), and
// the bridge to the isolated script. Never break the page: every handler
// swallows its own errors.

import { isToMain, TAG, type PlayerEvent, type TakeoverState, type ToIso } from './bridge';
import type { SyncResult } from './rpc';
import { isLoopWrap, isQueueCommand, isWatchedHere, meetsExpect, nextHasList, nextRows, panelSnapshot, panelView, parseEdit, parseQueueAction, QUEUE_ICON, type Expect, type ListAction } from './core';
import * as it from './innertube';
import { listenWithPip, queryPlayerDom } from '@/core/pip-doc';
import { installPageMenus, setMenu, sheetItems, swapDrop } from './page-menus';

const post = (m: Omit<ToIso, 'tag' | 'dir'>) => window.postMessage({ tag: TAG, dir: 'toIso', ...m }, location.origin);

let state: TakeoverState = { decision: 'native', label: '' };
let takeoverInstalled = false;

function app(): HTMLElement {
  const a = document.querySelector<HTMLElement>('ytd-app');
  if (!a) throw new Error('ytd-app not found');
  return a;
}

// ---------- QueueTakeover: intercept (F-05-AC6) ----------

function installTakeover(): void {
  // The action bubbles up from the clicked element, not from ytd-app (F-05-AC5),
  // so listen on document in the capture phase, ahead of the page.
  document.addEventListener('yt-action', (e) => {
    try {
      const p = parseQueueAction((e as CustomEvent).detail);
      if (p.kind === 'other') return;
      if (p.kind === 'malformed') {
        // Better native than an Add to queue that does nothing (F-05-AC15).
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

// ---------- QueueTakeover: relabel (F-05-AC7) ----------

type AnyEl = HTMLElement & Record<string, unknown>;

/** New-style menus: title span → what it said before and what we wrote. */
const newMenu = new Map<Element, { orig: string; wrote: string }>();
/** Old-style menus we relabelled. */
const oldMenu = new Set<AnyEl>();
/** Hover buttons: renderer → original tooltip. */
const tips = new WeakMap<Element, unknown>();

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
      // Not textContent: Polymer would add a second text run on reopen (F-05-AC7).
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

/** New-style hover buttons: what their label said before we changed it. */
const hoverLabels = new WeakMap<HTMLElement, { aria: string | null; title: string | null }>();

/**
 * Hover button on thumbnails: relabel it when the pointer reaches it (F-05-AC7).
 * Old style: the tooltip in the renderer's data. New style (2026-11,
 * toggle-button-view-model; findings F11): the inner button's aria-label,
 * which is the label it shows, plus a title so the pointer gets a tooltip.
 */
function onHover(e: Event): void {
  try {
    const target = e.target as Element | null;
    const take = state.decision === 'take' && !!state.label;
    const vm = target?.closest?.('toggle-button-view-model') as (HTMLElement & { data?: unknown }) | null;
    if (vm) {
      const d = vm.data as { defaultButtonViewModel?: { buttonViewModel?: { iconName?: string } } } | undefined;
      const btn = vm.querySelector<HTMLElement>('button');
      if (!btn || d?.defaultButtonViewModel?.buttonViewModel?.iconName !== QUEUE_ICON) return;
      if (take) {
        if (!hoverLabels.has(btn)) hoverLabels.set(btn, { aria: btn.getAttribute('aria-label'), title: btn.getAttribute('title') });
        btn.setAttribute('aria-label', state.label!);
        btn.title = state.label!;
      } else {
        const was = hoverLabels.get(btn);
        if (!was) return;
        hoverLabels.delete(btn);
        for (const [k, v] of [['aria-label', was.aria], ['title', was.title]] as const) {
          if (v === null) btn.removeAttribute(k);
          else btn.setAttribute(k, v);
        }
      }
      return;
    }
    const el = target?.closest?.('ytd-thumbnail-overlay-toggle-button-renderer') as AnyEl | null;
    const data = el?.data as { untoggledIcon?: { iconType?: string }; untoggledTooltip?: unknown } | undefined;
    if (!el || !data || data.untoggledIcon?.iconType !== QUEUE_ICON) return;
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
  // title changes (F-05-AC7): watch the popup container, and rescan after clicks.
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

// ---------- PlayerWatch (F-05) ----------

type PlayerApi = HTMLElement & {
  getVideoData?: () => { video_id?: string; title?: string; author?: string };
  getDuration?: () => number;
  getPlaylistId?: () => string | undefined;
  getPlaylistIndex?: () => number;
  /** The video IDs of the list the player holds. */
  getPlaylist?: () => string[] | null | undefined;
  playVideoAt?: (index: number) => void;
  getCurrentTime?: () => number;
  /** 2 = paused */
  getPlayerState?: () => number;
  pauseVideo?: () => void;
};

/** How long a looped video that was left waits to learn where to (F-10). */
const LEFT_WAIT_MS = 5000;

/** A removal sent by the page itself on unload, when the tab closes in the last 10 s. */
let armed: { videoId: string; listId: string; setVideoId: string; req: { url: string; init: RequestInit }; at: number } | undefined;
let rearming = false;

async function armRemoval(listId: string, setVideoId: string, videoId: string): Promise<void> {
  const req = await it.prepare('browse/edit_playlist', { playlistId: listId, actions: [{ action: 'ACTION_REMOVE_VIDEO', setVideoId }] });
  armed = { videoId, listId, setVideoId, req, at: Date.now() };
}

/** Popped out to a PiP window (F-11), the player is in that window's document. */
function player(): PlayerApi | null {
  return queryPlayerDom<PlayerApi>('#movie_player');
}

function installPlayerWatch(): void {
  let last: PlayerEvent | undefined;
  let nearSent: string | undefined;
  /** The video playing has wrapped from its end to the start by loop (F-10). */
  let loopedId: string | undefined;
  /** A looped video just left, waiting to learn the new video's list. */
  let leaving: { e: PlayerEvent; since: number } | undefined;
  const listInUrl = () => (location.pathname === '/watch' ? new URLSearchParams(location.search).get('list') ?? undefined : undefined);
  const snapshot = (type: PlayerEvent['type'], v: HTMLVideoElement): PlayerEvent | undefined => {
    const p = player();
    const videoId = p?.getVideoData?.()?.video_id;
    if (!videoId) return undefined;
    const index = p?.getPlaylistIndex?.();
    return {
      type, videoId, playlistId: p?.getPlaylistId?.() ?? undefined, index: typeof index === 'number' && index >= 0 ? index : undefined,
      currentTime: v.currentTime, duration: v.duration || 0, loop: v.loop,
    };
  };
  // By tag: a video in a PiP window (F-11) may not be an instance of this window's HTMLVideoElement.
  const isMain = (v: EventTarget | null): v is HTMLVideoElement =>
    (v as Element | null)?.tagName === 'VIDEO' && !!(v as Element).closest('#movie_player');

  // On every PiP document too: popped out (F-11), the video's events stay there.
  listenWithPip('timeupdate', (e) => {
    try {
      if (!isMain(e.target)) return;
      const s = snapshot('left', e.target);
      if (!s) return;
      if (leaving) {
        // Only a looped video waits to learn where it was left for (F-10).
        const to = s.playlistId ?? listInUrl();
        if (to !== undefined || Date.now() - leaving.since > LEFT_WAIT_MS) {
          post({ event: 'player', payload: { ...leaving.e, toPlaylistId: to } } as ToIso);
          leaving = undefined;
        }
      }
      if (last && last.videoId !== s.videoId) {
        // A new video started: report how the previous one was left, and where
        // to. getPlaylistId() is empty for a moment while it loads: a looped
        // video, whose removal depends on it, waits for it (or the URL's list).
        const to = s.playlistId ?? listInUrl();
        if (last.looped && to === undefined) leaving = { e: last, since: Date.now() };
        else post({ event: 'player', payload: { ...last, toPlaylistId: to } } as ToIso);
        if (armed && armed.videoId !== s.videoId) armed = undefined;
        loopedId = undefined;
      } else if (last && s.loop && isLoopWrap(last.currentTime, s.currentTime, s.duration)) {
        loopedId = s.videoId;
        // Next pass may run with loop off: let "near" fire again then.
        nearSent = undefined;
      }
      s.looped = loopedId === s.videoId;
      last = s;
      // On loop the video is being watched on repeat, not finished (F-10).
      if (nearSent !== s.videoId && !s.loop && isWatchedHere(s.currentTime, s.duration, false)) {
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
  listenWithPip('ended', (e) => {
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
      if (armed && last?.videoId === armed.videoId && !last.loop && isWatchedHere(last.currentTime, last.duration, false)) {
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

/** SPA navigation like a click on a link; full page load if the page does not start one (F-05). */
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

/**
 * Play `videoId` inside the list. With `keepPlace` and that video already in
 * the player: in the miniplayer, open it on the watch page at the same second
 * (F-05); already on its watch page, leave it be.
 */
function playVideo(videoId: string, listId: string, keepPlace = false): void {
  const p = player();
  const here = keepPlace && p?.getVideoData?.()?.video_id === videoId;
  if (here && !app().hasAttribute('miniplayer-is-active') && location.pathname === '/watch'
    && new URLSearchParams(location.search).get('v') === videoId) return;
  const t = here ? Math.floor(p!.getCurrentTime?.() ?? 0) : 0;
  const url = `/watch?v=${encodeURIComponent(videoId)}&list=${encodeURIComponent(listId)}${t ? `&t=${t}s` : ''}`;
  navigate(url, { watchEndpoint: { videoId, playlistId: listId, ...(t ? { startTimeSeconds: t } : {}) } }, { webPageType: 'WEB_PAGE_TYPE_WATCH', rootVe: 3832 });
}

/** How long to wait for the miniplayer to switch to the next entry before navigating anyway. */
const MINI_NEXT_WAITS = [300, 700, 1000, 1000];

/**
 * After an entry ends, play the next one in the form the player is in (F-05).
 * In the miniplayer, through the player's own list so it stays a miniplayer
 * (a navigation would open the watch page); elsewhere, or if the player does
 * not have that entry, navigate like playVideo.
 */
async function playNext(videoId: string, listId: string): Promise<'mini' | 'page'> {
  const p = player();
  if (p?.playVideoAt && app().hasAttribute('miniplayer-is-active')) {
    const list = p.getPlaylist?.() ?? [];
    const at = p.getPlaylistIndex?.() ?? -1;
    // A duplicate: take the one after the entry that just ended.
    let j = list.indexOf(videoId, at + 1);
    if (j < 0) j = list.indexOf(videoId);
    if (j >= 0) {
      p.playVideoAt(j);
      for (const wait of MINI_NEXT_WAITS) {
        await sleep(wait);
        if (player()?.getVideoData?.()?.video_id === videoId) return 'mini';
      }
    }
  }
  playVideo(videoId, listId);
  return 'page';
}

function openPlaylist(listId: string): void {
  const url = `/playlist?list=${encodeURIComponent(listId)}`;
  navigate(url, { browseEndpoint: { browseId: `VL${listId}` } }, { webPageType: 'WEB_PAGE_TYPE_PLAYLIST', rootVe: 5754 });
}

/** YouTube's playlist manager; the native queue calls these three (F-05). */
type PlaylistManager = HTMLElement & {
  getPlaylistData?: () => unknown;
  setAutoplayRenderer?: (a: unknown) => void;
  setPlaylistData?: (d: unknown) => void;
  setPlayerPlaybackControlData?: (d: unknown) => void;
};

/**
 * The list playing: the player's own, or the native queue (TLPQ…), which the
 * player does not report while it plays in the miniplayer (findings A5, F8).
 */
function playingList(p: PlayerApi | null): string | undefined {
  const own = p?.getPlaylistId?.();
  if (own) return own;
  const pm = document.querySelector<PlaylistManager>('yt-playlist-manager');
  const id = (pm?.getPlaylistData?.() as { playlistId?: unknown } | undefined)?.playlistId;
  return typeof id === 'string' && id.startsWith('TLPQ') ? id : undefined;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Removals can take a few seconds to show in reads (F-05). */
const SYNC_WAITS = [0, 1500, 3000, 5000];

/**
 * Bring the playlist panel up to date (F-05-AC13), the way the native queue does
 * it (F-05): read `next` for the video playing and the list, then hand it to
 * the playlist manager. Works on the watch page and under the miniplayer, no
 * reload. Playing the list: refresh. Playing a video outside any list and
 * `attach`: show the list with that video on top, to play after it (F-05-AC6).
 */
async function syncList(listId: string, expect: Expect | undefined, attach: boolean): Promise<SyncResult> {
  const p = player();
  const data = p?.getVideoData?.();
  const videoId = data?.video_id;
  if (!p || !videoId || p.classList.contains('ad-showing')) return { how: 'none' };
  const playing = playingList(p);
  if (playing ? playing !== listId : !attach) return { how: 'none' };
  const mini = app().hasAttribute('miniplayer-is-active');
  const onWatch = location.pathname === '/watch' && new URLSearchParams(location.search).get('v') === videoId;
  // Anywhere else the player is a leftover, not something playing.
  if (!mini && !onWatch) return { how: 'none' };
  const pm = document.querySelector<PlaylistManager>('yt-playlist-manager');
  if (pm?.setPlaylistData && pm.setPlayerPlaybackControlData && pm.setAutoplayRenderer) {
    try {
      for (const [i, wait] of SYNC_WAITS.entries()) {
        if (wait) await sleep(wait);
        const next = await it.call('next', { videoId, playlistId: listId });
        if (!meetsExpect(nextRows(next), expect) && i < SYNC_WAITS.length - 1) continue;
        // Moved on meanwhile: the page has loaded what goes with the new video.
        const now = player();
        if (now?.getVideoData?.()?.video_id !== videoId || playingList(now) !== playing) return { how: 'none' };
        if (!nextHasList(next)) {
          // The list is empty now and `next` leaves it out: empty the panel
          // the way its own Remove from playlist does. Nothing to attach.
          if (!playing) return { how: 'none' };
          dropFromPanel(listId, panelSnapshot(pm.getPlaylistData?.(), 0)?.snap.rows.map((r) => r.setVideoId) ?? []);
          return { how: 'panel', videoId };
        }
        // Playing the list already: a video not in it was just removed, not one to attach.
        const view = panelView(next, { videoId, title: data.title ?? '', author: data.author ?? '', duration: p.getDuration?.() ?? 0 }, !playing);
        if (!view) break;
        if (view.autoplay) pm.setAutoplayRenderer(view.autoplay);
        pm.setPlaylistData(view.list);
        pm.setPlayerPlaybackControlData({ playlistPanelRenderer: view.list });
        return { how: 'panel', videoId };
      }
    } catch {
      // fall back below
    }
  }
  if (playing) {
    refreshPlaylist();
    return { how: 'none' };
  }
  return onWatch && !mini && navigateIntoList(p, videoId, listId) ? { how: 'navigated', videoId } : { how: 'none' };
}

/**
 * Take entries off the playlist panel now, the way the panel's own Remove
 * from playlist does (measured 2026-11-21): the page drops the rows from the
 * playlist manager's data at once and leaves playback alone; an emptied list
 * shows "End of playlist", 1 / 0. Reads catch up later (F-05-AC13). Only when the
 * panel shows `listId`, and only entries it shows.
 */
function dropFromPanel(listId: string, setVideoIds: string[]): void {
  try {
    const pm = document.querySelector<PlaylistManager>('yt-playlist-manager');
    const shown = panelSnapshot(pm?.getPlaylistData?.(), 0);
    if (shown?.playlistId !== listId) return;
    const have = new Set(shown.snap.rows.map((r) => r.setVideoId));
    const ids = setVideoIds.filter((s) => have.has(s));
    if (!ids.length) return;
    const a = app();
    a.dispatchEvent(new CustomEvent('yt-action', {
      bubbles: true,
      composed: true,
      detail: { actionName: 'yt-playlist-remove-videos-action', optionalAction: false, args: [{ playlistRemoveVideosAction: { setVideoIds: ids } }, a, {}], returnValue: [] },
    }));
  } catch {
    // reads and F-05-AC13 catch up
  }
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

/** Fallback when the playlist manager is not there: ask the page to reload the panel (does nothing under the miniplayer). */
function refreshPlaylist(): void {
  const a = app();
  a.dispatchEvent(new CustomEvent('yt-action', {
    bubbles: true,
    composed: true,
    detail: { actionName: 'yt-refresh-playlist-command', optionalAction: false, returnValue: [], args: [{ refreshPlaylistCommand: {} }, a] },
  }));
}

// ---------- page edits (F-05-AC13) ----------

/**
 * The page edits lists itself too: Remove from playlist in the side panel,
 * Save to playlist, Add to queue straight into the list playing in the
 * miniplayer. Watch its edit_playlist requests and report the ones that went
 * through; reorders say nothing we count, so they are not reported. YouTube
 * looks `fetch` up on every call, so wrapping it at document_start sees them.
 * Some bodies are gzipped (it.bodyOf). Only a drop out of the panel (F-06) gets
 * its request changed, by swapDrop.
 */
function installEditWatch(): void {
  const orig = window.fetch;
  window.fetch = function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
    let body: Promise<unknown> | undefined;
    try {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      // Taken now, before the page's request reads its body.
      if (url.includes('/youtubei/v1/browse/edit_playlist') && !it.isOwn(init)) body = it.bodyOf(input, init);
    } catch {
      body = undefined;
    }
    const send = (): Promise<Response> => {
      const res = orig.call(this, input, init);
      if (body) {
        void Promise.all([body, res]).then(([b, r]) => {
          if (!r.ok) return;
          const edit = parseEdit(b);
          if (edit && (edit.has?.length || edit.gone?.length || edit.goneVideos?.length)) post({ event: 'edited', edit } as ToIso);
        }).catch(() => {});
      }
      return res;
    };
    try {
      const swapped = swapDrop(orig, input, init, body, send);
      if (swapped) return swapped;
    } catch {
      // send it as it is
    }
    return send();
  } as typeof window.fetch;
}

/**
 * Whenever the page (or we) put list data in the playlist panel, report it,
 * so the top bar count shows what the panel shows (F-05-AC13).
 */
function installPanelWatch(): void {
  const report = () => {
    try {
      const pm = document.querySelector<PlaylistManager>('yt-playlist-manager');
      const p = panelSnapshot(pm?.getPlaylistData?.(), Date.now());
      if (p) post({ event: 'panel', playlistId: p.playlistId, snap: p.snap } as ToIso);
    } catch {
      // the count catches up on the next read
    }
  };
  document.addEventListener('yt-playlist-data-updated', () => setTimeout(report, 0), true);
}

// ---------- RPC ----------

const methods: Record<string, (...args: never[]) => unknown> = {
  editablePlaylists: it.editablePlaylists,
  createPrivatePlaylist: it.createPrivatePlaylist,
  readPlaylist: it.readPlaylist,
  editPlaylist: async (id: string, actions: ListAction[]) => {
    const r = await it.editPlaylist(id, actions);
    const edit = parseEdit({ playlistId: id, actions });
    if (r.ok && edit) {
      dropFromPanel(id, edit.gone ?? []);
      post({ event: 'edited', edit } as ToIso);
    }
    return r;
  },
  identity: it.identity,
  setTakeover: (s: TakeoverState) => {
    state = s;
    relabel();
  },
  setMenu,
  armRemoval,
  disarm: () => {
    armed = undefined;
  },
  playVideo,
  playNext,
  openPlaylist,
  syncList,
  health: () => ({
    app: !!document.querySelector('ytd-app'),
    ytcfg: typeof (window as { ytcfg?: unknown }).ytcfg === 'object',
    takeover: takeoverInstalled,
  }),
  playing: () => {
    const p = player();
    const index = p?.getPlaylistIndex?.();
    return { videoId: p?.getVideoData?.()?.video_id, playlistId: playingList(p), index: typeof index === 'number' && index >= 0 ? index : undefined };
  },
};

export function startMainWorld(): void {
  installTakeover();
  installEditWatch();
  installPanelWatch();
  installRelabel();
  installPlayerWatch();
  installPageMenus({ takeover: () => state, post, dropFromPanel });
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
