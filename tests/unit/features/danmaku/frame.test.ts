import { describe, expect, it } from 'vitest';
import { frameAt, slotAt } from '@/features/danmaku/frame';
import type { Slot } from '@/features/danmaku/schedule';
import { comment } from './helpers';

const slot = (start: number, ...durs: number[]): Slot => ({ start, kind: 'stamp', items: durs.map((_, k) => comment(`c${k}`)), durs, extra: 0 });

describe('frameAt', () => {
  const one = slot(0, 4);
  it('is null outside the card', () => {
    expect(frameAt(one, -0.1, () => 1, 0.25)).toBeNull();
    expect(frameAt(one, 4, () => 1, 0.25)).toBeNull();
  });

  it('fades in and out', () => {
    expect(frameAt(one, 0, () => 1, 0.25)!.opacity).toBe(0);
    expect(frameAt(one, 0.125, () => 1, 0.25)!.opacity).toBe(0.5);
    expect(frameAt(one, 2, () => 1, 0.25)!.opacity).toBe(1);
    expect(frameAt(one, 3.875, () => 1, 0.25)!.opacity).toBeCloseTo(0.5);
    expect(frameAt(one, 2, () => 1, 0)!.opacity).toBe(1);
  });

  it('pages through screens evenly', () => {
    const long = slot(0, 15);
    expect([0, 4.9, 5, 10, 14.9].map((t) => frameAt(long, t, () => 3, 0.25)!.screen)).toEqual([0, 0, 1, 2, 2]);
  });

  it('rotates through the comments of a card', () => {
    const rot = slot(0, 2, 3, 2);
    expect([0, 1.9, 2, 4.9, 5, 6.9].map((t) => frameAt(rot, t, () => 1, 0)!.item)).toEqual([0, 0, 1, 1, 2, 2]);
  });
});

describe('slotAt', () => {
  const slots = [slot(10, 2), slot(20, 3, 3), slot(40, 1)];
  it('finds the card on screen, if any', () => {
    expect([9.9, 10, 11.9, 12, 25.9, 26, 40.5].map((t) => slotAt(slots, t)?.start)).toEqual([undefined, 10, 10, undefined, 20, undefined, 40]);
    expect(slotAt([], 5)).toBeUndefined();
  });
});
