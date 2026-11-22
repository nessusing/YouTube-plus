// Watch page: once the player is half scrolled away, it floats as a small
// window at the bottom right, left of "back to top", so the comments get the
// page (§49). It comes back when its place in the page is half on screen
// again. The window can be dragged (edge snapping as in §35.2) and remembers
// where it was, apart from the official miniplayer. An Expand button at its
// top left scrolls back up. While it floats, a timestamp only seeks (§36.4);
// switching theater mode goes back to the top (§36.3; YouTube does that itself).
//
// Findings (2026-11-21): no ancestor of #player-container has a transform,
// contain or filter, so position: fixed works on it. Its parent keeps its
// height when it leaves the flow (normal: #player-container-inner sizes itself
// by padding; theater: #player-full-bleed-container has its own height), so the
// page does not jump. YouTube does not notice the new box size by itself; a
// window resize event makes it refit the video and the control bar to the box.

import { injectStyle, type Toggleable } from '@/core/dom';
import { t } from '@/core/i18n';
import type { Logger } from '@/core/log';
import { FLOAT_POS_KEY } from './consts';
import { DEFAULT_FLOAT_POS, FLOAT_H, FLOAT_W, nextFloating, parseT } from './float-state';
import { decode, encode, snap, type Rect, type SavedPos, type Viewport } from './geometry';
import { SEL } from './selectors';
import { playerTooltip, type PlayerTooltip } from './tooltip';

const DRAG_THRESHOLD = 4;
const TIP_EDGE = 12;
const NS = 'http://www.w3.org/2000/svg';
/** Two arrows pointing out to the corners (24×24, white fill). */
const EXPAND_PATH = 'M21 11V3h-8l3.29 3.29-10 10L3 13v8h8l-3.29-3.29 10-10z';

/** Pressing on these must not start a drag. */
const NO_DRAG = 'button, a, input, .ytp-chrome-bottom, .ytp-chrome-top, .ytp-popup, .ytp-settings-menu, '
  + '.ytp-ce-element, .html5-endscreen, .ytp-ad-module, .ytp-paid-content-overlay';

const CSS = `
html[data-ytpp-float] ${SEL.floatBox} {
  position: fixed !important;
  left: var(--ytpp-float-x) !important;
  top: var(--ytpp-float-y) !important;
  right: auto !important;
  bottom: auto !important;
  width: ${FLOAT_W}px !important;
  height: ${FLOAT_H}px !important;
  z-index: 2030 !important;
  border-radius: 12px;
  overflow: hidden;
  background: #000;
  box-shadow: 0 4px 32px rgba(0,0,0,.3), 0 1px 4px rgba(0,0,0,.3);
}
/* In theater mode the box's parent paints as its own layer, so the box's z-index
   only counts inside it and the right column's thumbnails cover the window
   (2026-11-21; not in normal mode). Lift the parent instead, both modes alike:
   above the page, below the masthead (2020), "back to top" (2025), the guide
   drawer and miniplayer (2030). Its background is transparent. */
html[data-ytpp-float] ${SEL.floatPlace} { z-index: 2019 !important; }
html[data-ytpp-float-dragging], html[data-ytpp-float-dragging] * { cursor: grabbing !important; user-select: none !important; }
#movie_player .ytpp-float-expand {
  display: none; position: absolute; top: 0; left: 0; z-index: 60;
  box-sizing: border-box; width: 40px; height: 40px; padding: 8px; margin: 0;
  border: 0; outline: none; background: none; cursor: pointer;
  transition: opacity .1s cubic-bezier(.4,0,1,1);
}
html[data-ytpp-float] #movie_player .ytpp-float-expand { display: block; }
#movie_player.ytp-autohide .ytpp-float-expand { opacity: 0; }
#movie_player .ytpp-float-expand svg { display: block; width: 24px; height: 24px; filter: drop-shadow(0 0 2px rgba(0,0,0,.5)); }
#movie_player .ytpp-float-expand:focus-visible { box-shadow: inset 0 0 0 2px rgba(255,255,255,.6); }
`;

const isWatch = () => location.pathname === '/watch';

function viewport(): Viewport {
  const mh = document.querySelector(SEL.masthead)?.getBoundingClientRect().height ?? 56;
  return { w: document.documentElement.clientWidth, h: window.innerHeight, top: mh };
}

function rectOf(el: Element): Rect {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}

function icon(): SVGSVGElement {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', EXPAND_PATH);
  p.setAttribute('fill', '#fff');
  svg.append(p);
  return svg;
}

export interface FloatPlayer extends Toggleable {
  /** The UI language changed: update the labels. */
  relabel(): void;
}

export function floatPlayer(log: Logger): FloatPlayer {
  const html = document.documentElement;
  let enabled = false;
  let floating = false;
  let pos: SavedPos = DEFAULT_FLOAT_POS;
  let removeStyle: (() => void) | undefined;
  let flexyMo: MutationObserver | undefined;
  let lastTheater: boolean | undefined;
  let btn: HTMLButtonElement | undefined;
  let tip: PlayerTooltip | undefined;

  const flexy = () => document.querySelector<HTMLElement>(SEL.watchFlexy);
  const box = () => document.querySelector<HTMLElement>(SEL.floatBox);
  const fullscreen = () => !!flexy()?.hasAttribute('fullscreen') || !!document.fullscreenElement;
  const theater = () => !!flexy()?.hasAttribute('theater');

  // ---- YouTube refits the player to its box on a window resize ----
  let refitQueued = false;
  const refit = () => {
    if (refitQueued) return;
    refitQueued = true;
    requestAnimationFrame(() => {
      refitQueued = false;
      window.dispatchEvent(new Event('resize'));
    });
  };
  /** While floating, YouTube may size the video for the big page again (new video, ads): refit. */
  const videoMo = new MutationObserver(() => {
    if (!floating) return;
    const b = box();
    const v = b?.querySelector('video');
    if (!b || !v) return;
    const br = b.getBoundingClientRect();
    const vr = v.getBoundingClientRect();
    if (vr.width > br.width + 1 || vr.height > br.height + 1) refit();
  });
  const watchVideo = () => {
    videoMo.disconnect();
    const v = box()?.querySelector('video');
    if (v) videoMo.observe(v, { attributes: true, attributeFilter: ['style'] });
  };

  // ---- position ----
  const place = (r = decode(pos, viewport())) => {
    html.style.setProperty('--ytpp-float-x', `${Math.round(r.x)}px`);
    html.style.setProperty('--ytpp-float-y', `${Math.round(r.y)}px`);
  };

  const setFloating = (v: boolean) => {
    if (v === floating) return;
    floating = v;
    if (v) {
      place();
      ensureButton();
      watchVideo();
    } else {
      videoMo.disconnect();
      hideTip();
      drag = undefined;
      html.removeAttribute('data-ytpp-float-dragging');
    }
    html.toggleAttribute('data-ytpp-float', v);
    refit();
    // YouTube may still be laying out (theater switch, new video): once more after it settles.
    setTimeout(refit, 400);
    log.debug(v ? 'player floats' : 'player back in the page');
  };

  /** Float when less than half of the player's place is on screen. */
  const evaluate = () => {
    if (!enabled) return;
    const ph = box()?.parentElement;
    if (!isWatch() || fullscreen() || !ph) return setFloating(false);
    const r = ph.getBoundingClientRect();
    setFloating(nextFloating(floating, r.bottom - viewport().top, r.height));
  };
  let evalQueued = false;
  const onScroll = () => {
    if (evalQueued) return;
    evalQueued = true;
    requestAnimationFrame(() => {
      evalQueued = false;
      evaluate();
    });
  };

  const onWindowResize = () => {
    if (floating) place();
    onScroll();
  };

  // ---- Expand button and its tooltip ----
  const hideTip = () => {
    if (tip) tip.el.style.display = 'none';
  };
  /** Below the button, like the official miniplayer's Expand tooltip; kept inside the player. */
  const showTip = () => {
    const player = btn?.closest<HTMLElement>(SEL.moviePlayer);
    if (!btn || !player) return;
    tip ??= playerTooltip('ytpp-float-expand-tip');
    if (tip.el.parentElement !== player) player.append(tip.el);
    tip.text.textContent = t('player.expand');
    tip.el.style.display = '';
    const p = player.getBoundingClientRect();
    const r = btn.getBoundingClientRect();
    const w = tip.el.offsetWidth;
    const left = Math.max(TIP_EDGE, Math.min(r.left - p.left + r.width / 2 - w / 2, p.width - TIP_EDGE - w));
    tip.el.style.left = `${Math.round(left)}px`;
    tip.el.style.top = `${Math.round(r.bottom - p.top)}px`;
  };

  const relabel = () => {
    btn?.setAttribute('aria-label', t('player.expand'));
    if (tip && tip.el.style.display !== 'none') showTip();
  };

  const makeButton = () => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ytpp-float-expand';
    b.append(icon());
    b.addEventListener('click', (e) => {
      // Keep it from the player, which would pause.
      e.stopPropagation();
      e.preventDefault();
      (document.activeElement as HTMLElement | null)?.blur?.();
      window.scrollTo({ top: 0, behavior: 'instant' });
    });
    b.addEventListener('dblclick', (e) => e.stopPropagation());
    b.addEventListener('mouseenter', showTip);
    b.addEventListener('mouseleave', hideTip);
    return b;
  };

  const ensureButton = () => {
    const player = box()?.querySelector<HTMLElement>(SEL.moviePlayer);
    if (!player) return;
    btn ??= makeButton();
    if (btn.parentElement !== player) player.append(btn);
    relabel();
  };

  // ---- drag ----
  let drag: { id: number; sx: number; sy: number; start: Rect; moved: boolean } | undefined;

  const onDown = (e: PointerEvent) => {
    if (!floating || e.button !== 0) return;
    const target = e.target as Element | null;
    const b = target?.closest?.(SEL.floatBox);
    if (!b || target!.closest(NO_DRAG)) return;
    drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, start: rectOf(b), moved: false };
  };

  const onMove = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.sx;
    const dy = e.clientY - drag.sy;
    if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    if (!drag.moved) {
      drag.moved = true;
      html.setAttribute('data-ytpp-float-dragging', '');
    }
    e.preventDefault();
    place({ ...drag.start, x: drag.start.x + dx, y: drag.start.y + dy });
  };

  const onUp = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = undefined;
    html.removeAttribute('data-ytpp-float-dragging');
    if (!d.moved) return;
    const vp = viewport();
    const r = snap({ ...d.start, x: d.start.x + e.clientX - d.sx, y: d.start.y + e.clientY - d.sy }, vp);
    place(r);
    pos = encode(r, vp);
    void browser.storage.local.set({ [FLOAT_POS_KEY]: pos });
    log.debug('small window position saved', pos);
    // A drag ends with a click on the video, which would pause it.
    const eat = (ev: Event) => { ev.stopImmediatePropagation(); ev.preventDefault(); };
    window.addEventListener('click', eat, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', eat, true), 50);
  };

  // ---- §36.4: while floating, a timestamp only seeks ----
  const onClick = (e: MouseEvent) => {
    if (!floating || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
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
    const sec = parseT(url.searchParams.get('t'));
    const video = document.querySelector<HTMLVideoElement>(SEL.video);
    if (sec === undefined || !video) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    video.currentTime = sec;
    void video.play().catch(() => {});
    log.debug(`timestamp ${sec}s without scrolling`);
  };

  /** The layout is still moving (YouTube moves the player box a while after the switch): look again. */
  const settle = () => {
    onScroll();
    setTimeout(onScroll, 300);
    setTimeout(onScroll, 1000);
  };

  // ---- §36.3: switching theater mode while floating goes back to the top ----
  // Measured 2026-11-21: right after the switch the box still sits in the old
  // layout, so a check then can keep it floating; put it back ourselves.
  const watchFlexy = () => {
    const f = flexy();
    if (!f || flexyMo) return;
    lastTheater = theater();
    flexyMo = new MutationObserver(() => {
      const th = theater();
      if (th === lastTheater) return;
      lastTheater = th;
      if (floating) {
        setFloating(false);
        window.scrollTo({ top: 0, behavior: 'instant' });
      }
      settle();
    });
    flexyMo.observe(f, { attributes: true, attributeFilter: ['theater'] });
  };

  // Leaving the page: the player moves to the miniplayer; don't leave an empty window behind.
  const onNavigateStart = () => setFloating(false);
  const onNavigate = () => {
    watchFlexy();
    lastTheater = theater();
    settle();
  };

  const onStorage = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area !== 'local' || !(FLOAT_POS_KEY in changes)) return;
    pos = (changes[FLOAT_POS_KEY]!.newValue as SavedPos | undefined) ?? DEFAULT_FLOAT_POS;
    if (floating) place();
  };

  return {
    enable() {
      if (enabled) return;
      enabled = true;
      removeStyle = injectStyle('ytpp-float', CSS);
      window.addEventListener('scroll', onScroll, { passive: true });
      window.addEventListener('resize', onWindowResize);
      window.addEventListener('pointerdown', onDown, true);
      window.addEventListener('pointermove', onMove, true);
      window.addEventListener('pointerup', onUp, true);
      window.addEventListener('pointercancel', onUp, true);
      document.addEventListener('click', onClick, true);
      document.addEventListener('fullscreenchange', settle);
      document.addEventListener('yt-navigate-start', onNavigateStart);
      document.addEventListener('yt-navigate-finish', onNavigate);
      browser.storage.onChanged.addListener(onStorage);
      watchFlexy();
      void browser.storage.local.get(FLOAT_POS_KEY).then((got) => {
        pos = (got[FLOAT_POS_KEY] as SavedPos | undefined) ?? DEFAULT_FLOAT_POS;
        if (floating) place();
      });
      onScroll();
    },
    disable() {
      if (!enabled) return;
      setFloating(false);
      enabled = false;
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onWindowResize);
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('fullscreenchange', settle);
      document.removeEventListener('yt-navigate-start', onNavigateStart);
      document.removeEventListener('yt-navigate-finish', onNavigate);
      browser.storage.onChanged.removeListener(onStorage);
      flexyMo?.disconnect();
      flexyMo = undefined;
      for (const el of [btn, tip?.el]) el?.remove();
      btn = tip = undefined;
      html.style.removeProperty('--ytpp-float-x');
      html.style.removeProperty('--ytpp-float-y');
      removeStyle?.();
    },
    relabel,
  };
}
