// MAIN world: "Clear all" / "Remove watched" in the official ⋮ menus (§47), and
// dragging an entry out of the playlist panel to delete it (§48). Never break
// the page: every handler swallows its own errors.
//
// Measured 2026-11-21:
// - The panels' ⋮ (beside the watch page, under the miniplayer) is an old-style
//   ytd-menu-renderer. Its popup is the shared ytd-menu-popup-renderer; the
//   dropdown's positionTarget tells which ⋮ opened it, and `opened-changed`
//   fires before it is sized. A chosen item fires yt-action
//   `yt-menu-service-item-selected-action` with the item's data.
// - The playlist page's ⋮ is a new-style button-view-model whose data carries
//   the sheet (showSheetCommand … listItems), read when it is clicked. A chosen
//   item runs its command inside the page, with no event to catch: catch the
//   click.
// - The panel's drag is Closure's DragListGroup: a `.dragging` copy of the row
//   under ytd-app follows the pointer. Dropped outside the list, the row goes
//   back where it was and the page still sends ACTION_MOVE_VIDEO_AFTER for it
//   (gzipped); that request is the moment to turn the drop into a removal.

import type { Dropped, MenuState, TakeoverState, ToIso } from './bridge';
import { moveToRemove, parseEdit, TOOL_KEY, toolOf, withTools, type ListItem, type ToolCommand, type ToolOp } from './core';
import * as it from './innertube';

type AnyEl = HTMLElement & Record<string, unknown>;
type Post = (m: Omit<ToIso, 'tag' | 'dir'>) => void;

let menu: MenuState = { labels: { clearAll: '', removeWatched: '', dropToDelete: '' } };
let takeover: () => TakeoverState = () => ({ decision: 'native', label: '' });
let post: Post = () => {};
let dropFromPanel: (listId: string, setVideoIds: string[]) => void = () => {};

export function setMenu(s: Partial<MenuState>): void {
  menu = { ...menu, ...s, labels: s.labels ?? menu.labels };
}

const ICON: Record<ToolOp, string> = { all: 'DELETE', watched: 'CHECK_CIRCLE_THICK' };
const label = (op: ToolOp) => (op === 'all' ? menu.labels.clearAll : menu.labels.removeWatched);
const command = (op: ToolOp, listId: string) => ({ [TOOL_KEY]: { op, listId } satisfies ToolCommand });
const panelList = (panel: Element | null) => ((panel as AnyEl | null)?.data as { playlistId?: unknown } | undefined)?.playlistId;

/** The list a ⋮ is for, when our items belong in it (§47). */
function listFor(opener: Element): string | undefined {
  const panel = opener.closest('ytd-playlist-panel-renderer');
  if (panel) {
    // A row's own ⋮ is not the panel's.
    if (opener.closest('ytd-playlist-panel-video-renderer')) return undefined;
    const s = takeover();
    const id = panelList(panel);
    return s.decision === 'take' && s.listId && id === s.listId ? id : undefined;
  }
  if (location.pathname === '/playlist' && opener.closest('yt-page-header-renderer, ytd-playlist-header-renderer')) {
    const id = new URLSearchParams(location.search).get('list');
    return id && id === menu.pageList ? id : undefined;
  }
  return undefined;
}

let lastTool = { key: '', at: 0 };
function chose(t: ToolCommand): void {
  // The old menu fires the selection twice (the item, then its menu).
  const key = `${t.op}:${t.listId}`;
  if (key === lastTool.key && Date.now() - lastTool.at < 1000) return;
  lastTool = { key, at: Date.now() };
  post({ event: 'tool', op: t.op, listId: t.listId } as ToIso);
}

function closeMenus(): void {
  for (const d of document.querySelectorAll<AnyEl>('ytd-popup-container tp-yt-iron-dropdown')) {
    if (d.opened) (d.close as (() => void) | undefined)?.();
  }
}

// ---------- old-style menus: the panels' ⋮ ----------

const oldItem = (op: ToolOp, listId: string) => ({
  menuServiceItemRenderer: { text: { runs: [{ text: label(op) }] }, icon: { iconType: ICON[op] }, serviceEndpoint: command(op, listId), trackingParams: '' },
});
const isOldOurs = (x: unknown) => !!toolOf((x as { menuServiceItemRenderer?: { serviceEndpoint?: unknown } } | undefined)?.menuServiceItemRenderer?.serviceEndpoint);

function onOpened(e: Event): void {
  try {
    const dd = e.target as AnyEl | null;
    if (dd?.tagName !== 'TP-YT-IRON-DROPDOWN' || !dd.opened) return;
    const popup = dd.querySelector<AnyEl>('ytd-menu-popup-renderer');
    const data = popup?.data as { items?: unknown[] } | undefined;
    if (!popup || !Array.isArray(data?.items)) return;
    const opener = dd.positionTarget as Element | undefined;
    const listId = opener instanceof Element ? listFor(opener) : undefined;
    if (!listId && !data.items.some(isOldOurs)) return;
    const ours = listId ? [oldItem('all', listId), oldItem('watched', listId)] : [];
    popup.data = { ...data, items: withTools(data.items, ours, isOldOurs) };
  } catch {
    // the menu stays as YouTube made it
  }
}

function onAction(e: Event): void {
  try {
    const d = (e as CustomEvent).detail as { actionName?: string; args?: { serviceEndpoint?: unknown }[] } | undefined;
    if (d?.actionName !== 'yt-menu-service-item-selected-action') return;
    const t = toolOf(d.args?.[0]?.serviceEndpoint);
    if (!t) return;
    e.stopImmediatePropagation();
    closeMenus();
    chose(t);
  } catch {
    // leave it to the page
  }
}

// ---------- new-style menus: the playlist page's ⋮ ----------

const newItem = (op: ToolOp, listId: string) => ({
  listItemViewModel: {
    title: { content: label(op) },
    leadingImage: { sources: [{ clientResource: { imageName: ICON[op] } }] },
    rendererContext: { commandContext: { onTap: { innertubeCommand: command(op, listId) } } },
  },
});
const newCommand = (x: unknown) =>
  (x as { listItemViewModel?: { rendererContext?: { commandContext?: { onTap?: { innertubeCommand?: unknown } } } } } | undefined)
    ?.listItemViewModel?.rendererContext?.commandContext?.onTap?.innertubeCommand;
const isNewOurs = (x: unknown) => !!toolOf(newCommand(x));

/** The sheet items a ⋮ button opens, if it is one. */
function sheetOf(data: unknown): unknown[] | undefined {
  const d = data as { iconName?: unknown; onTap?: { innertubeCommand?: { showSheetCommand?: { panelLoadingStrategy?: { inlineContent?: { sheetViewModel?: { content?: { listViewModel?: { listItems?: unknown } } } } } } } } } | undefined;
  if (d?.iconName !== 'MORE_VERT') return undefined;
  const items = d.onTap?.innertubeCommand?.showSheetCommand?.panelLoadingStrategy?.inlineContent?.sheetViewModel?.content?.listViewModel?.listItems;
  return Array.isArray(items) ? items : undefined;
}

/** About to open a new-style ⋮: put our items in its sheet, or take them out (§47). */
function primeSheet(e: Event): void {
  try {
    for (const n of e.composedPath()) {
      if (!(n instanceof HTMLElement) || n.tagName === 'YTD-POPUP-CONTAINER' || n === document.body) break;
      const items = sheetOf((n as AnyEl).data);
      if (!items) continue;
      const listId = listFor(n);
      if (!listId && !items.some(isNewOurs)) return;
      // The page reads this very array when the button is clicked.
      items.splice(0, items.length, ...withTools(items, listId ? [newItem('all', listId), newItem('watched', listId)] : [], isNewOurs));
      return;
    }
  } catch {
    // the menu stays as YouTube made it
  }
}

/** The sheet's list items, from the component data on an ancestor (§21.3). */
export function sheetItems(el: Element): Record<string, unknown>[] | undefined {
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

function onClick(e: Event): void {
  try {
    const item = e.composedPath().find((n) => n instanceof Element && n.tagName === 'YT-LIST-ITEM-VIEW-MODEL') as Element | undefined;
    if (!item?.closest('ytd-popup-container')) return primeSheet(e);
    const items = sheetItems(item);
    if (!items) return;
    const all = [...(item.parentElement?.closest('yt-list-view-model, yt-sheet-view-model') ?? document).querySelectorAll('yt-list-item-view-model')];
    let t = toolOf(newCommand(items[all.indexOf(item)]));
    // The rows and the items may not line up one to one: match by title.
    t ??= toolOf(newCommand(items.find((x) => isNewOurs(x) && (x.listItemViewModel as { title?: { content?: unknown } }).title?.content === item.textContent?.trim())));
    if (!t) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    closeMenus();
    chose(t);
  } catch {
    // leave it to the page
  }
}

// ---------- §48: drag out of the panel to delete ----------

const DRAGGER = 'ytd-app > ytd-playlist-panel-video-renderer.dragging';
const MARK = 'ytpp-drop-delete';
/** How long after the drop the page's reorder request may come. */
const ARM_MS = 5000;

const STYLE = `
${DRAGGER}[${MARK}] { border-radius: 8px; }
${DRAGGER}[${MARK}]::after {
  content: attr(${MARK}); position: absolute; inset: 0; z-index: 1; border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  background: rgba(204, 0, 0, .88); color: #fff; font: 500 14px/20px Roboto, Arial, sans-serif;
}`;

interface Drag { row: AnyEl; panel: Element; listId: string; setVideoId: string; videoId: string; before: ListItem[]; out: boolean }

let drag: Drag | undefined;
let armed: (Drag & { at: number; timer: ReturnType<typeof setTimeout> }) | undefined;

function panelItems(panel: Element): ListItem[] {
  const contents = ((panel as AnyEl).data as { contents?: unknown[] } | undefined)?.contents ?? [];
  return contents
    .map((c) => (c as { playlistPanelVideoRenderer?: { videoId?: unknown; playlistSetVideoId?: unknown } }).playlistPanelVideoRenderer)
    // Our own top row (a video attached to the list, §24.2) has no setVideoId.
    .filter((r): r is { videoId: string; playlistSetVideoId: string } => typeof r?.videoId === 'string' && typeof r.playlistSetVideoId === 'string' && !!r.playlistSetVideoId)
    .map((r) => ({ videoId: r.videoId, setVideoId: r.playlistSetVideoId }));
}

function onDown(e: PointerEvent): void {
  drag = undefined;
  try {
    if (e.button !== 0) return;
    const row = (e.target as Element | null)?.closest?.('ytd-playlist-panel-video-renderer') as AnyEl | null;
    const panel = row?.closest('ytd-playlist-panel-renderer');
    if (!row || !panel) return;
    const s = takeover();
    const listId = panelList(panel);
    if (s.decision !== 'take' || !s.listId || listId !== s.listId) return;
    const d = row.data as { videoId?: unknown; playlistSetVideoId?: unknown } | undefined;
    if (typeof d?.videoId !== 'string' || typeof d.playlistSetVideoId !== 'string' || !d.playlistSetVideoId) return;
    drag = { row, panel, listId, setVideoId: d.playlistSetVideoId, videoId: d.videoId, before: panelItems(panel), out: false };
  } catch {
    drag = undefined;
  }
}

/** Outside the panel: the dragged row turns red and says so; back inside, a plain reorder. */
function onMove(e: PointerEvent): void {
  if (!drag) return;
  try {
    const dragger = document.querySelector(DRAGGER);
    if (!dragger) return;
    const r = drag.panel.getBoundingClientRect();
    drag.out = e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    if (drag.out) dragger.setAttribute(MARK, menu.labels.dropToDelete);
    else dragger.removeAttribute(MARK);
  } catch {
    // cosmetic
  }
}

function onUp(): void {
  const d = drag;
  drag = undefined;
  try {
    const dragger = document.querySelector(DRAGGER);
    dragger?.removeAttribute(MARK);
    if (!d?.out || !dragger) return;
    // The page puts the row back and sends its reorder now: catch that request.
    if (armed) clearTimeout(armed.timer);
    armed = { ...d, at: Date.now(), timer: setTimeout(() => disarm(true), ARM_MS) };
    // Gone at once; it comes back if the removal fails. After the page has put it back.
    setTimeout(() => hide(d), 0);
  } catch {
    // the page carries on with its reorder
  }
}

function disarm(showRow: boolean): void {
  if (!armed) return;
  clearTimeout(armed.timer);
  if (showRow) unhide(armed.setVideoId);
  armed = undefined;
}

/**
 * Entries dropped out of a panel, hidden wherever a panel shows them for a
 * while: the page reuses row elements for other entries, and its own refresh
 * after the request may bring a dropped entry back for a few seconds while
 * reads lag (§21.4). Until §24.8 has the panel right.
 */
const HIDE_MS = 30_000;
const hidden = new Map<string, number>();
let hideTimer: ReturnType<typeof setInterval> | undefined;

function applyHidden(): void {
  const now = Date.now();
  for (const [sid, until] of hidden) if (now > until) hidden.delete(sid);
  for (const row of document.querySelectorAll<AnyEl>('ytd-playlist-panel-renderer ytd-playlist-panel-video-renderer')) {
    const sid = (row.data as { playlistSetVideoId?: unknown } | undefined)?.playlistSetVideoId;
    const hide = typeof sid === 'string' && hidden.has(sid);
    if (hide) {
      row.style.display = 'none';
      row.dataset.ytppHidden = '1';
    } else if (row.dataset.ytppHidden) {
      row.style.display = '';
      delete row.dataset.ytppHidden;
    }
  }
  if (!hidden.size && hideTimer) {
    clearInterval(hideTimer);
    hideTimer = undefined;
  }
}

function hide(d: Drag): void {
  hidden.set(d.setVideoId, Date.now() + HIDE_MS);
  applyHidden();
  hideTimer ??= setInterval(applyHidden, 300);
}

function unhide(setVideoId?: string): void {
  if (setVideoId) hidden.delete(setVideoId);
  else hidden.clear();
  applyHidden();
}

/**
 * Called by the fetch watcher for each edit_playlist the page sends. While a
 * drop is armed: if this is its reorder, send a removal instead and answer the
 * page with that (without the "Removed · Undo" notice it brings, §48).
 * Undefined when nothing is armed; another request while armed goes out
 * through `send`, as it would have.
 */
export function swapDrop(
  orig: typeof window.fetch,
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  body: Promise<unknown> | undefined,
  send: () => Promise<Response>,
): Promise<Response> | undefined {
  const a = armed;
  if (!a || !body || Date.now() - a.at > ARM_MS) return undefined;
  return (async () => {
    let repl: Record<string, unknown> | undefined;
    try {
      repl = moveToRemove(await body, a.listId, a.setVideoId);
    } catch {
      repl = undefined;
    }
    if (!repl) return send();
    disarm(false);
    const done = (ok: boolean, error?: string) => {
      if (!ok) unhide(a.setVideoId);
      const drop: Dropped = { listId: a.listId, setVideoId: a.setVideoId, videoId: a.videoId, ok, error, before: a.before };
      post({ event: 'dropped', drop } as ToIso);
    };
    const req = input instanceof Request ? input : undefined;
    const headers = new Headers(req?.headers);
    new Headers(init?.headers).forEach((v, k) => headers.set(k, v));
    headers.delete('content-encoding');
    headers.delete('content-length');
    const url = req?.url ?? (input instanceof URL ? input.href : String(input));
    let res: Response;
    try {
      res = await orig.call(window, url, { method: 'POST', headers, body: JSON.stringify(repl), credentials: req?.credentials ?? init?.credentials ?? 'same-origin' });
    } catch (err) {
      done(false, String(err));
      throw err;
    }
    if (!res.ok) {
      done(false, `HTTP ${res.status}`);
      return res;
    }
    const edit = parseEdit(repl);
    // Off the panel at once, as the panel's own Remove does.
    dropFromPanel(a.listId, [a.setVideoId]);
    if (edit) post({ event: 'edited', edit } as ToIso);
    done(true);
    try {
      const json = (await res.clone().json()) as Record<string, unknown>;
      delete json.actions;
      const h = new Headers(res.headers);
      h.delete('content-encoding');
      h.delete('content-length');
      return new Response(JSON.stringify(json), { status: res.status, statusText: res.statusText, headers: h });
    } catch {
      return res;
    }
  })();
}

export function installPageMenus(deps: { takeover: () => TakeoverState; post: Post; dropFromPanel: typeof dropFromPanel }): void {
  takeover = deps.takeover;
  post = deps.post;
  dropFromPanel = deps.dropFromPanel;
  // Not bubbling, but the capture phase passes every ancestor.
  document.addEventListener('opened-changed', onOpened, true);
  document.addEventListener('yt-action', onAction, true);
  document.addEventListener('pointerdown', primeSheet, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && primeSheet(e), true);
  window.addEventListener('pointerdown', onDown, true);
  window.addEventListener('pointermove', onMove, true);
  window.addEventListener('pointerup', onUp, true);
  window.addEventListener('pointercancel', () => (drag = undefined), true);
  const style = document.createElement('style');
  style.textContent = STYLE;
  (document.head ?? document.documentElement).append(style);
}
