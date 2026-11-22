import { describe, expect, it } from 'vitest';
import type { Placement } from '@/features/danmaku/ai';
import { DEFAULT_PARAMS } from '@/features/danmaku/params';
import { type Slot, slotEnd } from '@/features/danmaku/schedule';
import { buildTimeline } from '@/features/danmaku/timeline';
import { comment } from './helpers';

const stamped = comment('1:00 the jump was great', { id: 'S', likes: 100 });
const plain = Array.from({ length: 40 }, (_, k) => comment(`comment number ${k} is long enough`, { id: `c${k}`, likes: 40 - k }));
const comments = [stamped, ...plain];
const input = { videoId: 'vid', duration: 600, total: 1000, comments, heat: comments.map((c) => c.likes / 100), heatmap: [] };

/** One card at a time, with the gap between. */
function expectNoOverlap(ss: Slot[]) {
  for (let k = 1; k < ss.length; k++) expect(ss[k]!.start).toBeGreaterThanOrEqual(slotEnd(ss[k - 1]!) + DEFAULT_PARAMS.display.gapSec - 1e-9);
}
const ids = (ss: Slot[]) => ss.flatMap((s) => s.items.map((c) => c.id));

describe('buildTimeline', () => {
  it('stamps: only timestamped comments', () => {
    const r = buildTimeline(input, 'stamps', DEFAULT_PARAMS);
    expect(r.map((s) => [s.kind, s.start, ids([s])])).toEqual([['stamp', 60, ['S']]]);
  });

  it('local: the timestamped card plus the rest, one at a time', () => {
    const r = buildTimeline(input, 'local', DEFAULT_PARAMS);
    expect(r.find((s) => s.kind === 'stamp')!.start).toBe(60);
    expect(r.filter((s) => s.kind === 'local').length).toBeGreaterThan(30);
    expect(new Set(ids(r)).size).toBe(ids(r).length);
    expectNoOverlap(r);
  });

  describe('ai', () => {
    const placements = new Map<string, Placement>([
      ['c0', { kind: 'at', sec: 100, conf: 0.95 }],
      ['c4', { kind: 'at', sec: 61, conf: 0.95 }], // clashes with the timestamped card
      ['c1', { kind: 'ambient', why: 'a' }],
      ['c3', { kind: 'ambient', why: 'low', sec: 300, conf: 0.6 }],
      ['c2', { kind: 'hide' }],
    ]);

    it('places confident times, fills idle stretches from the ambient ones, hides x and unknowns', () => {
      const r = buildTimeline({ ...input, placements }, 'ai', DEFAULT_PARAMS);
      expect(r.find((s) => s.kind === 'ai')).toMatchObject({ start: 100, conf: 0.95 });
      expect(ids(r).sort()).toEqual(['S', 'c0', 'c1', 'c3']);
      expect(r.filter((s) => s.kind === 'ambient').map((s) => s.items[0]!.id)).toEqual(expect.arrayContaining(['c1', 'c3']));
      expectNoOverlap(r);
    });

    it('leaves idle stretches alone with ambient off', () => {
      const r = buildTimeline({ ...input, placements }, 'ai', { ...DEFAULT_PARAMS, ai: { ...DEFAULT_PARAMS.ai, ambient: false } });
      expect(r.map((s) => [s.kind, s.start])).toEqual([['stamp', 60], ['ai', 100]]);
    });
  });
});
