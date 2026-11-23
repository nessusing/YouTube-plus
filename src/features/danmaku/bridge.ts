// window.postMessage bridge between the danmaku content script and its MAIN
// world script (F-12-AC4). The page side makes the InnerTube calls
// and parses them there, so only the small parsed result crosses over.

import type { CommentPage, WatchInfo } from './comments';

export const TAG = 'ytpp-danmaku';

/** The video in the player, from the player's own response. */
export interface VideoInfo {
  videoId: string;
  title: string;
  /** Seconds. */
  duration: number;
  /** Live or a live replay: not handled (F-12). */
  live: boolean;
}

export interface MainApi {
  /** The video the player has loaded, if any. */
  video(): VideoInfo | undefined;
  /** First `next` call: the first comments token and the "Most replayed" curve. */
  watch(videoId: string): Promise<WatchInfo>;
  /** One comments page; level 1 = a page of one comment's replies. */
  page(token: string, videoId: string, level?: number): Promise<CommentPage>;
}

export type ToMain = { tag: typeof TAG; dir: 'toMain'; id: number; method: keyof MainApi; args: unknown[] };
export type ToIso =
  | { tag: typeof TAG; dir: 'toIso'; id: number; ok: true; result: unknown }
  | { tag: typeof TAG; dir: 'toIso'; id: number; ok: false; error: string };

export const isToMain = (d: unknown): d is ToMain => !!d && typeof d === 'object' && (d as ToMain).tag === TAG && (d as ToMain).dir === 'toMain';
export const isToIso = (d: unknown): d is ToIso => !!d && typeof d === 'object' && (d as ToIso).tag === TAG && (d as ToIso).dir === 'toIso';
