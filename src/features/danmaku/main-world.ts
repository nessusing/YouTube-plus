// Danmaku, page side (MAIN world; plans P13 「拉评论」): InnerTube `next` the
// way the page calls it, without scrolling or touching the comments section.
// Always hl=en, so counts read "9.3K" and ages "3 months ago" (measured
// 2026-11-22). Works signed out too.

import { call } from '@/features/queue/innertube';
import { isToMain, TAG, type MainApi, type ToIso, type VideoInfo } from './bridge';
import { parsePage, parseWatch } from './comments';

declare const ytcfg: { get(key: string): unknown };

interface Player extends HTMLElement {
  getPlayerResponse?: () => { videoDetails?: { videoId?: string; title?: string; lengthSeconds?: string; isLiveContent?: boolean; isLive?: boolean } } | undefined;
}

function context(): Record<string, unknown> {
  const ctx = (ytcfg.get('INNERTUBE_CONTEXT') ?? {}) as { client?: Record<string, unknown> };
  return { ...ctx, client: { ...ctx.client, hl: 'en' } };
}

const next = (body: Record<string, unknown>) => call('next', { ...body, context: context() }, { anonymous: true });

const api: MainApi = {
  video(): VideoInfo | undefined {
    const d = document.querySelector<Player>('#movie_player')?.getPlayerResponse?.()?.videoDetails;
    if (!d?.videoId) return undefined;
    return { videoId: d.videoId, title: d.title ?? '', duration: Number(d.lengthSeconds) || 0, live: !!(d.isLiveContent || d.isLive) };
  },
  async watch(videoId) {
    return parseWatch(await next({ videoId }));
  },
  async page(token, videoId) {
    return parsePage(await next({ continuation: token }), videoId);
  },
};

export function startDanmakuMain(): void {
  window.addEventListener('message', (e) => {
    if (e.source !== window || !isToMain(e.data)) return;
    const { id, method, args } = e.data;
    const reply = (m: { ok: true; result: unknown } | { ok: false; error: string }) => window.postMessage({ tag: TAG, dir: 'toIso', id, ...m } satisfies ToIso, location.origin);
    Promise.resolve()
      .then(() => (api[method] as (...a: unknown[]) => unknown)(...args))
      .then((result) => reply({ ok: true, result }), (err) => reply({ ok: false, error: String(err instanceof Error ? err.message : err) }));
  });
}
