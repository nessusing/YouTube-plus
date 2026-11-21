// Loop button (design §40.2): one toggle right of ▶ in the bottom control bar
// (watch page, theater, fullscreen, and the miniplayer with our controls), and
// one right of the big ▶ in the middle of the miniplayer (shown only without
// our controls). Its state is the <video>'s `loop` attribute, which is what the
// right-click "Loop" sets; turning it on / off goes through the player API in
// the page (player-main.ts) so the right-click menu follows. YouTube turns it
// off itself when another video starts.

import { injectStyle, whenElement, type Toggleable } from '@/core/dom';
import { t } from '@/core/i18n';
import { LOOP_OFF_EVENT, LOOP_ON_EVENT } from './consts';
import { SEL } from './selectors';

const NS = 'http://www.w3.org/2000/svg';
/** 24×24: a ring arrow round a ▶; 2 px strokes with round caps, like the player's own 2026 icons. */
const ICON_PATHS: Record<string, string>[] = [
  { d: 'M19.73 9.93A8 8 0 1 1 13.39 4.12', stroke: 'white', 'stroke-width': '2', 'stroke-linecap': 'round' },
  { d: 'M16.34 4.64L13.35 0.87L12.24 7.17Z', fill: 'white', stroke: 'white', 'stroke-width': '1', 'stroke-linejoin': 'round' },
  { d: 'M10 8.8V15.2L15.2 12Z', fill: 'white', stroke: 'white', 'stroke-width': '1.2', 'stroke-linejoin': 'round' },
];

// Sizes measured 2026-11-21: the bar's round buttons are 40 px with an 8 px
// top margin, 48 px and 12 px in big mode (fullscreen); icons stay 24 px.
const CSS = `
#movie_player .ytpp-loop {
  position: relative; box-sizing: border-box; padding: 0; border: 0; outline: none;
  display: flex; align-items: center; justify-content: center; cursor: pointer;
}
#movie_player .ytpp-loop svg { display: block; opacity: .5; }
#movie_player .ytpp-loop[aria-pressed="true"] svg { opacity: 1; }
#movie_player .ytpp-loop:focus-visible { box-shadow: inset 0 0 0 2px rgba(255,255,255,.6); }
#movie_player .ytpp-loop-bar {
  flex: none; width: 40px; height: 40px; margin: 8px 0 0 12px;
  border-radius: 50%; background: rgba(0,0,0,.3);
}
#movie_player.ytp-big-mode .ytpp-loop-bar { width: 48px; height: 48px; margin-top: 12px; }
#movie_player .ytpp-loop-bar svg { width: 24px; height: 24px; }
#movie_player .ytpp-loop-bar::after {
  content: ""; position: absolute; inset: 4px; border-radius: 50%;
  pointer-events: none; transition: background-color .2s;
}
#movie_player .ytpp-loop-bar:hover::after { background-color: rgba(255,255,255,.1); }
/* Middle of the miniplayer: beside the big ▶, which keeps its place. */
#movie_player ${SEL.miniPlayHolder} { position: relative; }
#movie_player .ytpp-loop-mini {
  position: absolute; left: calc(100% + 16px); top: 50%; transform: translateY(-50%);
  width: 42px; height: 42px; background: none;
}
#movie_player .ytpp-loop-mini svg { width: 32px; height: 32px; }
`;

/** Gap between a tooltip and its button, as the player's own (measured). */
const TIP_GAP = 22;
const TIP_EDGE = 12;

export interface LoopButton extends Toggleable {
  /** The UI language changed: update the labels. */
  relabel(): void;
}

function icon(): SVGSVGElement {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('aria-hidden', 'true');
  for (const attrs of ICON_PATHS) {
    const p = document.createElementNS(NS, 'path');
    for (const [k, v] of Object.entries(attrs)) p.setAttribute(k, v);
    svg.append(p);
  }
  return svg;
}

/** The player's own tooltip markup, so its styles apply; the player never shows tooltips for our buttons. */
function tooltip(): { el: HTMLElement; text: HTMLElement } {
  const el = document.createElement('div');
  el.className = 'ytp-tooltip ytp-bottom ytpp-loop-tip';
  el.style.maxWidth = '300px';
  el.style.display = 'none';
  const wrap = document.createElement('div');
  wrap.className = 'ytp-tooltip-text-wrapper';
  wrap.setAttribute('aria-hidden', 'true');
  const bottom = document.createElement('div');
  bottom.className = 'ytp-tooltip-bottom-text';
  const text = document.createElement('span');
  text.className = 'ytp-tooltip-text';
  bottom.append(text);
  wrap.append(bottom);
  el.append(wrap);
  return { el, text };
}

export function loopButton(): LoopButton {
  let removeStyle: (() => void) | undefined;
  let cancelWait: (() => void) | undefined;
  let queued = false;
  let active = false;
  let video: HTMLVideoElement | null = null;
  let bar: HTMLButtonElement | undefined;
  let mini: HTMLButtonElement | undefined;
  let tip: ReturnType<typeof tooltip> | undefined;
  let hovered: HTMLButtonElement | undefined;

  const isOn = () => !!video?.loop;
  const label = () => t(isOn() ? 'player.loopOff' : 'player.loopOn');
  const setLoop = (on: boolean) => document.dispatchEvent(new CustomEvent(on ? LOOP_ON_EVENT : LOOP_OFF_EVENT));

  const hideTip = () => {
    if (tip) tip.el.style.display = 'none';
  };
  const showTip = (b: HTMLButtonElement) => {
    const player = b.closest<HTMLElement>(SEL.moviePlayer);
    if (!player) return;
    tip ??= tooltip();
    if (tip.el.parentElement !== player) player.append(tip.el);
    tip.text.textContent = label();
    tip.el.style.display = '';
    const p = player.getBoundingClientRect();
    const r = b.getBoundingClientRect();
    const w = tip.el.offsetWidth;
    const h = tip.el.offsetHeight;
    const left = Math.max(TIP_EDGE, Math.min(r.left - p.left + r.width / 2 - w / 2, p.width - TIP_EDGE - w));
    tip.el.style.left = `${Math.round(left)}px`;
    tip.el.style.top = `${Math.round(r.top - p.top - TIP_GAP - h)}px`;
  };

  const render = () => {
    for (const b of [bar, mini]) {
      if (!b) continue;
      b.setAttribute('aria-pressed', String(isOn()));
      b.setAttribute('aria-label', label());
    }
    if (hovered) showTip(hovered);
  };
  const videoMo = new MutationObserver(render);

  const make = (cls: string): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `ytpp-loop ${cls}`;
    b.append(icon());
    b.addEventListener('click', (e) => {
      // Keep it from the player: the miniplayer's scrim pauses on click.
      e.stopPropagation();
      e.preventDefault();
      setLoop(!isOn());
    });
    b.addEventListener('dblclick', (e) => e.stopPropagation());
    b.addEventListener('mouseenter', () => {
      hovered = b;
      showTip(b);
    });
    b.addEventListener('mouseleave', () => {
      hovered = undefined;
      hideTip();
    });
    return b;
  };

  /** Put the buttons in place (YouTube may re-render around them) and follow the video. */
  const ensure = () => {
    queued = false;
    // A frame queued before disable() must not put the buttons back.
    if (!active) return;
    let changed = false;
    const v = document.querySelector<HTMLVideoElement>(SEL.video);
    if (v !== video) {
      videoMo.disconnect();
      video = v;
      if (v) videoMo.observe(v, { attributes: true, attributeFilter: ['loop'] });
      changed = true;
    }
    const play = document.querySelector(SEL.barPlay);
    if (play && (!bar || bar.previousElementSibling !== play)) {
      bar ??= make('ytpp-loop-bar');
      play.after(bar);
      changed = true;
    }
    const holder = document.querySelector(SEL.miniPlayHolder);
    if (holder && (!mini || mini.parentElement !== holder)) {
      mini ??= make('ytpp-loop-mini');
      holder.append(mini);
      changed = true;
    }
    if (changed) render();
  };
  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(ensure);
  };
  const playerMo = new MutationObserver(schedule);

  return {
    enable() {
      active = true;
      removeStyle = injectStyle('ytpp-loop-button', CSS);
      cancelWait = whenElement(SEL.moviePlayer, (p) => {
        playerMo.observe(p, { childList: true, subtree: true });
        ensure();
      });
    },
    disable() {
      active = false;
      cancelWait?.();
      playerMo.disconnect();
      videoMo.disconnect();
      // Turned off while looping: stop looping too, or it would go on with no button to show it.
      if (video?.loop) setLoop(false);
      for (const el of [bar, mini, tip?.el]) el?.remove();
      bar = mini = tip = hovered = undefined;
      video = null;
      removeStyle?.();
    },
    relabel: render,
  };
}
