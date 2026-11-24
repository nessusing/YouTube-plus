// Flying style (F-12): each comment of the timeline flies once, as a single
// line, from the player's right edge to its left. Same comments at the same
// times as the cards; several may be on screen at once (and may overlap when
// every lane is taken). Each comment has its own speed, random but fixed per
// comment, so seeking back replays it the same way. Like the cards, where a
// comment is is a function of video time.

import type { Comment } from './comments';
import type { DisplayParams } from './params';
import type { Slot, SlotKind } from './schedule';
import { AVATAR_EM, CHAR_EM, commentLines } from './timing';
import { displayWidth } from './text';

export interface FlyItem {
  c: Comment;
  /** When its head enters at the right edge. */
  start: number;
  /** Seconds for the head to cross the player's width. */
  cross: number;
  kind: SlotKind;
  conf?: number;
}

/** 0 ≤ x < 1 from a string (FNV-1a), the same every time. */
export function hash01(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 2 ** 32;
}

/**
 * Every comment of the cards, in time order: a rotating card's comments
 * start one after another, as the card would show them. Comments of more than
 * flyMaxLines lines (estimated like a card's) are left out.
 */
export function flyItems(slots: Slot[], p: DisplayParams): FlyItem[] {
  const lo = Math.min(p.flyMinSec, p.flyMaxSec);
  const hi = Math.max(p.flyMinSec, p.flyMaxSec);
  const out: FlyItem[] = [];
  for (const s of slots) {
    let at = s.start;
    s.items.forEach((c, i) => {
      if (commentLines(c, p) <= p.flyMaxLines) {
        out.push({ c, start: at, cross: lo + (hi - lo) * hash01(c.id), kind: s.kind, conf: s.conf });
      }
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
 * A lane for each item (same order). An item takes the first lane where it
 * neither enters before the last comment there has fully come in (plus the
 * gap) nor, being faster, catches up with any comment still in that lane. With
 * no such lane it takes the one that frees up first (overlap allowed).
 */
export function assignLanes(items: Pick<FlyItem, 'start' | 'cross'>[], widths: number[], width: number, lanes: number, gapPx: number): number[] {
  const inLane: { start: number; cross: number; w: number }[][] = Array.from({ length: Math.max(1, lanes) }, () => []);
  return items.map((it, i) => {
    const w = widths[i] ?? 0;
    const v = speedOf(it, width);
    let pick = -1;
    let soonest = Infinity;
    let soonestLane = 0;
    for (let l = 0; l < inLane.length; l++) {
      // Drop what has left the screen.
      const lane = (inLane[l] = inLane[l]!.filter((a) => a.start + flySec(a, a.w, width) > it.start));
      let ok = true;
      let free = -Infinity;
      for (const a of lane) {
        const va = speedOf(a, width);
        // a's tail plus the gap is in from the right edge...
        const tailIn = a.start + (a.w + gapPx) / va;
        free = Math.max(free, tailIn);
        if (it.start < tailIn) ok = false;
        // ...and a faster newcomer must not reach a's tail before a has left.
        else if (v > va) {
          const aGone = a.start + flySec(a, a.w, width);
          if (width - v * (aGone - it.start) < gapPx) ok = false;
        }
      }
      if (ok) {
        pick = l;
        break;
      }
      if (free < soonest) {
        soonest = free;
        soonestLane = l;
      }
    }
    const l = pick >= 0 ? pick : soonestLane;
    inLane[l]!.push({ start: it.start, cross: it.cross, w });
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
