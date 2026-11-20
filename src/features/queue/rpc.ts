// Isolated-world client for the MAIN world script.

import { isToIso, TAG, type PlayerEvent, type TakeoverState } from './bridge';
import type { ListAction, ListItem } from './core';
import type { Identity } from './profiles';

export interface PlaylistRef { id: string; title: string; privacy: string }
export interface PlaylistData { exists: boolean; editable: boolean; title: string; items: ListItem[] }
export interface Playing { videoId?: string; playlistId?: string; index?: number }

export interface Rpc {
  editablePlaylists(): Promise<PlaylistRef[]>;
  createPrivatePlaylist(title: string): Promise<string>;
  readPlaylist(id: string): Promise<PlaylistData>;
  editPlaylist(id: string, actions: ListAction[]): Promise<{ ok: boolean; status: number; error?: string; added: string[] }>;
  identity(): Promise<Identity>;
  setTakeover(s: TakeoverState): Promise<void>;
  armRemoval(listId: string, setVideoId: string, videoId: string): Promise<void>;
  disarm(): Promise<void>;
  playVideo(videoId: string, listId: string): Promise<void>;
  openPlaylist(listId: string): Promise<void>;
  /** Show the list next to the video playing outside any list (§24.2); how, or false if left alone. */
  attachList(listId: string): Promise<'panel' | 'navigated' | false>;
  refreshPlaylist(): Promise<void>;
  health(): Promise<{ app: boolean; ytcfg: boolean; takeover: boolean }>;
  playing(): Promise<Playing>;
}

export interface Bridge {
  rpc: Rpc;
  onAdd(cb: (videoIds: string[]) => void): void;
  onNativeAdd(cb: () => void): void;
  onWarn(cb: (msg: string) => void): void;
  onPlayer(cb: (e: PlayerEvent) => void): void;
  ready: Promise<void>;
}

export function connect(timeoutMs = 20000): Bridge {
  let seq = 0;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  const addCbs: ((videoIds: string[]) => void)[] = [];
  const nativeCbs: (() => void)[] = [];
  const warnCbs: ((msg: string) => void)[] = [];
  const playerCbs: ((e: PlayerEvent) => void)[] = [];
  let markReady!: () => void;
  const ready = new Promise<void>((r) => (markReady = r));

  window.addEventListener('message', (e) => {
    if (e.source !== window || !isToIso(e.data)) return;
    const d = e.data;
    if ('event' in d) {
      if (d.event === 'add') addCbs.forEach((cb) => cb(d.videoIds));
      else if (d.event === 'nativeAdd') nativeCbs.forEach((cb) => cb());
      else if (d.event === 'warn') warnCbs.forEach((cb) => cb(d.msg));
      else if (d.event === 'player') playerCbs.forEach((cb) => cb(d.payload));
      else if (d.event === 'ready') markReady();
      return;
    }
    const p = pending.get(d.id);
    if (!p) return;
    pending.delete(d.id);
    if (d.ok) p.resolve(d.result);
    else p.reject(new Error(d.error));
  });

  const invoke = (method: string, args: unknown[]) =>
    new Promise<unknown>((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      window.postMessage({ tag: TAG, dir: 'toMain', id, method, args }, location.origin);
      setTimeout(() => {
        if (pending.delete(id)) reject(new Error(`${method}: no answer from the page script`));
      }, timeoutMs);
    });

  // The MAIN script runs at document_start and may have said "ready" before we
  // listened; a health ping settles it either way.
  void invoke('health', []).then(() => markReady(), () => {});

  const rpc = new Proxy({} as Rpc, { get: (_t, method: string) => (...args: unknown[]) => invoke(method, args) });
  return {
    rpc,
    onAdd: (cb) => addCbs.push(cb),
    onNativeAdd: (cb) => nativeCbs.push(cb),
    onWarn: (cb) => warnCbs.push(cb),
    onPlayer: (cb) => playerCbs.push(cb),
    ready,
  };
}
