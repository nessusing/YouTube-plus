// Self-checks for the shared parts.

import type { SelfCheck } from './selfcheck';

export const coreChecks: SelfCheck[] = [
  {
    feature: 'core',
    name: '本地存储可读写',
    async run() {
      const key = 'selfcheck-probe';
      const v = String(Math.random());
      await browser.storage.local.set({ [key]: v });
      const got = await browser.storage.local.get(key);
      await browser.storage.local.remove(key);
      return got[key] === v ? { status: 'pass' } : { status: 'fail', detail: '写入后读回的值不一致' };
    },
  },
  {
    feature: 'core',
    name: '有打开的 YouTube 标签页',
    async run() {
      const tabs = await browser.tabs.query({ url: 'https://www.youtube.com/*' });
      return tabs.length > 0
        ? { status: 'pass', detail: `${tabs.length} 个` }
        : { status: 'skip', detail: '没有打开的 YouTube 标签页；队列和播放器的自检会跳过，打开一个后再重跑' };
    },
  },
];
