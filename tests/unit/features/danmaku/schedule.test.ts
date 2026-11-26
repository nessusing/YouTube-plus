import { describe, expect, it } from 'vitest';
import { type Candidate, cardLayout, fillIdle, pickBest, placeStamps, replayOver, type Slot, Tracks } from '@/features/danmaku/schedule';
import { comment } from './helpers';

const slot = (name: string, start: number, ...durs: number[]): Slot => ({ start, kind: 'stamp', items: durs.map((_, k) => comment(`${name}${k}`)), durs, extra: 0 });
const cand = (name: string, start: number, dur: number, score: number): Candidate => ({ slot: { ...slot(name, start, dur), kind: 'local' }, score });
const names = (ss: Slot[]) => ss.map((s) => s.items[0]!.text.replace(/0$/, ''));
/** Into one row, as the single card does. */
const place = (cards: Slot[]) => placeStamps(cards, new Tracks(cardLayout(1, 0.5)), 5);

describe('placeStamps', () => {
  it('F-12-AC6 pushes a card back until the previous one has ended, plus the gap', () => {
    expect(place([slot('b', 11, 2), slot('a', 10, 2)]).map((s) => s.start)).toEqual([10, 12.5]);
  });

  it('F-12-AC6 drops a single comment pushed more than maxDelaySec; a rotating card may wait as long as it lasts', () => {
    const r = place([slot('long', 10, 7), slot('single', 12, 2), slot('rot', 12.5, 2, 2, 2)]);
    // long ends 17 → free at 17.5: single would wait 5.5 s (> 5), rot 5 s.
    expect(names(r)).toEqual(['long', 'rot']);
    const r2 = place([slot('long', 10, 7), slot('rot', 11.5, 2, 2, 2)]);
    expect(r2.map((s) => s.start)).toEqual([10, 17.5]); // waits 6 s = its length
    expect(place([slot('long', 10, 8), slot('rot', 11.5, 2, 2, 2)]).length).toBe(1); // 7 s > 6 s
  });
});

describe('pickBest', () => {
  it('F-12-AC10 takes the best-scoring set that keeps the gap', () => {
    // X [0,4) and Z [5,8) fit together; Y [3,6) clashes with both.
    expect(names(pickBest([cand('X', 0, 4, 5), cand('Y', 3, 3, 3), cand('Z', 5, 3, 3)], [], 0.5))).toEqual(['X', 'Z']);
    expect(names(pickBest([cand('X', 0, 4, 1), cand('Y', 3, 3, 10), cand('Z', 5, 3, 3)], [], 0.5))).toEqual(['Y']);
  });

  it('F-12-AC10 needs the gap between cards', () => {
    expect(names(pickBest([cand('X', 0, 4, 1), cand('Z', 4.4, 3, 1)], [], 0.5))).toEqual(['X']); // a tie keeps the earlier
    expect(names(pickBest([cand('X', 0, 4, 1), cand('Z', 4.5, 3, 1)], [], 0.5))).toEqual(['X', 'Z']);
  });

  it('F-12-AC10 leaves out what clashes with taken slots', () => {
    const taken = [slot('T', 10, 2)];
    expect(names(pickBest([cand('A', 11.5, 2, 9), cand('B', 12.5, 2, 1), cand('C', 7, 2.5, 1)], taken, 0.5))).toEqual(['C', 'B']);
  });

  it('F-12-AC10 copes with nothing', () => expect(pickBest([], [], 0.5)).toEqual([]));
});

describe('replayOver', () => {
  const hm = [{ start: 0, dur: 10, score: 1 }, { start: 10, dur: 10, score: 0.5 }];
  it('F-12-AC8 averages over the range, uncovered parts as 0', () => {
    expect(replayOver(hm, 0, 10)).toBe(1);
    expect(replayOver(hm, 5, 15)).toBe(0.75);
    expect(replayOver(hm, 15, 25)).toBe(0.25);
    expect(replayOver([], 0, 10)).toBe(0);
  });
});

describe('fillIdle', () => {
  const pool = [slot('P1', 0, 3), slot('P2', 0, 3), slot('P3', 0, 3)].map((s) => ({ ...s, kind: 'ambient' as const }));
  const base = { from: 5, duration: 60, idleSec: 20, gapSec: 0.5, heatmap: [] };

  it('F-12-AC9 fills stretches idle for more than idleSec, in their middle', () => {
    const r = fillIdle([slot('S', 30, 2)], pool, base);
    expect(r.map((s) => [names([s])[0], s.start])).toEqual([['P1', 16], ['S', 30], ['P2', 45]]);
  });

  it('F-12-AC9 moves to the most replayed spot of the stretch', () => {
    const r = fillIdle([slot('S', 30, 2)], pool, { ...base, heatmap: [{ start: 50, dur: 10, score: 1 }] });
    expect(r.map((s) => s.start)).toEqual([16, 30, 50]);
  });

  it('F-12-AC9 skips comments too long for the stretch', () => {
    const long = { ...slot('L', 0, 28), kind: 'ambient' as const }; // longer than both stretches (24.5 s, 27.5 s)
    const r = fillIdle([slot('S', 30, 2)], [long, ...pool], base);
    expect(names(r)).toEqual(['P1', 'S', 'P2']);
  });
});
