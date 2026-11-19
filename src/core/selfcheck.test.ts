import { describe, expect, it, vi } from 'vitest';
import type { Logger } from './log';
import { runChecks, type SelfCheck } from './selfcheck';

const log = (): Logger => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() });

describe('runChecks', () => {
  it('runs enabled features in order, skips disabled ones, and turns throws into failures', async () => {
    const order: string[] = [];
    const checks: SelfCheck[] = [
      { feature: 'core', name: 'a', run: async () => (order.push('a'), { status: 'pass' }) },
      { feature: 'tldr', name: 'b', run: async () => (order.push('b'), { status: 'pass' }) },
      { feature: 'queue', name: 'c', run: async () => { order.push('c'); throw new Error('nope'); } },
    ];
    const l = log();
    const results = await runChecks(checks, (f) => f !== 'tldr', l);
    expect(order).toEqual(['a', 'c']);
    expect(results).toEqual([
      { feature: 'core', name: 'a', status: 'pass' },
      { feature: 'queue', name: 'c', status: 'fail', detail: 'nope' },
    ]);
    expect(l.info).toHaveBeenCalledTimes(1);
    expect(l.warn).toHaveBeenCalledTimes(1);
  });
});
