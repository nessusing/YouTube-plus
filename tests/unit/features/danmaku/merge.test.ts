import { describe, expect, it } from 'vitest';
import { evictKeys, isFresh } from '@/features/danmaku/cache';
import { DEFAULT_PARAMS } from '@/features/danmaku/params';
import { cardLayout, type Slot, type SlotKind } from '@/features/danmaku/schedule';
import { buildTimeline, fetchLimit, mergeTimeline, prepareComments } from '@/features/danmaku/timeline';
import { comment } from './helpers';

const slot = (start: number, kind: SlotKind, id: string, dur = 3): Slot => ({ start, kind, items: [comment(`text of ${id}`, { id })], durs: [dur], extra: 0 });
const view = (ss: Slot[]) => ss.map((s) => `${s.kind}:${s.items[0]!.id}@${s.start}`);

describe('fetchLimit', () => {
  const p = DEFAULT_PARAMS.comments;
  it('F-12-AC4 at least minCount, perMinute for long videos, capped at maxCount', () => {
    expect(fetchLimit(60, p)).toBe(200);
    expect(fetchLimit(16 * 60, p)).toBe(240);
    expect(fetchLimit(3 * 3600, p)).toBe(300);
  });
});

describe('prepareComments', () => {
  it('F-12-AC5 filters and gives heat in the same order', () => {
    const raw = [comment('a comment that is long enough', { likes: 10 }), comment('hi'), comment('another comment long enough', { likes: 0 })];
    const r = prepareComments(raw, DEFAULT_PARAMS);
    expect(r.comments.map((c) => c.id)).toEqual([raw[0]!.id, raw[2]!.id]);
    expect(r.heat).toHaveLength(2);
    expect(r.heat[0]).toBeGreaterThan(r.heat[1]!);
  });
});

describe('mergeTimeline', () => {
  const gap = cardLayout(1, 0.5);
  it('F-12-AC10 at 0 takes the new timeline whole', () => {
    const next = [slot(0, 'toc', 't'), slot(10, 'local', 'a')];
    expect(mergeTimeline([], next, 0, gap)).toEqual(next);
  });

  it('F-12-AC10 keeps what started, replaces what has not', () => {
    const old = [slot(5, 'local', 'a'), slot(20, 'local', 'b'), slot(40, 'local', 'c')];
    const next = [slot(6, 'local', 'x'), slot(7, 'local', 'y'), slot(25, 'ai', 'z'), slot(45, 'local', 'c')];
    // a started at 5 and runs to 8: y at 7 would overlap it.
    expect(view(mergeTimeline(old, next, 6, gap))).toEqual(['local:a@5', 'ai:z@25', 'local:c@45']);
  });

  it('F-12-AC10 a first layout mid-video keeps the cards before the playhead', () => {
    const next = [slot(30, 'stamp', 's'), slot(60, 'local', 'a')];
    expect(mergeTimeline([], next, 31, gap)).toEqual(next);
  });

  it('F-12-AC10 fills the part before the playhead where nothing was kept', () => {
    const old = [slot(50, 'stamp', 's')];
    const next = [slot(10, 'local', 'a'), slot(52, 'local', 'b'), slot(70, 'local', 'c')];
    expect(view(mergeTimeline(old, next, 51, gap))).toEqual(['local:a@10', 'stamp:s@50', 'local:c@70']);
  });

  it('F-12-AC10 never shows a comment twice, except timestamped ones', () => {
    const old = [slot(5, 'local', 'a'), slot(8.5, 'stamp', 's')];
    const next = [slot(30, 'ai', 'a'), slot(60, 'stamp', 's'), slot(90, 'ambient', 'b')];
    expect(view(mergeTimeline(old, next, 10, gap))).toEqual(['local:a@5', 'stamp:s@8.5', 'stamp:s@60', 'ambient:b@90']);
  });
});

describe('mergeTimeline with rows', () => {
  it('F-12-AC10 a new card takes a free row beside a kept one, never more than the rows', () => {
    const old = [{ ...slot(5, 'local', 'a', 10), row: 0 }];
    const next = [{ ...slot(8, 'local', 'x', 5), row: 0 }, { ...slot(9, 'local', 'y', 5), row: 1 }];
    const r = mergeTimeline(old, next, 6, cardLayout(2, 0.5));
    expect(r.map((s) => [s.items[0]!.id, s.row])).toEqual([['a', 0], ['x', 1]]);
  });
});

describe('mergeTimeline with a moment on screen', () => {
  const plan = (cardRows: number, texts: string[]) => buildTimeline({
    videoId: 'v', duration: 600, total: 10, heatmap: [], heat: texts.map(() => 0),
    comments: texts.map((x) => comment(x)),
  }, 'stamps', { ...DEFAULT_PARAMS, display: { ...DEFAULT_PARAMS.display, cardRows } });
  const A = '1:00 the first thing said here';
  const B = '1:00 the second thing said here';

  it('F-12-AC10 F-12-AC6 more rows mid-card: its comments do not show a second time beside it', () => {
    const old = plan(1, [A, B]);
    const r = mergeTimeline(old, plan(3, [A, B]), 61, cardLayout(3, 0.5));
    expect(r).toEqual(old);
  });

  it('F-12-AC10 F-12-AC6 a comment fetched later for that moment takes a free row; the shown one is not repeated', () => {
    // The later one is a second earlier, so the moment now starts there.
    const old = plan(3, [A]);
    const r = mergeTimeline(old, plan(3, [A, '0:59 and one more from just before']), 60.5, cardLayout(3, 0.5));
    expect(r.flatMap((s) => s.items.map((c) => c.text)).sort()).toEqual(['0:59 and one more from just before', A]);
  });

  it('F-12-AC6 a comment\'s other timestamps still show', () => {
    const both = ['1:00 here and again at 2:00'];
    const r = mergeTimeline(plan(2, both).slice(0, 1), plan(2, both), 61, cardLayout(2, 0.5));
    expect(r.map((s) => s.start)).toEqual([60, 120]);
  });
});

describe('cache rules', () => {
  it('F-12-AC15 fresh while complete and younger than the limit', () => {
    const now = 10 * 86_400_000;
    expect(isFresh({ t: now - 86_400_000, complete: true }, now, 7)).toBe(true);
    expect(isFresh({ t: now - 8 * 86_400_000, complete: true }, now, 7)).toBe(false);
    expect(isFresh({ t: now, complete: false }, now, 7)).toBe(false);
  });

  it('F-12-AC15 evicts least recently used until it fits', () => {
    const es = [{ key: 'a', used: 3, bytes: 100 }, { key: 'b', used: 1, bytes: 100 }, { key: 'c', used: 2, bytes: 100 }];
    expect(evictKeys(es, 300)).toEqual([]);
    expect(evictKeys(es, 150)).toEqual(['b', 'c']);
  });
});
