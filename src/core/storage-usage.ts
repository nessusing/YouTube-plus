// Storage categories and their usage (design §4.1). Each category owns a set
// of storage.local keys; anything unclaimed counts as "other".

import { LOG_KEY } from './log';

export type StorageCategory = 'log' | 'tldrCache' | 'queueSnapshot' | 'other';

export const TLDR_CACHE_PREFIX = 'tldr/cache/';
export const QUEUE_SNAPSHOT_KEY = 'queue/snapshot';

export function categoryOf(key: string): StorageCategory {
  if (key === LOG_KEY) return 'log';
  if (key.startsWith(TLDR_CACHE_PREFIX)) return 'tldrCache';
  if (key === QUEUE_SNAPSHOT_KEY) return 'queueSnapshot';
  return 'other';
}

export interface CategoryUsage {
  bytes: number;
  /** Lines for the log, entries for the cache; absent where it means nothing. */
  count?: number;
}

export interface StorageUsage {
  total: number;
  byCategory: Record<StorageCategory, CategoryUsage>;
}

export function groupKeys(keys: string[]): Record<StorageCategory, string[]> {
  const out: Record<StorageCategory, string[]> = { log: [], tldrCache: [], queueSnapshot: [], other: [] };
  for (const k of keys) out[categoryOf(k)].push(k);
  return out;
}

export async function getStorageUsage(): Promise<StorageUsage> {
  const all = await browser.storage.local.get(null);
  const groups = groupKeys(Object.keys(all));
  const bytes = async (keys: string[]) => (keys.length ? browser.storage.local.getBytesInUse(keys) : 0);
  const log = all[LOG_KEY];
  return {
    total: await browser.storage.local.getBytesInUse(null),
    byCategory: {
      log: { bytes: await bytes(groups.log), count: Array.isArray(log) ? log.length : 0 },
      tldrCache: { bytes: await bytes(groups.tldrCache), count: groups.tldrCache.length },
      queueSnapshot: { bytes: await bytes(groups.queueSnapshot) },
      other: { bytes: await bytes(groups.other) },
    },
  };
}

export async function clearCategory(cat: Exclude<StorageCategory, 'other' | 'log'>): Promise<void> {
  const all = await browser.storage.local.get(null);
  const keys = groupKeys(Object.keys(all))[cat];
  if (keys.length) await browser.storage.local.remove(keys);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
