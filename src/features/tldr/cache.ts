// SummaryCache (design §13) in chrome.storage.local, one key per video
// (`tldr/cache/orig:<videoId>`). Summaries are in the video's own language
// (plans P23), so the extension's language is not part of the key.

import { TLDR_CACHE_PREFIX } from '@/core/storage-usage';
import { evict, fresh, type CacheEntry } from './cache-rules';

/** "orig" = the video's own language. Other keys are older formats (`<videoId>`, `<en|zh>:<videoId>`) and get dropped. */
const KEY_PREFIX = `${TLDR_CACHE_PREFIX}orig:`;

export class SummaryCache {
  private writes = 0;
  constructor(private maxBytes: () => Promise<number>) {}

  private key(videoId: string): string {
    return `${KEY_PREFIX}${videoId}`;
  }

  async get(videoId: string): Promise<CacheEntry | undefined> {
    const k = this.key(videoId);
    const e = fresh((await browser.storage.local.get(k))[k] as CacheEntry | undefined, Date.now());
    if (e) void browser.storage.local.set({ [k]: { ...e, used: Date.now() } });
    return e;
  }

  async getMany(videoIds: string[]): Promise<Record<string, CacheEntry>> {
    if (!videoIds.length) return {};
    const got = await browser.storage.local.get(videoIds.map((id) => this.key(id)));
    const now = Date.now();
    const out: Record<string, CacheEntry> = {};
    for (const id of videoIds) {
      const e = fresh(got[this.key(id)] as CacheEntry | undefined, now);
      if (e) out[id] = e;
    }
    return out;
  }

  async set(videoId: string, e: CacheEntry): Promise<void> {
    await browser.storage.local.set({ [this.key(videoId)]: e });
    if (++this.writes % 10 === 1) await this.trim();
  }

  async remove(videoId: string): Promise<void> {
    await browser.storage.local.remove(this.key(videoId));
  }

  /** LRU down to the configured size (also called when the limit changes). */
  async trim(): Promise<void> {
    const all = await browser.storage.local.get(null);
    const entries: Record<string, CacheEntry> = {};
    const legacy: string[] = []; // older key formats, never read again
    for (const [k, v] of Object.entries(all)) {
      if (!k.startsWith(TLDR_CACHE_PREFIX)) continue;
      if (k.startsWith(KEY_PREFIX)) entries[k] = v as CacheEntry;
      else legacy.push(k);
    }
    const drop = [...legacy, ...evict(entries, await this.maxBytes())];
    if (drop.length) await browser.storage.local.remove(drop);
  }
}
