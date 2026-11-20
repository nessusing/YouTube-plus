import { describe, expect, it } from 'vitest';
import { parseT, SUPPRESS_MS, TheaterMachine } from '@/features/player/theater';

describe('TheaterMachine', () => {
  it('switches to normal on the first scroll down and back at the top', () => {
    const m = new TheaterMachine();
    expect(m.onScroll(0, true, 0)).toBe('none');
    expect(m.onScroll(30, true, 10)).toBe('toNormal');
    expect(m.onTheaterChanged(false, 30, 50)).toBe('none'); // ours
    expect(m.onScroll(400, false, 1000)).toBe('none');
    expect(m.onScroll(0, false, 2000)).toBe('toTheater');
    expect(m.onTheaterChanged(true, 0, 2050)).toBe('none');
    expect(m.autoSwitched).toBe(false);
  });

  it('ignores scroll events right after its own switch', () => {
    const m = new TheaterMachine();
    m.onScroll(30, true, 0);
    m.onTheaterChanged(false, 30, 10);
    expect(m.onScroll(0, false, 10 + SUPPRESS_MS - 1)).toBe('none');
    expect(m.onScroll(0, false, 10 + SUPPRESS_MS + 1)).toBe('toTheater');
  });

  it('does nothing while waiting for its own click to land', () => {
    const m = new TheaterMachine();
    m.onScroll(30, true, 0);
    expect(m.onScroll(0, true, 1000)).toBe('none');
  });

  it('never switches back after the user switched to normal themselves', () => {
    const m = new TheaterMachine();
    expect(m.onTheaterChanged(false, 0, 0)).toBe('none');
    expect(m.onScroll(0, false, 1000)).toBe('none');
  });

  it('clears the flag when the user switches mid-way', () => {
    const m = new TheaterMachine();
    m.onScroll(30, true, 0);
    m.onTheaterChanged(false, 30, 10);
    // user presses t while the player is stuck → go to top (§36.3)
    expect(m.onTheaterChanged(true, 900, 2000)).toBe('scrollTop');
    expect(m.autoSwitched).toBe(false);
    // then later at the top in theater, scrolling down auto switches again
    expect(m.onScroll(30, true, 3000)).toBe('toNormal');
  });

  it('starts over after reset', () => {
    const m = new TheaterMachine();
    m.onScroll(30, true, 0);
    m.reset();
    expect(m.onScroll(0, false, 10)).toBe('none');
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
