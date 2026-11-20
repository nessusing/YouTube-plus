// Queue feature (design part 3), isolated world side.

import { initLang, t } from '@/core/i18n';
import { createLogger } from '@/core/log';
import { servePageChecks } from '@/core/page-checks';
import { getSettings, onSettingsChanged, type Settings } from '@/core/settings';
import type { Snapshot } from './core';
import { QUEUE_PAGE_CHECKS } from './consts';
import { LIST_KEY } from './keys';
import { playlistTools, restoreSnapshot } from './playlist-tools';
import { connect } from './rpc';
import { statusBadge } from './status-badge';
import { QueueSync } from './sync';

export async function startQueue(): Promise<void> {
  await initLang();
  const log = createLogger('queue');
  const bridge = connect();
  const badge = statusBadge();
  let settings: Settings = await getSettings();
  let sync: QueueSync | undefined;
  const tools = playlistTools(bridge.rpc, log);

  const loggedIn = async () => (await bridge.rpc.identity()).loggedIn;

  const on = async () => {
    if (sync) return;
    await bridge.ready;
    if (!(await loggedIn())) {
      log.debug('not signed in; queue sync off on this page');
      return;
    }
    sync = new QueueSync(bridge.rpc, log, badge, () => settings.queue.listName);
    tools.enable();
    void sync.start();
  };

  const off = () => {
    sync?.stop();
    sync = undefined;
    tools.disable();
    badge.hide();
  };

  bridge.onTap((endpoint, body) => sync?.onTap(endpoint, body));
  bridge.onPlayer((e) => sync?.onPlayer(e));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') sync?.onVisible();
  });

  servePageChecks('queue', {
    [QUEUE_PAGE_CHECKS[0]]: async () => {
      await bridge.ready;
      const h = await bridge.rpc.health();
      if (!h.app || !h.ytcfg) return { status: 'fail', detail: t('check.notFound', { x: !h.app ? 'ytd-app' : 'ytcfg' }) };
      const id = await bridge.rpc.identity();
      if (!id.loggedIn) return { status: 'fail', detail: t('check.queue.notLoggedIn') };
      await bridge.rpc.editablePlaylists();
      return { status: 'pass', detail: id.brand ? t('check.queue.brand') : undefined };
    },
    [QUEUE_PAGE_CHECKS[1]]: async () => {
      await bridge.ready;
      if (!(await loggedIn())) return { status: 'skip', detail: t('check.queue.notLoggedIn') };
      const s = new QueueSync(bridge.rpc, log, badge, () => settings.queue.listName);
      const id = await s.ensureList();
      const data = await bridge.rpc.readPlaylist(id);
      return data.editable
        ? { status: 'pass', detail: t('check.queue.listOk', { name: settings.queue.listName, n: data.items.length }) }
        : { status: 'fail', detail: t('check.queue.notEditable', { id }) };
    },
    [QUEUE_PAGE_CHECKS[2]]: async () => {
      const h = await bridge.rpc.health();
      return h.fetchTap ? { status: 'pass' } : { status: 'fail', detail: t('check.queue.noTap') };
    },
  });

  // Settings page asks a YouTube tab to restore the last snapshot (§25).
  browser.runtime.onMessage.addListener((msg: unknown, _s, sendResponse) => {
    const m = msg as { type?: string; snapshot?: Snapshot };
    if (m?.type !== 'YouTube+/queue-restore-snapshot' || !m.snapshot) return;
    restoreSnapshot(bridge.rpc, log, m.snapshot)
      .then((n) => sendResponse({ ok: true, restored: n }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  });

  const apply = (s: Settings) => {
    const nameChanged = s.queue.listName !== settings.queue.listName;
    settings = s;
    if (!s.features.queue) return off();
    if (nameChanged && sync) {
      // A new name means a different list (§24.1); start over with it.
      off();
      void browser.storage.sync.remove(LIST_KEY);
    }
    void on();
  };

  onSettingsChanged(apply);
  apply(settings);
}
