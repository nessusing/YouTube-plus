// The timeline's slots and rows (F-12-AC10): up to a number of rows on screen
// at once. Timestamped comments take their rows first, then the rest, then
// idle stretches are filled with ambient comments. Times are in seconds.

import type { Comment, HeatSegment } from './comments';
import { STEP_SEC } from './timing';

export type SlotKind = 'toc' | 'stamp' | 'local' | 'ai' | 'ambient';

/** One card on the timeline (one strip when flying). A card for one moment can rotate through several comments. */
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
  /** Which row (card) or lane (flying) it is in; 0 when not said. */
  row?: number;
  /** Timestamped: the moment it is for, wherever it was pushed to. */
  moment?: number;
  /** Flying: seconds for the head to cross the player, and the strip's width as a share of the player's. */
  fly?: { cross: number; w: number };
}

export const slotDur = (s: Slot): number => s.durs.reduce((a, b) => a + b, 0);
export const slotEnd = (s: Slot): number => s.start + slotDur(s);
export const snap = (t: number): number => Math.round(t / STEP_SEC) * STEP_SEC;
const snapUp = (t: number): number => Math.ceil(t / STEP_SEC - 1e-6) * STEP_SEC;
const EPS = 1e-9;

/** How slots of one style share a row. */
export interface Layout {
  rows: number;
  /** The earliest `c` may start in a row after `prev`. */
  after(prev: Slot, c: Slot): number;
  /** The latest `c` may start in a row before `next`. */
  before(c: Slot, next: Slot): number;
}

/** Cards: one at a time in a row, with the gap between. */
export const cardLayout = (rows: number, gapSec: number): Layout => ({
  rows: Math.max(1, Math.round(rows)),
  after: (prev) => slotEnd(prev) + gapSec,
  before: (c, next) => next.start - gapSec - slotDur(c),
});

/** What is taken in each row. Each row's slots are sorted by start and fit each other. */
export class Tracks {
  private readonly rows: Slot[][] = [];

  constructor(readonly layout: Layout) {
    for (let r = 0; r < layout.rows; r++) this.rows.push([]);
  }

  /** Put `s` in its row. A row beyond the layout's (the rows were just reduced) is kept but not offered again. */
  add(s: Slot): void {
    const row = (this.rows[s.row ?? 0] ??= []);
    row.splice(indexAfter(row, s.start), 0, s);
  }

  /** Does `s` fit row `r` at its own start? */
  fitsRow(s: Slot, r: number): boolean {
    const row = this.rows[r]!;
    const k = indexAfter(row, s.start);
    const prev = row[k - 1];
    const next = row[k];
    return (!prev || s.start >= this.layout.after(prev, s) - EPS) && (!next || s.start <= this.layout.before(s, next) + EPS);
  }

  /** The row `s` fits at its start: its own if that does, else the first; undefined when none. */
  rowAt(s: Slot): number | undefined {
    if (s.row !== undefined && s.row < this.layout.rows && this.fitsRow(s, s.row)) return s.row;
    for (let r = 0; r < this.layout.rows; r++) if (this.fitsRow(s, r)) return r;
    return undefined;
  }

  /** The start in [lo, hi] nearest to `want` where `s` fits some row; the lowest row on a tie. */
  nearest(s: Slot, want: number, lo: number, hi: number): { start: number; row: number } | undefined {
    let best: { start: number; row: number } | undefined;
    let dist = Infinity;
    for (let r = 0; r < this.layout.rows; r++) {
      const row = this.rows[r]!;
      // The free stretch between each two neighbours.
      for (let k = 0; k <= row.length; k++) {
        const prev = row[k - 1];
        const next = row[k];
        const a = Math.max(lo, prev ? this.layout.after(prev, s) : lo);
        const b = Math.min(hi, next ? this.layout.before(s, next) : hi);
        if (a > b + EPS) continue;
        // Onto the half-second grid when the stretch holds a grid point.
        const g = snapUp(a) <= b + EPS ? Math.min(Math.max(snap(want), snapUp(a)), Math.floor(b / STEP_SEC + 1e-6) * STEP_SEC) : a;
        const d = Math.abs(g - want);
        if (d < dist - EPS) {
          best = { start: g, row: r };
          dist = d;
        }
      }
    }
    return best;
  }
}

/** Where a slot starting at `t` goes in a row sorted by start. */
function indexAfter(row: Slot[], t: number): number {
  let lo = 0;
  let hi = row.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (row[mid]!.start <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * A moment's card cut into `k` cards shown side by side, its comments dealt in
 * turn; the last carries the count of those not shown.
 */
function split(card: Slot, k: number): Slot[] {
  return Array.from({ length: k }, (_, j) => ({
    ...card,
    items: card.items.filter((_, i) => i % k === j),
    durs: card.durs.filter((_, i) => i % k === j),
    extra: j === k - 1 ? card.extra : 0,
  }));
}

/**
 * Timestamped cards in time order (F-12-AC6), added to `tracks`. At its moment
 * a card's comments take as many free rows as they can, rotating what is left
 * over. With every row taken it is pushed back: a single comment at most
 * `maxDelaySec`, else it is dropped (never moved earlier: spoilers). A rotating
 * card may wait as long as it lasts.
 */
export function placeStamps(cards: Slot[], tracks: Tracks, maxDelaySec: number): Slot[] {
  const out: Slot[] = [];
  const put = (s: Slot, row: number) => {
    const placed = { ...s, row };
    tracks.add(placed);
    out.push(placed);
  };
  for (const c of [...cards].sort((a, b) => a.start - b.start)) {
    const card = { ...c, moment: c.start };
    let done = false;
    for (let k = Math.min(card.items.length, tracks.layout.rows); k >= 1 && !done; k--) {
      const parts = split(card, k);
      const used = new Set<number>();
      const rows = parts.map((part) => {
        for (let r = 0; r < tracks.layout.rows; r++) {
          if (used.has(r) || !tracks.fitsRow(part, r)) continue;
          used.add(r);
          return r;
        }
        return undefined;
      });
      if (rows.some((r) => r === undefined)) continue;
      parts.forEach((part, j) => put(part, rows[j]!));
      done = true;
    }
    if (done) continue;
    const maxDelay = card.items.length > 1 ? Math.max(maxDelaySec, slotDur(card)) : maxDelaySec;
    const spot = tracks.nearest(card, card.start, card.start, card.start + maxDelay);
    if (spot) put({ ...card, start: spot.start }, spot.row);
  }
  return out.sort((a, b) => a.start - b.start);
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
 * One row's best-scoring set of candidates that do not overlap each other or
 * the taken slots (keeping the gap): weighted interval scheduling. Candidates
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
 * Fill every stretch longer than idleSec with nothing on screen with the
 * hottest ambient comment that fits, placed where the stretch is most replayed
 * (its middle without a curve), until no such stretch is left or the pool runs
 * out. `pool` is hottest first; each slot in it is a single comment with its
 * duration (start ignored). The screen is empty there, so row 0 is free.
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
    timeline.push({ ...item, start: at, row: 0 });
    timeline.sort((a, b) => a.start - b.start);
  }
  return timeline;
}
