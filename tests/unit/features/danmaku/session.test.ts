// @vitest-environment happy-dom
// F-12-AC15 and friends: one video's session against a fake page and cache.
import { describe, expect, it, vi } from 'vitest';
import { createLogger } from '@/core/log';
import { DEFAULT_SETTINGS, type Settings } from '@/core/settings';
import type { CacheEntry, DanmakuCache } from '@/features/danmaku/cache';
import type { MainRpc } from '@/features/danmaku/rpc';
import { Session } from '@/features/danmaku/session';
import { comment } from './helpers';

const info = { videoId: 'vid', title: 'A video', duration: 60, live: false };
const cs = Array.from({ length: 30 }, (_, k) => comment(`comment number ${k} is long enough`, { id: `c${k}`, likes: 30 - k }));

function setup(entry?: CacheEntry) {
  let settings: Settings = structuredClone(DEFAULT_SETTINGS);
  const saved: CacheEntry[] = [];
  const rpc = {
    watch: vi.fn(async () => ({ token: 't', heatmap: [] })),
    page: vi.fn(async () => ({ comments: cs, total: 30 })),
  } as unknown as MainRpc;
  const cache = { get: async () => entry, set: async (_: string, e: CacheEntry) => void saved.push(e) } as unknown as DanmakuCache;
  const session = new Session(info, { rpc, cache, log: createLogger('danmaku'), settings: () => settings, ask: vi.fn(), changed: () => {} });
  return { session, saved, rpc, set: (mut: (s: Settings) => void) => { settings = structuredClone(settings); mut(settings); session.settingsChanged(); } };
}

describe('F-12-AC15 what the cache keeps', () => {
  it('F-12-AC15 saves the title and length with the comments', async () => {
    const { session, saved } = setup();
    await session.run();
    expect(saved.at(-1)).toMatchObject({ title: 'A video', duration: 60, complete: true });
  });

  it('F-12-AC15 F-12-AC19 an entry from before gets them when the video is opened, still as old', async () => {
    const t = Date.now() - 3_600_000;
    const { session, saved, rpc } = setup({ t, used: t, total: 30, heatmap: [], comments: cs, complete: true });
    await session.run();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ t, title: 'A video', duration: 60 });
    expect(rpc.page).not.toHaveBeenCalled();
  });

  it('F-12-AC15 an entry that has them is not saved again', async () => {
    const t = Date.now();
    const { session, saved } = setup({ t, used: t, total: 30, heatmap: [], comments: cs, complete: true, title: 'A video', duration: 60 });
    await session.run();
    expect(saved).toEqual([]);
  });
});

describe('F-12-AC10 settings while playing', () => {
  it('F-12-AC10 F-12-AC13 rows apply at once; switching style lays the video out for that style', async () => {
    const { session, set } = setup();
    await session.run();
    const one = session.slots.length;
    set((s) => { s.danmaku.params.display.cardRows = 4; });
    expect(session.slots.length).toBeGreaterThan(one);
    set((s) => { s.danmaku.style = 'fly'; });
    expect(session.slots.every((x) => x.fly)).toBe(true);
    set((s) => { s.danmaku.style = 'card'; });
    expect(session.slots.some((x) => x.fly)).toBe(false);
  });
});
