// window.postMessage bridge between the isolated content script and the MAIN
// world script. Both sides live on youtube.com; the tag keeps our messages
// apart from the page's.

import type { ListEdit, ListSnapshot, Takeover } from './core';

export const TAG = 'ytpp-queue';

export type ToMain = { tag: typeof TAG; dir: 'toMain'; id: number; method: string; args: unknown[] };
export type ToIso =
  | { tag: typeof TAG; dir: 'toIso'; id: number; ok: true; result: unknown }
  | { tag: typeof TAG; dir: 'toIso'; id: number; ok: false; error: string }
  | { tag: typeof TAG; dir: 'toIso'; event: 'add'; videoIds: string[] }
  | { tag: typeof TAG; dir: 'toIso'; event: 'nativeAdd' }
  | { tag: typeof TAG; dir: 'toIso'; event: 'warn'; msg: string }
  | { tag: typeof TAG; dir: 'toIso'; event: 'player'; payload: PlayerEvent }
  /** A successful edit_playlist, by the page or by us (§24.8). */
  | { tag: typeof TAG; dir: 'toIso'; event: 'edited'; edit: ListEdit }
  /** The page put this list in the playlist panel (§24.8). */
  | { tag: typeof TAG; dir: 'toIso'; event: 'panel'; playlistId: string; snap: ListSnapshot }
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
  /** Loop (§40.2) was on at this moment. */
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
}

export function isToIso(d: unknown): d is ToIso {
  return !!d && typeof d === 'object' && (d as ToIso).tag === TAG && (d as ToIso).dir === 'toIso';
}

export function isToMain(d: unknown): d is ToMain {
  return !!d && typeof d === 'object' && (d as ToMain).tag === TAG && (d as ToMain).dir === 'toMain';
}
