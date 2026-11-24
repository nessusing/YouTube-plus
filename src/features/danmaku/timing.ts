// How long a card stays (F-12-AC10). Scheduling estimates lines from
// a reference width; the card itself pages by its real lines within the time
// it was given.

import type { Comment } from './comments';
import type { DisplayParams } from './params';
import { displayWidth, isCjk } from './text';

/** Average width of a Latin character, in em (estimates; drawing measures). */
export const CHAR_EM = 0.52;
/** Room the avatar takes before the handle, in em: the image and its margin (F-19-AC2). */
export const AVATAR_EM = 1.2 + 0.35;

/** Width of what comes before the text, in Latin characters: the avatar, then "@handle ". */
export const headWidth = (c: Pick<Comment, 'author' | 'avatar'>, cjkWidth: number): number =>
  displayWidth(`${c.author} `, cjkWidth) + (c.avatar ? AVATAR_EM / CHAR_EM : 0);

/** Scheduling resolution. */
export const STEP_SEC = 0.5;
/** Up to the next step; the epsilon absorbs float sums like 20 × 0.2 = 4.000000000000001. */
const roundUp = (s: number): number => Math.ceil(s / STEP_SEC - 1e-6) * STEP_SEC;

/**
 * Lines at the reference width; `prefix` takes room on the first line: a
 * string (e.g. "@handle ") or a width in Latin characters.
 */
export function estimateLines(text: string, p: Pick<DisplayParams, 'refLineWidth' | 'cjkWidth'>, prefix: string | number = ''): number {
  const lead = typeof prefix === 'number' ? prefix : displayWidth(prefix, p.cjkWidth);
  return text.split('\n').reduce((n, para, i) => {
    const w = displayWidth(para, p.cjkWidth) + (i === 0 ? lead : 0);
    return n + Math.max(1, Math.ceil(w / p.refLineWidth));
  }, 0);
}

/** Reading time of the text alone (whitespace is free). */
export function readingSec(text: string, p: Pick<DisplayParams, 'latinCharSec' | 'cjkCharSec'>): number {
  let s = 0;
  for (const ch of text) if (!/\s/.test(ch)) s += isCjk(ch) ? p.cjkCharSec : p.latinCharSec;
  return s;
}

/**
 * Up to two lines: reading time, between minSec and one screen. Longer: one
 * screen per two lines. Rounded up to STEP_SEC.
 */
export function displaySec(text: string, p: DisplayParams, prefix: string | number = ''): number {
  const lines = estimateLines(text, p, prefix);
  if (lines > 2) return Math.ceil(lines / 2) * p.screenSec;
  return roundUp(Math.min(p.screenSec, Math.max(p.minSec, readingSec(text, p))));
}

/** A comment's lines at the reference width, its avatar and handle included (F-19-AC2). */
export const commentLines = (c: Pick<Comment, 'text' | 'author' | 'avatar'>, p: Pick<DisplayParams, 'refLineWidth' | 'cjkWidth'>): number =>
  estimateLines(c.text, p, headWidth(c, p.cjkWidth));
