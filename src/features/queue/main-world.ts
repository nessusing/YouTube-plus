// MAIN world side of the queue feature (design §23): fetch tap, queue driver,
// player watch, and the bridge to the isolated script.

import { isToMain, TAG, type PlayerEvent, type ToIso } from './bridge';
import * as it from './innertube';

const post = (m: Omit<ToIso, 'tag' | 'dir'>) => window.postMessage({ tag: TAG, dir: 'toIso', ...m }, location.origin);

// ---------- FetchTap: watch, never change ----------

const TAPPED = /\/youtubei\/v1\/(browse\/edit_playlist|playlist\/create)\b/;

async function bodyText(input: RequestInfo | URL, init?: RequestInit): Promise<string | undefined> {
  let bytes: Uint8Array | undefined;
  if (init?.body != null) {
    if (typeof init.body === 'string') return init.body;
    if (init.body instanceof ArrayBuffer) bytes = new Uint8Array(init.body);
    else if (ArrayBuffer.isView(init.body)) bytes = new Uint8Array(init.body.buffer, init.body.byteOffset, init.body.byteLength);
    else if (init.body instanceof Blob) bytes = new Uint8Array(await init.body.arrayBuffer());
    else return undefined;
  } else if (input instanceof Request) {
    bytes = new Uint8Array(await input.arrayBuffer());
  }
  if (!bytes) return undefined;
  // The page gzips request bodies (design §28.1).
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    return new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  }
  return new TextDecoder().decode(bytes);
}

function installFetchTap(): void {
  const orig = window.fetch;
  const tapped = function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
    try {
      const url = input instanceof Request ? input.url : String(input);
      const m = TAPPED.exec(url);
      const own = input instanceof Request ? input.headers.has(it.OWN_HEADER) : new Headers(init?.headers).has(it.OWN_HEADER);
      if (m && !own) {
        const copy = input instanceof Request ? input.clone() : input;
        void bodyText(copy, init).then((t) => {
          if (t === undefined) return;
          let body: unknown;
          try {
            body = JSON.parse(t);
          } catch {
            return;
          }
          post({ event: 'tap', endpoint: m[1]!, body } as ToIso);
        }).catch(() => {});
      }
    } catch {
      // never break the page
    }
    return orig.apply(this, [input, init] as Parameters<typeof fetch>);
  };
  (tapped as unknown as { __ytpp: boolean }).__ytpp = true;
  window.fetch = tapped as typeof fetch;
}

// ---------- QueueDriver ----------

function app(): HTMLElement {
  const a = document.querySelector<HTMLElement>('ytd-app');
  if (!a) throw new Error('ytd-app not found');
  return a;
}

function currentTlpq(): string | undefined {
  for (const k of Object.keys(sessionStorage)) {
    if (k.endsWith('::TLPQplaylist')) return /TLPQ[\w-]+/.exec(sessionStorage.getItem(k) ?? '')?.[0];
  }
  return undefined;
}

function addToQueue(videoIds: string[], openMiniplayer: boolean): void {
  if (!videoIds.length) return;
  const a = app();
  a.dispatchEvent(new CustomEvent('yt-action', {
    bubbles: true,
    composed: true,
    detail: {
      actionName: 'yt-add-to-playlist-command',
      optionalAction: false,
      returnValue: [],
      args: [{
        addToPlaylistCommand: {
          openMiniplayer,
          videoId: videoIds[0],
          videoIds,
          listType: 'PLAYLIST_EDIT_LIST_TYPE_QUEUE',
          onCreateListCommand: {
            commandMetadata: { webCommandMetadata: { sendPost: true, apiUrl: '/youtubei/v1/playlist/create' } },
            createPlaylistServiceEndpoint: { videoIds, params: 'CAQ%3D' },
          },
        },
      }, a],
    },
  }));
}

/** Remove through the panel so it updates (§28.1 item 5); API fallback. */
async function removeFromQueue(tlpq: string, setVideoId: string): Promise<'ui' | 'api'> {
  const el = [...document.querySelectorAll<HTMLElement & { data?: { playlistSetVideoId?: string } }>('ytd-playlist-panel-video-renderer')]
    .find((e) => e.data?.playlistSetVideoId === setVideoId);
  const endpoint = { playlistEditEndpoint: { playlistId: tlpq, actions: [{ action: 'ACTION_REMOVE_VIDEO', setVideoId }] } };
  if (el) {
    el.dispatchEvent(new CustomEvent('yt-action', {
      bubbles: true, composed: true,
      detail: { actionName: 'yt-service-request', optionalAction: false, returnValue: [], args: [el, endpoint] },
    }));
    return 'ui';
  }
  await it.editPlaylist(tlpq, [{ action: 'ACTION_REMOVE_VIDEO', setVideoId }]);
  return 'api';
}

// ---------- PlayerWatch ----------

type PlayerApi = HTMLElement & {
  getVideoData?: () => { video_id?: string };
  getPlaylistId?: () => string | undefined;
};

function installPlayerWatch(): void {
  let last: PlayerEvent | undefined;
  const snapshot = (type: PlayerEvent['type'], v: HTMLVideoElement): PlayerEvent | undefined => {
    const p = document.querySelector<PlayerApi>('#movie_player');
    const videoId = p?.getVideoData?.()?.video_id;
    if (!videoId) return undefined;
    return { type, videoId, playlistId: p?.getPlaylistId?.() ?? undefined, currentTime: v.currentTime, duration: v.duration || 0 };
  };
  document.addEventListener('timeupdate', (e) => {
    const v = e.target as HTMLVideoElement;
    if (v.tagName !== 'VIDEO' || !v.closest('#movie_player')) return;
    const s = snapshot('left', v);
    if (!s) return;
    // A new video started: report how the previous one was left.
    if (last && last.videoId !== s.videoId) post({ event: 'player', payload: last } as ToIso);
    last = s;
  }, true);
  document.addEventListener('ended', (e) => {
    const v = e.target as HTMLVideoElement;
    if (v.tagName !== 'VIDEO' || !v.closest('#movie_player')) return;
    const s = snapshot('ended', v);
    if (s) post({ event: 'player', payload: s } as ToIso);
    last = undefined;
  }, true);
  window.addEventListener('pagehide', () => {
    if (last) post({ event: 'player', payload: last } as ToIso);
  });
}

// ---------- RPC ----------

const methods: Record<string, (...args: never[]) => unknown> = {
  editablePlaylists: it.editablePlaylists,
  createPrivatePlaylist: it.createPrivatePlaylist,
  readPlaylist: it.readPlaylist,
  editPlaylist: it.editPlaylist,
  readQueue: it.readQueue,
  identity: it.identity,
  currentTlpq,
  addToQueue,
  removeFromQueue,
  moveInQueue: (tlpq: string, setVideoId: string, after?: string) =>
    it.editPlaylist(tlpq, [{ action: 'ACTION_MOVE_VIDEO_AFTER', setVideoId, ...(after ? { movedSetVideoIdPredecessor: after } : {}) }]),
  health: () => ({
    app: !!document.querySelector('ytd-app'),
    ytcfg: typeof (window as { ytcfg?: unknown }).ytcfg === 'object',
    fetchTap: !!(window.fetch as unknown as { __ytpp?: boolean }).__ytpp,
  }),
  playing: () => {
    const p = document.querySelector<PlayerApi>('#movie_player');
    return { videoId: p?.getVideoData?.()?.video_id, playlistId: p?.getPlaylistId?.() };
  },
};

export function startMainWorld(): void {
  installFetchTap();
  installPlayerWatch();
  window.addEventListener('message', async (e) => {
    if (e.source !== window || !isToMain(e.data)) return;
    const { id, method, args } = e.data;
    try {
      const fn = methods[method];
      if (!fn) throw new Error(`unknown method ${method}`);
      const result = await (fn as (...a: unknown[]) => unknown)(...args);
      post({ id, ok: true, result } as ToIso);
    } catch (err) {
      post({ id, ok: false, error: err instanceof Error ? err.message : String(err) } as ToIso);
    }
  });
  post({ event: 'ready' } as ToIso);
}
