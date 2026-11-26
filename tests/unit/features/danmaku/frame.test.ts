import { describe, expect, it } from 'vitest';
import { frameAt, slotsAt } from '@/features/danmaku/frame';
import type { Slot } from '@/features/danmaku/schedule';
import { comment } from './helpers';

const slot = (start: number, ...durs: number[]): Slot => ({ start, kind: 'stamp', items: durs.map((_, k) => comment(`c${k}`)), durs, extra: 0 });

describe('frameAt', () => {
  const one = slot(0, 4);
  it('F-12-AC10 is null outside the card', () => {
    expect(frameAt(one, -0.1, () => 1, 0.25)).toBeNull();
    expect(frameAt(one, 4, () => 1, 0.25)).toBeNull();
  });

  it('F-12-AC10 fades in and out', () => {
    expect(frameAt(one, 0, () => 1, 0.25)!.opacity).toBe(0);
    expect(frameAt(one, 0.125, () => 1, 0.25)!.opacity).toBe(0.5);
    expect(frameAt(one, 2, () => 1, 0.25)!.opacity).toBe(1);
    expect(frameAt(one, 3.875, () => 1, 0.25)!.opacity).toBeCloseTo(0.5);
    expect(frameAt(one, 2, () => 1, 0)!.opacity).toBe(1);
  });

  it('F-12-AC10 pages through screens evenly', () => {
    const long = slot(0, 15);
    expect([0, 4.9, 5, 10, 14.9].map((t) => frameAt(long, t, () => 3, 0.25)!.screen)).toEqual([0, 0, 1, 2, 2]);
  });

  it('F-12-AC10 rotates through the comments of a card', () => {
    const rot = slot(0, 2, 3, 2);
    expect([0, 1.9, 2, 4.9, 5, 6.9].map((t) => frameAt(rot, t, () => 1, 0)!.item)).toEqual([0, 0, 1, 1, 2, 2]);
  });
});

describe('slotsAt', () => {
  const slots = [slot(10, 2), slot(20, 3, 3), slot(21, 1), slot(40, 1)];
  it('F-12-AC10 finds the cards on screen, earliest first', () => {
    expect([9.9, 10, 12, 20, 21.5, 22, 26, 40.5].map((t) => slotsAt(slots, t).map((s) => s.start))).toEqual([[], [10], [], [20], [20, 21], [20], [], [40]]);
    expect(slotsAt([], 5)).toEqual([]);
  });
});
