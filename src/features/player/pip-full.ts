// Full screen from the PiP window (§50). Chrome allows no full screen in a
// Document PiP window, and a click there does not count as one in the tab, so
// the tab cannot ask for it either (both tried, 2026-11-22). Instead: back to
// the tab, the browser window full screen (as F11, through the background,
// which needs no click), the watch page with the player covering it all.
// Esc, f, the full screen button, a double click on the video or F11 leave:
// the window goes back to how it was and pip.ts pops out again (`back`).

import { injectStyle } from '@/core/dom';
import type { Logger } from '@/core/log';
import { SEL } from './selectors';

const ATTR = 'data-ytpp-full';
/** How long YouTube may take to expand the miniplayer to the watch page. */
const EXPAND_WAIT_MS = 5000;

/** Above the masthead (2020), the guide drawer and the miniplayer (2030), and our small window's parent (2019). */
const CSS = `
html[${ATTR}], html[${ATTR}] body { overflow: hidden !important; }
html[${ATTR}] ${SEL.floatBox} {
  position: fixed !important; inset: 0 !important;
  width: 100vw !important; height: 100vh !important; max-width: none !important; max-height: none !important;
  z-index: 2100 !important; background: #000; border-radius: 0 !important; box-shadow: none !important;
}
html[${ATTR}] ${SEL.floatPlace} { z-index: 2100 !important; }
`;

export interface PipFull {
  /** From the PiP window, already closed back into the miniplayer: go full screen in the tab. */
  enter(): Promise<void>;
  /** Leave: CSS off, the window back as it was. The player stays on the watch page. */
  exit(why: string): void;
  readonly active: boolean;
}

/** A double click on the picture (not the control bar, a button or a menu) means full screen in YouTube. */
export function isPictureDblClick(e: Event): boolean {
  const t = e.target as Element | null;
  return !!t?.closest?.(SEL.moviePlayer) && !t.closest('.ytp-chrome-bottom, .ytp-chrome-top, button, a, .ytp-popup, .ytp-settings-menu, .ytp-ad-module');
}

export function isFullscreenButton(e: Event): boolean {
  return !!(e.target as Element | null)?.closest?.('.ytp-fullscreen-button');
}

/** `back`: the user left; called while still on, so a key or click still counts as theirs. */
export function pipFull(log: Logger, back: (why: string) => void): PipFull {
  const html = document.documentElement;
  let active = false;
  let removeStyle: (() => void) | undefined;
  const fullMq = window.matchMedia('(display-mode: fullscreen)');

  const windowFull = (on: boolean) => browser.runtime.sendMessage({ type: 'YouTube+/window-fullscreen', on }).catch(() => {});
  const refit = () => {
    // YouTube lays the player out for its new box on a window resize (§49).
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
    setTimeout(() => window.dispatchEvent(new Event('resize')), 400);
  };
  const waitFor = (ok: () => boolean, ms: number) =>
    new Promise<boolean>((resolve) => {
      const t0 = Date.now();
      const tick = () => {
        if (ok()) resolve(true);
        else if (Date.now() - t0 > ms) resolve(false);
        else setTimeout(tick, 50);
      };
      tick();
    });
  const onWatch = () => location.pathname === '/watch'
    && !document.querySelector(SEL.app)?.hasAttribute(SEL.appMiniActiveAttr)
    && !!document.querySelector(`${SEL.floatBox} ${SEL.moviePlayer}`);

  const stop = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.code === 'Escape' || (e.code === 'KeyF' && !e.shiftKey)) {
      stop(e);
      back(e.code === 'Escape' ? 'Esc' : 'f');
    }
  };
  const onClick = (e: Event) => {
    if (!isFullscreenButton(e)) return;
    stop(e);
    back('full screen button');
  };
  const onDblClick = (e: Event) => {
    if (!isPictureDblClick(e)) return;
    stop(e);
    back('double click');
  };
  /** F11, or anything else that took the window out of full screen. */
  const onDisplayMode = () => {
    if (active && !fullMq.matches) back('window left full screen');
  };
  const onNavigate = () => exit('navigated');

  const listen = (on: boolean) => {
    const m = on ? 'addEventListener' : 'removeEventListener';
    document[m]('keydown', onKey as EventListener, true);
    document[m]('click', onClick, true);
    document[m]('dblclick', onDblClick, true);
    document[m]('yt-navigate-start', onNavigate);
    fullMq[m]('change', onDisplayMode);
  };

  const exit = (why: string) => {
    if (!active) return;
    active = false;
    listen(false);
    html.removeAttribute(ATTR);
    removeStyle?.();
    void windowFull(false);
    refit();
    log.info(`full screen off (${why})`);
  };

  const enter = async () => {
    if (active) return;
    active = true;
    removeStyle = injectStyle('ytpp-pip-full', CSS);
    html.setAttribute(ATTR, '');
    void windowFull(true);
    document.querySelector<HTMLElement>(SEL.miniExpand)?.click();
    if (!(await waitFor(onWatch, EXPAND_WAIT_MS))) {
      log.warn('full screen: the miniplayer did not expand');
      exit('no watch page');
      return;
    }
    if (!active) return;
    window.scrollTo(0, 0);
    listen(true);
    refit();
    log.info('full screen on');
  };

  return {
    enter,
    exit,
    get active() {
      return active;
    },
  };
}
