// Player feature (design part 4): wires the four sub-features to settings.

import { initLang, t } from '@/core/i18n';
import type { Toggleable } from '@/core/dom';
import { createLogger } from '@/core/log';
import { servePageChecks } from '@/core/page-checks';
import { featureOn, getSettings, onSettingsChanged, type PlayerSettings, type Settings } from '@/core/settings';
import { backToTop } from './back-to-top';
import { miniControls } from './mini-controls';
import { miniDrag } from './mini-drag';
import { SEL, THEATER_COOKIE } from './selectors';
import { stickyPlayer } from './sticky';

import { PLAYER_PAGE_CHECKS } from './consts';

export async function startPlayer(): Promise<void> {
  // The back-to-top label is baked in when the button is built: rebuild it.
  await initLang(() => {
    if (!on.has('backToTop')) return;
    parts.backToTop.disable();
    parts.backToTop.enable();
  });
  const log = createLogger('player');
  const parts: Record<keyof PlayerSettings, Toggleable> = {
    miniControls: miniControls(),
    freeDrag: miniDrag(log),
    stickyPlayer: stickyPlayer(log),
    backToTop: backToTop(),
  };
  const on = new Set<keyof PlayerSettings>();

  const apply = (s: Settings) => {
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
      const missing = [SEL.moviePlayer, SEL.chromeBottom].filter((s) => !document.querySelector(s));
      return missing.length ? { status: 'fail', detail: t('check.player.barMissing', { x: missing.join(', ') }) } : { status: 'pass' };
    },
    [PLAYER_PAGE_CHECKS[1]]: () =>
      document.querySelector(SEL.miniplayer) && document.querySelector(SEL.app)
        ? { status: 'pass' }
        : { status: 'fail', detail: t('check.notFound', { x: SEL.miniplayer }) },
    [PLAYER_PAGE_CHECKS[2]]: () => {
      if (location.pathname !== '/watch') return { status: 'skip', detail: t('check.player.onWatch') };
      if (!document.querySelector(SEL.sizeButton)) return { status: 'fail', detail: t('check.notFound', { x: SEL.sizeButton }) };
      if (!document.querySelector(`${SEL.watchFlexy}`)) return { status: 'fail', detail: t('check.notFound', { x: SEL.watchFlexy }) };
      const pref = document.cookie.split('; ').some((c) => c.startsWith(`${THEATER_COOKIE}=`));
      return { status: 'pass', detail: pref ? undefined : t('check.player.noCookie', { c: THEATER_COOKIE }) };
    },
  });

  apply(await getSettings());
  onSettingsChanged((s) => apply(s));
  log.debug(`started on ${location.pathname}`);
}
