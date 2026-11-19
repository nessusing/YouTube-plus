import { describe, expect, it } from 'vitest';
import { anchorResize, decode, encode, nearestCorner, snap, type Rect } from './geometry';

const vp = { w: 1000, h: 800, top: 56 };
const r = (x: number, y: number, w = 400, h = 376): Rect => ({ x, y, w, h });

describe('snap', () => {
  it('leaves a window in the middle alone', () => {
    expect(snap(r(300, 200), vp)).toEqual(r(300, 200));
  });
  it('snaps to a close edge', () => {
    expect(snap(r(10, 200), vp)).toEqual(r(16, 200));
    expect(snap(r(590, 200), vp)).toEqual(r(584, 200)); // 10 px from the right
  });
  it('snaps into a corner when close to two edges', () => {
    expect(snap(r(5, 60), vp)).toEqual(r(16, 72));
    expect(snap(r(595, 420), vp)).toEqual(r(584, 408));
  });
  it('treats the masthead as the top edge', () => {
    expect(snap(r(300, 70), vp).y).toBe(72);
    expect(snap(r(300, 100), vp).y).toBe(100);
  });
});

describe('encode / decode', () => {
  it('picks the corner nearest the window centre', () => {
    expect(nearestCorner(r(16, 72), vp)).toBe('tl');
    expect(nearestCorner(r(584, 408), vp)).toBe('br');
    expect(nearestCorner(r(584, 72), vp)).toBe('tr');
    expect(nearestCorner(r(16, 408), vp)).toBe('bl');
  });
  it('round-trips in the same viewport', () => {
    for (const rect of [r(16, 72), r(584, 408), r(300, 200), r(584, 72, 320, 300)]) {
      expect(decode(encode(rect, vp), vp)).toEqual(rect);
    }
  });
  it('keeps the distance from its corner when the window grows', () => {
    const s = encode(r(584, 408), vp); // br, 16/16
    expect(s).toMatchObject({ corner: 'br', dx: 16, dy: 16 });
    expect(decode(s, { w: 1600, h: 1000, top: 56 })).toEqual(r(1184, 608));
  });
  it('stays inside a smaller viewport', () => {
    const s = encode(r(300, 300), vp);
    const out = decode(s, { w: 500, h: 500, top: 56 });
    expect(out.x).toBeGreaterThanOrEqual(0);
    expect(out.x + out.w).toBeLessThanOrEqual(500);
    expect(out.y).toBeGreaterThanOrEqual(56);
    expect(out.y + out.h).toBeLessThanOrEqual(500);
  });
  it('pushes into its corner when it cannot fit', () => {
    const s = encode(r(584, 408), vp); // br
    expect(decode(s, { w: 300, h: 300, top: 56 })).toEqual({ x: -100, y: -76, w: 400, h: 376 });
  });
});

describe('anchorResize', () => {
  it('keeps the east/south edges fixed when resizing from west/north', () => {
    expect(anchorResize(r(100, 100), 500, 470, true, true)).toEqual(r(0, 6, 500, 470));
    expect(anchorResize(r(100, 100), 500, 470, false, false)).toEqual(r(100, 100, 500, 470));
  });
});
