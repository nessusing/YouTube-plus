import { coreChecks } from '@/core/core-checks';
import { initLang } from '@/core/i18n';
import { pageCheck } from '@/core/page-checks';
import { PLAYER_PAGE_CHECKS } from '@/features/player/consts';
import { QUEUE_PAGE_CHECKS } from '@/features/queue/consts';
import { removeLegacyKeys } from '@/features/queue/profiles';
import { createLogger, setLogSink } from '@/core/log';
import { LogStore } from '@/core/log-store';
import { isMessage, type SelfCheckResponse } from '@/core/messages';
import { runChecks, type SelfCheck } from '@/core/selfcheck';
import { featureOn, getSettings, onSettingsChanged, withDefaults, type Settings } from '@/core/settings';
import { tldrChecks } from '@/features/tldr/checks';
import { installHeaderRule } from '@/features/tldr/client';
import { TldrService } from '@/features/tldr/service';

export default defineBackground(() => {
  const store = new LogStore(async () => (await getSettings()).storage.logMB * 1024 * 1024);
  setLogSink((entries) => store.add(entries));
  void initLang();

  // Settings cached for synchronous use by the TL;DR service.
  let settings: Settings = withDefaults(undefined);
  void getSettings().then((s) => (settings = s));
  // Toolbar icon: color while the master switch is on, gray while off (design §2).
  // Set on every wake, since Chrome forgets setIcon across restarts.
  const showEnabled = (on: boolean) => {
    const sizes = [16, 32, 48, 128];
    const path = Object.fromEntries(sizes.map((n) => [n, `/icon/${on ? '' : 'gray-'}${n}.png`]));
    browser.action.setIcon({ path }).catch((e) => createLogger('core').warn('setIcon failed', e));
  };
  void getSettings().then((s) => showEnabled(s.enabled));
  browser.action.onClicked.addListener(() => void browser.runtime.openOptionsPage());
  const tldr = new TldrService(() => settings, createLogger('tldr'));
  onSettingsChanged((s) => {
    const limitChanged = s.storage.tldrCacheMB !== settings.storage.tldrCacheMB;
    const accountChanged = s.tldr.account !== settings.tldr.account;
    showEnabled(s.enabled);
    settings = s;
    void store.trim();
    if (limitChanged) void tldr.cache.trim();
    if (accountChanged) tldr.accountChanged();
  });
  // Coming back from signing in: check again without waiting for a click (design §15.1).
  browser.tabs.onUpdated.addListener((_id, info, tab) => {
    if (info.status !== 'complete' || !featureOn(settings, 'tldr')) return;
    if (/^https:\/\/(gemini|accounts)\.google\.com\//.test(tab.url ?? '')) tldr.onGeminiPage();
  });
  installHeaderRule().catch((e) => createLogger('tldr').error('header rule failed', e));
  browser.runtime.onConnect.addListener((port) => {
    if (featureOn(settings, 'tldr')) tldr.attach(port);
  });
  const log = createLogger('core');

  // Features append their checks here as they land.
  const checks: SelfCheck[] = [
    ...coreChecks,
    ...tldrChecks(tldr),
    ...QUEUE_PAGE_CHECKS.map((n) => pageCheck('queue', n)),
    ...PLAYER_PAGE_CHECKS.map((n) => pageCheck('player', n)),
  ];

  browser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!isMessage(msg)) return;
    switch (msg.type) {
      case 'YouTube+/tldr-status':
        tldr.status().then(sendResponse);
        return true;
      case 'YouTube+/tldr-resume':
        tldr.resume().then(() => sendResponse({}));
        return true;
      case 'YouTube+/tldr-signin':
        tldr.openSignin().then(() => sendResponse({}));
        return true;
      case 'YouTube+/tldr-recheck':
        tldr.probe().then((gemini) => sendResponse({ gemini }));
        return true;
      case 'YouTube+/open-options':
        void browser.tabs.create({ url: browser.runtime.getURL(`/options.html#${msg.hash ?? ''}`) });
        return;
      case 'YouTube+/log':
        store.add(msg.entries);
        return;
      case 'YouTube+/log-clear':
        store.clear().then(() => sendResponse({}));
        return true;
      case 'YouTube+/selfcheck':
        getSettings()
          .then((s) => runChecks(checks, (f) => f === 'core' || featureOn(s, f), log))
          .then((results) => sendResponse({ results } satisfies SelfCheckResponse));
        return true;
    }
  });

  browser.runtime.onInstalled.addListener(({ reason }) => {
    log.info(`installed (${reason}), version ${browser.runtime.getManifest().version}`);
    // The old queue sync's leftovers (design §29 step 1); harmless when absent.
    if (reason === 'update') removeLegacyKeys().catch((e) => createLogger('queue').warn('removing old queue keys failed', e));
    if (reason === 'install') {
      // The options page runs the full self-check when opened with #install.
      void browser.tabs.create({ url: browser.runtime.getURL('/options.html#install') });
    }
  });
});
