// Miniplayer placement math (F-07-AC2, F-07-AC3). Pure, unit-tested.

export interface Rect { x: number; y: number; w: number; h: number }
export interface Viewport { w: number; h: number; /** space taken by the masthead at the top */ top: number }
export type Corner = 'tl' | 'tr' | 'bl' | 'br';

/** What we store: the nearest corner, the distance from it, and the size. */
export interface SavedPos { corner: Corner; dx: number; dy: number; width: number; height: number }

/** Released within this many px of an edge → snap to it. */
export const SNAP_PX = 24;
/** Gap kept from an edge after snapping (matches the official 16 px inset). */
export const EDGE_GAP = 16;

/** Snap to whichever edges are close; a corner is just two edges at once. */
export function snap(r: Rect, vp: Viewport, threshold = SNAP_PX, gap = EDGE_GAP): Rect {
  const out = { ...r };
  const left = r.x;
  const right = vp.w - (r.x + r.w);
  const top = r.y - vp.top;
  const bottom = vp.h - (r.y + r.h);
  if (left < threshold) out.x = gap;
  else if (right < threshold) out.x = vp.w - r.w - gap;
  if (top < threshold) out.y = vp.top + gap;
  else if (bottom < threshold) out.y = vp.h - r.h - gap;
  return out;
}

export function nearestCorner(r: Rect, vp: Viewport): Corner {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const v = cy < (vp.top + vp.h) / 2 ? 't' : 'b';
  const h = cx < vp.w / 2 ? 'l' : 'r';
  return `${v}${h}` as Corner;
}

export function encode(r: Rect, vp: Viewport): SavedPos {
  const corner = nearestCorner(r, vp);
  const dx = corner[1] === 'l' ? r.x : vp.w - (r.x + r.w);
  const dy = corner[0] === 't' ? r.y - vp.top : vp.h - (r.y + r.h);
  return { corner, dx: Math.round(dx), dy: Math.round(dy), width: Math.round(r.w), height: Math.round(r.h) };
}

/** Back to a rect for this viewport, kept fully inside it; if it can't fit, push it into its corner. */
export function decode(s: SavedPos, vp: Viewport): Rect {
  const w = s.width;
  const h = s.height;
  let x = s.corner[1] === 'l' ? s.dx : vp.w - w - s.dx;
  let y = s.corner[0] === 't' ? vp.top + s.dy : vp.h - h - s.dy;
  x = clamp(x, 0, vp.w - w, s.corner[1] === 'l' ? 0 : vp.w - w);
  y = clamp(y, vp.top, vp.h - h, s.corner[0] === 't' ? vp.top : vp.h - h);
  return { x, y, w, h };
}

/** Clamp to [lo, hi]; when the range is empty (too big to fit), use the corner side. */
function clamp(v: number, lo: number, hi: number, whenTooBig: number): number {
  if (hi < lo) return whenTooBig;
  return Math.min(Math.max(v, lo), hi);
}

/** Resizing from a west/north edge must keep the opposite edge where it was. */
export function anchorResize(start: Rect, w: number, h: number, fromWest: boolean, fromNorth: boolean): Rect {
  return {
    x: fromWest ? start.x + start.w - w : start.x,
    y: fromNorth ? start.y + start.h - h : start.y,
    w,
    h,
  };
}
