// How long a card stays (§51.6). Scheduling estimates lines from
// a reference width; the card itself pages by its real lines within the time
// it was given.

import type { DisplayParams } from './params';
import { displayWidth, isCjk } from './text';

/** Scheduling resolution. */
export const STEP_SEC = 0.5;
/** Up to the next step; the epsilon absorbs float sums like 20 × 0.2 = 4.000000000000001. */
const roundUp = (s: number): number => Math.ceil(s / STEP_SEC - 1e-6) * STEP_SEC;

/** Lines at the reference width; `prefix` (the "@handle ") takes room on the first line. */
export function estimateLines(text: string, p: Pick<DisplayParams, 'refLineWidth' | 'cjkWidth'>, prefix = ''): number {
  return text.split('\n').reduce((n, para, i) => {
    const w = displayWidth(i === 0 ? prefix + para : para, p.cjkWidth);
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
export function displaySec(text: string, p: DisplayParams, prefix = ''): number {
  const lines = estimateLines(text, p, prefix);
  if (lines > 2) return Math.ceil(lines / 2) * p.screenSec;
  return roundUp(Math.min(p.screenSec, Math.max(p.minSec, readingSec(text, p))));
}
