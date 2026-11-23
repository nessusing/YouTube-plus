// The timeline (F-12-AC10): one card at a time, a gap between cards,
// timestamped cards first, then the rest chosen by weighted interval
// scheduling (dynamic programming), then idle stretches filled with ambient
// comments. All times are seconds on a STEP_SEC grid.

import type { Comment, HeatSegment } from './comments';
import { STEP_SEC } from './timing';

export type SlotKind = 'toc' | 'stamp' | 'local' | 'ai' | 'ambient';

/** One card on the timeline. A card for one moment can rotate through several comments. */
export interface Slot {
  start: number;
  kind: SlotKind;
  /** Shown in turn, most liked first. */
  items: Comment[];
  /** Seconds each item stays; the card lasts their sum. */
  durs: number[];
  /** Comments at this moment that are not shown ("+4"). */
  extra: number;
  /** Gemini's confidence, for the debug label. */
  conf?: number;
}

export const slotDur = (s: Slot): number => s.durs.reduce((a, b) => a + b, 0);
export const slotEnd = (s: Slot): number => s.start + slotDur(s);
export const snap = (t: number): number => Math.round(t / STEP_SEC) * STEP_SEC;

/**
 * Timestamped cards in time order, each at its moment or pushed back until the
 * previous card has ended plus the gap. A single comment may wait at most
 * `maxDelaySec`, else it is dropped (never moved earlier: spoilers). A
 * rotating card may wait as long as it lasts.
 */
export function placeStamps(cards: Slot[], o: { maxDelaySec: number; gapSec: number }): Slot[] {
  const out: Slot[] = [];
  let free = -Infinity;
  for (const card of [...cards].sort((a, b) => a.start - b.start)) {
    const start = Math.max(card.start, free);
    const maxDelay = card.items.length > 1 ? Math.max(o.maxDelaySec, slotDur(card)) : o.maxDelaySec;
    if (start - card.start > maxDelay + 1e-9) continue;
    const placed = { ...card, start };
    out.push(placed);
    free = slotEnd(placed) + o.gapSec;
  }
  return out;
}

export interface Candidate {
  slot: Slot;
  score: number;
}

/** Does [s, e) come within `gap` of any taken slot? */
function clashes(s: number, e: number, taken: Slot[], gap: number): boolean {
  return taken.some((t) => s < slotEnd(t) + gap - 1e-9 && t.start < e + gap - 1e-9);
}

/**
 * The best-scoring set of candidates that do not overlap each other or the
 * taken slots (keeping the gap): weighted interval scheduling. Candidates
 * clashing with a taken slot are left out first.
 */
export function pickBest(cands: Candidate[], taken: Slot[], gapSec: number): Slot[] {
  const ok = cands.filter((c) => !clashes(c.slot.start, slotEnd(c.slot), taken, gapSec))
    .sort((a, b) => slotEnd(a.slot) - slotEnd(b.slot));
  const n = ok.length;
  const best = new Array<number>(n + 1).fill(0);
  const prev = new Array<number>(n).fill(0);
  for (let j = 0; j < n; j++) {
    // Candidates are sorted by end: binary-search the last one ending (plus gap) by this start.
    let lo = 0;
    let hi = j;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (slotEnd(ok[mid]!.slot) + gapSec <= ok[j]!.slot.start + 1e-9) lo = mid + 1;
      else hi = mid;
    }
    prev[j] = lo; // candidates 0..lo-1 fit before j
    best[j + 1] = Math.max(best[j]!, ok[j]!.score + best[lo]!);
  }
  const picked: Slot[] = [];
  for (let j = n - 1; j >= 0;) {
    if (ok[j]!.score + best[prev[j]!]! > best[j]!) {
      picked.push(ok[j]!.slot);
      j = prev[j]! - 1;
    } else {
      j--;
    }
  }
  return picked.reverse();
}

/** Mean "Most replayed" score over [a, b); parts the curve does not cover count 0. */
export function replayOver(heatmap: HeatSegment[], a: number, b: number): number {
  if (b <= a) return 0;
  let sum = 0;
  for (const h of heatmap) {
    const o = Math.min(b, h.start + h.dur) - Math.max(a, h.start);
    if (o > 0) sum += h.score * o;
  }
  return sum / (b - a);
}

export interface FillOptions {
  from: number;
  duration: number;
  idleSec: number;
  gapSec: number;
  heatmap: HeatSegment[];
}

/**
 * Fill every idle stretch longer than idleSec with the hottest ambient comment
 * that fits, placed where the stretch is most replayed (its middle without a
 * curve), until no such stretch is left or the pool runs out. `pool` is hottest
 * first; each slot in it is a single comment with its duration (start ignored).
 */
export function fillIdle(slots: Slot[], pool: Slot[], o: FillOptions): Slot[] {
  const timeline = [...slots].sort((a, b) => a.start - b.start);
  const left = [...pool];
  for (;;) {
    // Free stretches: where a card could start and must have ended.
    const gaps: { a: number; b: number }[] = [];
    let cursor = o.from;
    for (const s of timeline) {
      gaps.push({ a: cursor, b: s.start - o.gapSec });
      cursor = Math.max(cursor, slotEnd(s) + o.gapSec);
    }
    gaps.push({ a: cursor, b: o.duration });
    let idle: { a: number; b: number } | undefined;
    let k = -1;
    for (const g of gaps) {
      if (g.b - g.a <= o.idleSec) continue;
      k = left.findIndex((s) => slotDur(s) <= g.b - g.a);
      if (k >= 0) {
        idle = g;
        break;
      }
    }
    if (!idle) break;
    const item = left.splice(k, 1)[0]!;
    const dur = slotDur(item);
    // The middle, unless somewhere is more replayed.
    let at = Math.max(idle.a, snap((idle.a + idle.b - dur) / 2));
    let top = replayOver(o.heatmap, at, at + dur);
    for (let t = Math.ceil(idle.a / STEP_SEC) * STEP_SEC; o.heatmap.length && t + dur <= idle.b + 1e-9; t += STEP_SEC) {
      const r = replayOver(o.heatmap, t, t + dur);
      if (r > top + 1e-9) {
        top = r;
        at = t;
      }
    }
    timeline.push({ ...item, start: at });
    timeline.sort((a, b) => a.start - b.start);
  }
  return timeline;
}
