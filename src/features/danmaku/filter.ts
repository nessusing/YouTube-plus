// Local filtering (F-12-AC5): dropped comments are neither sent
// to Gemini nor shown.

import type { Comment } from './comments';
import type { CommentParams } from './params';
import { core, cutRanges, weightedLength } from './text';

export type DropReason = 'link' | 'emoji' | 'short' | 'duplicate';

export interface Filtered {
  kept: Comment[];
  dropped: { comment: Comment; reason: DropReason }[];
}

/** What the comment says besides its timestamps and inline emoji. */
export function ownText(c: Comment): string {
  return cutRanges(c.text, [...c.stamps, ...c.images]).trim();
}

/**
 * Drop links, pure emoji, too short (a CJK letter counts `cjkWeight` Latin
 * ones: measured 2026-11-22, counting characters dropped half of the Chinese
 * comments) and duplicates (the most liked copy stays). Keeps the order.
 */
export function filterComments(cs: Comment[], p: Pick<CommentParams, 'minLength' | 'cjkWeight'>): Filtered {
  const dropped: Filtered['dropped'] = [];
  const survivors: { c: Comment; key: string }[] = [];
  for (const c of cs) {
    const own = ownText(c);
    const key = core(own);
    const reason: DropReason | undefined = c.hasLink ? 'link'
      : !key ? 'emoji'
      : weightedLength(own, p.cjkWeight) < p.minLength ? 'short'
      : undefined;
    if (reason) dropped.push({ comment: c, reason });
    else survivors.push({ c, key });
  }
  const best = new Map<string, Comment>();
  for (const { c, key } of survivors) {
    const b = best.get(key);
    if (!b || c.likes > b.likes) best.set(key, c);
  }
  const kept: Comment[] = [];
  for (const { c, key } of survivors) {
    if (best.get(key) === c) kept.push(c);
    else dropped.push({ comment: c, reason: 'duplicate' });
  }
  return { kept, dropped };
}
