// window.postMessage bridge between the isolated content script and the MAIN
// world script. Both sides live on youtube.com; the tag keeps our messages
// apart from the page's.

import type { ListEdit, ListItem, ListSnapshot, Takeover, ToolOp } from './core';

export const TAG = 'ytpp-queue';

export type ToMain = { tag: typeof TAG; dir: 'toMain'; id: number; method: string; args: unknown[] };
export type ToIso =
  | { tag: typeof TAG; dir: 'toIso'; id: number; ok: true; result: unknown }
  | { tag: typeof TAG; dir: 'toIso'; id: number; ok: false; error: string }
  | { tag: typeof TAG; dir: 'toIso'; event: 'add'; videoIds: string[] }
  | { tag: typeof TAG; dir: 'toIso'; event: 'nativeAdd' }
  | { tag: typeof TAG; dir: 'toIso'; event: 'warn'; msg: string }
  | { tag: typeof TAG; dir: 'toIso'; event: 'player'; payload: PlayerEvent }
  /** A successful edit_playlist, by the page or by us (F-05-AC13). */
  | { tag: typeof TAG; dir: 'toIso'; event: 'edited'; edit: ListEdit }
  /** The page put this list in the playlist panel (F-05-AC13). */
  | { tag: typeof TAG; dir: 'toIso'; event: 'panel'; playlistId: string; snap: ListSnapshot }
  /** Our Clear all / Remove watched in an official ⋮ menu was chosen (F-06). */
  | { tag: typeof TAG; dir: 'toIso'; event: 'tool'; op: ToolOp; listId: string }
  /** A panel entry dropped outside the panel was removed, or not (F-06). */
  | { tag: typeof TAG; dir: 'toIso'; event: 'dropped'; drop: Dropped }
  | { tag: typeof TAG; dir: 'toIso'; event: 'ready' };

/**
 * near: under 10 s left (once per video). ended: the video ended.
 * left: another video started; carries where the previous one was left.
 */
export interface PlayerEvent {
  type: 'near' | 'ended' | 'left';
  videoId: string;
  playlistId: string | undefined;
  /** player.getPlaylistIndex() */
  index: number | undefined;
  currentTime: number;
  duration: number;
  /** Loop (F-10) was on at this moment. */
  loop?: boolean;
  /** This video has wrapped from its end back to the start at least once. */
  looped?: boolean;
  /** left: the playlist of the video that started (undefined: none, or the tab closed). */
  toPlaylistId?: string;
}

/** What the isolated side tells the page script to do with Add to queue. */
export interface TakeoverState {
  decision: Takeover;
  /** "Add to <list name>", shown on the menu items while taking over. */
  label: string;
  /** The chosen list while taking over: its panels get our ⋮ items and drag out to delete (F-06). */
  listId?: string;
}

/** What the official ⋮ menus get (F-06) and the drag out of the panel says (F-06). */
export interface MenuState {
  /** The /playlist page's list, when this identity can edit it. */
  pageList?: string;
  labels: { clearAll: string; removeWatched: string; dropToDelete: string };
}

export interface Dropped {
  listId: string;
  setVideoId: string;
  videoId: string;
  ok: boolean;
  error?: string;
  /** The list as the panel showed it when the drag started. */
  before: ListItem[];
}

export function isToIso(d: unknown): d is ToIso {
  return !!d && typeof d === 'object' && (d as ToIso).tag === TAG && (d as ToIso).dir === 'toIso';
}

export function isToMain(d: unknown): d is ToMain {
  return !!d && typeof d === 'object' && (d as ToMain).tag === TAG && (d as ToMain).dir === 'toMain';
}
