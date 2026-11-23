// TL;DR job queue rules (F-03), pure. One global queue in the service
// worker: dedupe by video, priority, one at a time, random spacing, hourly and
// daily caps, circuit breaker, prefetch only while a YouTube tab is visible.

export type Priority = 0 | 1 | 2; // 2 clicked > 1 visible > 0 on the page

export interface Job { videoId: string; title: string; priority: Priority; manual: boolean; added: number }

export interface Limits { perHour: number; perDay: number; prefetch: boolean }

export interface Counters {
  /** start times of requests in the last hour */
  hour: number[];
  /** local date (YYYY-MM-DD) and count for that day */
  day: string;
  dayCount: number;
}

export type Breaker =
  | { state: 'closed' }
  | { state: 'quota' } // until the user presses resume
  | { state: 'blocked'; until: number };

export const BLOCK_MS = 30 * 60 * 1000;
export const SPACING_MIN_MS = 5000;
export const SPACING_MAX_MS = 10000;

export function localDay(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function freshCounters(c: Counters, now: number): Counters {
  const day = localDay(now);
  return { hour: c.hour.filter((t) => now - t < 3_600_000), day, dayCount: c.day === day ? c.dayCount : 0 };
}

export function underCaps(c: Counters, l: Limits): boolean {
  return c.hour.length < l.perHour && c.dayCount < l.perDay;
}

export function breakerOpen(b: Breaker, now: number): boolean {
  return b.state === 'quota' || (b.state === 'blocked' && now < b.until);
}

/** Add or bump a job; returns the new list sorted for picking. Never lowers a manual job. */
export function upsert(jobs: Job[], j: Omit<Job, 'added'>, now: number): Job[] {
  const i = jobs.findIndex((x) => x.videoId === j.videoId);
  const out = [...jobs];
  if (i < 0) out.push({ ...j, added: now });
  else {
    const old = out[i]!;
    out[i] = { ...old, title: j.title || old.title, priority: Math.max(old.priority, j.priority) as Priority, manual: old.manual || j.manual };
  }
  return out;
}

/** Scrolled away: only lower visible → page, never cancel (F-03). */
export function demote(jobs: Job[], videoIds: Set<string>): Job[] {
  return jobs.map((j) => (videoIds.has(j.videoId) && j.priority === 1 && !j.manual ? { ...j, priority: 0 } : j));
}

/**
 * Which job may run now, if any. Manual jobs ignore the caps and the
 * foreground rule but not an open breaker (F-03).
 */
export function pick(jobs: Job[], o: { counters: Counters; limits: Limits; breaker: Breaker; foreground: boolean; now: number }): Job | undefined {
  if (breakerOpen(o.breaker, o.now)) return undefined;
  const sorted = [...jobs].sort((a, b) => b.priority - a.priority || Number(b.manual) - Number(a.manual) || a.added - b.added);
  const manual = sorted.find((j) => j.manual);
  if (manual) return manual;
  if (!o.limits.prefetch || !o.foreground || !underCaps(o.counters, o.limits)) return undefined;
  return sorted[0];
}

/**
 * Up to `size` jobs for one request (F-03 batching): the job pick() chooses,
 * then more in pick order. Manual jobs may always join; prefetch jobs only
 * when prefetch is allowed right now (the batch is one request against the caps).
 */
export function pickBatch(jobs: Job[], o: Parameters<typeof pick>[1], size: number): Job[] {
  const first = pick(jobs, o);
  if (!first) return [];
  const prefetchOk = o.limits.prefetch && o.foreground && underCaps(o.counters, o.limits);
  const rest = [...jobs]
    .filter((j) => j !== first && (j.manual || prefetchOk))
    .sort((a, b) => b.priority - a.priority || Number(b.manual) - Number(a.manual) || a.added - b.added);
  return [first, ...rest].slice(0, Math.max(1, size));
}

export function nextSpacing(rand = Math.random()): number {
  return SPACING_MIN_MS + Math.floor(rand * (SPACING_MAX_MS - SPACING_MIN_MS));
}

export function count(c: Counters, now: number): Counters {
  const f = freshCounters(c, now);
  return { ...f, hour: [...f.hour, now], dayCount: f.dayCount + 1 };
}
