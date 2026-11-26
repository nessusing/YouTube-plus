// Flying style (F-12-AC13): each comment crosses the player once, as a single
// line, right to left, in lanes from the top. In a lane the next comment
// follows once the last is fully in, and never catches it up. Each comment has
// its own speed, random but fixed per comment, so seeking back replays it the
// same way; where a comment is is a function of video time.

import type { Comment } from './comments';
import type { DisplayParams } from './params';
import type { Layout, Slot, SlotKind } from './schedule';
import { AVATAR_EM, CHAR_EM, FONT_PER_HEIGHT } from './timing';
import { displayWidth } from './text';

export interface FlyItem {
  c: Comment;
  /** When its head enters at the right edge. */
  start: number;
  /** Seconds for the head to cross the player's width. */
  cross: number;
  /** The lane the timeline gave it. */
  row: number;
  kind: SlotKind;
  conf?: number;
}

/** Space between comments in a lane, in em. */
export const ITEM_GAP = 1.5;
/** The player's width in em of the font, for a 16:9 player (the font follows the height). */
const playerEm = (fontScale: number): number => 16 / 9 / (FONT_PER_HEIGHT * fontScale);
/** Widths are estimates: planned a little wider than guessed. */
const MARGIN = 1.05;

/** 0 ≤ x < 1 from a string (FNV-1a), the same every time. */
export function hash01(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 2 ** 32;
}

/** A comment's speed and width, as the timeline plans with them. */
export function flyMetrics(c: Comment, p: DisplayParams): { cross: number; w: number } {
  const lo = Math.min(p.flyMinSec, p.flyMaxSec);
  const hi = Math.max(p.flyMinSec, p.flyMaxSec);
  return { cross: lo + (hi - lo) * hash01(c.id), w: (MARGIN * estimateFlyWidth(c, 1)) / playerEm(p.fontScale) };
}

/**
 * The lanes as the timeline shares them: `b` may start after `a` once `a` is
 * fully in (plus the gap) and so late that `b`, if faster, has not reached the
 * left edge when `a` has left.
 */
export function flyLayout(rows: number, p: Pick<DisplayParams, 'fontScale'>): Layout {
  const g = ITEM_GAP / playerEm(p.fontScale);
  /** Seconds `b` must start after `a`. */
  const apart = (a: Slot, b: Slot) => {
    const f = a.fly!;
    return Math.max((f.w + g) * f.cross, (1 + f.w) * f.cross - (1 - g) * b.fly!.cross);
  };
  return {
    rows: Math.max(1, Math.round(rows)),
    after: (prev, c) => prev.start + apart(prev, c),
    before: (c, next) => next.start - apart(c, next),
  };
}

/** Every comment of the timeline, in time order. */
export function flyItems(slots: Slot[], p: DisplayParams): FlyItem[] {
  const out: FlyItem[] = [];
  for (const s of slots) {
    let at = s.start;
    s.items.forEach((c, i) => {
      out.push({ c, start: at, cross: s.fly?.cross ?? flyMetrics(c, p).cross, row: s.row ?? 0, kind: s.kind, conf: s.conf });
      at += s.durs[i] ?? 0;
    });
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Speed in px/s on a player `width` wide. */
export const speedOf = (it: Pick<FlyItem, 'cross'>, width: number): number => width / Math.max(0.1, it.cross);

/** A comment's left edge at video time `t`. */
export const xAt = (it: Pick<FlyItem, 'start' | 'cross'>, t: number, width: number): number => width - speedOf(it, width) * (t - it.start);

/** Seconds from entering at the right until its tail leaves at the left. */
export const flySec = (it: Pick<FlyItem, 'cross'>, w: number, width: number): number => (width + w) / speedOf(it, width);

/**
 * A lane for each item (same order, sorted by start) with the widths as drawn:
 * the lane the timeline gave it if free, else the first free one, else -1 (not
 * drawn). Free: the item neither enters before the last comment there has fully
 * come in (plus the gap) nor, being faster, catches up with any in that lane.
 */
export function assignLanes(items: (Pick<FlyItem, 'start' | 'cross'> & { row?: number })[], widths: number[], width: number, lanes: number, gapPx: number): number[] {
  const inLane: { start: number; cross: number; w: number }[][] = Array.from({ length: Math.max(1, lanes) }, () => []);
  return items.map((it, i) => {
    const w = widths[i] ?? 0;
    const v = speedOf(it, width);
    const free = (l: number): boolean => {
      // Drop what has left the screen.
      const lane = (inLane[l] = inLane[l]!.filter((a) => a.start + flySec(a, a.w, width) > it.start));
      return lane.every((a) => {
        const va = speedOf(a, width);
        // a's tail plus the gap is in from the right edge...
        if (it.start < a.start + (a.w + gapPx) / va - 1e-6) return false;
        // ...and a faster newcomer must not reach a's tail before a has left.
        if (v <= va) return true;
        return width - v * (a.start + flySec(a, a.w, width) - it.start) >= gapPx - 1e-6;
      });
    };
    const want = it.row ?? 0;
    let l = want < inLane.length && free(want) ? want : -1;
    for (let k = 0; l < 0 && k < inLane.length; k++) if (free(k)) l = k;
    if (l >= 0) inLane[l]!.push({ start: it.start, cross: it.cross, w });
    return l;
  });
}

/**
 * A strip's width in px at this font size, estimated for lane planning
 * (drawing measures): text, padding, member emoji, and the avatar (F-19-AC2).
 */
export function estimateFlyWidth(c: Pick<Comment, 'author' | 'text' | 'images' | 'avatar'>, font: number): number {
  return font * (CHAR_EM * displayWidth(`${c.author} ${c.text}`, 2) + 1.5 + c.images.length + (c.avatar ? AVATAR_EM : 0));
}
