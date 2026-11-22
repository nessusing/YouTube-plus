import { describe, expect, it } from 'vitest';
import { apportion, isSpoiler, localCandidates, perMinute, seeded } from '@/features/danmaku/local';
import { DEFAULT_PARAMS } from '@/features/danmaku/params';
import { comment } from './helpers';

describe('seeded', () => {
  it('repeats for the same seed and differs for another', () => {
    const a = seeded('abc');
    const b = seeded('abc');
    const c = seeded('abd');
    const xs = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(xs);
    expect([c(), c(), c()]).not.toEqual(xs);
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
  });
});

describe('perMinute', () => {
  it('is 1 + log10(total), between 1 and 6', () => {
    expect(perMinute(0, DEFAULT_PARAMS.local)).toBe(1);
    expect(perMinute(1000, DEFAULT_PARAMS.local)).toBe(4);
    expect(perMinute(1e9, DEFAULT_PARAMS.local)).toBe(6);
  });
});

describe('isSpoiler', () => {
  const W = DEFAULT_PARAMS.local.spoilerWords;
  it.each([
    ['What a twist!', true], ['The ending got me', true], ['结局太好了', true], ['最後那一句真的笑死', true],
    ['twisted logic', false], ['the endless road', false], ['great video', false],
  ])('%j → %s', (text, yes) => expect(isSpoiler(text, W)).toBe(yes));
});

describe('apportion', () => {
  it('splits by largest remainder', () => {
    expect(apportion(10, [1, 1, 1])).toEqual([4, 3, 3]);
    expect(apportion(7, [2, 1])).toEqual([5, 2]);
    expect(apportion(5, [0, 0])).toEqual([0, 0]);
  });
});

describe('localCandidates', () => {
  // 40 comments, hottest first; 10 minutes, 1000 comments → 4 a minute → all 40.
  const cs = Array.from({ length: 40 }, (_, k) => comment(`comment number ${k} is long enough`, { likes: 40 - k }));
  const heat = cs.map((c) => c.likes / 40);
  const base = { videoId: 'vid', duration: 600, total: 1000, comments: cs, heat, heatmap: [] };
  const windowOf = (t: number) => Math.floor((t - 5) / 30);

  it('places as many as the rate allows, after the lead-in and inside the video', () => {
    const r = localCandidates(base, DEFAULT_PARAMS);
    expect(r).toHaveLength(40);
    for (const c of r) {
      expect(c.slot.start).toBeGreaterThanOrEqual(5);
      expect(c.slot.start + c.slot.durs[0]!).toBeLessThanOrEqual(600);
    }
    expect(localCandidates({ ...base, total: 1 }, DEFAULT_PARAMS)).toHaveLength(10); // 1 a minute
  });

  it('is the same every time for a video', () => {
    expect(localCandidates(base, DEFAULT_PARAMS)).toEqual(localCandidates(base, DEFAULT_PARAMS));
    expect(localCandidates({ ...base, videoId: 'other' }, DEFAULT_PARAMS)).not.toEqual(localCandidates(base, DEFAULT_PARAMS));
  });

  it('spreads the hottest over the whole video', () => {
    const r = localCandidates(base, DEFAULT_PARAMS);
    const top = r.filter((c) => cs.indexOf(c.slot.items[0]!) < 20).map((c) => windowOf(c.slot.start));
    expect(new Set(top).size).toBe(20);
  });

  it('gives more to the most replayed part', () => {
    const r = localCandidates({ ...base, heatmap: [{ start: 305, dur: 30, score: 1 }] }, DEFAULT_PARAMS);
    const count = (w: number) => r.filter((c) => windowOf(c.slot.start) === w).length;
    expect(count(10)).toBeGreaterThan(count(0));
  });

  it('keeps spoilers for the last 20%', () => {
    const spoiler = comment('what a twist at the end, wow', { likes: 1000 });
    const r = localCandidates({ ...base, comments: [spoiler, ...cs], heat: [2, ...heat] }, DEFAULT_PARAMS);
    expect(r.find((c) => c.slot.items[0] === spoiler)!.slot.start).toBeGreaterThanOrEqual(480);
  });

  it('scores heat × duration', () => {
    const c = localCandidates(base, DEFAULT_PARAMS)[0]!;
    expect(c.score).toBeCloseTo(heat[cs.indexOf(c.slot.items[0]!)]! * c.slot.durs[0]!);
  });
});
