// Self-checks that need a YouTube page (F-01-AC6). The background side sends
// the check to an open YouTube tab; the feature's content script answers.

import { t, type MsgKey } from './i18n';
import type { FeatureId } from './settings';
import type { CheckOutcome, SelfCheck } from './selfcheck';

type PageCheckMsg = { type: 'YouTube+/page-check'; feature: FeatureId; name: MsgKey };

/** The YouTube tab used last (F-05 Q24): settings and checks act through it. */
export async function recentYouTubeTab(): Promise<Browser.tabs.Tab | undefined> {
  const tabs = await browser.tabs.query({ url: 'https://www.youtube.com/*' });
  return tabs.sort((a, b) => Number(b.active) - Number(a.active) || (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))[0];
}

/** Background: a SelfCheck that runs `name` inside a YouTube tab. */
export function pageCheck(feature: FeatureId, name: MsgKey): SelfCheck {
  return {
    feature,
    name,
    async run(): Promise<CheckOutcome> {
      const tab = await recentYouTubeTab();
      if (!tab?.id) return { status: 'skip', detail: t('check.needYtTab') };
      try {
        const res = (await browser.tabs.sendMessage(tab.id, { type: 'YouTube+/page-check', feature, name } satisfies PageCheckMsg, { frameId: 0 })) as CheckOutcome | undefined;
        return res ?? { status: 'fail', detail: t('check.noAnswer') };
      } catch {
        return { status: 'fail', detail: t('check.noScript') };
      }
    },
  };
}

/** Content script: answer page checks for this feature. */
export function servePageChecks(feature: FeatureId, checks: Partial<Record<MsgKey, () => CheckOutcome | Promise<CheckOutcome>>>): void {
  browser.runtime.onMessage.addListener((msg: unknown, _sender, sendResponse) => {
    const m = msg as PageCheckMsg;
    if (m?.type !== 'YouTube+/page-check' || m.feature !== feature) return;
    const check = checks[m.name];
    if (!check) return;
    Promise.resolve()
      .then(check)
      .catch((e): CheckOutcome => ({ status: 'fail', detail: String(e) }))
      .then(sendResponse);
    return true;
  });
}
