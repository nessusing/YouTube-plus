// Player feature (design part 4): wires the sub-features to settings.

import { initLang, t } from '@/core/i18n';
import type { Toggleable } from '@/core/dom';
import { createLogger } from '@/core/log';
import { servePageChecks } from '@/core/page-checks';
import { pipSupported, queryPlayerDom } from '@/core/pip-doc';
import { featureOn, getSettings, onSettingsChanged, type PlayerSettings, type Settings } from '@/core/settings';
import { backToTop } from './back-to-top';
import { loopButton } from './loop-button';
import { miniControls } from './mini-controls';
import { miniDrag } from './mini-drag';
import { miniMinimize } from './mini-minimize';
import { floatPlayer } from './float';
import { pip as pipPart } from './pip';
import { SEL } from './selectors';

import { PLAYER_PAGE_CHECKS } from './consts';

export async function startPlayer(): Promise<void> {
  // The back-to-top label is baked in when the button is built: rebuild it.
  await initLang(() => {
    loop.relabel();
    minimize.relabel();
    float.relabel();
    pip.relabel();
    if (!on.has('backToTop')) return;
    parts.backToTop.disable();
    parts.backToTop.enable();
  });
  const log = createLogger('player');
  const loop = loopButton();
  const minimize = miniMinimize(log);
  const float = floatPlayer(log);
  const pip = pipPart(log);
  const parts: Record<keyof PlayerSettings, Toggleable> = {
    miniControls: miniControls(),
    freeDrag: miniDrag(log),
    // Setting key kept from the sticky player it replaced (F-08).
    stickyPlayer: float,
    backToTop: backToTop(),
    loopButton: loop,
    miniMinimize: minimize,
    pip,
  };
  const on = new Set<keyof PlayerSettings>();

  const apply = (s: Settings) => {
    pip.setShortcut(s.shortcuts.pip);
    for (const k of Object.keys(parts) as (keyof PlayerSettings)[]) {
      const want = featureOn(s, 'player') && s.player[k];
      try {
        if (want && !on.has(k)) {
          parts[k].enable();
          on.add(k);
        } else if (!want && on.has(k)) {
          parts[k].disable();
          on.delete(k);
        }
      } catch (e) {
        log.error(`${k} ${want ? 'enable' : 'disable'} failed`, e);
      }
    }
  };

  servePageChecks('player', {
    [PLAYER_PAGE_CHECKS[0]]: () => {
      const missing = [SEL.moviePlayer, SEL.chromeBottom].filter((s) => !queryPlayerDom(s));
      return missing.length ? { status: 'fail', detail: t('check.player.barMissing', { x: missing.join(', ') }) } : { status: 'pass' };
    },
    [PLAYER_PAGE_CHECKS[3]]: () => (pipSupported() ? { status: 'pass' } : { status: 'warn', detail: t('check.player.pipMissing') }),
    [PLAYER_PAGE_CHECKS[1]]: () =>
      document.querySelector(SEL.miniplayer) && document.querySelector(SEL.app)
        ? { status: 'pass' }
        : { status: 'fail', detail: t('check.notFound', { x: SEL.miniplayer }) },
    [PLAYER_PAGE_CHECKS[2]]: () => {
      if (location.pathname !== '/watch') return { status: 'skip', detail: t('check.player.onWatch') };
      // The small window (F-08) floats this box; its parent holds the place in the page.
      const box = document.querySelector(SEL.floatBox);
      if (!box?.querySelector(SEL.moviePlayer)) return { status: 'fail', detail: t('check.notFound', { x: `${SEL.floatBox} ${SEL.moviePlayer}` }) };
      return { status: 'pass' };
    },
  });

  apply(await getSettings());
  onSettingsChanged((s) => apply(s));
  log.debug(`started on ${location.pathname}`);
}
