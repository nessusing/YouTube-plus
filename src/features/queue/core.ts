// Queue core (design §24, §25). Pure: no DOM, no fetch, no storage.

export interface ListItem { videoId: string; setVideoId: string; /** 0-100, from the resume overlay */ percent?: number }

export type ListAction =
  | { action: 'ACTION_ADD_VIDEO'; addedVideoId: string; dedupeOption?: 'DEDUPE_OPTION_SKIP' }
  | { action: 'ACTION_REMOVE_VIDEO'; setVideoId: string }
  | { action: 'ACTION_MOVE_VIDEO_AFTER'; setVideoId: string; movedSetVideoIdPredecessor?: string };

export const WATCHED_PERCENT = 90;
export const WATCHED_REMAINING_S = 10;
export const BATCH = 100;

export function chunk<T>(xs: T[], n = BATCH): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

export function isWatchedElsewhere(item: ListItem): boolean {
  return (item.percent ?? 0) >= WATCHED_PERCENT;
}

export function isWatchedHere(currentTime: number, duration: number, ended: boolean): boolean {
  return ended || (duration > 0 && duration - currentTime < WATCHED_REMAINING_S);
}

/** How close to the end / the start a jump must be to count as a loop wrap. */
export const LOOP_WRAP_S = 1.5;

/**
 * Between two time updates the video jumped from its last moments back to its
 * first: the loop (§40.2) wrapped it. Dragging the progress bar back to the
 * start from anywhere earlier does not count.
 */
export function isLoopWrap(prevTime: number, time: number, duration: number): boolean {
  return duration > 0 && prevTime >= duration - LOOP_WRAP_S && time < LOOP_WRAP_S && time < prevTime;
}

/**
 * Another video started: does the one left count as watched (§24.4, §40.2)?
 * Looped at least once and moved on inside the same list: yes. Loop still on
 * otherwise: no, it is being watched on repeat. Else: under 10 s were left.
 */
export function leftCountsAsWatched(e: {
  currentTime: number; duration: number; playlistId: string | undefined;
  loop?: boolean; looped?: boolean; toPlaylistId?: string;
}): boolean {
  if (e.looped && e.toPlaylistId !== undefined && e.toPlaylistId === e.playlistId) return true;
  if (e.loop) return false;
  return isWatchedHere(e.currentTime, e.duration, false);
}

// ---- per-identity queue settings (§22 Q17/Q22, §24.7) ----

export type QueueMode = 'native' | 'playlist';

export interface QueueProfile {
  mode: QueueMode;
  /** The chosen playlist (§24.5); absent = none chosen. */
  listId?: string;
  /** Its title, for display only; refreshed when the list is read. */
  listName?: string;
  /** "Remove from the playlist after playing" (§24.4). */
  removeWatched: boolean;
}

export const DEFAULT_PROFILE: QueueProfile = { mode: 'native', removeWatched: true };

export function profileWithDefaults(stored: Partial<QueueProfile> | undefined): QueueProfile {
  const s = stored ?? {};
  const p: QueueProfile = {
    mode: s.mode === 'playlist' ? 'playlist' : 'native',
    removeWatched: s.removeWatched !== false,
  };
  if (typeof s.listId === 'string' && s.listId) {
    p.listId = s.listId;
    if (typeof s.listName === 'string') p.listName = s.listName;
  }
  return p;
}

// ---- when to take over "Add to queue" (§24.1) ----

export interface TakeoverInput {
  featureOn: boolean;
  profile: QueueProfile;
  loggedIn: boolean;
  /** undefined while the check is still running */
  editable: boolean | undefined;
  /** Responses stopped matching what we expect (§26); paused until reload. */
  protocolError: boolean;
}

/**
 * take: intercept and add to the list. native: leave it alone, say nothing.
 * noList / notEditable: leave it alone, but tell the user why (once).
 */
export type Takeover = 'take' | 'native' | 'noList' | 'notEditable';

export function decideTakeover(i: TakeoverInput): Takeover {
  if (!i.featureOn || i.profile.mode !== 'playlist' || !i.loggedIn || i.protocolError) return 'native';
  if (!i.profile.listId) return 'noList';
  if (i.editable === false) return 'notEditable';
  return i.editable ? 'take' : 'native';
}

// ---- recognising "Add to queue" (§21.2, §21.3) ----

export const QUEUE_LIST_TYPE = 'PLAYLIST_EDIT_LIST_TYPE_QUEUE';
export const QUEUE_ICON = 'ADD_TO_QUEUE_TAIL';

/**
 * Read a `yt-action` event's detail. `queue`: an Add to queue we can take over.
 * `malformed`: it is an Add to queue but not shaped as recorded (YouTube
 * changed?): leave it to the page (§26). `other`: anything else.
 */
export function parseQueueAction(detail: unknown):
  | { kind: 'queue'; videoIds: string[] }
  | { kind: 'malformed' }
  | { kind: 'other' } {
  const d = detail as { actionName?: unknown; args?: unknown } | null;
  if (!d || d.actionName !== 'yt-add-to-playlist-command') return { kind: 'other' };
  const cmd = (Array.isArray(d.args) ? (d.args[0] as { addToPlaylistCommand?: unknown } | undefined) : undefined)?.addToPlaylistCommand as
    | { listType?: unknown; videoId?: unknown; videoIds?: unknown }
    | undefined;
  if (!cmd || typeof cmd !== 'object') return { kind: 'other' };
  if (cmd.listType !== QUEUE_LIST_TYPE) return { kind: 'other' };
  const ids = Array.isArray(cmd.videoIds) ? cmd.videoIds.filter((v): v is string => typeof v === 'string' && !!v) : [];
  if (!ids.length && typeof cmd.videoId === 'string' && cmd.videoId) ids.push(cmd.videoId);
  return ids.length ? { kind: 'queue', videoIds: [...new Set(ids)] } : { kind: 'malformed' };
}

/** True if a command object (menu item data) contains an Add to queue. */
export function isQueueCommand(cmd: unknown, depth = 0): boolean {
  if (!cmd || typeof cmd !== 'object' || depth > 8) return false;
  const c = cmd as Record<string, unknown>;
  const add = c.addToPlaylistCommand as { listType?: unknown } | undefined;
  if (add && add.listType === QUEUE_LIST_TYPE) return true;
  for (const v of Object.values(c)) {
    if (Array.isArray(v) ? v.some((x) => isQueueCommand(x, depth + 1)) : isQueueCommand(v, depth + 1)) return true;
  }
  return false;
}

/** The videos not in the list yet. The server ignores DEDUPE_OPTION_SKIP (2026-11-20). */
export function notInList(items: ListItem[], videoIds: string[]): string[] {
  const have = new Set(items.map((i) => i.videoId));
  return videoIds.filter((v) => !have.has(v));
}

export function addActions(videoIds: string[]): ListAction[] {
  return videoIds.map((v) => ({ action: 'ACTION_ADD_VIDEO', addedVideoId: v, dedupeOption: 'DEDUPE_OPTION_SKIP' }));
}

// ---- after a video is watched (§24.4) ----

/**
 * Given the list as it is now on the server, find the entry just watched and
 * the one to play next. `hintIndex` is the player's playlist index, used to
 * pick between duplicates and to carry on when the watched entry was already
 * removed elsewhere.
 */
export function nextAfter(items: ListItem[], videoId: string, hintIndex?: number): { watched?: ListItem; next?: ListItem } {
  const hits = items.map((it, i) => (it.videoId === videoId ? i : -1)).filter((i) => i >= 0);
  if (!hits.length) {
    // Gone already: whatever now sits at its old place is what came after it.
    const at = hintIndex !== undefined && hintIndex >= 0 ? hintIndex : 0;
    return { next: items[at] };
  }
  const idx = hintIndex === undefined ? hits[0]! : hits.reduce((a, b) => (Math.abs(b - hintIndex) < Math.abs(a - hintIndex) ? b : a));
  return { watched: items[idx], next: items[idx + 1] };
}

// ---- attach the list to the video playing (§24.2) ----

type Obj = Record<string, unknown>;
const obj = (x: unknown): Obj | undefined => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Obj) : undefined);

/**
 * The list as the native queue would show it: the video playing now on top
 * (local only, not added to the list), then the list, and autoplay pointing at
 * the list's first entry. From a `next` response for (playing video, list).
 */
export function queueView(next: unknown, now: { videoId: string; title: string; author: string; duration: number }): { list: Obj; autoplay: Obj } | undefined {
  const two = obj(obj(next)?.contents)?.twoColumnWatchNextResults as Obj | undefined;
  const list = obj(obj(two?.playlist)?.playlist);
  const autoplay = obj(obj(two?.autoplay)?.autoplay);
  const contents = list?.contents;
  if (!list || !autoplay || !Array.isArray(contents)) return undefined;
  // Copies: the page keeps the response, so do not change it.
  const copied = contents.map((c) => {
    const r = obj(obj(c)?.playlistPanelVideoRenderer);
    return r ? { ...obj(c), playlistPanelVideoRenderer: { ...r, selected: false } } : c;
  });
  const firstNav = copied.map((c) => obj(obj(c)?.playlistPanelVideoRenderer)?.navigationEndpoint).find(Boolean);
  if (!firstNav || !Array.isArray(autoplay.sets)) return undefined;
  const v = now.videoId;
  const d = Math.round(now.duration);
  const top = {
    playlistPanelVideoRenderer: {
      videoId: v,
      title: { simpleText: now.title },
      shortBylineText: { runs: [{ text: now.author }] },
      longBylineText: { runs: [{ text: now.author }] },
      thumbnail: { thumbnails: [{ url: `https://i.ytimg.com/vi/${v}/default.jpg`, width: 120, height: 90 }, { url: `https://i.ytimg.com/vi/${v}/mqdefault.jpg`, width: 320, height: 180 }] },
      ...(d > 0 ? { lengthText: { simpleText: `${Math.floor(d / 60)}:${String(d % 60).padStart(2, '0')}` } } : {}),
      indexText: { simpleText: '▶' },
      selected: true,
      navigationEndpoint: { commandMetadata: { webCommandMetadata: { url: `/watch?v=${v}`, webPageType: 'WEB_PAGE_TYPE_WATCH', rootVe: 3832 } }, watchEndpoint: { videoId: v } },
    },
  };
  const total = typeof list.totalVideos === 'number' ? list.totalVideos + 1 : undefined;
  const view = { ...list, contents: [top, ...copied], currentIndex: 0, localCurrentIndex: 0, ...(total ? { totalVideos: total } : {}) };
  const sets = (autoplay.sets as unknown[]).map((x) => ({ ...obj(x), autoplayVideo: firstNav, nextButtonVideo: firstNav }));
  const ap: Obj = { ...autoplay, sets };
  delete ap.modifiedSets;
  return { list: view, autoplay: ap };
}

/** The list's entries in a `next` response. */
export function nextRows(next: unknown): ListItem[] {
  const two = obj(obj(next)?.contents)?.twoColumnWatchNextResults as Obj | undefined;
  const contents = obj(obj(two?.playlist)?.playlist)?.contents;
  if (!Array.isArray(contents)) return [];
  return contents
    .map((c) => obj(obj(c)?.playlistPanelVideoRenderer))
    .filter((r): r is Obj => !!r && typeof r.videoId === 'string')
    .map((r) => ({ videoId: r.videoId as string, setVideoId: typeof r.playlistSetVideoId === 'string' ? r.playlistSetVideoId : '' }));
}

/**
 * What to hand the playlist manager for the video playing now: the list as
 * the server has it when that video is in it. A video from outside the list
 * (`attach`, §24.2) gets the queue view above. Playing the list but no longer
 * in it (just watched and removed, §24.4): the list as the server has it, and
 * no autoplay, so what plays next stays YouTube's call.
 */
export function panelView(next: unknown, now: { videoId: string; title: string; author: string; duration: number }, attach: boolean): { list: Obj; autoplay?: Obj } | undefined {
  const inList = nextRows(next).some((r) => r.videoId === now.videoId);
  if (!inList && attach) return queueView(next, now);
  const two = obj(obj(next)?.contents)?.twoColumnWatchNextResults as Obj | undefined;
  const list = obj(obj(two?.playlist)?.playlist);
  if (!list) return undefined;
  if (!inList) return { list: { ...list } };
  const autoplay = obj(obj(two?.autoplay)?.autoplay);
  return autoplay ? { list: { ...list }, autoplay: { ...autoplay } } : undefined;
}

// ---- keeping the UI in step with the list (§24.8) ----

/**
 * What a list edit should look like once reads catch up (removals can take a
 * few seconds to show, §21.4): these videos in it, these entries gone.
 */
export interface Expect {
  has?: string[];
  /** setVideoIds */
  gone?: string[];
  /** videoIds removed by id */
  goneVideos?: string[];
}

export interface ListEdit extends Expect {
  playlistId: string;
}

/** Read an edit_playlist request body (the page's or ours). */
export function parseEdit(body: unknown): ListEdit | undefined {
  const b = obj(body);
  if (!b || typeof b.playlistId !== 'string' || !Array.isArray(b.actions)) return undefined;
  const e: ListEdit = { playlistId: b.playlistId, has: [], gone: [], goneVideos: [] };
  for (const a of b.actions.map(obj)) {
    if (a?.action === 'ACTION_ADD_VIDEO' && typeof a.addedVideoId === 'string') e.has!.push(a.addedVideoId);
    else if (a?.action === 'ACTION_REMOVE_VIDEO' && typeof a.setVideoId === 'string') e.gone!.push(a.setVideoId);
    else if (a?.action === 'ACTION_REMOVE_VIDEO_BY_VIDEO_ID' && typeof a.removedVideoId === 'string') e.goneVideos!.push(a.removedVideoId);
  }
  return e;
}

export function mergeExpect(a: Expect | undefined, b: Expect | undefined): Expect {
  const cat = (x?: string[], y?: string[]) => [...(x ?? []), ...(y ?? [])];
  // Added then removed again (or the reverse) within one batch: the last word wins.
  const gone = cat(a?.gone, b?.gone);
  const goneVideos = cat(a?.goneVideos, b?.goneVideos).filter((v) => !(b?.has ?? []).includes(v));
  const has = cat(a?.has, b?.has).filter((v) => !(b?.goneVideos ?? []).includes(v));
  return { has: [...new Set(has)], gone: [...new Set(gone)], goneVideos: [...new Set(goneVideos)] };
}

export function meetsExpect(items: ListItem[], e: Expect | undefined): boolean {
  if (!e) return true;
  const vids = new Set(items.map((i) => i.videoId));
  const sets = new Set(items.map((i) => i.setVideoId));
  return (e.has ?? []).every((v) => vids.has(v))
    && (e.gone ?? []).every((s) => !sets.has(s))
    && (e.goneVideos ?? []).every((v) => !vids.has(v));
}

/**
 * One look at the list: from our own read, or what the page just put in the
 * playlist panel. `total` can exceed `rows` (the panel shows a window of a
 * long list).
 */
export interface ListSnapshot {
  rows: ListItem[];
  total: number;
  at: number;
}

/**
 * The count to show: the latest snapshot with the edits we know of applied on
 * top, so a read that has not caught up yet cannot bring back an old number.
 */
export function countWith(snap: ListSnapshot | undefined, e: Expect | undefined): number | undefined {
  if (!snap) return undefined;
  const gone = new Set(e?.gone ?? []);
  const goneVideos = new Set(e?.goneVideos ?? []);
  const vids = new Set(snap.rows.map((r) => r.videoId));
  const stale = snap.rows.filter((r) => gone.has(r.setVideoId) || goneVideos.has(r.videoId)).length;
  const missing = (e?.has ?? []).filter((v) => !vids.has(v)).length;
  return Math.max(0, snap.total - stale + missing);
}

/** Read the panel data the page handed the playlist manager (our own top row has no setVideoId). */
export function panelSnapshot(data: unknown, at: number): { playlistId: string; snap: ListSnapshot } | undefined {
  const d = obj(data);
  if (!d || typeof d.playlistId !== 'string' || !Array.isArray(d.contents)) return undefined;
  const all = d.contents.map((c) => obj(obj(c)?.playlistPanelVideoRenderer)).filter((r): r is Obj => !!r && typeof r.videoId === 'string');
  const rows = all.filter((r) => typeof r.playlistSetVideoId === 'string' && r.playlistSetVideoId)
    .map((r) => ({ videoId: r.videoId as string, setVideoId: r.playlistSetVideoId as string }));
  const local = all.length - rows.length;
  const total = typeof d.totalVideos === 'number' ? d.totalVideos - local : rows.length;
  return { playlistId: d.playlistId, snap: { rows, total: Math.max(rows.length, total), at } };
}

// ---- reading a playlist (§21.4) ----

const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);

function findFirst(o: unknown, key: string, depth = 0): unknown {
  const x = obj(o) ?? (Array.isArray(o) ? o : undefined);
  if (!x || depth > 30) return undefined;
  if (!Array.isArray(x) && key in x) return (x as Obj)[key];
  for (const v of Object.values(x)) {
    const hit = findFirst(v, key, depth + 1);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

function entryOf(row: unknown): ListItem | undefined {
  const r = obj(obj(row)?.playlistVideoRenderer);
  if (!r || typeof r.videoId !== 'string' || typeof r.setVideoId !== 'string') return undefined;
  const pct = findFirst(r.thumbnailOverlays, 'percentDurationWatched');
  return { videoId: r.videoId, setVideoId: r.setVideoId, percent: typeof pct === 'number' ? pct : undefined };
}

function tokenOf(rows: unknown[]): string | undefined {
  const more = rows.map((r) => obj(r)?.continuationItemRenderer).find(Boolean);
  const t = (findFirst(more, 'continuationCommand') as { token?: unknown } | undefined)?.token;
  return typeof t === 'string' ? t : undefined;
}

/**
 * One page of a playlist read (`browse` for VL<id>, or a continuation of it):
 * the list's own entries and the token for the list's next page. Only the
 * list's own rows count. A short list is followed by a "Recommended videos"
 * section whose rows look the same (playlistVideoRenderer with a setVideoId)
 * and that loads through its own continuation, outside playlistVideoListRenderer
 * (recorded 2026-11-20, findings F7).
 */
export function playlistPage(json: unknown): { items: ListItem[]; token?: string } {
  const list = obj(findFirst(json, 'playlistVideoListRenderer'));
  let rows: unknown[];
  if (list) {
    rows = arr(list.contents);
  } else {
    // A continuation: the list's rows are direct children of the appended items;
    // the recommendations target the page (VL…) and come wrapped in a section.
    rows = arr(obj(json)?.onResponseReceivedActions)
      .map((a) => obj(obj(a)?.appendContinuationItemsAction))
      .filter((a): a is Obj => !!a && !(typeof a.targetId === 'string' && (a.targetId.startsWith('VL') || a.targetId === 'recommended_videos_shelf')))
      .flatMap((a) => arr(a.continuationItems));
  }
  return { items: rows.map(entryOf).filter((i): i is ListItem => !!i), token: tokenOf(rows) };
}

/**
 * The list's title from a `browse` reply. Since 2026-11 the page has no
 * playlistHeaderRenderer; the title is in the metadata and the page header
 * (measured 2026-11-21).
 */
export function playlistTitle(json: unknown): string | undefined {
  const j = obj(json);
  const meta = obj(obj(j?.metadata)?.playlistMetadataRenderer)?.title;
  if (typeof meta === 'string' && meta) return meta;
  const page = obj(obj(j?.header)?.pageHeaderRenderer)?.pageTitle;
  if (typeof page === 'string' && page) return page;
  const old = obj(obj(findFirst(json, 'playlistHeaderRenderer'))?.title);
  const t = typeof old?.simpleText === 'string' ? old.simpleText : arr(old?.runs).map((r) => String(obj(r)?.text ?? '')).join('');
  return t || undefined;
}

/** Order-sensitive fingerprint, to tell whether the list changed elsewhere. */
export function listSignature(items: ListItem[]): string {
  return items.map((i) => i.setVideoId || i.videoId).join(',');
}

// ---- clear all / remove watched (§25) ----

export interface Snapshot {
  listId: string;
  listName: string;
  time: number;
  mode: 'all' | 'watched';
  /** removed videos with their original index in the list */
  removed: { videoId: string; index: number }[];
}

export function planClear(items: ListItem[], mode: 'all' | 'watched'): { remove: ListItem[]; removed: Snapshot['removed'] } {
  const picked = items.map((it, index) => ({ it, index })).filter(({ it }) => mode === 'all' || isWatchedElsewhere(it));
  return { remove: picked.map((p) => p.it), removed: picked.map((p) => ({ videoId: p.it.videoId, index: p.index })) };
}

/**
 * After re-adding (appended at the end), move each restored item back to its
 * original index. `after` = list as it is now (restored items at the end, in
 * snapshot order); returns moves to apply in order.
 */
export function planUndoMoves(after: ListItem[], restoredSetIds: string[], removed: Snapshot['removed']): { setVideoId: string; afterSetVideoId?: string }[] {
  const order = after.map((i) => i.setVideoId);
  const moves: { setVideoId: string; afterSetVideoId?: string }[] = [];
  const pairs = removed.map((r, k) => ({ index: r.index, setId: restoredSetIds[k]! })).filter((p) => p.setId).sort((a, b) => a.index - b.index);
  for (const p of pairs) {
    const target = Math.min(p.index, order.length - 1);
    const from = order.indexOf(p.setId);
    if (from === target) continue;
    order.splice(from, 1);
    order.splice(target, 0, p.setId);
    moves.push({ setVideoId: p.setId, afterSetVideoId: target === 0 ? undefined : order[target - 1] });
  }
  return moves;
}
