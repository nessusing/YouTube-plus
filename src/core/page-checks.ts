// Self-checks that need a YouTube page (design §5). The background side sends
// the check to an open YouTube tab; the feature's content script answers.

import type { FeatureId } from './settings';
import type { CheckOutcome, SelfCheck } from './selfcheck';

type PageCheckMsg = { type: 'yt++/page-check'; feature: FeatureId; name: string };

/** Background: a SelfCheck that runs `name` inside a YouTube tab. */
export function pageCheck(feature: FeatureId, name: string): SelfCheck {
  return {
    feature,
    name,
    async run(): Promise<CheckOutcome> {
      const tabs = await browser.tabs.query({ url: 'https://www.youtube.com/*' });
      const tab = tabs.find((t) => t.active) ?? tabs[0];
      if (!tab?.id) return { status: 'skip', detail: '需要一个打开着的 YouTube 标签页' };
      try {
        const res = (await browser.tabs.sendMessage(tab.id, { type: 'yt++/page-check', feature, name } satisfies PageCheckMsg, { frameId: 0 })) as CheckOutcome | undefined;
        return res ?? { status: 'fail', detail: '标签页里的脚本没有回应；刷新 YouTube 标签页后重试' };
      } catch {
        return { status: 'fail', detail: '标签页里没有 yt++ 的脚本（扩展装上或更新之前打开的）；刷新 YouTube 标签页后重试' };
      }
    },
  };
}

/** Content script: answer page checks for this feature. */
export function servePageChecks(feature: FeatureId, checks: Record<string, () => CheckOutcome | Promise<CheckOutcome>>): void {
  browser.runtime.onMessage.addListener((msg: unknown, _sender, sendResponse) => {
    const m = msg as PageCheckMsg;
    if (m?.type !== 'yt++/page-check' || m.feature !== feature) return;
    const check = checks[m.name];
    if (!check) return;
    Promise.resolve()
      .then(check)
      .catch((e): CheckOutcome => ({ status: 'fail', detail: String(e) }))
      .then(sendResponse);
    return true;
  });
}
