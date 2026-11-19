// Isolated-world client for the MAIN world script.

import { isToIso, TAG, type PlayerEvent } from './bridge';
import type { ListAction, ListItem, TlpqItem } from './core';

export interface Rpc {
  editablePlaylists(): Promise<{ id: string; title: string; privacy: string }[]>;
  createPrivatePlaylist(title: string): Promise<string>;
  readPlaylist(id: string): Promise<{ exists: boolean; editable: boolean; title: string; items: ListItem[] }>;
  editPlaylist(id: string, actions: ListAction[]): Promise<{ ok: boolean; status: number; error?: string; added: string[] }>;
  readQueue(tlpq: string): Promise<TlpqItem[]>;
  identity(): Promise<{ loggedIn: boolean; brand: boolean }>;
  currentTlpq(): Promise<string | undefined>;
  addToQueue(videoIds: string[], openMiniplayer: boolean): Promise<void>;
  removeFromQueue(tlpq: string, setVideoId: string): Promise<'ui' | 'api'>;
  moveInQueue(tlpq: string, setVideoId: string, after?: string): Promise<{ ok: boolean; status: number }>;
  health(): Promise<{ app: boolean; ytcfg: boolean; fetchTap: boolean }>;
  playing(): Promise<{ videoId?: string; playlistId?: string }>;
}

export interface Bridge {
  rpc: Rpc;
  onTap(cb: (endpoint: string, body: unknown) => void): void;
  onPlayer(cb: (e: PlayerEvent) => void): void;
  ready: Promise<void>;
}

export function connect(timeoutMs = 20000): Bridge {
  let seq = 0;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  const tapCbs: ((endpoint: string, body: unknown) => void)[] = [];
  const playerCbs: ((e: PlayerEvent) => void)[] = [];
  let markReady!: () => void;
  const ready = new Promise<void>((r) => (markReady = r));

  window.addEventListener('message', (e) => {
    if (e.source !== window || !isToIso(e.data)) return;
    const d = e.data;
    if ('event' in d) {
      if (d.event === 'tap') tapCbs.forEach((cb) => cb(d.endpoint, d.body));
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
  return { rpc, onTap: (cb) => tapCbs.push(cb), onPlayer: (cb) => playerCbs.push(cb), ready };
}
