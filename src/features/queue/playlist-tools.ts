// "Clear all" and "Remove watched" (F-06). The items sit in the
// official ⋮ menus (page-menus.ts, MAIN world): on the page of a list this
// identity can edit, and while taking over, in the panels showing the chosen
// list. Chosen: removed at once, no confirm, no undo; a page notice says how
// it went (F-02, failures F-05-AC15).

import { t as tr } from '@/core/i18n';
import { notify } from '@/core/notify';
import type { Logger } from '@/core/log';
import { chunk, clearNotice, planClear, type ListItem, type ToolOp } from './core';
import type { Playing, Rpc } from './rpc';

function listIdFromUrl(): string | undefined {
  if (location.pathname !== '/playlist') return undefined;
  return new URL(location.href).searchParams.get('list') ?? undefined;
}

/** Entries of `listId` were removed; `before` is the list as it was, `playing` what played then. */
export type OnRemoved = (listId: string, before: ListItem[], removed: string[], playing: Playing) => void;

export function playlistTools(rpc: Rpc, log: Logger, onRemoved: OnRemoved) {
  let forList: string | undefined;
  let busy = false;
  let on = false;

  /**
   * Take the removed rows off the list page. This script runs in the isolated
   * world, where the rows' Polymer `data` (setVideoId) is not visible, so
   * match them by the video link; only the list's own rows, not the
   * recommended videos under it. A video in the list twice goes twice, which
   * is what both operations remove anyway.
   */
  const removeRows = (videoIds: Set<string>) => {
    for (const el of document.querySelectorAll<HTMLElement>('ytd-playlist-video-list-renderer ytd-playlist-video-renderer')) {
      const href = el.querySelector<HTMLAnchorElement>('a#video-title, a#thumbnail, a[href*="watch?v="]')?.href;
      const v = href ? new URL(href).searchParams.get('v') : null;
      if (v && videoIds.has(v)) el.remove();
    }
  };

  const run = async (op: ToolOp, listId: string) => {
    if (busy || !on) return;
    busy = true;
    try {
      const data = await rpc.readPlaylist(listId);
      const remove = planClear(data.items, op);
      const playing = remove.length ? await rpc.playing().catch((): Playing => ({})) : {};
      const gone: ListItem[] = [];
      let failed = 0;
      for (const part of chunk(remove)) {
        try {
          const r = await rpc.editPlaylist(listId, part.map((i) => ({ action: 'ACTION_REMOVE_VIDEO', setVideoId: i.setVideoId })));
          if (r.ok) gone.push(...part);
          else {
            failed += part.length;
            log.warn(`${op === 'all' ? 'clear all' : 'remove watched'} on ${listId}: ${part.length} failed: ${r.error ?? r.status}`);
          }
        } catch (e) {
          failed += part.length;
          log.warn(`${op === 'all' ? 'clear all' : 'remove watched'} on ${listId}: ${part.length} failed`, e);
        }
      }
      if (gone.length) {
        onRemoved(listId, data.items, gone.map((i) => i.setVideoId), playing);
        if (listIdFromUrl() === listId) removeRows(new Set(gone.map((i) => i.videoId)));
        log.info(`${op === 'all' ? 'clear all' : 'remove watched'} on ${listId}: removed ${gone.length}`);
      }
      const n = clearNotice(remove.length, failed);
      notify(tr(n.key, { n: n.n, m: n.m }), failed ? { error: true } : undefined);
    } catch (e) {
      log.error(`${op === 'all' ? 'clear all' : 'remove watched'} failed`, e);
      notify(tr('queue.failed'), { error: true });
    } finally {
      busy = false;
    }
  };

  /** On the page of a list this identity can edit, its ⋮ gets the items. */
  const mount = async () => {
    const listId = listIdFromUrl();
    if (listId === forList) return;
    forList = listId;
    await rpc.setMenu({ pageList: undefined });
    if (!listId) return;
    let editable = false;
    try {
      editable = (await rpc.readPlaylist(listId)).editable;
    } catch (e) {
      log.warn('playlist tools: could not read list', e);
    }
    if (editable && on && forList === listId) await rpc.setMenu({ pageList: listId });
  };

  const onNavigate = () => void mount().catch((e) => log.debug(`playlist tools: ${String(e)}`));

  return {
    run,
    enable() {
      on = true;
      void rpc.setMenu({ labels: { clearAll: tr('queue.clearAll'), removeWatched: tr('queue.removeWatched'), dropToDelete: tr('queue.dropToDelete') } });
      document.addEventListener('yt-navigate-finish', onNavigate);
      onNavigate();
    },
    disable() {
      on = false;
      document.removeEventListener('yt-navigate-finish', onNavigate);
      forList = undefined;
      void rpc.setMenu({ pageList: undefined });
    },
  };
}
