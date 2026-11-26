// The data behind the settings page preview (F-12-AC18, F-12-AC19): the cached
// videos, their timeline under the current settings, and the timeline strip's blocks.

import { DANMAKU_CACHE_PREFIX } from '@/core/storage-usage';
import type { DanmakuSettings } from '@/core/settings';
import type { CacheEntry } from './cache';
import { type Slot, type SlotKind, slotDur } from './schedule';
import { type Mode, type PlanStats, planVideo } from './timeline';

export interface CachedVideo {
  videoId: string;
  entry: CacheEntry;
}

/** From all of storage.local: the videos the preview can show, most recently watched first. */
export function cachedVideos(all: Record<string, unknown>): CachedVideo[] {
  return Object.entries(all)
    .filter(([k]) => k.startsWith(DANMAKU_CACHE_PREFIX))
    .map(([k, v]) => ({ videoId: k.slice(DANMAKU_CACHE_PREFIX.length), entry: v as CacheEntry }))
    .filter((v) => v.entry.title !== undefined && !!v.entry.duration && v.entry.comments.length > 0)
    .sort((a, b) => b.entry.used - a.entry.used);
}

export interface CachedPlan {
  mode: Mode;
  slots: Slot[];
  stats: PlanStats & { fetched: number };
}

/** As the player would lay it out; nothing is fetched and Gemini is not asked. */
export function planCached({ videoId, entry }: CachedVideo, s: Pick<DanmakuSettings, 'placement' | 'style' | 'params'>): CachedPlan {
  const r = planVideo({
    videoId, duration: entry.duration ?? 0, total: entry.total, comments: entry.comments, heatmap: entry.heatmap,
    placements: new Map(Object.entries(entry.placements ?? {})), aiFailed: !!entry.aiFailed,
  }, s);
  return { mode: r.mode, slots: r.slots, stats: { ...r.stats, fetched: entry.comments.length } };
}

/** "1:05", "1:02:03". */
export function clock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor(s / 60) % 60;
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export interface Block {
  row: number;
  /** Shares of the video's length. */
  left: number;
  width: number;
  start: number;
  kind: SlotKind;
  /** What it says, for hovering. */
  title: string;
}

/**
 * One block per slot, in the same order. A card is as wide as it stays; a
 * flying comment is still on screen when the next enters its lane, so its
 * block ends there.
 */
export function timelineBlocks(slots: Slot[], duration: number): Block[] {
  const next = new Map<Slot, number>();
  const last = new Map<number, Slot>();
  for (const s of [...slots].sort((a, b) => a.start - b.start)) {
    const prev = last.get(s.row ?? 0);
    if (prev) next.set(prev, s.start);
    last.set(s.row ?? 0, s);
  }
  return slots.map((s) => {
    const dur = s.fly ? Math.min(slotDur(s), (next.get(s) ?? Infinity) - s.start) : slotDur(s);
    return {
      row: s.row ?? 0,
      left: s.start / duration,
      width: dur / duration,
      start: s.start,
      kind: s.kind,
      title: `${clock(s.start)} ${s.items.map((c) => `${c.author} ${c.text}`).join('\n')}`,
    };
  });
}
