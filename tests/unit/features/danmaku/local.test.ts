import { describe, expect, it } from 'vitest';
import { durOf } from '@/features/danmaku/cards';
import { apportion, isSpoiler, localCandidates, localTarget, placeLocal, seeded } from '@/features/danmaku/local';
import { cardLayout, type Slot, Tracks } from '@/features/danmaku/schedule';
import { DEFAULT_PARAMS } from '@/features/danmaku/params';
import { comment } from './helpers';

describe('seeded', () => {
  it('F-12-AC8 repeats for the same seed and differs for another', () => {
    const a = seeded('abc');
    const b = seeded('abc');
    const c = seeded('abd');
    const xs = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(xs);
    expect([c(), c(), c()]).not.toEqual(xs);
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
  });
});

describe('isSpoiler', () => {
  const W = DEFAULT_PARAMS.local.spoilerWords;
  it.each([
    ['What a twist!', true], ['The ending got me', true], ['结局太好了', true], ['最後那一句真的笑死', true],
    ['twisted logic', false], ['the endless road', false], ['great video', false],
  ])('F-12-AC8 %j → %s', (text, yes) => expect(isSpoiler(text, W)).toBe(yes));
});

describe('apportion', () => {
  it('F-12-AC8 splits by largest remainder', () => {
    expect(apportion(10, [1, 1, 1])).toEqual([4, 3, 3]);
    expect(apportion(7, [2, 1])).toEqual([5, 2]);
    expect(apportion(5, [0, 0])).toEqual([0, 0]);
  });
});

const cardOf = (c: ReturnType<typeof comment>): Slot => ({ start: 0, kind: 'local', items: [c], durs: [durOf(c, DEFAULT_PARAMS.display)], extra: 0 });

describe('localTarget', () => {
  it('F-12-AC8 0 means as many as fit; otherwise the rate over the video', () => {
    expect(DEFAULT_PARAMS.local.maxPerMinute).toBe(0);
    expect(localTarget(600, DEFAULT_PARAMS.local)).toBe(Infinity);
    expect(localTarget(600, { maxPerMinute: 3 })).toBe(30);
    expect(localTarget(10, { maxPerMinute: 1 })).toBe(1);
  });
});

describe('localCandidates', () => {
  // 40 comments, hottest first; 10 minutes.
  const cs = Array.from({ length: 40 }, (_, k) => comment(`comment number ${k} is long enough`, { likes: 40 - k }));
  const heat = cs.map((c) => c.likes / 40);
  const base = { videoId: 'vid', duration: 600, comments: cs, heat, heatmap: [] };
  const windowOf = (t: number) => Math.floor((t - 5) / 30);
  const wanted = (i = base, p = DEFAULT_PARAMS) => localCandidates(i, p, cardOf);

  it('F-12-AC8 offers every comment a time inside the video, hottest first', () => {
    const r = wanted();
    expect(r.map((c) => c.slot.items[0])).toEqual(cs);
    for (const c of r) {
      expect(c.slot.start).toBeGreaterThanOrEqual(5);
      expect(c.slot.start + c.slot.durs[0]!).toBeLessThanOrEqual(600);
    }
  });

  it('F-12-AC8 is the same every time for a video', () => {
    expect(wanted()).toEqual(wanted());
    expect(wanted({ ...base, videoId: 'other' })).not.toEqual(wanted());
  });

  it('F-12-AC8 spreads the hottest over the whole video', () => {
    expect(new Set(wanted().slice(0, 20).map((c) => windowOf(c.slot.start))).size).toBe(20);
  });

  it('F-12-AC8 with a limit, the most replayed part gets more of the hottest', () => {
    const p = { ...DEFAULT_PARAMS, local: { ...DEFAULT_PARAMS.local, maxPerMinute: 3 } };
    const r = wanted({ ...base, heatmap: [{ start: 305, dur: 30, score: 1 }] } as typeof base, p).slice(0, 30);
    const count = (w: number) => r.filter((c) => windowOf(c.slot.start) === w).length;
    expect(count(10)).toBeGreaterThan(count(0));
  });

  it('F-12-AC8 keeps spoilers for the last 20%', () => {
    const spoiler = comment('what a twist at the end, wow', { likes: 1000 });
    const r = wanted({ ...base, comments: [spoiler, ...cs], heat: [2, ...heat] });
    expect(r[0]).toMatchObject({ spoiler: true });
    expect(r[0]!.slot.start).toBeGreaterThanOrEqual(480);
  });
});

describe('placeLocal', () => {
  const cand = (id: string, start: number, dur: number, spoiler = false) => ({ slot: { start, kind: 'local' as const, items: [comment(`text of ${id}`, { id })], durs: [dur], extra: 0 }, spoiler });
  const o = { from: 5, duration: 200, tailFrom: 160, target: Infinity };
  const taken = (start: number, dur: number) => {
    const t = new Tracks(cardLayout(1, 0.5));
    t.add({ ...cand('T', start, dur).slot, row: 0 });
    return t;
  };
  const view = (ss: Slot[]) => ss.map((s) => [s.items[0]!.id, s.start]);

  it('F-12-AC8 moves to the nearest free time when the wanted one is taken', () => {
    expect(view(placeLocal(taken(100, 10), [cand('a', 106, 2)], o).slots)).toEqual([['a', 110.5]]);
    expect(view(placeLocal(taken(100, 10), [cand('a', 101, 2)], o).slots)).toEqual([['a', 97.5]]);
  });

  it('F-12-AC8 skips one that fits nowhere and goes on to the next', () => {
    const r = placeLocal(taken(10, 180), [cand('big', 50, 20), cand('small', 50, 2)], { ...o, target: 1 });
    expect(view(r.slots)).toEqual([['small', 7.5]]);
    expect(r).toMatchObject({ noRoom: 1, overLimit: 0 });
  });

  it('F-12-AC8 stops at the limit', () => {
    const r = placeLocal(new Tracks(cardLayout(1, 0.5)), [cand('a', 20, 2), cand('b', 60, 2), cand('c', 90, 2)], { ...o, target: 2 });
    expect(view(r.slots)).toEqual([['a', 20], ['b', 60]]);
    expect(r).toMatchObject({ noRoom: 0, overLimit: 1 });
  });

  it('F-12-AC8 a moved spoiler stays in the last 20%', () => {
    expect(view(placeLocal(taken(160, 10), [cand('s', 161, 2, true)], o).slots)).toEqual([['s', 170.5]]);
    expect(placeLocal(taken(155, 45), [cand('s', 161, 2, true)], o)).toMatchObject({ slots: [], noRoom: 1 });
  });
});
