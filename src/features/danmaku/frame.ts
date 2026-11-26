// What a card shows at a moment (F-12-AC12), as a pure function of
// time inside the card, so pausing, seeking and playback speed need nothing
// special: the timeline is bound to video time.

import { type Slot, slotDur, slotEnd } from './schedule';

export interface Frame {
  /** Which comment of a rotating card. */
  item: number;
  /** Which screen (two lines) of that comment. */
  screen: number;
  opacity: number;
}

/**
 * The frame `t` seconds into the card, or null outside it. Each comment gets
 * its share of the card; a comment of n screens shows each for an nth of its
 * time; each comment fades in and out over fadeSec.
 */
export function frameAt(slot: Slot, t: number, screens: (item: number) => number, fadeSec: number): Frame | null {
  if (t < 0) return null;
  let at = 0;
  for (let item = 0; item < slot.durs.length; item++) {
    const d = slot.durs[item]!;
    if (t < at + d) {
      const u = t - at;
      const n = Math.max(1, screens(item));
      const screen = Math.min(n - 1, Math.floor(u / (d / n)));
      const opacity = fadeSec > 0 ? Math.max(0, Math.min(1, u / fadeSec, (d - u) / fadeSec)) : 1;
      return { item, screen, opacity };
    }
    at += d;
  }
  return null;
}

/** The longest card of each timeline, to know how far back to look. */
const longest = new WeakMap<Slot[], number>();

/** The cards showing at video time `t`, earliest first (slots sorted by start). */
export function slotsAt(slots: Slot[], t: number): Slot[] {
  let max = longest.get(slots);
  if (max === undefined) longest.set(slots, (max = slots.reduce((m, s) => Math.max(m, slotDur(s)), 0)));
  let lo = 0;
  let hi = slots.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (slots[mid]!.start <= t) lo = mid + 1;
    else hi = mid;
  }
  const out: Slot[] = [];
  for (let i = lo - 1; i >= 0 && slots[i]!.start > t - max; i--) if (t < slotEnd(slots[i]!)) out.push(slots[i]!);
  return out.reverse();
}
