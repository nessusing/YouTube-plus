// Several comments at once (D-026): rows on the card, lanes when flying.
import { describe, expect, it } from 'vitest';
import type { Placement } from '@/features/danmaku/ai';
import { flyItems } from '@/features/danmaku/fly';
import { DEFAULT_PARAMS, type DanmakuParams } from '@/features/danmaku/params';
import { type Slot, slotEnd } from '@/features/danmaku/schedule';
import { buildTimeline, planTimeline } from '@/features/danmaku/timeline';
import { comment } from './helpers';

const with_ = (display: Partial<DanmakuParams['display']>, local: Partial<DanmakuParams['local']> = {}): DanmakuParams => ({
  ...DEFAULT_PARAMS, display: { ...DEFAULT_PARAMS.display, ...display }, local: { ...DEFAULT_PARAMS.local, ...local },
});
const many = (n: number, text = 'is long enough') => Array.from({ length: n }, (_, k) => comment(`comment number ${k} ${text}`, { id: `c${k}`, likes: n - k }));
const input = (cs: ReturnType<typeof comment>[], duration = 120) => ({ videoId: 'vid', duration, total: 1000, comments: cs, heat: cs.map((c) => c.likes / 1000), heatmap: [] });
const ids = (ss: Slot[]) => ss.flatMap((s) => s.items.map((c) => c.id));

/** Most cards on screen at once. */
const peak = (ss: Slot[]) => Math.max(0, ...ss.map((s) => ss.filter((o) => o.start <= s.start && s.start < slotEnd(o)).length));

/** Cards in one row never overlap and keep the gap. */
function expectRows(ss: Slot[], rows: number, gap = DEFAULT_PARAMS.display.gapSec) {
  for (let r = 0; r < rows; r++) {
    const row = ss.filter((s) => (s.row ?? 0) === r).sort((a, b) => a.start - b.start);
    for (let k = 1; k < row.length; k++) expect(row[k]!.start).toBeGreaterThanOrEqual(slotEnd(row[k - 1]!) + gap - 1e-9);
  }
  expect(ss.every((s) => (s.row ?? 0) >= 0 && (s.row ?? 0) < rows)).toBe(true);
}

/** Sample the screen: strips sharing a lane never touch, whatever their speeds. */
function expectNoFlyOverlap(ss: Slot[], lanes: number) {
  expect(ss.every((s) => (s.row ?? 0) >= 0 && (s.row ?? 0) < lanes)).toBe(true);
  const end = Math.max(...ss.map(slotEnd));
  for (let t = 0; t < end; t += 0.05) {
    for (let r = 0; r < lanes; r++) {
      const on = ss.filter((s) => (s.row ?? 0) === r)
        .map((s) => ({ a: 1 - (t - s.start) / s.fly!.cross, w: s.fly!.w, started: t >= s.start }))
        .filter((s) => s.started && s.a < 1 && s.a + s.w > 0)
        .sort((x, y) => x.a - y.a);
      for (let k = 1; k < on.length; k++) expect(on[k]!.a, `t=${t.toFixed(2)} lane ${r}`).toBeGreaterThan(on[k - 1]!.a + on[k - 1]!.w);
    }
  }
}

describe('F-12-AC10 rows', () => {
  it('F-12-AC10 one card row and seven flying lanes by default', () => {
    expect([DEFAULT_PARAMS.display.cardRows, DEFAULT_PARAMS.display.flyRows]).toEqual([1, 7]);
  });

  it('F-12-AC10 never more cards at once than rows, and more rows show more', () => {
    const cs = many(200);
    const one = buildTimeline(input(cs), 'local', with_({ cardRows: 1 }));
    const four = buildTimeline(input(cs), 'local', with_({ cardRows: 4 }));
    expect(peak(one)).toBe(1);
    expect(peak(four)).toBe(4);
    expect(four.length).toBeGreaterThan(one.length * 3);
    expectRows(one, 1);
    expectRows(four, 4);
    expect(new Set(ids(four)).size).toBe(ids(four).length);
  });

  it('F-12-AC10 few comments are not forced together', () => {
    expect(peak(buildTimeline(input(many(3), 600), 'local', with_({ cardRows: 4 })))).toBe(1);
  });
});

describe('F-12-AC6 timestamped comments and rows', () => {
  const moment = [5, 9, 7, 1, 3].map((likes) => comment(`1:00 comment with ${likes} likes`, { id: `l${likes}`, likes }));
  const at = (rows: number) => buildTimeline(input(moment), 'stamps', with_({ cardRows: rows }));

  it('F-12-AC6 a moment\'s comments show side by side when rows are free, at most three', () => {
    const r = at(5);
    expect(r.map((s) => s.start)).toEqual([60, 60, 60]);
    expect(r.map((s) => s.row).sort()).toEqual([0, 1, 2]);
    expect(r.map((s) => ids([s]))).toEqual([['l9'], ['l7'], ['l5']]);
    expect(r.map((s) => s.extra)).toEqual([0, 0, 2]);
  });

  it('F-12-AC6 rotates what the free rows cannot hold', () => {
    const two = at(2);
    expect(two.map((s) => s.start)).toEqual([60, 60]);
    expect(two.map((s) => ids([s]))).toEqual([['l9', 'l5'], ['l7']]);
    expect(at(1).map((s) => ids([s]))).toEqual([['l9', 'l7', 'l5']]);
  });

  it('F-12-AC6 takes rows before the other comments do', () => {
    const cs = [...moment, ...many(200)];
    const r = buildTimeline(input(cs), 'local', with_({ cardRows: 3 }));
    expect(r.filter((s) => s.kind === 'stamp').map((s) => s.start)).toEqual([60, 60, 60]);
    expectRows(r, 3);
  });
});

describe('F-12-AC9 AI mode and rows', () => {
  const cs = many(3);
  const placements = new Map<string, Placement>([
    ['c0', { kind: 'at', sec: 30, conf: 0.95 }],
    ['c1', { kind: 'at', sec: 30, conf: 0.95 }],
    ['c2', { kind: 'ambient', why: 'a' }],
  ]);
  const run = (rows: number, local: Partial<DanmakuParams['local']> = {}) => buildTimeline({ ...input(cs), placements }, 'ai', with_({ cardRows: rows }, local));

  it('F-12-AC9 a clash goes to another row', () => {
    const r = run(2).filter((s) => s.kind === 'ai');
    expect(r.map((s) => [s.start, s.row]).sort()).toEqual([[30, 0], [30, 1]]);
    expect(run(1).filter((s) => s.kind === 'ai')).toHaveLength(1);
  });

  it('F-12-AC9 ambient comments only fill an empty screen', () => {
    const r = run(4);
    const amb = r.find((s) => s.kind === 'ambient')!;
    expect(r.filter((s) => s !== amb && s.start < slotEnd(amb) && amb.start < slotEnd(s))).toEqual([]);
  });

  it('F-12-AC9 the per-minute limit does not apply', () => {
    expect(run(2, { maxPerMinute: 0.1 }).filter((s) => s.kind === 'ai')).toHaveLength(2);
  });
});

describe('F-12-AC13 flying lanes', () => {
  const cs = [...many(150), ...many(40, 'and then some more words to make this one a good deal longer than the others are').map((c, k) => ({ ...c, id: `w${k}`, text: `wide ${k} ${c.text}` }))];

  it('F-12-AC13 keeps to the lanes and never overlaps or catches up', () => {
    for (const lanes of [1, 3]) {
      const r = buildTimeline(input(cs), 'local', with_({ flyRows: lanes }), 'fly');
      expect(r.length).toBeGreaterThan(lanes * 15);
      expect(r.every((s) => s.items.length === 1)).toBe(true);
      expectNoFlyOverlap(r, lanes);
    }
  });

  it('F-12-AC13 the next one follows once the last is fully in: more on screen than lanes', () => {
    const r = buildTimeline(input(cs), 'local', with_({ flyRows: 2 }), 'fly');
    expect(peak(r)).toBeGreaterThan(2);
  });

  it('F-12-AC13 timed by lane, so it differs from the card timeline', () => {
    const card = buildTimeline(input(cs), 'local', with_({ cardRows: 3, flyRows: 3 }), 'card');
    const fly = buildTimeline(input(cs), 'local', with_({ cardRows: 3, flyRows: 3 }), 'fly');
    expect(fly.map((s) => [s.items[0]!.id, s.start])).not.toEqual(card.map((s) => [s.items[0]!.id, s.start]));
  });

  it('F-12-AC13 F-12-AC6 a moment\'s comments each fly, at it or just after', () => {
    const moment = [1, 2, 3].map((k) => comment(`1:00 the jump number ${k} was great`, { id: `m${k}` }));
    const run = (lanes: number) => buildTimeline(input(moment), 'stamps', with_({ flyRows: lanes }), 'fly');
    expect(run(3).map((s) => s.start)).toEqual([60, 60, 60]);
    // One lane: each waits for the last to be in; what would wait more than 5 s is dropped.
    const one = run(1);
    expect(one.length).toBeGreaterThanOrEqual(2);
    for (const s of one) expect(s.start).toBeGreaterThanOrEqual(60), expect(s.start).toBeLessThanOrEqual(65);
    for (const lanes of [1, 3]) expectNoFlyOverlap(run(lanes), lanes);
  });

  it('F-12-AC13 flying items carry their lane, start and speed from the timeline', () => {
    const r = buildTimeline(input(cs), 'local', with_({ flyRows: 3 }), 'fly');
    const items = flyItems(r, DEFAULT_PARAMS.display);
    expect(items.map((i) => [i.c.id, i.start, i.row, i.cross])).toEqual(r.map((s) => [s.items[0]!.id, s.start, s.row ?? 0, s.fly!.cross]));
  });
});

describe('F-12-AC19 what became of the comments', () => {
  const cs = [...many(100), comment('word '.repeat(80), { id: 'long' })];
  const check = (stats: ReturnType<typeof planTimeline>['stats']) => expect(stats.placed + stats.tooLong + stats.noRoom + stats.overLimit + stats.notUsed).toBe(stats.kept);

  it('F-12-AC19 counts placed, too long, without room and over the limit', () => {
    const tight = planTimeline(input(cs, 60), 'local', with_({ cardRows: 1 })).stats;
    expect(tight.tooLong).toBe(1);
    expect(tight.noRoom).toBeGreaterThan(50);
    expect(tight.overLimit).toBe(0);
    check(tight);
    const limited = planTimeline(input(cs, 600), 'local', with_({}, { maxPerMinute: 2 })).stats;
    expect(limited).toMatchObject({ placed: 20, noRoom: 0, overLimit: 80, tooLong: 1 });
    check(limited);
  });

  it('F-12-AC19 comments the mode does not use are counted as unused', () => {
    const s = planTimeline(input(cs), 'stamps', DEFAULT_PARAMS).stats;
    expect(s).toMatchObject({ placed: 0, notUsed: 100, tooLong: 1 });
    check(s);
  });
});
