// F-12-AC18 / F-12-AC19: the data behind the settings page preview.
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@/core/settings';
import type { CacheEntry } from '@/features/danmaku/cache';
import { demoTimeline } from '@/features/danmaku/demo';
import { DEFAULT_PARAMS } from '@/features/danmaku/params';
import { cachedVideos, planCached, timelineBlocks } from '@/features/danmaku/preview';
import { slotEnd } from '@/features/danmaku/schedule';
import { comment } from './helpers';

const cs = Array.from({ length: 40 }, (_, k) => comment(`comment number ${k} is long enough`, { id: `c${k}`, likes: 40 - k }));
const entry = (more: Partial<CacheEntry> = {}): CacheEntry => ({ t: 1, used: 1, total: 40, heatmap: [], comments: cs, complete: true, title: 'T', duration: 300, ...more });
const danmaku = structuredClone(DEFAULT_SETTINGS.danmaku);

describe('F-12-AC18 cached videos', () => {
  it('F-12-AC18 lists them, most recently watched first', () => {
    const all = { 'danmaku/cache/a': entry({ used: 5, title: 'A' }), 'danmaku/cache/b': entry({ used: 9, title: 'B' }), settings: {}, 'tldr/cache/x': {} };
    expect(cachedVideos(all).map((v) => [v.videoId, v.entry.title])).toEqual([['b', 'B'], ['a', 'A']]);
  });

  it('F-12-AC19 leaves out entries without a title or length, and videos without comments', () => {
    const all = { 'danmaku/cache/old': entry({ title: undefined, duration: undefined }), 'danmaku/cache/none': entry({ comments: [] }) };
    expect(cachedVideos(all)).toEqual([]);
  });

  it('F-12-AC18 lays a cached video out with the current settings', () => {
    const v = { videoId: 'a', entry: entry() };
    const one = planCached(v, danmaku);
    expect(one.mode).toBe('local');
    expect(one.stats).toMatchObject({ fetched: 40, kept: 40, placed: 40 });
    expect(planCached(v, { ...danmaku, params: { ...danmaku.params, local: { ...danmaku.params.local, maxPerMinute: 2 } } }).stats.placed).toBe(10);
  });

  it('F-12-AC18 AI mode uses what Gemini already said, or the fallback', () => {
    const ai = { ...danmaku, placement: 'ai' as const };
    const r = planCached({ videoId: 'a', entry: entry({ placements: { c3: { kind: 'at', sec: 100, conf: 0.95 } } }) }, ai);
    expect(r.mode).toBe('ai');
    expect(r.slots.map((s) => [s.kind, s.start, s.items[0]!.id])).toEqual([['ai', 100, 'c3']]);
    expect(planCached({ videoId: 'a', entry: entry({ aiFailed: { reason: 'no_transcript', t: 1 } }) }, ai).mode).toBe('local');
  });
});

describe('F-12-AC19 the timeline strip', () => {
  it('F-12-AC19 one block per comment slot, in its row, coloured by source', () => {
    const p = { ...danmaku, params: { ...danmaku.params, display: { ...danmaku.params.display, cardRows: 2 } } };
    const { slots } = planCached({ videoId: 'a', entry: entry({ duration: 60 }) }, p);
    const blocks = timelineBlocks(slots, 60);
    expect(blocks).toHaveLength(slots.length);
    blocks.forEach((b, i) => {
      expect(b.row).toBe(slots[i]!.row);
      expect(b.kind).toBe('local');
      expect(b.left).toBeCloseTo(slots[i]!.start / 60);
      expect(b.width).toBeCloseTo((slotEnd(slots[i]!) - slots[i]!.start) / 60);
      expect(b.title).toContain(slots[i]!.items[0]!.text);
      expect(b.title).toMatch(/^\d+:\d\d /);
    });
  });

  it('F-12-AC19 flying blocks in a lane do not cover each other', () => {
    const { slots } = planCached({ videoId: 'a', entry: entry({ duration: 60 }) }, { ...danmaku, style: 'fly' });
    const blocks = timelineBlocks(slots, 60);
    for (const row of new Set(blocks.map((b) => b.row))) {
      const inRow = blocks.filter((b) => b.row === row).sort((a, b) => a.left - b.left);
      for (let k = 1; k < inRow.length; k++) expect(inRow[k]!.left).toBeGreaterThanOrEqual(inRow[k - 1]!.left + inRow[k - 1]!.width - 1e-9);
    }
  });
});

describe('F-12-AC18 sample comments', () => {
  it('F-12-AC18 the samples follow the rows and the style', () => {
    const four = demoTimeline({ ...DEFAULT_PARAMS, display: { ...DEFAULT_PARAMS.display, cardRows: 4, longLines: 0 } });
    expect(four.slots.filter((s) => s.start === four.slots[0]!.start)).toHaveLength(4);
    expect(demoTimeline(DEFAULT_PARAMS, 'fly').slots.every((s) => s.fly)).toBe(true);
  });
});
