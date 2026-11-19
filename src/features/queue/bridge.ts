// window.postMessage bridge between the isolated content script and the MAIN
// world script. Both sides live on youtube.com; the tag keeps our messages
// apart from the page's.

export const TAG = 'ytpp-queue';

export type ToMain = { tag: typeof TAG; dir: 'toMain'; id: number; method: string; args: unknown[] };
export type ToIso =
  | { tag: typeof TAG; dir: 'toIso'; id: number; ok: true; result: unknown }
  | { tag: typeof TAG; dir: 'toIso'; id: number; ok: false; error: string }
  | { tag: typeof TAG; dir: 'toIso'; event: 'tap'; endpoint: string; body: unknown }
  | { tag: typeof TAG; dir: 'toIso'; event: 'player'; payload: PlayerEvent }
  | { tag: typeof TAG; dir: 'toIso'; event: 'ready' };

export interface PlayerEvent {
  type: 'ended' | 'left';
  videoId: string;
  playlistId: string | undefined;
  currentTime: number;
  duration: number;
}

export function isToIso(d: unknown): d is ToIso {
  return !!d && typeof d === 'object' && (d as ToIso).tag === TAG && (d as ToIso).dir === 'toIso';
}

export function isToMain(d: unknown): d is ToMain {
  return !!d && typeof d === 'object' && (d as ToMain).tag === TAG && (d as ToMain).dir === 'toMain';
}
