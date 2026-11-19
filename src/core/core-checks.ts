// Self-checks for the shared parts.

import { t } from './i18n';
import type { SelfCheck } from './selfcheck';

export const coreChecks: SelfCheck[] = [
  {
    feature: 'core',
    name: 'check.storage',
    async run() {
      const key = 'selfcheck-probe';
      const v = String(Math.random());
      await browser.storage.local.set({ [key]: v });
      const got = await browser.storage.local.get(key);
      await browser.storage.local.remove(key);
      return got[key] === v ? { status: 'pass' } : { status: 'fail', detail: t('check.storageMismatch') };
    },
  },
  {
    feature: 'core',
    name: 'check.ytTab',
    async run() {
      const tabs = await browser.tabs.query({ url: 'https://www.youtube.com/*' });
      return tabs.length > 0
        ? { status: 'pass', detail: t('check.ytTabCount', { n: tabs.length }) }
        : { status: 'skip', detail: t('check.noYtTab') };
    },
  },
];
