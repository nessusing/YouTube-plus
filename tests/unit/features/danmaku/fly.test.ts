import { describe, expect, it } from 'vitest';
import { assignLanes, flyItems, flySec, hash01, xAt } from '@/features/danmaku/fly';
import { DEFAULT_PARAMS } from '@/features/danmaku/params';
import type { Slot } from '@/features/danmaku/schedule';
import { comment } from './helpers';

const P = DEFAULT_PARAMS.display;
const slot = (start: number, texts: string[], durs: number[]): Slot => ({ start, kind: 'local', items: texts.map((x) => comment(x)), durs, extra: 0 });

describe('flyItems', () => {
  it('F-12-AC13 flies the cards\' comments; a rotating card\'s one after another', () => {
    const items = flyItems([slot(10, ['a b c', 'd e f'], [2, 3]), slot(4, ['g h i'], [2])], P);
    expect(items.map((i) => [i.c.text, i.start])).toEqual([['g h i', 4], ['a b c', 10], ['d e f', 12]]);
  });

  it('F-12-AC13 gives each comment its own speed in [min, max], the same every time', () => {
    const texts = Array.from({ length: 40 }, (_, i) => `comment number ${i}`);
    const a = flyItems([slot(0, texts, texts.map(() => 1))], P);
    const b = flyItems([slot(0, texts, texts.map(() => 1))], P);
    expect(a.map((i) => i.cross)).toEqual(b.map((i) => i.cross));
    for (const i of a) expect(i.cross).toBeGreaterThanOrEqual(P.flyMinSec), expect(i.cross).toBeLessThan(P.flyMaxSec);
    expect(new Set(a.map((i) => i.cross.toFixed(3))).size).toBeGreaterThan(30);
  });

  it('F-12-AC13 hash01 is in [0, 1)', () => {
    for (const s of ['', 'a', 'UgyEnXfdC-umwvTt8JF4AaABAg', '中文']) {
      expect(hash01(s)).toBeGreaterThanOrEqual(0);
      expect(hash01(s)).toBeLessThan(1);
    }
  });
});

describe('position', () => {
  const it8 = { start: 10, cross: 8 };
  it('F-12-AC13 enters at the right edge and crosses the width in `cross` seconds', () => {
    expect(xAt(it8, 10, 800)).toBe(800);
    expect(xAt(it8, 14, 800)).toBe(400);
    expect(xAt(it8, 18, 800)).toBe(0);
  });
  it('F-12-AC13 stays until its tail has left', () => {
    expect(flySec(it8, 200, 800)).toBe(10); // (800 + 200) px at 100 px/s
  });
});

describe('assignLanes', () => {
  const W = 1000;
  it('F-12-AC13 puts a comment in the first lane once the previous one is fully in', () => {
    // 100 px/s, 200 px wide + 20 gap: lane 0 is free again 2.2 s later.
    const lanes = assignLanes([{ start: 0, cross: 10 }, { start: 1, cross: 10 }, { start: 3, cross: 10 }], [200, 200, 200], W, 3, 20);
    expect(lanes).toEqual([0, 1, 0]);
  });

  it('F-12-AC13 keeps a faster comment out of a lane where it would catch up', () => {
    // Slow one: 50 px/s, leaves at 24 s. A fast one (200 px/s) entering at 5 s would reach x = 0 at 10 s.
    const lanes = assignLanes([{ start: 0, cross: 20 }, { start: 5, cross: 5 }], [200, 100], W, 2, 20);
    expect(lanes).toEqual([0, 1]);
    // A slower one behind it is fine.
    expect(assignLanes([{ start: 0, cross: 5 }, { start: 3, cross: 20 }], [200, 100], W, 2, 20)).toEqual([0, 0]);
  });

  it('F-12-AC13 gives no lane rather than overlap', () => {
    const lanes = assignLanes([{ start: 0, cross: 10 }, { start: 0.5, cross: 10 }, { start: 1, cross: 10 }], [400, 100, 400], W, 2, 20);
    // Lane 0's comment is in at 4.2 s, lane 1's at 1.7 s: nowhere for the third at 1 s.
    expect(lanes).toEqual([0, 1, -1]);
  });

  it('F-12-AC13 takes the timeline\'s lane when it is free, another when not', () => {
    expect(assignLanes([{ start: 0, cross: 10, row: 2 }, { start: 1, cross: 10, row: 2 }], [200, 200], W, 3, 20)).toEqual([2, 0]);
    expect(assignLanes([{ start: 0, cross: 10, row: 5 }], [200], W, 2, 20)).toEqual([0]);
  });

  it('F-12-AC13 reuses a lane once its comments have left the screen', () => {
    expect(assignLanes([{ start: 0, cross: 2 }, { start: 30, cross: 20 }], [5000, 100], W, 1, 20)).toEqual([0, 0]);
  });
});
