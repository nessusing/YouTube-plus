// The watch page's small window (F-08): when to float, where it goes by
// default, and timestamp parsing for F-08-AC5. Pure, unit-tested.

import type { SavedPos } from './geometry';

/** Same size as the official miniplayer's default (400 px wide, 16:9). */
export const FLOAT_W = 400;
export const FLOAT_H = 225;

/** The "back to top" button (back-to-top.ts): inset from the window's corner and size. */
export const BACK_TO_TOP_INSET = 24;
export const BACK_TO_TOP_SIZE = 48;
/** Gap between the small window and the "back to top" button on its right. */
export const FLOAT_GAP = 16;

/** Bottom right, left of "back to top", bottoms aligned. */
export const DEFAULT_FLOAT_POS: SavedPos = {
  corner: 'br',
  dx: BACK_TO_TOP_INSET + BACK_TO_TOP_SIZE + FLOAT_GAP,
  dy: BACK_TO_TOP_INSET,
  width: FLOAT_W,
  height: FLOAT_H,
};

/** Half a band on each side of the halfway line, so the window doesn't flicker there. */
export const FLOAT_BAND = 24;

/**
 * Should the player float? `visible` is how much of the player's place in the
 * page is still on screen below the masthead (px), `height` its full height.
 * It floats once less than half is visible and comes back once more than half
 * is, with a band around the halfway line.
 */
export function nextFloating(floating: boolean, visible: number, height: number, band = FLOAT_BAND): boolean {
  if (height <= 0) return false;
  const half = height / 2;
  return floating ? visible < half + band : visible < half - band;
}

/** Parse a YouTube t= value: "90", "90s", "1m30s", "1h2m3s". */
export function parseT(t: string | null): number | undefined {
  if (!t) return undefined;
  if (/^\d+s?$/.test(t)) return parseInt(t, 10);
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(t);
  if (!m || (!m[1] && !m[2] && !m[3])) return undefined;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}
