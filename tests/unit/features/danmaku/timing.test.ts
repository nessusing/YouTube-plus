import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '@/features/danmaku/params';
import { displaySec, estimateLines, readingSec } from '@/features/danmaku/timing';

const P = DEFAULT_PARAMS.display; // 5 s screens, 0.068 / 0.2 s per char, min 1.5, line 50, CJK width 2

describe('estimateLines', () => {
  it('counts CJK as double width and each paragraph separately', () => {
    expect(estimateLines('x'.repeat(50), P)).toBe(1);
    expect(estimateLines('x'.repeat(51), P)).toBe(2);
    expect(estimateLines('字'.repeat(25), P)).toBe(1);
    expect(estimateLines('字'.repeat(26), P)).toBe(2);
    expect(estimateLines('a\n\nb', P)).toBe(3);
  });

  it('gives the handle room on the first line', () => {
    expect(estimateLines('x'.repeat(45), P)).toBe(1);
    expect(estimateLines('x'.repeat(45), P, '@someone ')).toBe(2);
  });
});

describe('readingSec', () => {
  it('charges per character by script, whitespace free', () => {
    expect(readingSec('ab cd', P)).toBeCloseTo(4 * 0.068);
    expect(readingSec('木蘭 ok', P)).toBeCloseTo(2 * 0.2 + 2 * 0.068);
  });
});

describe('displaySec', () => {
  it('is at least minSec', () => expect(displaySec('nice one!', P)).toBe(1.5));
  it('rounds reading time up to half seconds', () => expect(displaySec('x'.repeat(40), P)).toBe(3)); // 2.72 s
  it('reads CJK slower', () => expect(displaySec('字'.repeat(20), P)).toBe(4));
  it('caps two lines at one screen', () => expect(displaySec('字'.repeat(30), P)).toBe(5));
  it('gives longer comments a screen per two lines', () => {
    expect(displaySec('x'.repeat(160), P)).toBe(10); // 4 lines
    expect(displaySec('a\nb\nc', P)).toBe(10); // 3 lines → 2 screens
    expect(displaySec('x'.repeat(260), P)).toBe(15); // 6 lines
  });
});
