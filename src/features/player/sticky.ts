// Watch page: sticky player in normal mode (§36.1), theater auto switching
// (§36.2), t / size button while stuck (§36.3), timestamps without scrolling
// (§36.4).
//
// Findings (2026-11-18): position: sticky on #primary-inner > #player works
// with no placeholder and no ancestor clips; #primary-inner only spans the
// whole left column once we give it min-height: 100% (see CSS). The theater preference is the `wide` cookie; the size button
// flips the layout and the cookie, and writing the cookie back afterwards
// keeps the preference. The official timestamp click seeks at once and smooth-
// scrolls to the top ~0.8 s later; a capture-phase click handler that sets
// video.currentTime skips the scroll.
// Timing of a size-button click: ~40-75 ms later the theater attribute flips
// and the cookie is written; ~70 ms after that YouTube scrolls to y=0. So we
// fix the cookie and the scroll only after our own switch has landed.

import { injectStyle, type Toggleable } from '@/core/dom';
import type { Logger } from '@/core/log';
import { SEL, THEATER_COOKIE } from './selectors';
import { parseT, TheaterMachine, type TheaterAction } from './theater';

const CSS = `
html[data-ytpp-sticky] ${SEL.watchFlexy}:not([theater]):not([fullscreen]) ${SEL.stickyTarget} {
  position: sticky;
  top: var(--ytpp-masthead, 56px);
  z-index: 1000;
  background: var(--yt-spec-base-background, #0f0f0f);
}
/* #primary stretches to the page height (the right column is usually longer),
   but #primary-inner ends with the comments, and sticky can't leave its parent.
   Stretch it so the player stays up as long as the page scrolls (2026-11-18). */
html[data-ytpp-sticky] ${SEL.watchFlexy}:not([theater]):not([fullscreen]) #primary-inner {
  min-height: 100%;
  box-sizing: border-box;
}
`;

function readCookie(name: string): string | undefined {
  return document.cookie.split('; ').find((c) => c.startsWith(`${name}=`))?.slice(name.length + 1);
}

function writeCookie(name: string, value: string): void {
  document.cookie = `${name}=${value}; domain=.youtube.com; path=/; max-age=${60 * 60 * 24 * 365 * 2}; secure`;
}

const isWatch = () => location.pathname === '/watch';

export function stickyPlayer(log: Logger): Toggleable {
  const machine = new TheaterMachine();
  const html = document.documentElement;
  let removeStyle: (() => void) | undefined;
  let flexyObserver: MutationObserver | undefined;
  let lastTheater: boolean | undefined;
  /** Our own switch in flight: the preference to put back and where the user was. */
  let pending: { pref: string | undefined; y: number } | undefined;

  const flexy = () => document.querySelector<HTMLElement>(SEL.watchFlexy);
  const theater = () => !!flexy()?.hasAttribute('theater');
  const fullscreen = () => !!flexy()?.hasAttribute('fullscreen') || !!document.fullscreenElement;

  /** Switch layout without touching the saved preference. */
  const toggleKeepingPref = () => {
    const btn = document.querySelector<HTMLElement>(SEL.sizeButton);
    if (!btn) {
      log.warn('theater switch: size button not found');
      machine.abort();
      return;
    }
    pending = { pref: readCookie(THEATER_COOKIE), y: window.scrollY };
    btn.click();
  };

  /** Our switch landed: restore the preference and undo YouTube's jump to the top. */
  const afterOwnSwitch = (p: NonNullable<typeof pending>) => {
    const fixCookie = () => {
      if (p.pref !== undefined && readCookie(THEATER_COOKIE) !== p.pref) writeCookie(THEATER_COOKIE, p.pref);
    };
    fixCookie();
    setTimeout(fixCookie, 300);
    setTimeout(fixCookie, 1500);
    if (p.y <= 0) return;
    const undoJump = () => {
      if (window.scrollY < p.y / 2) window.scrollTo({ top: p.y, behavior: 'instant' });
    };
    window.addEventListener('scroll', undoJump, { passive: true });
    setTimeout(() => window.removeEventListener('scroll', undoJump), 600);
  };

  const perform = (a: TheaterAction) => {
    switch (a) {
      case 'toNormal':
      case 'toTheater':
        log.debug(`theater auto switch: ${a}`);
        toggleKeepingPref();
        break;
      case 'scrollTop':
        window.scrollTo({ top: 0, behavior: 'instant' });
        break;
    }
  };

  const onScroll = () => {
    if (!isWatch() || fullscreen()) return;
    perform(machine.onScroll(window.scrollY, theater(), performance.now()));
  };

  const watchFlexy = () => {
    const f = flexy();
    if (!f || flexyObserver) return;
    lastTheater = theater();
    flexyObserver = new MutationObserver(() => {
      const t = theater();
      if (t === lastTheater) return;
      lastTheater = t;
      const p = pending;
      pending = undefined;
      const action = machine.onTheaterChanged(t, window.scrollY, performance.now());
      if (p && action === 'none') afterOwnSwitch(p);
      perform(action);
    });
    flexyObserver.observe(f, { attributes: true, attributeFilter: ['theater'] });
  };

  const setMasthead = () => {
    const h = document.querySelector(SEL.masthead)?.getBoundingClientRect().height;
    if (h) html.style.setProperty('--ytpp-masthead', `${h}px`);
  };

  const onNavigate = () => {
    machine.reset();
    pending = undefined;
    setMasthead();
    watchFlexy();
    lastTheater = theater();
  };

  // §36.4: while the player is stuck, a timestamp only seeks.
  const onClick = (e: MouseEvent) => {
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    if (!isWatch() || fullscreen() || theater() || window.scrollY <= 0) return;
    const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (!a) return;
    let url: URL;
    try {
      url = new URL(a.href);
    } catch {
      return;
    }
    const current = new URL(location.href).searchParams.get('v');
    if (url.pathname !== '/watch' || !current || url.searchParams.get('v') !== current) return;
    const t = parseT(url.searchParams.get('t'));
    const video = document.querySelector<HTMLVideoElement>(SEL.video);
    if (t === undefined || !video) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    video.currentTime = t;
    void video.play().catch(() => {});
    log.debug(`timestamp ${t}s without scrolling`);
  };

  return {
    enable() {
      removeStyle = injectStyle('ytpp-sticky', CSS);
      html.setAttribute('data-ytpp-sticky', '');
      setMasthead();
      watchFlexy();
      window.addEventListener('scroll', onScroll, { passive: true });
      document.addEventListener('click', onClick, true);
      document.addEventListener('yt-navigate-finish', onNavigate);
    },
    disable() {
      removeStyle?.();
      html.removeAttribute('data-ytpp-sticky');
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('yt-navigate-finish', onNavigate);
      flexyObserver?.disconnect();
      flexyObserver = undefined;
      // If we left the page in normal mode, go back to what the user had.
      if (machine.autoSwitched && !theater()) toggleKeepingPref();
      machine.reset();
    },
  };
}
