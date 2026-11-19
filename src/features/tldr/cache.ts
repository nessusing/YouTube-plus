// SummaryCache (design §13) in chrome.storage.local, one key per video.

import { TLDR_CACHE_PREFIX } from '@/core/storage-usage';
import { evict, fresh, type CacheEntry } from './cache-rules';

const key = (videoId: string) => `${TLDR_CACHE_PREFIX}${videoId}`;

export class SummaryCache {
  private writes = 0;
  constructor(private maxBytes: () => Promise<number>) {}

  async get(videoId: string): Promise<CacheEntry | undefined> {
    const k = key(videoId);
    const e = fresh((await browser.storage.local.get(k))[k] as CacheEntry | undefined, Date.now());
    if (e) void browser.storage.local.set({ [k]: { ...e, used: Date.now() } });
    return e;
  }

  async getMany(videoIds: string[]): Promise<Record<string, CacheEntry>> {
    if (!videoIds.length) return {};
    const got = await browser.storage.local.get(videoIds.map(key));
    const now = Date.now();
    const out: Record<string, CacheEntry> = {};
    for (const id of videoIds) {
      const e = fresh(got[key(id)] as CacheEntry | undefined, now);
      if (e) out[id] = e;
    }
    return out;
  }

  async set(videoId: string, e: CacheEntry): Promise<void> {
    await browser.storage.local.set({ [key(videoId)]: e });
    if (++this.writes % 10 === 1) await this.trim();
  }

  async remove(videoId: string): Promise<void> {
    await browser.storage.local.remove(key(videoId));
  }

  /** LRU down to the configured size (also called when the limit changes). */
  async trim(): Promise<void> {
    const all = await browser.storage.local.get(null);
    const entries: Record<string, CacheEntry> = {};
    for (const [k, v] of Object.entries(all)) if (k.startsWith(TLDR_CACHE_PREFIX)) entries[k] = v as CacheEntry;
    const drop = evict(entries, await this.maxBytes());
    if (drop.length) await browser.storage.local.remove(drop);
  }
}
