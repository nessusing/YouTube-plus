// Miniplayer minimize (§44): a button left of the ✕ at the top right of the
// miniplayer shrinks it to a bar at the bottom left of the page that shows only
// the video's title; clicking the bar anywhere brings the miniplayer back where
// it was, at its size. The video keeps playing. The miniplayer is not closed,
// only hidden (with its list panel), so YouTube, the drag (§35.2, §35.3) and
// the queue see nothing change. Minimized is remembered in storage.local: it
// holds across reloads and the next time a miniplayer opens, in every tab.

import { injectStyle, whenElement, type Toggleable } from '@/core/dom';
import { t } from '@/core/i18n';
import type { Logger } from '@/core/log';
import { MINI_MIN_KEY } from './consts';
import { SEL } from './selectors';
import { playerTooltip, type PlayerTooltip } from './tooltip';

const NS = 'http://www.w3.org/2000/svg';
/** A low dash, drawn like the ✕ beside it (24×24, white fill). */
const ICON_PATH = 'M6 17h12v2H6z';

/** Measured 2026-11-21: the ✕ is 40×40 with 8 px padding at the top right, z-index 67. */
const CSS = `
html[data-ytpp-mini-min] ${SEL.miniplayer} {
  opacity: 0 !important;
  clip-path: inset(50%) !important;
  pointer-events: none !important;
}
#movie_player .ytpp-mini-min {
  position: absolute; top: 0; right: 40px; z-index: 67;
  box-sizing: border-box; width: 40px; height: 40px; padding: 8px; margin: 0;
  border: 0; outline: none; background: none; cursor: pointer;
}
#movie_player .ytpp-mini-min svg { display: block; width: 24px; height: 24px; }
#movie_player .ytpp-mini-min:focus-visible { box-shadow: inset 0 0 0 2px rgba(255,255,255,.6); }
`;

/** The bar lives in a shadow root, away from YouTube's styles; its theme variables still reach it. */
const BAR_CSS = `
button {
  all: unset; position: relative; box-sizing: border-box;
  display: flex; align-items: center; height: 48px; padding: 0 16px;
  max-width: min(400px, calc(100vw - 32px));
  border-radius: 12px; cursor: pointer;
  background: var(--yt-spec-base-background, #fff);
  color: var(--yt-spec-text-primary, #0f0f0f);
  box-shadow: 0 4px 32px rgba(0,0,0,.1), 0 1px 4px rgba(0,0,0,.2);
  font: 500 14px/20px Roboto, Arial, sans-serif;
}
button::after {
  content: ""; position: absolute; inset: 0; border-radius: inherit;
  background: currentColor; opacity: 0; transition: opacity .15s; pointer-events: none;
}
button:hover::after { opacity: .06; }
button:focus-visible { outline: 2px solid #3ea6ff; outline-offset: 2px; }
span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
`;

/** Same 16 px inset as the miniplayer's own corners (geometry.ts EDGE_GAP). */
const BAR_GAP = 16;
const TIP_EDGE = 12;

export interface MiniMinimize extends Toggleable {
  /** The UI language changed: update the labels. */
  relabel(): void;
}

function icon(): SVGSVGElement {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', ICON_PATH);
  p.setAttribute('fill', '#fff');
  svg.append(p);
  return svg;
}

export function miniMinimize(log: Logger): MiniMinimize {
  const html = document.documentElement;
  let enabled = false;
  /** The stored state: minimized whenever a miniplayer is showing. */
  let minimized = false;
  let removeStyle: (() => void) | undefined;
  let cancelPlayer: (() => void) | undefined;
  let cancelApp: (() => void) | undefined;
  let queued = false;
  let btn: HTMLButtonElement | undefined;
  let tip: PlayerTooltip | undefined;
  let host: HTMLElement | undefined;
  let bar: HTMLButtonElement | undefined;
  let barText: HTMLElement | undefined;
  let watchedInfo: Element | undefined;

  const miniActive = () => !!document.querySelector(SEL.app)?.hasAttribute(SEL.appMiniActiveAttr);
  const title = () => document.querySelector(SEL.miniTitle)?.textContent?.trim() ?? '';

  // ---- the bar ----
  const makeBar = () => {
    host = document.createElement('ytpp-mini-bar');
    // Same layer as ytd-miniplayer (2030), which it stands in for.
    host.style.cssText = `position:fixed;left:${BAR_GAP}px;bottom:${BAR_GAP}px;z-index:2030;display:none;`;
    const root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = BAR_CSS;
    bar = document.createElement('button');
    bar.type = 'button';
    barText = document.createElement('span');
    bar.append(barText);
    root.append(style, bar);
    // Clicks (and Enter / Space) on the button bubble out of the shadow root.
    host.addEventListener('click', () => setMinimized(false));
    html.append(host);
    relabel();
  };

  const updateTitle = () => {
    if (!barText) return;
    const text = title();
    // No title yet (between videos): keep the last one rather than an empty bar.
    if (text && barText.textContent !== text) barText.textContent = text;
    else if (!barText.textContent) barText.textContent = t('player.miniRestore');
  };
  const titleMo = new MutationObserver(() => updateTitle());
  /** Follow the info bar's title; YouTube may replace the element. */
  const watchTitle = () => {
    const info = document.querySelector('ytd-miniplayer-info-bar') ?? undefined;
    if (info === watchedInfo) return;
    titleMo.disconnect();
    watchedInfo = info;
    if (info) titleMo.observe(info, { childList: true, characterData: true, subtree: true });
  };
  const unwatchTitle = () => {
    titleMo.disconnect();
    watchedInfo = undefined;
  };

  /** Show the bar (and hide the miniplayer) exactly when minimized with a miniplayer up. */
  const render = () => {
    const show = enabled && minimized && miniActive();
    html.toggleAttribute('data-ytpp-mini-min', show);
    if (show) {
      if (!host) makeBar();
      watchTitle();
      updateTitle();
      host!.style.display = '';
    } else {
      if (host) host.style.display = 'none';
      unwatchTitle();
    }
  };

  const setMinimized = (v: boolean) => {
    if (v === minimized) return;
    minimized = v;
    hideTip();
    // Focus would stay on a button that is now hidden.
    (document.activeElement as HTMLElement | null)?.blur?.();
    render();
    void (v ? browser.storage.local.set({ [MINI_MIN_KEY]: true }) : browser.storage.local.remove(MINI_MIN_KEY));
    log.debug(v ? 'miniplayer minimized' : 'miniplayer restored');
  };

  // ---- the button left of ✕ ----
  const hideTip = () => {
    if (tip) tip.el.style.display = 'none';
  };
  /** Below the button, like the official Expand tooltip; kept inside the player. */
  const showTip = () => {
    const player = btn?.closest<HTMLElement>(SEL.moviePlayer);
    if (!btn || !player) return;
    tip ??= playerTooltip('ytpp-mini-min-tip');
    if (tip.el.parentElement !== player) player.append(tip.el);
    tip.text.textContent = t('player.miniMinimize');
    tip.el.style.display = '';
    const p = player.getBoundingClientRect();
    const r = btn.getBoundingClientRect();
    const w = tip.el.offsetWidth;
    const left = Math.max(TIP_EDGE, Math.min(r.left - p.left + r.width / 2 - w / 2, p.width - TIP_EDGE - w));
    tip.el.style.left = `${Math.round(left)}px`;
    tip.el.style.top = `${Math.round(r.bottom - p.top)}px`;
  };

  const makeButton = () => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ytpp-mini-min';
    b.append(icon());
    b.addEventListener('click', (e) => {
      // Keep it from the player: the miniplayer's scrim pauses on click.
      e.stopPropagation();
      e.preventDefault();
      setMinimized(true);
    });
    b.addEventListener('dblclick', (e) => e.stopPropagation());
    b.addEventListener('mouseenter', showTip);
    b.addEventListener('mouseleave', hideTip);
    return b;
  };

  /** Keep the button right before ✕ (YouTube may re-render around it). */
  const ensure = () => {
    queued = false;
    if (!enabled) return;
    const close = document.querySelector(SEL.miniClose);
    if (!close || btn?.nextElementSibling === close) return;
    btn ??= makeButton();
    close.before(btn);
    relabel();
  };
  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(ensure);
  };
  const playerMo = new MutationObserver(schedule);
  const appMo = new MutationObserver(() => render());

  const relabel = () => {
    btn?.setAttribute('aria-label', t('player.miniMinimize'));
    bar?.setAttribute('aria-label', t('player.miniRestore'));
    if (tip && tip.el.style.display !== 'none') showTip();
  };

  // A new video in the miniplayer (next in a list) may not touch the info bar we watch.
  const onVideoLoaded = (e: Event) => {
    if (host?.style.display === '' && (e.target as Element | null)?.closest?.(SEL.moviePlayer)) {
      watchTitle();
      updateTitle();
    }
  };
  const onNavigate = () => render();

  const onStorage = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area !== 'local' || !(MINI_MIN_KEY in changes)) return;
    minimized = changes[MINI_MIN_KEY]!.newValue === true;
    render();
  };

  return {
    enable() {
      enabled = true;
      removeStyle = injectStyle('ytpp-mini-minimize', CSS);
      cancelPlayer = whenElement(SEL.moviePlayer, (p) => {
        playerMo.observe(p, { childList: true, subtree: true });
        ensure();
      });
      cancelApp = whenElement(SEL.app, (app) => {
        appMo.observe(app, { attributes: true, attributeFilter: [SEL.appMiniActiveAttr] });
        render();
      });
      document.addEventListener('loadeddata', onVideoLoaded, true);
      document.addEventListener('yt-navigate-finish', onNavigate);
      browser.storage.onChanged.addListener(onStorage);
      void browser.storage.local.get(MINI_MIN_KEY).then((got) => {
        minimized = got[MINI_MIN_KEY] === true;
        render();
      });
    },
    disable() {
      enabled = false;
      cancelPlayer?.();
      cancelApp?.();
      playerMo.disconnect();
      appMo.disconnect();
      unwatchTitle();
      document.removeEventListener('loadeddata', onVideoLoaded, true);
      document.removeEventListener('yt-navigate-finish', onNavigate);
      browser.storage.onChanged.removeListener(onStorage);
      html.removeAttribute('data-ytpp-mini-min');
      for (const el of [btn, tip?.el, host]) el?.remove();
      btn = tip = host = bar = barText = undefined;
      removeStyle?.();
    },
    relabel,
  };
}
