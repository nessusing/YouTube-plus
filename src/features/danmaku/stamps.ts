// Timestamped comments (§51.4).

import type { Comment } from './comments';
import type { StampParams } from './params';
import { cutRanges, displayWidth } from './text';

/**
 * A real table of contents: the first timestamp is 0:00, at least
 * `tocMinStamps` of them, and every line with a timestamp is just the time and
 * a short title (a range like "1:00-2:30" is fine). Lines without a timestamp,
 * such as an intro sentence, are ignored. Shown once at 0:00 as the video's
 * contents; anything else (e.g. a highlights list) shows at every timestamp.
 */
export function isToc(c: Comment, p: Pick<StampParams, 'tocMinStamps' | 'tocTitleMax'>, cjkWidth: number): boolean {
  if (c.stamps.length < p.tocMinStamps || c.stamps[0]!.sec !== 0) return false;
  let lineStart = 0;
  for (const line of c.text.split('\n')) {
    const lineEnd = lineStart + line.length;
    const inLine = c.stamps.filter((s) => s.start >= lineStart && s.start < lineEnd);
    if (inLine.length > 2) return false;
    if (inLine.length) {
      const title = cutRanges(line, inLine.map((s) => ({ start: s.start - lineStart, len: s.len })))
        .replace(/^[\s\-–—:|.,)(\][~>]+|[\s\-–—:|.,)(\][~<]+$/gu, '');
      if (displayWidth(title, cjkWidth) > p.tocTitleMax) return false;
    }
    lineStart = lineEnd + 1;
  }
  return true;
}

/** Timestamps a comment shows at: inside the video, each moment once. */
export function stampTimes(c: Comment, duration: number): number[] {
  return [...new Set(c.stamps.map((s) => s.sec))].filter((t) => t >= 0 && t <= duration).sort((a, b) => a - b);
}
