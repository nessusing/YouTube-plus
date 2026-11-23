import { describe, expect, it } from 'vitest';
import { boxCoxFit, heatOf } from '@/features/danmaku/heat';
import { DEFAULT_PARAMS } from '@/features/danmaku/params';
import { comment } from './helpers';

const P = DEFAULT_PARAMS.heat; // likes 1, replies 0.5, recency 0.1

describe('boxCoxFit', () => {
  it('F-12-AC5 picks the log for a geometric series and stays near linear for a linear one', () => {
    expect(boxCoxFit([1, 10, 100, 1000, 10000]).lambda).toBe(0);
    expect(boxCoxFit([1, 2, 3, 4, 5]).lambda).toBeCloseTo(0.7);
  });
});

describe('heatOf', () => {
  it('F-12-AC5 is empty for no comments', () => expect(heatOf([], P)).toEqual([]));

  it('F-12-AC5 grows with likes, the most liked scoring likeWeight', () => {
    const h = heatOf([0, 5, 50, 5000].map((likes) => comment(`c${likes}`, { likes })), P);
    expect(h[0]).toBe(0);
    expect(h[3]).toBe(1);
    expect(h[1]!).toBeGreaterThan(0.2); // Box-Cox spreads the small ones out
    expect(h[2]!).toBeGreaterThan(h[1]!);
  });

  it('F-12-AC5 adds replies on a log scale', () => {
    const h = heatOf([0, 9, 99].map((replies) => comment(`r${replies}`, { replies })), P);
    expect(h[0]).toBe(0);
    expect(h[1]).toBeCloseTo(0.25);
    expect(h[2]).toBeCloseTo(0.5);
  });

  it('F-12-AC5 prefers newer comments a little, or older with a negative weight; unknown ages count as the median', () => {
    const cs = [comment('a', { ageDays: 1 }), comment('b', { ageDays: 10 }), comment('c', { ageDays: null })];
    expect(heatOf(cs, P)).toEqual([0.1, 0, 0]);
    expect(heatOf(cs, { ...P, recencyWeight: -0.1 })).toEqual([-0.1, 0, 0]);
  });
});
