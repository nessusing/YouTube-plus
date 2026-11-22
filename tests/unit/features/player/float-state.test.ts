import { describe, expect, it } from 'vitest';
import { decode } from '@/features/player/geometry';
import { BACK_TO_TOP_INSET, BACK_TO_TOP_SIZE, DEFAULT_FLOAT_POS, FLOAT_BAND, FLOAT_H, FLOAT_W, nextFloating, parseT } from '@/features/player/float-state';

describe('nextFloating', () => {
  const H = 600;

  it('floats once less than half of the player is on screen', () => {
    expect(nextFloating(false, H, H)).toBe(false);
    expect(nextFloating(false, H / 2, H)).toBe(false);
    expect(nextFloating(false, H / 2 - FLOAT_BAND + 1, H)).toBe(false);
    expect(nextFloating(false, H / 2 - FLOAT_BAND - 1, H)).toBe(true);
    expect(nextFloating(false, 0, H)).toBe(true);
    expect(nextFloating(false, -2000, H)).toBe(true);
  });

  it('comes back once more than half is on screen, with a band in between', () => {
    expect(nextFloating(true, H / 2, H)).toBe(true);
    expect(nextFloating(true, H / 2 + FLOAT_BAND - 1, H)).toBe(true);
    expect(nextFloating(true, H / 2 + FLOAT_BAND + 1, H)).toBe(false);
    expect(nextFloating(true, H, H)).toBe(false);
  });

  it('never floats a player with no height', () => {
    expect(nextFloating(false, -100, 0)).toBe(false);
    expect(nextFloating(true, -100, 0)).toBe(false);
  });
});

describe('DEFAULT_FLOAT_POS', () => {
  it('sits left of "back to top", bottoms aligned, at the official miniplayer size', () => {
    const r = decode(DEFAULT_FLOAT_POS, { w: 1400, h: 900, top: 56 });
    expect(r.w).toBe(FLOAT_W);
    expect(r.h).toBe(FLOAT_H);
    expect(r.y + r.h).toBe(900 - BACK_TO_TOP_INSET);
    expect(r.x + r.w).toBeLessThan(1400 - BACK_TO_TOP_INSET - BACK_TO_TOP_SIZE);
  });
});

describe('parseT', () => {
  it('parses the forms YouTube uses', () => {
    expect(parseT('90')).toBe(90);
    expect(parseT('90s')).toBe(90);
    expect(parseT('1m30s')).toBe(90);
    expect(parseT('1h2m3s')).toBe(3723);
    expect(parseT('2m')).toBe(120);
    expect(parseT('abc')).toBeUndefined();
    expect(parseT('')).toBeUndefined();
    expect(parseT(null)).toBeUndefined();
  });
});
