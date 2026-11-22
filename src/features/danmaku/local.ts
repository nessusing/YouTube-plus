// Local mode (§51.5): spread comments without timestamps over
// the video by heat, without Gemini. Same video, same result: the randomness
// is seeded by the videoId.

import type { Comment, HeatSegment } from './comments';
import type { DanmakuParams, LocalParams } from './params';
import { durOf } from './cards';
import { type Candidate, replayOver, snap } from './schedule';

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

/** Comments per minute = 1 + log10(total comments), clamped. */
export function perMinute(total: number, p: Pick<LocalParams, 'perMinuteMin' | 'perMinuteMax'>): number {
  return Math.min(p.perMinuteMax, Math.max(p.perMinuteMin, 1 + Math.log10(Math.max(1, total))));
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
  /** Comment count from the header (for the per-minute rate). */
  total: number;
  /** Without timestamps, already filtered; heat in the same order. */
  comments: Comment[];
  heat: number[];
  heatmap: HeatSegment[];
}

/**
 * Where each comment would go, scored heat × duration for pickBest:
 *  1. how many: perMinute(total) × minutes, at most the comments we have;
 *  2. cut [leadIn, duration) into windows; each gets a share ∝ its length ×
 *     (1 + replayWeight × its "Most replayed" score);
 *  3. hottest first, deal one per window per round, windows in a seeded
 *     order, so the best comments are spread over the whole video; spoilers
 *     only go to windows in the last spoilerTail of the video;
 *  4. a window's comments split it evenly, each at a seeded spot in its part.
 */
export function localCandidates(i: LocalInput, p: DanmakuParams): Candidate[] {
  const lp = p.local;
  const rand = seeded(i.videoId);
  const count = Math.min(i.comments.length, Math.round(perMinute(i.total, lp) * (i.duration / 60)));
  const windows: { a: number; b: number }[] = [];
  for (let a = lp.leadInSec; a < i.duration; a += lp.windowSec) windows.push({ a, b: Math.min(i.duration, a + lp.windowSec) });
  if (!count || !windows.length) return [];
  const quota = apportion(count, windows.map((w) => ((w.b - w.a) / lp.windowSec) * (1 + lp.replayWeight * replayOver(i.heatmap, w.a, w.b))));
  const tailFrom = i.duration * (1 - lp.spoilerTail);

  const order = i.comments.map((c, k) => ({ c, heat: i.heat[k] ?? 0 })).sort((a, b) => b.heat - a.heat);
  const dealt: { c: Comment; heat: number }[][] = windows.map(() => []);
  let rotation: number[] = [];
  for (const item of order) {
    const spoiler = isSpoiler(item.c.text, lp.spoilerWords);
    const fits = (w: number) => dealt[w]!.length < quota[w]! && (!spoiler || windows[w]!.b > tailFrom);
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

  const out: Candidate[] = [];
  windows.forEach((win, w) => {
    const items = dealt[w]!;
    const part = (win.b - win.a) / items.length;
    items.forEach((item, k) => {
      const dur = durOf(item.c, p.display);
      let start = win.a + part * k + rand() * Math.max(0, part - dur);
      if (isSpoiler(item.c.text, lp.spoilerWords)) start = Math.max(start, tailFrom);
      start = snap(Math.min(i.duration - dur, start));
      out.push({ slot: { start: Math.max(0, start), kind: 'local', items: [item.c], durs: [dur], extra: 0 }, score: item.heat * dur + 1e-6 });
    });
  });
  return out;
}
