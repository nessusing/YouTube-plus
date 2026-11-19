// TL;DR cache rules (design §13), pure.

import type { Summary } from './types';

export type CacheEntry =
  | { kind: 'ok'; data: Summary; t: number; used: number }
  | { kind: 'unreadable'; reason: string; t: number; used: number };

export const UNREADABLE_TTL = 24 * 60 * 60 * 1000;

export function fresh(e: CacheEntry | undefined, now: number): CacheEntry | undefined {
  if (!e) return undefined;
  if (e.kind === 'unreadable' && now - e.t > UNREADABLE_TTL) return undefined;
  return e;
}

export function entryBytes(key: string, e: CacheEntry): number {
  return key.length + JSON.stringify(e).length;
}

/** Keys to drop (least recently used first) so the total fits in maxBytes. */
export function evict(entries: Record<string, CacheEntry>, maxBytes: number): string[] {
  const list = Object.entries(entries).map(([k, e]) => ({ k, used: e.used, size: entryBytes(k, e) }));
  let total = list.reduce((s, x) => s + x.size, 0);
  const drop: string[] = [];
  for (const x of list.sort((a, b) => a.used - b.used)) {
    if (total <= maxBytes) break;
    drop.push(x.k);
    total -= x.size;
  }
  return drop;
}
