// "Clear all" and "Remove watched" on your own playlist pages (design §25),
// with confirm, undo (a notice button, §46), and the most recent snapshot kept (per identity)
// for the settings page.

import { t as tr } from '@/core/i18n';
import { notify } from '@/core/notify';
import type { Logger } from '@/core/log';
import { chunk, planClear, planUndoMoves, type ListAction, type Snapshot } from './core';
import { saveSnapshot } from './profiles';
import type { Rpc } from './rpc';

const HEADER = 'ytd-playlist-header-renderer, yt-page-header-renderer';
/** The new header's row of buttons (Play all, Share, ⋮). */
const ROW = 'yt-flexible-actions-view-model';

const STYLE = `
  :host { all: initial; }
  * { box-sizing: border-box; font-family: Roboto, Arial, sans-serif; }
  .btn { all: unset; cursor: pointer; display: inline-flex; align-items: center; justify-content: center;
    height: 36px; min-width: 36px; padding: 0 12px; border-radius: 18px; font-size: 14px; font-weight: 500;
    background: rgba(255,255,255,.1); color: #fff; }
  .btn:hover { background: rgba(255,255,255,.2); }
  /* Same size as the header's round icon buttons beside it. */
  .btn.more { width: 40px; height: 40px; min-width: 0; padding: 0; border-radius: 50%; font-size: 18px; }
  .btn:focus-visible { outline: 2px solid #3ea6ff; outline-offset: 2px; }
  .menu { position: fixed; z-index: 2300; background: #282828; color: #f1f1f1; border-radius: 12px; padding: 8px 0;
    box-shadow: 0 4px 32px rgba(0,0,0,.4); min-width: 180px; }
  .menu button { all: unset; display: block; width: 100%; padding: 10px 16px; cursor: pointer; font-size: 14px; box-sizing: border-box; }
  .menu button:hover, .menu button:focus-visible { background: rgba(255,255,255,.1); }
  .scrim { position: fixed; inset: 0; z-index: 2300; background: rgba(0,0,0,.5); display: grid; place-items: center; }
  .dialog { background: #282828; color: #f1f1f1; border-radius: 12px; padding: 24px; width: min(400px, calc(100vw - 32px)); }
  .dialog p { margin: 0 0 20px; font-size: 15px; line-height: 1.5; }
  .row { display: flex; justify-content: flex-end; gap: 8px; }
  .primary { background: #3ea6ff; color: #0f0f0f; }
  .primary:hover { background: #65b8ff; }
`;

function listIdFromUrl(): string | undefined {
  if (location.pathname !== '/playlist') return undefined;
  return new URL(location.href).searchParams.get('list') ?? undefined;
}

/** `identity` is the hash the snapshot is stored under (design §25). */
export function playlistTools(rpc: Rpc, log: Logger, identity: () => string | undefined) {
  let host: HTMLElement | undefined;
  let root: ShadowRoot | undefined;
  let forList: string | undefined;
  let busy = false;

  const ui = () => {
    if (!host) {
      host = document.createElement('ytpp-playlist-tools');
      root = host.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = STYLE;
      root.append(style);
    }
    return root!;
  };

  const closeOverlays = () => root?.querySelectorAll('.menu, .scrim').forEach((e) => e.remove());

  const confirmDialog = (text: string, ok: string) =>
    new Promise<boolean>((resolve) => {
      closeOverlays();
      const scrim = document.createElement('div');
      scrim.className = 'scrim';
      scrim.innerHTML = `<div class="dialog" role="dialog" aria-modal="true"><p></p><div class="row">
        <button class="btn cancel" type="button">${tr('queue.cancel')}</button><button class="btn primary ok" type="button"></button></div></div>`;
      scrim.querySelector('p')!.textContent = text;
      scrim.querySelector('.ok')!.textContent = ok;
      const done = (v: boolean) => {
        scrim.remove();
        resolve(v);
      };
      scrim.addEventListener('click', (e) => e.target === scrim && done(false));
      scrim.querySelector('.cancel')!.addEventListener('click', () => done(false));
      scrim.querySelector('.ok')!.addEventListener('click', () => done(true));
      scrim.addEventListener('keydown', (e) => (e as KeyboardEvent).key === 'Escape' && done(false));
      ui().append(scrim);
      (scrim.querySelector('.ok') as HTMLElement).focus();
    });

  /**
   * Take the removed rows off the page. This script runs in the isolated
   * world, where the rows' Polymer `data` (setVideoId) is not visible, so
   * match them by the video link; only the list's own rows, not the
   * recommended videos under it. A video in the list twice goes twice, which
   * is what both modes remove anyway.
   */
  const removeRows = (videoIds: Set<string>) => {
    for (const el of document.querySelectorAll<HTMLElement>('ytd-playlist-video-list-renderer ytd-playlist-video-renderer')) {
      const href = el.querySelector<HTMLAnchorElement>('a#video-title, a#thumbnail, a[href*="watch?v="]')?.href;
      const v = href ? new URL(href).searchParams.get('v') : null;
      if (v && videoIds.has(v)) el.remove();
    }
  };

  const clear = async (mode: Snapshot['mode']) => {
    if (busy || !forList) return;
    busy = true;
    const listId = forList;
    try {
      const data = await rpc.readPlaylist(listId);
      const { remove, removed } = planClear(data.items, mode);
      if (!remove.length) {
        notify(tr(mode === 'watched' ? 'queue.noneWatched' : 'queue.empty'));
        return;
      }
      const title = data.title || listId;
      if (!(await confirmDialog(tr('queue.confirmRemove', { title, n: remove.length }), tr('queue.delete')))) return;
      let failed = 0;
      for (const part of chunk(remove)) {
        const r = await rpc.editPlaylist(listId, part.map((i) => ({ action: 'ACTION_REMOVE_VIDEO', setVideoId: i.setVideoId })));
        if (!r.ok) failed += part.length;
      }
      if (failed) log.warn(`clear (${mode}) on ${listId}: ${failed} of ${remove.length} failed`);
      const snapshot: Snapshot = { listId, listName: title, time: Date.now(), mode, removed };
      const id = identity();
      if (id) await saveSnapshot(id, snapshot);
      removeRows(new Set(remove.map((i) => i.videoId)));
      log.info(`clear (${mode}) on ${listId}: removed ${remove.length - failed}`);
      notify(tr('queue.deleted', { n: remove.length - failed }), { action: { label: tr('queue.undo'), run: () => void restoreSnapshot(rpc, log, snapshot).then((n) => shownInReads(rpc, listId, data.items.length - remove.length + n)).then(() => location.reload()) } });
    } catch (e) {
      log.error('clear failed', e);
      notify(tr('queue.failed'), { error: true });
    } finally {
      busy = false;
    }
  };

  const openMenu = (anchor: HTMLElement) => {
    closeOverlays();
    const menu = document.createElement('div');
    menu.className = 'menu';
    menu.setAttribute('role', 'menu');
    const r = anchor.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(r.left, innerWidth - 200))}px`;
    menu.style.top = `${r.bottom + 4}px`;
    const item = (label: string, fn: () => void) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'menuitem');
      b.textContent = label;
      b.addEventListener('click', () => {
        menu.remove();
        fn();
      });
      menu.append(b);
    };
    item(tr('queue.clearAll'), () => void clear('all'));
    item(tr('queue.removeWatched'), () => void clear('watched'));
    ui().append(menu);
    const off = (e: Event) => {
      if (!e.composedPath().includes(menu) && !e.composedPath().includes(anchor)) {
        menu.remove();
        document.removeEventListener('pointerdown', off, true);
      }
    };
    document.addEventListener('pointerdown', off, true);
    (menu.querySelector('button') as HTMLElement).focus();
  };

  /** The list on this page, once known to be ours. */
  let editableList: string | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;

  const button = () => {
    const r = ui();
    if (!r.querySelector('.btn.more')) {
      const btn = document.createElement('button');
      btn.className = 'btn more';
      btn.type = 'button';
      btn.title = tr('queue.toolsTitle');
      btn.setAttribute('aria-label', tr('queue.toolsLabel'));
      btn.setAttribute('aria-haspopup', 'menu');
      btn.textContent = '⋯';
      btn.addEventListener('click', () => openMenu(btn));
      r.append(btn);
    }
  };

  /**
   * Put the button in the header on screen. The page keeps hidden copies of
   * the header (a 0x0 one in the tabbed header, the old sidebar) and redraws
   * it after loading, which drops our button: so this runs every second and
   * puts it back when it is gone or hidden (measured 2026-11-21).
   */
  const place = () => {
    if (!editableList || editableList !== listIdFromUrl()) return;
    if (host?.isConnected && shown(host)) return;
    const header = firstShown(HEADER);
    if (!header) return;
    // New header: a line of its own under the action row, which has no room
    // to spare (YouTube squeezes "Play all" when a button is added to it).
    // Old header: next to Shuffle.
    const row = header.querySelector(ROW);
    const shuffle = row ? undefined : [...header.querySelectorAll('button, a')].find((b) => /shuffle|随机/i.test(b.getAttribute('aria-label') ?? b.textContent ?? ''));
    const anchor = row ?? shuffle?.closest('yt-button-view-model, ytd-button-renderer') ?? shuffle?.parentElement;
    button();
    host!.style.cssText = row ? 'display:flex;margin-top:8px;' : 'display:inline-flex;margin-left:8px;vertical-align:middle;';
    if (anchor?.parentElement) anchor.after(host!);
    else header.append(host!);
  };

  /** On a page of a list we can edit, show the button. */
  const mount = async () => {
    const listId = listIdFromUrl();
    if (listId === forList) return place();
    forList = listId;
    editableList = undefined;
    host?.remove();
    if (!listId) return;
    let editable = false;
    try {
      editable = (await rpc.readPlaylist(listId)).editable;
    } catch (e) {
      log.warn('playlist tools: could not read list', e);
    }
    if (!editable || forList !== listId) return;
    editableList = listId;
    place();
  };

  const onNavigate = () => void mount();

  return {
    enable() {
      document.addEventListener('yt-navigate-finish', onNavigate);
      timer = setInterval(place, 1000);
      void mount();
    },
    disable() {
      document.removeEventListener('yt-navigate-finish', onNavigate);
      clearInterval(timer);
      host?.remove();
      host = root = undefined;
      forList = editableList = undefined;
    },
  };
}

const shown = (el: Element) => el.getClientRects().length > 0 && el.getBoundingClientRect().width > 0;
const firstShown = (selector: string) => [...document.querySelectorAll(selector)].find(shown);

/**
 * Wait (up to ~10 s) until reads show `n` entries: reads lag behind writes by
 * a few seconds (findings A4), and a page reloaded too early shows the list
 * as it was before the undo.
 */
async function shownInReads(rpc: Rpc, listId: string, n: number): Promise<void> {
  for (const ms of [0, 1000, 1500, 2500, 5000]) {
    await new Promise((r) => setTimeout(r, ms));
    try {
      if ((await rpc.readPlaylist(listId)).items.length >= n) return;
    } catch {
      return;
    }
  }
}

/** Put the removed videos back where they were (design §25 undo). */
export async function restoreSnapshot(rpc: Rpc, log: Logger, s: Snapshot): Promise<number> {
  const added: string[] = [];
  for (const part of chunk(s.removed)) {
    const actions: ListAction[] = part.map((r) => ({ action: 'ACTION_ADD_VIDEO', addedVideoId: r.videoId }));
    const res = await rpc.editPlaylist(s.listId, actions);
    if (!res.ok) throw new Error(`re-adding failed: ${res.error ?? res.status}`);
    added.push(...res.added);
  }
  if (added.length === s.removed.length) {
    const now = await rpc.readPlaylist(s.listId);
    const moves = planUndoMoves(now.items, added, s.removed);
    for (const part of chunk(moves)) {
      await rpc.editPlaylist(s.listId, part.map((m) => ({ action: 'ACTION_MOVE_VIDEO_AFTER', setVideoId: m.setVideoId, ...(m.afterSetVideoId ? { movedSetVideoIdPredecessor: m.afterSetVideoId } : {}) })));
    }
  } else {
    log.warn(`undo: got ${added.length} new entries for ${s.removed.length} videos; left them at the end`);
  }
  log.info(`undo on ${s.listId}: restored ${added.length}`);
  return added.length;
}
