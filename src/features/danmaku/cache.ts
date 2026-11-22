// Danmaku cache (plans P13 「缓存」): per video in storage.local, its own size
// cap (cache.mb), least recently used out first. Comments expire after
// cache.days; Gemini's placements outlive them, so after a refetch only new
// comments go to Gemini.

import { DANMAKU_CACHE_PREFIX } from '@/core/storage-usage';
import type { Placement } from './ai';
import type { Comment, HeatSegment } from './comments';

export interface CacheEntry {
  /** When the comments were fetched. */
  t: number;
  used: number;
  /** Comment count from the header. */
  total: number;
  heatmap: HeatSegment[];
  /** As fetched, unfiltered, in YouTube's order. */
  comments: Comment[];
  /** Fetched up to the limit (or to the end); false: stopped early, fetch again. */
  complete: boolean;
  /** Gemini's verdict per comment id (AI mode). */
  placements?: Record<string, Placement>;
  /** AI mode could not run for this video (e.g. "no_transcript"), with when. */
  aiFailed?: { reason: string; t: number };
}

const DAY_MS = 86_400_000;

/** Comments still fresh at `now`? */
export const isFresh = (e: Pick<CacheEntry, 't' | 'complete'>, now: number, days: number): boolean => e.complete && now - e.t < days * DAY_MS;

/** Keys to drop, least recently used first, until the rest fit in maxBytes. */
export function evictKeys(entries: { key: string; used: number; bytes: number }[], maxBytes: number): string[] {
  let total = entries.reduce((s, e) => s + e.bytes, 0);
  const drop: string[] = [];
  for (const e of [...entries].sort((a, b) => a.used - b.used)) {
    if (total <= maxBytes) break;
    drop.push(e.key);
    total -= e.bytes;
  }
  return drop;
}

const key = (videoId: string) => `${DANMAKU_CACHE_PREFIX}${videoId}`;

export class DanmakuCache {
  constructor(private maxBytes: () => number) {}

  /** The entry, fresh or not (see isFresh); marks it used. */
  async get(videoId: string): Promise<CacheEntry | undefined> {
    const k = key(videoId);
    const e = (await browser.storage.local.get(k))[k] as CacheEntry | undefined;
    if (e) void browser.storage.local.set({ [k]: { ...e, used: Date.now() } }).catch(() => {});
    return e;
  }

  async set(videoId: string, e: CacheEntry): Promise<void> {
    await browser.storage.local.set({ [key(videoId)]: { ...e, used: Date.now() } });
    await this.trim();
  }

  async trim(): Promise<void> {
    const all = await browser.storage.local.get(null);
    const entries = Object.entries(all)
      .filter(([k]) => k.startsWith(DANMAKU_CACHE_PREFIX))
      .map(([k, v]) => ({ key: k, used: (v as CacheEntry).used ?? 0, bytes: k.length + JSON.stringify(v).length }));
    const drop = evictKeys(entries, this.maxBytes());
    if (drop.length) await browser.storage.local.remove(drop);
  }
}
