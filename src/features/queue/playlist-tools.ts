// "Clear all" and "Remove watched" on your own playlist pages (design §25),
// with confirm, 10 s undo, and the most recent snapshot kept (per identity)
// for the settings page.

import { t as tr } from '@/core/i18n';
import type { Logger } from '@/core/log';
import { chunk, planClear, planUndoMoves, type ListAction, type Snapshot } from './core';
import { saveSnapshot } from './profiles';
import type { Rpc } from './rpc';
import { toast } from './toast';

const UNDO_MS = 10_000;
const HEADER = 'ytd-playlist-header-renderer, yt-page-header-renderer';

const STYLE = `
  :host { all: initial; }
  * { box-sizing: border-box; font-family: Roboto, Arial, sans-serif; }
  .btn { all: unset; cursor: pointer; display: inline-flex; align-items: center; justify-content: center;
    height: 36px; min-width: 36px; padding: 0 12px; border-radius: 18px; font-size: 14px; font-weight: 500;
    background: rgba(255,255,255,.1); color: #fff; }
  .btn:hover { background: rgba(255,255,255,.2); }
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
      host.style.cssText = 'display:inline-flex;margin-left:8px;vertical-align:middle;';
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

  const removeRows = (setIds: Set<string>) => {
    for (const el of document.querySelectorAll<HTMLElement & { data?: { setVideoId?: string } }>('ytd-playlist-video-renderer')) {
      if (el.data?.setVideoId && setIds.has(el.data.setVideoId)) el.remove();
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
        toast(tr(mode === 'watched' ? 'queue.noneWatched' : 'queue.empty'), undefined, 4000);
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
      removeRows(new Set(remove.map((i) => i.setVideoId)));
      log.info(`clear (${mode}) on ${listId}: removed ${remove.length - failed}`);
      toast(tr('queue.deleted', { n: remove.length - failed }), { label: tr('queue.undo'), run: () => void restoreSnapshot(rpc, log, snapshot).then(() => location.reload()) }, UNDO_MS);
    } catch (e) {
      log.error('clear failed', e);
      toast(tr('queue.failed'), undefined, 6000);
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

  /** Place the button next to Play all / Shuffle, if this list is ours. */
  const mount = async () => {
    const listId = listIdFromUrl();
    if (!listId) {
      host?.remove();
      forList = undefined;
      return;
    }
    if (forList === listId && host?.isConnected) return;
    forList = listId;
    host?.remove();
    let editable = false;
    try {
      editable = (await rpc.readPlaylist(listId)).editable;
    } catch (e) {
      log.warn('playlist tools: could not read list', e);
    }
    if (!editable || forList !== listId) return;
    const header = await waitFor(HEADER);
    if (!header || forList !== listId) return;
    const shuffle = [...header.querySelectorAll('button, a')].find((b) => /shuffle|随机/i.test(b.getAttribute('aria-label') ?? b.textContent ?? ''));
    const anchor = shuffle?.closest('yt-button-view-model, ytd-button-renderer, yt-flexible-actions-view-model > div') ?? shuffle?.parentElement;
    const r = ui();
    r.querySelector('.btn.more')?.remove();
    const btn = document.createElement('button');
    btn.className = 'btn more';
    btn.type = 'button';
    btn.title = tr('queue.toolsTitle');
    btn.setAttribute('aria-label', tr('queue.toolsLabel'));
    btn.setAttribute('aria-haspopup', 'menu');
    btn.textContent = '⋯';
    btn.addEventListener('click', () => openMenu(btn));
    r.append(btn);
    if (anchor?.parentElement) anchor.after(host!);
    else header.append(host!);
  };

  const onNavigate = () => void mount();

  return {
    enable() {
      document.addEventListener('yt-navigate-finish', onNavigate);
      void mount();
    },
    disable() {
      document.removeEventListener('yt-navigate-finish', onNavigate);
      host?.remove();
      host = root = undefined;
      forList = undefined;
    },
  };
}

function waitFor(selector: string, ms = 8000): Promise<Element | undefined> {
  return new Promise((resolve) => {
    const found = document.querySelector(selector);
    if (found) return resolve(found);
    const mo = new MutationObserver(() => {
      const el = document.querySelector(selector);
      if (el) {
        mo.disconnect();
        resolve(el);
      }
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => {
      mo.disconnect();
      resolve(undefined);
    }, ms);
  });
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
