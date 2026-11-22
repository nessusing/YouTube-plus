// Cards for timestamped comments (§51.4).

import type { Comment } from './comments';
import type { DanmakuParams } from './params';
import { type Slot } from './schedule';
import { isToc, stampTimes } from './stamps';
import { displaySec, STEP_SEC } from './timing';

/** Seconds a comment stays on its card; the "@handle " takes room too. */
export const durOf = (c: Comment, p: DanmakuParams['display']): number => displaySec(c.text, p, `${c.author} `);

/**
 * One card per moment, before placement. A table of contents is one card at
 * 0:00. Other comments appear at each of their timestamps; occurrences within
 * 2 × clusterSec of the first one at a moment (± clusterSec around its middle)
 * share a card that starts at the earliest, shows up to rotateMax comments,
 * most liked first, and counts the rest as extra.
 */
export function stampCards(cs: Comment[], duration: number, p: DanmakuParams): Slot[] {
  const cards: Slot[] = [];
  const hits: { t: number; c: Comment }[] = [];
  for (const c of cs) {
    if (isToc(c, p.stamps, p.display.cjkWidth)) cards.push({ start: 0, kind: 'toc', items: [c], durs: [durOf(c, p.display)], extra: 0 });
    else for (const t of stampTimes(c, duration)) hits.push({ t, c });
  }
  hits.sort((a, b) => a.t - b.t);
  for (let i = 0; i < hits.length;) {
    const first = hits[i]!.t;
    const group: Comment[] = [];
    for (; i < hits.length && hits[i]!.t <= first + 2 * p.stamps.clusterSec; i++) if (!group.includes(hits[i]!.c)) group.push(hits[i]!.c);
    group.sort((a, b) => b.likes - a.likes);
    const shown = group.slice(0, p.stamps.rotateMax);
    cards.push({
      start: Math.floor(first / STEP_SEC) * STEP_SEC,
      kind: 'stamp',
      items: shown,
      durs: shown.map((c) => durOf(c, p.display)),
      extra: group.length - shown.length,
    });
  }
  return cards;
}
