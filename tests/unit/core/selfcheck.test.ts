import { describe, expect, it, vi } from 'vitest';
import { setLang } from '@/core/i18n';
import type { Logger } from '@/core/log';
import { runChecks, type SelfCheck } from '@/core/selfcheck';

const log = (): Logger => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() });

describe('runChecks', () => {
  it('runs enabled features in order, skips disabled ones, and turns throws into failures', async () => {
    setLang('en');
    const order: string[] = [];
    const checks: SelfCheck[] = [
      { feature: 'core', name: 'check.storage', run: async () => (order.push('a'), { status: 'pass' }) },
      { feature: 'tldr', name: 'check.tldr.login', run: async () => (order.push('b'), { status: 'pass' }) },
      { feature: 'queue', name: 'check.queue.auth', run: async () => { order.push('c'); throw new Error('nope'); } },
    ];
    const l = log();
    const results = await runChecks(checks, (f) => f !== 'tldr', l);
    expect(order).toEqual(['a', 'c']);
    expect(results).toEqual([
      { feature: 'core', name: 'Local storage read/write', status: 'pass' },
      { feature: 'queue', name: 'Page objects and auth', status: 'fail', detail: 'nope' },
    ]);
    expect(l.info).toHaveBeenCalledTimes(1);
    expect(l.warn).toHaveBeenCalledTimes(1);
  });
});
