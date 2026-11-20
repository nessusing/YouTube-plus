import { describe, expect, it } from 'vitest';
import { evict, fresh, UNREADABLE_TTL, type CacheEntry } from '@/features/tldr/cache-rules';
import { breakerOpen, count, demote, freshCounters, localDay, nextSpacing, pick, pickBatch, upsert, type Counters, type Job } from '@/features/tldr/jobs';

const limits = { perHour: 2, perDay: 3, prefetch: true };
const none: Counters = { hour: [], day: '', dayCount: 0 };
const base = { counters: none, limits, breaker: { state: 'closed' } as const, foreground: true, now: 1000 };

function jobs(): Job[] {
  let j: Job[] = [];
  j = upsert(j, { videoId: 'a', title: 'A', priority: 0, manual: false }, 1);
  j = upsert(j, { videoId: 'b', title: 'B', priority: 1, manual: false }, 2);
  j = upsert(j, { videoId: 'c', title: 'C', priority: 1, manual: false }, 3);
  return j;
}

describe('job picking', () => {
  it('dedupes and only raises priority', () => {
    let j = jobs();
    j = upsert(j, { videoId: 'a', title: '', priority: 1, manual: false }, 9);
    expect(j.filter((x) => x.videoId === 'a')).toEqual([{ videoId: 'a', title: 'A', priority: 1, manual: false, added: 1 }]);
    j = upsert(j, { videoId: 'a', title: '', priority: 0, manual: false }, 10);
    expect(j.find((x) => x.videoId === 'a')!.priority).toBe(1);
  });
  it('picks clicked > visible > page, oldest first', () => {
    let j = jobs();
    expect(pick(j, base)!.videoId).toBe('b');
    j = upsert(j, { videoId: 'a', title: '', priority: 2, manual: true }, 5);
    expect(pick(j, base)!.videoId).toBe('a');
  });
  it('demotes scrolled-away visible jobs but keeps them', () => {
    const j = demote(jobs(), new Set(['b']));
    expect(j.find((x) => x.videoId === 'b')!.priority).toBe(0);
    expect(j).toHaveLength(3);
  });
  it('pauses prefetch in the background, over caps, or when turned off; manual still runs', () => {
    const j = upsert(jobs(), { videoId: 'm', title: '', priority: 2, manual: true }, 4);
    expect(pick(jobs(), { ...base, foreground: false })).toBeUndefined();
    expect(pick(jobs(), { ...base, limits: { ...limits, prefetch: false } })).toBeUndefined();
    const full = count(count({ ...none }, 900), 950);
    expect(pick(jobs(), { ...base, counters: freshCounters(full, 1000) })).toBeUndefined();
    expect(pick(j, { ...base, foreground: false, counters: full })!.videoId).toBe('m');
  });
  it('stops everything, manual included, while the breaker is open', () => {
    const j = upsert(jobs(), { videoId: 'm', title: '', priority: 2, manual: true }, 4);
    expect(pick(j, { ...base, breaker: { state: 'quota' } })).toBeUndefined();
    expect(pick(j, { ...base, breaker: { state: 'blocked', until: 2000 } })).toBeUndefined();
    expect(breakerOpen({ state: 'blocked', until: 2000 }, 2001)).toBe(false);
  });
});

describe('counters', () => {
  it('slides the hour and resets on a new local day', () => {
    const t = new Date(2026, 10, 18, 23, 59).getTime();
    let c = count(none, t);
    expect(c).toMatchObject({ day: localDay(t), dayCount: 1 });
    c = freshCounters(c, t + 2 * 60_000);
    expect(c.dayCount).toBe(0);
    expect(c.hour).toHaveLength(1);
    expect(freshCounters(c, t + 3_700_000).hour).toHaveLength(0);
  });
  it('spaces requests 5-10 s apart', () => {
    expect(nextSpacing(0)).toBe(5000);
    expect(nextSpacing(0.999)).toBeLessThan(10000);
  });
});

describe('cache rules', () => {
  const ok = (used: number, n = 10): CacheEntry => ({ kind: 'ok', data: { points: ['x'.repeat(n)], lang: 'en' }, t: 0, used });
  it('expires unreadable after 24 h, keeps ok forever', () => {
    const u: CacheEntry = { kind: 'unreadable', reason: 'r', t: 0, used: 0 };
    expect(fresh(u, UNREADABLE_TTL - 1)).toBe(u);
    expect(fresh(u, UNREADABLE_TTL + 1)).toBeUndefined();
    expect(fresh(ok(0), 1e12)).toBeTruthy();
  });
  it('evicts least recently used until it fits', () => {
    const entries = { a: ok(3, 100), b: ok(1, 100), c: ok(2, 100) };
    const one = JSON.stringify(entries.a).length + 1;
    expect(evict(entries, one * 3)).toEqual([]);
    expect(evict(entries, one * 2)).toEqual(['b']);
    expect(evict(entries, one)).toEqual(['b', 'c']);
  });
});

describe('pickBatch', () => {
  it('takes jobs in pick order up to the size', () => {
    expect(pickBatch(jobs(), base, 2).map((j) => j.videoId)).toEqual(['b', 'c']);
    expect(pickBatch(jobs(), base, 10).map((j) => j.videoId)).toEqual(['b', 'c', 'a']);
    expect(pickBatch(jobs(), base, 0).map((j) => j.videoId)).toEqual(['b']);
  });
  it('puts the clicked job first', () => {
    const j = upsert(jobs(), { videoId: 'a', title: '', priority: 2, manual: true }, 5);
    expect(pickBatch(j, base, 3).map((x) => x.videoId)).toEqual(['a', 'b', 'c']);
  });
  it('adds only clicked jobs when prefetch is not allowed', () => {
    let j = upsert(jobs(), { videoId: 'a', title: '', priority: 2, manual: true }, 5);
    j = upsert(j, { videoId: 'd', title: 'D', priority: 2, manual: true }, 6);
    expect(pickBatch(j, { ...base, foreground: false }, 5).map((x) => x.videoId)).toEqual(['a', 'd']);
    expect(pickBatch(jobs(), { ...base, foreground: false }, 5)).toEqual([]);
  });
});
