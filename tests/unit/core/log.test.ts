import { describe, expect, it } from 'vitest';
import { appendCapped, entrySize, formatEntry, stringifyArg, type LogEntry } from '@/core/log';

const e = (i: number, msg = `m${i}`): LogEntry => ({ t: i, feature: 'core', level: 'info', msg });

describe('appendCapped', () => {
  it('keeps everything under the cap', () => {
    expect(appendCapped([e(1)], [e(2)], 1e6).map((x) => x.t)).toEqual([1, 2]);
  });

  it('trims existing entries when the cap shrinks', () => {
    const out = appendCapped([e(1), e(2), e(3)], [], entrySize(e(1)) * 2);
    expect(out.map((x) => x.t)).toEqual([2, 3]);
  });

  it('drops the oldest past the byte cap', () => {
    const big = 'x'.repeat(100);
    const cap = entrySize(e(0, big)) * 2;
    const out = appendCapped([e(1, big), e(2, big)], [e(3, big)], cap);
    expect(out.map((x) => x.t)).toEqual([2, 3]);
  });

  it('can drop a single entry larger than the byte cap', () => {
    expect(appendCapped([], [e(1, 'x'.repeat(1000))], 10)).toEqual([]);
  });
});

describe('formatting', () => {
  it('formats a line with feature and level', () => {
    expect(formatEntry({ t: new Date(2026, 10, 18, 9, 5, 7, 3).getTime(), feature: 'queue', level: 'warn', msg: 'hi' }))
      .toBe('2026-11-18 09:05:07.003 [queue] WARN hi');
  });

  it('stringifies args', () => {
    expect(stringifyArg('a')).toBe('a');
    expect(stringifyArg({ a: 1 })).toBe('{"a":1}');
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(stringifyArg(cyclic)).toBe('[object Object]');
    expect(stringifyArg(new Error('boom'))).toContain('boom');
  });
});
