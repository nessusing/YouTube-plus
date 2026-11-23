import { describe, expect, it } from 'vitest';
import { categoryOf, formatBytes, groupKeys } from '@/core/storage-usage';

describe('storage categories', () => {
  it('F-01-AC5 assigns keys to categories', () => {
    expect(categoryOf('log')).toBe('log');
    expect(categoryOf('tldr/cache/abc')).toBe('tldrCache');
    expect(categoryOf('danmaku/cache/abc')).toBe('danmakuCache');
    expect(categoryOf('queue/outbox')).toBe('other');
    expect(groupKeys(['log', 'tldr/cache/a', 'tldr/cache/b', 'danmaku/cache/c', 'x'])).toEqual({
      log: ['log'], tldrCache: ['tldr/cache/a', 'tldr/cache/b'], danmakuCache: ['danmaku/cache/c'], other: ['x'],
    });
  });

  it('F-01-AC5 formats sizes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.00 MB');
  });
});
