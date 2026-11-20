// Queue feature (design part 3), isolated world side.

import { initLang, t } from '@/core/i18n';
import { createLogger } from '@/core/log';
import { servePageChecks } from '@/core/page-checks';
import { featureOn, getSettings, onSettingsChanged, type Settings } from '@/core/settings';
import { QUEUE_PAGE_CHECKS } from './consts';
import { QueueController } from './controller';
import { isQueueRequest, type QueueRequest } from './messages';
import { playButton } from './play-button';
import { playlistTools, restoreSnapshot } from './playlist-tools';
import { connect } from './rpc';

export async function startQueue(): Promise<void> {
  await initLang();
  const log = createLogger('queue');
  const bridge = connect();
  const { rpc } = bridge;
  let settings: Settings = await getSettings();
  const ctl = new QueueController(
    rpc,
    log,
    () => featureOn(settings, 'queue'),
    playlistTools(rpc, log, () => ctl.me?.key),
    playButton(() => void ctl.play()),
  );

  bridge.onAdd((ids) => void ctl.onAdd(ids));
  bridge.onNativeAdd(() => ctl.onNativeAdd());
  bridge.onWarn((msg) => log.warn(msg));
  bridge.onPlayer((e) => ctl.onPlayer(e));

  servePageChecks('queue', {
    [QUEUE_PAGE_CHECKS[0]]: async () => {
      await bridge.ready;
      const h = await rpc.health();
      if (!h.app || !h.ytcfg) return { status: 'fail', detail: t('check.notFound', { x: !h.app ? 'ytd-app' : 'ytcfg' }) };
      const id = await rpc.identity();
      if (!id.loggedIn) return { status: 'fail', detail: t('check.queue.notLoggedIn') };
      const lists = await rpc.editablePlaylists();
      if (!lists.length) return { status: 'fail', detail: t('check.queue.noLists') };
      const who = id.name ? t('check.queue.as', { name: id.name }) : '';
      return { status: 'pass', detail: id.brand ? `${who} ${t('check.queue.brand')}`.trim() : who || undefined };
    },
    [QUEUE_PAGE_CHECKS[1]]: async () => {
      await bridge.ready;
      await ctl.refresh();
      const p = ctl.profile;
      if (!ctl.me?.loggedIn) return { status: 'skip', detail: t('check.queue.notLoggedIn') };
      if (p.mode !== 'playlist') return { status: 'skip', detail: t('check.queue.nativeMode') };
      if (!p.listId) return { status: 'fail', detail: t('check.queue.noList') };
      const data = await rpc.readPlaylist(p.listId);
      if (!data.exists) return { status: 'fail', detail: t('check.queue.gone', { id: p.listId }) };
      if (ctl.decision === 'notEditable') return { status: 'fail', detail: t('check.queue.notEditable', { id: p.listId }) };
      return { status: 'pass', detail: t('check.queue.listOk', { name: ctl.listName(), n: data.items.length }) };
    },
    [QUEUE_PAGE_CHECKS[2]]: async () => {
      await bridge.ready;
      const h = await rpc.health();
      return h.takeover ? { status: 'pass' } : { status: 'fail', detail: t('check.queue.noTakeover') };
    },
  });

  // The settings page works through this tab (design §27).
  const handle = async (m: QueueRequest): Promise<unknown> => {
    await bridge.ready;
    switch (m.op) {
      case 'whoami':
        return rpc.identity();
      case 'lists':
        return rpc.editablePlaylists();
      case 'create':
        return rpc.createPrivatePlaylist(m.title);
      case 'restore': {
        const me = await rpc.identity();
        if (me.key !== m.key) throw new Error(t('opt.queue.otherIdentity'));
        return restoreSnapshot(rpc, log, m.snapshot);
      }
    }
  };
  browser.runtime.onMessage.addListener((msg: unknown, _s, sendResponse) => {
    if (!isQueueRequest(msg)) return;
    handle(msg)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((e) => sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }));
    return true;
  });

  onSettingsChanged((s) => {
    const was = featureOn(settings, 'queue');
    settings = s;
    if (featureOn(s, 'queue') !== was) void ctl.refresh().catch((e) => log.error('refresh failed', e));
  });
  await bridge.ready;
  await ctl.refresh();
}
