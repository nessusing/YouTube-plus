// An in-memory YouTube for controller tests (L2): the playlists on the
// server, the player, and the playlist panel, behind the same Rpc the MAIN
// world script answers. It copies the behaviour measured in the browser
// (design §21.4, §24.8):
//   - an added video shows in reads at once; a removed one keeps showing for
//     `removalLagMs` (reads lag behind removals);
//   - removing an entry that is already gone fails with 400;
//   - DEDUPE_OPTION_SKIP is ignored: adding a video twice gives two entries;
//   - the list can be deleted elsewhere; edits elsewhere send no event.
// Events the page script would post (edited, panel) are delivered a tick
// later, like window.postMessage.

import type { PlayerEvent, TakeoverState } from '@/features/queue/bridge';
import { meetsExpect, parseEdit, type Expect, type ListAction, type ListEdit, type ListItem, type ListSnapshot } from '@/features/queue/core';
import type { Identity } from '@/features/queue/profiles';
import type { Playing, PlaylistData, PlaylistRef, Rpc, SyncResult } from '@/features/queue/rpc';

interface Entry { videoId: string; setVideoId: string; removedAt?: number }
interface List { id: string; title: string; editable: boolean; entries: Entry[] }

export interface Player {
  videoId?: string;
  /** player.getPlaylistId(): a list ID, the native queue's TLPQ…, or undefined */
  playlistId?: string;
  index?: number;
  /** ytd-app[miniplayer-is-active] */
  mini: boolean;
  /** on /watch?v=<videoId> */
  onWatch: boolean;
  ad: boolean;
}

/** What the playlist panel (side panel / under the miniplayer) shows. */
export interface Panel {
  playlistId: string;
  /** The video put on top locally by an attach (not in the list). */
  top?: string;
  rows: ListItem[];
}

type Method = keyof Rpc;
type Failure = Error | 'hang';

const SYNC_WAITS = [0, 1500, 3000, 5000];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const later = (fn: () => void) => void setTimeout(fn, 0);

export class FakeYouTube {
  lists = new Map<string, List>();
  removalLagMs = 0;
  me: Identity = { loggedIn: true, key: 'me', name: 'Me', brand: false };
  player: Player = { mini: false, onWatch: false, ad: false };
  panel: Panel | undefined;
  takeover: TakeoverState = { decision: 'native', label: '' };
  /** The playlist manager's three methods are there (else syncList falls back). */
  playlistManager = true;
  /** After an attach, does the player report the list as its playlist? (to be confirmed in e2e) */
  attachSetsPlaylistId = true;
  /** playlist/get_add_to_playlist returns nothing (a protocol change). */
  protocolBroken = false;
  calls: { method: Method; args: unknown[] }[] = [];
  armed: { listId: string; setVideoId: string; videoId: string } | undefined;
  navigations: string[] = [];

  onEdited: ((e: ListEdit) => void) | undefined;
  onPanel: ((playlistId: string, snap: ListSnapshot) => void) | undefined;

  private failures = new Map<Method, { err: Failure; times: number }>();
  private seq = 0;

  constructor() {
    this.addList('WL', 'Watch later', []);
  }

  // ---------- setting up ----------

  addList(id: string, title: string, videoIds: string[], editable = true): void {
    this.lists.set(id, { id, title, editable, entries: videoIds.map((v) => ({ videoId: v, setVideoId: this.newSet() })) });
  }

  /** The next edit_playlist answers with this HTTP status and changes nothing. */
  editStatus: number | undefined;

  /** Make the next `times` calls of `method` fail (Error) or never answer ('hang'). */
  fail(method: Method, err: Failure = new Error(`${method} failed`), times = 1): void {
    this.failures.set(method, { err, times });
  }

  /** The list as it truly is on the server (reads may still lag). */
  truth(id: string): string[] {
    return this.lists.get(id)?.entries.filter((e) => e.removedAt === undefined).map((e) => e.videoId) ?? [];
  }

  entries(id: string): ListItem[] {
    return this.lists.get(id)?.entries.filter((e) => e.removedAt === undefined).map(({ videoId, setVideoId }) => ({ videoId, setVideoId })) ?? [];
  }

  callsOf(method: Method): unknown[][] {
    return this.calls.filter((c) => c.method === method).map((c) => c.args);
  }

  // ---------- things that happen outside the extension ----------

  /**
   * The page edits a list itself (panel "Remove", Save to playlist…): the
   * fetch watcher reports it. When the panel shows that list, the page then
   * asks `next` again and re-renders it, with whatever reads say right then
   * (measured 2026-11-20).
   */
  pageEdit(listId: string, actions: ListAction[]): { ok: boolean; status: number } {
    const r = this.apply(listId, actions);
    const edit = parseEdit({ playlistId: listId, actions });
    if (r.ok && edit) later(() => this.onEdited?.(edit));
    if (r.ok && this.panel?.playlistId === listId) {
      const top = this.panel.top;
      setTimeout(() => this.showPanel({ playlistId: listId, top, rows: this.visible(listId) }), 200);
    }
    return r;
  }

  /** Another tab or the phone: the server changes, nothing tells this page. */
  externalEdit(listId: string, actions: ListAction[]): void {
    this.apply(listId, actions);
  }

  deleteList(id: string): void {
    this.lists.delete(id);
  }

  /**
   * The page loads a video (click, autoplay, our navigation). A watch page in
   * a list puts the list in the panel, as the page would with `next`.
   */
  load(videoId: string | undefined, playlistId?: string, where: { mini?: boolean } = {}): void {
    const mini = !!where.mini;
    const index = playlistId ? this.visible(playlistId).findIndex((i) => i.videoId === videoId) : -1;
    this.player = { videoId, playlistId, index: index >= 0 ? index : undefined, mini, onWatch: !!videoId && !mini, ad: false };
    if (playlistId && this.lists.has(playlistId)) this.showPanel({ playlistId, rows: this.visible(playlistId) });
    else this.panel = undefined;
  }

  /**
   * The native queue playing: the panel holds a TLPQ… list, but
   * player.getPlaylistId() is empty (measured 2026-11-20, findings A5).
   */
  playNativeQueue(videoIds: string[], where: { mini?: boolean } = { mini: true }): void {
    const mini = !!where.mini;
    this.player = { videoId: videoIds[0], playlistId: undefined, index: 0, mini, onWatch: !mini, ad: false };
    this.panel = { playlistId: 'TLPQabc', rows: videoIds.map((v, i) => ({ videoId: v, setVideoId: `Q${i}` })) };
  }

  /** The page put list data in the panel; yt-playlist-data-updated reports it. */
  showPanel(p: Panel): void {
    this.panel = p;
    const snap: ListSnapshot = { rows: p.rows, total: p.rows.length, at: Date.now() };
    later(() => this.onPanel?.(p.playlistId, snap));
  }

  playerEvent(type: PlayerEvent['type'], over: Partial<PlayerEvent> = {}): PlayerEvent {
    return {
      type,
      videoId: this.player.videoId ?? '',
      playlistId: this.player.playlistId,
      index: this.player.index,
      currentTime: type === 'ended' ? 300 : 295,
      duration: 300,
      ...over,
    };
  }

  // ---------- the Rpc the controller talks to ----------

  readonly rpc: Rpc = new Proxy({} as Rpc, {
    get: (_t, method: Method) => (...args: unknown[]) => this.invoke(method, args),
  });

  private async invoke(method: Method, args: unknown[]): Promise<unknown> {
    this.calls.push({ method, args });
    await Promise.resolve();
    const f = this.failures.get(method);
    if (f) {
      if (--f.times <= 0) this.failures.delete(method);
      if (f.err === 'hang') return new Promise(() => {});
      throw f.err;
    }
    const impl = (this.impl as unknown as Record<string, (...a: unknown[]) => unknown>)[method];
    if (!impl) throw new Error(`fake: ${method} not implemented`);
    return impl(...args);
  }

  private impl: Rpc = {
    editablePlaylists: async (): Promise<PlaylistRef[]> => {
      if (this.protocolBroken) return [];
      return [...this.lists.values()].filter((l) => l.editable).map((l) => ({ id: l.id, title: l.title, privacy: 'PRIVATE' }));
    },
    createPrivatePlaylist: async (title: string) => {
      const id = `PL${++this.seq}`;
      this.addList(id, title, []);
      return id;
    },
    readPlaylist: async (id: string): Promise<PlaylistData> => {
      const l = this.lists.get(id);
      if (!l) return { exists: false, editable: false, title: '', items: [] };
      return { exists: true, editable: l.editable, title: l.title, items: this.visible(id) };
    },
    editPlaylist: async (id: string, actions: ListAction[]) => {
      if (this.editStatus) {
        const status = this.editStatus;
        this.editStatus = undefined;
        return { ok: false, status, error: `HTTP ${status}`, added: [] };
      }
      const r = this.apply(id, actions);
      const edit = parseEdit({ playlistId: id, actions });
      if (r.ok && edit) later(() => this.onEdited?.(edit));
      return { ...r, added: [] };
    },
    identity: async () => ({ ...this.me }),
    setTakeover: async (s: TakeoverState) => {
      this.takeover = s;
    },
    armRemoval: async (listId: string, setVideoId: string, videoId: string) => {
      this.armed = { listId, setVideoId, videoId };
    },
    disarm: async () => {
      this.armed = undefined;
    },
    playVideo: async (videoId: string, listId: string) => {
      this.navigations.push(`/watch?v=${videoId}&list=${listId}`);
      this.load(videoId, listId, { mini: false });
    },
    openPlaylist: async (listId: string) => {
      this.navigations.push(`/playlist?list=${listId}`);
    },
    syncList: (listId: string, expect: Expect | undefined, attach: boolean) => this.syncList(listId, expect, attach),
    health: async () => ({ app: true, ytcfg: true, takeover: true }),
    playing: async (): Promise<Playing> => ({ videoId: this.player.videoId, playlistId: this.player.playlistId, index: this.player.index }),
  };

  /** Mirrors main-world.ts syncList (design §24.8, §24.2). */
  private async syncList(listId: string, expect: Expect | undefined, attach: boolean): Promise<SyncResult> {
    const { videoId, ad, mini, onWatch } = this.player;
    if (!videoId || ad) return { how: 'none' };
    const playing = this.player.playlistId;
    if (playing ? playing !== listId : !attach) return { how: 'none' };
    if (!mini && !onWatch) return { how: 'none' };
    if (this.playlistManager) {
      for (const [i, wait] of SYNC_WAITS.entries()) {
        if (wait) await sleep(wait);
        const rows = this.visible(listId);
        if (!meetsExpect(rows, expect) && i < SYNC_WAITS.length - 1) continue;
        if (this.player.videoId !== videoId || this.player.playlistId !== playing) return { how: 'none' };
        const inList = rows.some((r) => r.videoId === videoId);
        this.showPanel({ playlistId: listId, rows, top: inList ? undefined : videoId });
        if (!playing && this.attachSetsPlaylistId) this.player = { ...this.player, playlistId: listId, index: 0 };
        return { how: 'panel', videoId };
      }
    }
    if (playing) return { how: 'none' };
    if (onWatch && !mini) {
      this.navigations.push(`/watch?v=${videoId}&list=${listId}`);
      this.load(videoId, listId);
      this.player.index = 0;
      return { how: 'navigated', videoId };
    }
    return { how: 'none' };
  }

  // ---------- the server ----------

  private newSet(): string {
    return `S${++this.seq}`;
  }

  /** What a read returns now: removed entries linger for removalLagMs. */
  private visible(id: string): ListItem[] {
    const now = Date.now();
    return (this.lists.get(id)?.entries ?? [])
      .filter((e) => e.removedAt === undefined || now < e.removedAt + this.removalLagMs)
      .map(({ videoId, setVideoId }) => ({ videoId, setVideoId }));
  }

  private apply(id: string, actions: ListAction[]): { ok: boolean; status: number; error?: string } {
    const l = this.lists.get(id);
    if (!l) return { ok: false, status: 404, error: 'not found' };
    const live = () => l.entries.filter((e) => e.removedAt === undefined);
    // All or nothing, like the server: check first.
    for (const a of actions) {
      if (a.action === 'ACTION_REMOVE_VIDEO' && !live().some((e) => e.setVideoId === a.setVideoId)) {
        return { ok: false, status: 400, error: 'precondition failed' };
      }
    }
    for (const a of actions) {
      if (a.action === 'ACTION_ADD_VIDEO') {
        l.entries.push({ videoId: a.addedVideoId, setVideoId: this.newSet() });
      } else if (a.action === 'ACTION_REMOVE_VIDEO') {
        const e = live().find((x) => x.setVideoId === a.setVideoId)!;
        e.removedAt = Date.now();
      } else if (a.action === 'ACTION_MOVE_VIDEO_AFTER') {
        const from = l.entries.findIndex((x) => x.setVideoId === a.setVideoId);
        const [moved] = l.entries.splice(from, 1);
        const at = a.movedSetVideoIdPredecessor ? l.entries.findIndex((x) => x.setVideoId === a.movedSetVideoIdPredecessor) + 1 : 0;
        l.entries.splice(at, 0, moved!);
      }
    }
    return { ok: true, status: 200 };
  }
}
