import { coreChecks } from '@/core/core-checks';
import { pageCheck } from '@/core/page-checks';
import { PLAYER_PAGE_CHECKS } from '@/features/player/consts';
import { createLogger, setLogSink } from '@/core/log';
import { LogStore } from '@/core/log-store';
import { isMessage, type SelfCheckResponse } from '@/core/messages';
import { runChecks, type SelfCheck } from '@/core/selfcheck';
import { getSettings, onSettingsChanged } from '@/core/settings';

export default defineBackground(() => {
  const store = new LogStore(async () => (await getSettings()).storage.logMB * 1024 * 1024);
  setLogSink((entries) => store.add(entries));
  onSettingsChanged(() => void store.trim());
  const log = createLogger('core');

  // Features append their checks here as they land.
  const checks: SelfCheck[] = [...coreChecks, ...PLAYER_PAGE_CHECKS.map((n) => pageCheck('player', n))];

  browser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!isMessage(msg)) return;
    switch (msg.type) {
      case 'yt++/log':
        store.add(msg.entries);
        return;
      case 'yt++/log-clear':
        store.clear().then(() => sendResponse({}));
        return true;
      case 'yt++/selfcheck':
        getSettings()
          .then((s) => runChecks(checks, (f) => f === 'core' || s.features[f], log))
          .then((results) => sendResponse({ results } satisfies SelfCheckResponse));
        return true;
    }
  });

  browser.runtime.onInstalled.addListener(({ reason }) => {
    log.info(`installed (${reason}), version ${browser.runtime.getManifest().version}`);
    if (reason === 'install') {
      // The options page runs the full self-check when opened with #install.
      void browser.tabs.create({ url: browser.runtime.getURL('/options.html#install') });
    }
  });
});
