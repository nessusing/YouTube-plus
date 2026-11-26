// Local mode (F-12): spread comments without timestamps over
// the video by heat, without Gemini. Same video, same result: the randomness
// is seeded by the videoId.

import type { Comment, HeatSegment } from './comments';
import type { DanmakuParams, LocalParams } from './params';
import { replayOver, type Slot, slotDur, snap, type Tracks } from './schedule';
import { STEP_SEC } from './timing';

/** mulberry32 seeded by a string hash. */
export function seeded(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates with the given random source. */
function shuffle<T>(xs: T[], rand: () => number): T[] {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [xs[i], xs[j]] = [xs[j]!, xs[i]!];
  }
  return xs;
}

/** How many comments to place at most (F-12-AC8): the rate over the video; 0 = no limit. */
export function localTarget(duration: number, p: Pick<LocalParams, 'maxPerMinute'>): number {
  return p.maxPerMinute > 0 ? Math.max(1, Math.round((p.maxPerMinute * duration) / 60)) : Infinity;
}

/** Mentions the ending, a twist…: only for the tail of the video. Latin words match whole. */
export function isSpoiler(text: string, words: string[]): boolean {
  const t = text.toLowerCase();
  return words.some((w) => {
    const word = w.toLowerCase();
    if (!/^[\x20-\x7e]+$/.test(word)) return t.includes(word);
    const esc = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^a-z0-9])${esc}($|[^a-z0-9])`).test(t);
  });
}

/** Integer shares of `total` proportional to `weights` (largest remainder). */
export function apportion(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (w / sum) * total);
  const out = raw.map(Math.floor);
  const order = raw.map((r, i) => ({ i, rest: r - Math.floor(r) })).sort((a, b) => b.rest - a.rest || a.i - b.i);
  for (let k = 0, left = total - out.reduce((a, b) => a + b, 0); k < left; k++) out[order[k % order.length]!.i]!++;
  return out;
}

export interface LocalInput {
  videoId: string;
  duration: number;
  /** Without timestamps, already filtered; heat in the same order. */
  comments: Comment[];
  heat: number[];
  heatmap: HeatSegment[];
}

export interface LocalCandidate {
  /** `start` is the time it would like. */
  slot: Slot;
  /** Only for the tail of the video. */
  spoiler: boolean;
}

/**
 * The comments in the order to place them, each with the time it would like:
 *  1. cut [leadIn, duration) into windows; as many comments as the limit allows
 *     (all without one) are shared out ∝ a window's length × (1 + replayWeight
 *     × its "Most replayed" score);
 *  2. hottest first, deal one per window per round, windows in a seeded order,
 *     so the best comments are spread over the whole video; spoilers only go
 *     to windows in the last spoilerTail of the video;
 *  3. a window's comments split it evenly, each at a seeded spot in its part.
 * Those come first, hottest first; then the rest (they stand in for any that
 * find no room), at seeded times.
 */
export function localCandidates(i: LocalInput, p: DanmakuParams, make: (c: Comment) => Slot): LocalCandidate[] {
  const lp = p.local;
  const rand = seeded(i.videoId);
  const count = Math.min(i.comments.length, localTarget(i.duration, lp));
  const windows: { a: number; b: number }[] = [];
  for (let a = lp.leadInSec; a < i.duration; a += lp.windowSec) windows.push({ a, b: Math.min(i.duration, a + lp.windowSec) });
  if (!count || !windows.length) return [];
  const quota = apportion(count, windows.map((w) => ((w.b - w.a) / lp.windowSec) * (1 + lp.replayWeight * replayOver(i.heatmap, w.a, w.b))));
  const tailFrom = i.duration * (1 - lp.spoilerTail);

  const order = i.comments.map((c, k) => ({ c, heat: i.heat[k] ?? 0, spoiler: isSpoiler(c.text, lp.spoilerWords) })).sort((a, b) => b.heat - a.heat);
  const dealt: (typeof order)[] = windows.map(() => []);
  let rotation: number[] = [];
  for (const item of order) {
    const fits = (w: number) => dealt[w]!.length < quota[w]! && (!item.spoiler || windows[w]!.b > tailFrom);
    if (!windows.some((_, w) => fits(w))) continue;
    // Next window in this round that fits; a new seeded round when none is left.
    let w = rotation.findIndex(fits);
    if (w < 0) {
      rotation = shuffle(windows.map((_, k) => k), rand);
      w = rotation.findIndex(fits);
    }
    dealt[rotation[w]!]!.push(item);
    rotation.splice(w, 1);
  }

  const at = (item: (typeof order)[number], want: number): LocalCandidate => {
    const slot = make(item.c);
    if (item.spoiler) want = Math.max(want, tailFrom);
    slot.start = Math.max(0, snap(Math.min(i.duration - slotDur(slot), want)));
    return { slot, spoiler: item.spoiler };
  };
  const chosen = new Map<Comment, LocalCandidate>();
  windows.forEach((win, w) => {
    const items = dealt[w]!;
    const part = (win.b - win.a) / items.length;
    items.forEach((item, k) => {
      const dur = slotDur(make(item.c));
      chosen.set(item.c, at(item, win.a + part * k + rand() * Math.max(0, part - dur)));
    });
  });
  const first = order.flatMap((x) => chosen.get(x.c) ?? []);
  const rest = order.filter((x) => !chosen.has(x.c))
    .map((x) => at(x, lp.leadInSec + rand() * Math.max(0, i.duration - lp.leadInSec)));
  return [...first, ...rest];
}

export interface PlaceOptions {
  /** Nothing starts before this. */
  from: number;
  duration: number;
  /** Spoilers start here at the earliest. */
  tailFrom: number;
  /** Stop after placing this many. */
  target: number;
}

/**
 * Add the candidates to `tracks` in order (F-12-AC8): each at the free time
 * nearest to the one it would like; one that fits nowhere is passed over.
 */
export function placeLocal(tracks: Tracks, cands: LocalCandidate[], o: PlaceOptions): { slots: Slot[]; noRoom: number; overLimit: number } {
  const slots: Slot[] = [];
  let noRoom = 0;
  let overLimit = 0;
  for (const { slot, spoiler } of cands) {
    if (slots.length >= o.target) {
      overLimit++;
      continue;
    }
    const from = spoiler ? Math.max(o.from, Math.ceil(o.tailFrom / STEP_SEC - 1e-6) * STEP_SEC) : o.from;
    const spot = tracks.nearest(slot, slot.start, from, o.duration - slotDur(slot));
    if (!spot) {
      noRoom++;
      continue;
    }
    const placed = { ...slot, ...spot };
    tracks.add(placed);
    slots.push(placed);
  }
  return { slots, noRoom, overLimit };
}
