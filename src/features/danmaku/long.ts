// Long comments (F-12-AC17): more than longLines estimated lines is long, and
// is then hidden, cut to that many lines, or (on the card) scrolled in full.

import type { DanmakuStyle } from '@/core/settings';
import type { Comment } from './comments';
import type { DisplayParams } from './params';
import { displayWidth } from './text';
import { commentLines, headWidth } from './timing';

/** The styles that have a timeline (the panel lists everything). */
export type TimelineStyle = Exclude<DanmakuStyle, 'panel'>;

/** The comment's first `lines` estimated lines, ending in "…". */
export function truncate(c: Comment, lines: number, p: Pick<DisplayParams, 'refLineWidth' | 'cjkWidth'>): Comment {
  let line = 1;
  let used = headWidth(c, p.cjkWidth);
  /** UTF-16 length of what fits. */
  let end = 0;
  for (const ch of c.text) {
    if (ch === '\n') {
      if (line >= lines) break;
      line += Math.max(1, Math.ceil(used / p.refLineWidth));
      if (line > lines) break;
      used = 0;
    } else {
      const w = displayWidth(ch, p.cjkWidth);
      // The room left: whole lines still free, keeping one character for the "…".
      if (used + w > (lines - line + 1) * p.refLineWidth - 1) break;
      used += w;
    }
    end += ch.length;
  }
  // A member emoji is kept whole or not at all.
  for (const img of c.images) if (img.start < end && img.start + img.len > end) end = img.start;
  const text = c.text.slice(0, end).trimEnd();
  return { ...c, text: `${text}…`, images: c.images.filter((i) => i.start + i.len <= text.length), cut: true };
}

/**
 * The comment as it is to be shown, or undefined when it is not. A table of
 * contents on the card is exempt (it always scrolls); flying has one line, so
 * "scroll" cuts there.
 */
export function fitLong(c: Comment, p: DisplayParams, style: TimelineStyle, toc: boolean): Comment | undefined {
  if (p.longLines <= 0 || (toc && style === 'card') || commentLines(c, p) <= p.longLines) return c;
  if (p.longMode === 'hide') return undefined;
  if (p.longMode === 'scroll' && style === 'card') return c;
  return truncate(c, p.longLines, p);
}
