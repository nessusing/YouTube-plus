// Comment danmaku on the watch page (§51): the player button, the layer
// over the player and one Session per video. Nothing runs while the feature
// is off; while the button is off nothing is fetched and Gemini is not asked.

import { initLang, t, type MsgKey } from '@/core/i18n';
import { createLogger } from '@/core/log';
import { servePageChecks } from '@/core/page-checks';
import { featureOn, getSettings, onSettingsChanged, saveSettings, type Settings } from '@/core/settings';
import type { AskResult } from '@/features/tldr/service';
import type { VideoInfo } from './bridge';
import { danmakuButton, type ButtonLook } from './button';
import { DanmakuCache } from './cache';
import { CHECK_VIDEO_ID, DANMAKU_PAGE_CHECKS } from './consts';
import { overlay as makeOverlay } from './overlay';
import { connectMain } from './rpc';
import { Session } from './session';

const sec = (ms?: number) => (ms === undefined ? '–' : (ms / 1000).toFixed(1));

/** What the button's tooltip says (first line = its label). */
function tipOf(s: Settings, session: Session | undefined, unsupported: MsgKey | undefined): string {
  const on = s.danmaku.active;
  const lines = [t(on ? 'dm.tip.on' : 'dm.tip.off')];
  if (!on) return lines.join('\n');
  if (unsupported) return [...lines, t(unsupported)].join('\n');
  if (!session) return lines.join('\n');
  if (session.phase === 'none') lines.push(t('dm.tip.none'));
  else if (session.phase === 'error') lines.push(t('dm.tip.error', { e: session.error }));
  else if (session.phase === 'fetching' && !session.slots.length) lines.push(t('dm.tip.fetching', { n: session.comments.length }));
  else {
    const m = session.mode();
    lines.push(t('dm.tip.ready', { n: session.comments.length, k: session.slots.length, mode: t(`dm.mode.${m.mode}` as MsgKey) }));
    if (!session.complete) lines.push(t('dm.tip.fetching', { n: session.comments.length }));
    if (session.aiPending) lines.push(t('dm.tip.placing', { n: session.aiPending }));
    if (m.fallback) lines.push(t(`dm.tip.fallback.${s.danmaku.params.ai.fallback}` as MsgKey, { why: t(`dm.why.${m.fallback}` as MsgKey) }));
  }
  if (s.danmaku.debug) {
    const tm = session.timing;
    lines.push(t('dm.tip.timing', {
      f: tm.cached ? t('dm.tip.cached') : sec(tm.fetchMs), p: tm.pages, a: sec(tm.firstAiMs), b: sec(tm.aiMs),
      x: tm.batches.map((b) => sec(b)).join(' / ') || '–',
    }));
  }
  return lines.join('\n');
}

export async function startDanmaku(): Promise<void> {
  const log = createLogger('danmaku');
  let settings = await getSettings();
  const rpc = connectMain();
  const cache = new DanmakuCache(() => settings.danmaku.params.cache.mb * 1024 * 1024);
  const layer = makeOverlay();
  let session: Session | undefined;
  /** Why the current video gets nothing (live). */
  let unsupported: MsgKey | undefined;
  let enabled = false;
  /** Bumped on every navigation, so a slow lookup for the last video gives up. */
  let gen = 0;

  const render = () => {
    const look: ButtonLook = {
      on: settings.danmaku.active,
      busy: !!session && ((session.phase === 'fetching') || !session.complete || session.aiPending > 0),
      dim: !!unsupported || session?.phase === 'none',
      tip: tipOf(settings, session, unsupported),
    };
    button.set(look);
  };
  const button = danmakuButton(() => {
    void getSettings().then((s) => {
      s.danmaku.active = !s.danmaku.active;
      return saveSettings(s);
    }).catch((e) => log.error('saving the button state failed', e));
  });
  await initLang(render);

  const ask = (videoId: string, prompt: string) => browser.runtime.sendMessage({ type: 'YouTube+/dm-ask', videoId, prompt }) as Promise<AskResult>;
  const deps = {
    rpc, cache, log, ask,
    settings: () => settings,
    changed: (s: Session) => {
      if (s !== session) return;
      layer.setSlots(s.videoId, s.slots);
      render();
    },
  };

  const stopSession = () => {
    session?.stop();
    session = undefined;
    unsupported = undefined;
    layer.setSlots('', []);
  };

  /** The player's video once it is the one in the URL (the page may still be switching). */
  const videoInfo = async (videoId: string, my: number): Promise<VideoInfo | undefined> => {
    for (let i = 0; i < 40 && my === gen; i++) {
      const v = await rpc.video().catch(() => undefined);
      if (v?.videoId === videoId && v.duration > 0) return v;
      await new Promise((r) => setTimeout(r, 250));
    }
    return undefined;
  };

  /** Follow the watch page's video. Elsewhere (miniplayer) the session carries on. */
  const sync = async () => {
    if (!enabled || !settings.danmaku.active || location.pathname !== '/watch') return;
    const v = new URLSearchParams(location.search).get('v');
    if (!v || session?.videoId === v) return;
    stopSession();
    const my = ++gen;
    render();
    const info = await videoInfo(v, my);
    if (my !== gen || !enabled || !settings.danmaku.active) return;
    if (!info) {
      log.warn(`${v}: the player did not report this video`);
      return;
    }
    if (info.live) {
      unsupported = 'dm.tip.live';
      render();
      return;
    }
    session = new Session(info, deps);
    render();
    session.run().catch((e) => log.error(`${v}: failed`, e));
  };
  const onNavigate = () => void sync();

  const apply = (next: Settings) => {
    const prev = settings;
    settings = next;
    const want = featureOn(next, 'danmaku');
    if (want && !enabled) {
      enabled = true;
      button.enable();
      layer.enable();
      document.addEventListener('yt-navigate-finish', onNavigate);
    } else if (!want && enabled) {
      enabled = false;
      gen++;
      stopSession();
      document.removeEventListener('yt-navigate-finish', onNavigate);
      button.disable();
      layer.disable();
      return;
    }
    if (!enabled) return;
    layer.setDisplay(next.danmaku.params.display, next.danmaku.debug);
    if (!next.danmaku.active) {
      gen++;
      stopSession();
    } else if (session && (prev.danmaku.placement !== next.danmaku.placement || JSON.stringify(prev.danmaku.params) !== JSON.stringify(next.danmaku.params))) {
      session.settingsChanged();
    }
    render();
    void sync();
  };

  servePageChecks('danmaku', {
    [DANMAKU_PAGE_CHECKS[0]]: async () => {
      const w = await rpc.watch(CHECK_VIDEO_ID);
      if (!w.token) return { status: 'fail', detail: t('check.dm.noToken') };
      const page = await rpc.page(w.token, CHECK_VIDEO_ID);
      if (!page.comments.length) return { status: 'fail', detail: t('check.dm.noComments') };
      return { status: 'pass', detail: t('check.dm.got', { n: page.comments.length }) };
    },
  });

  apply(settings);
  onSettingsChanged(apply);
  log.debug(`started on ${location.pathname}`);
}
