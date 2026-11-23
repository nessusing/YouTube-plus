// The danmaku button (F-12): in the player's control bar, left
// of the captions button, remembered for every video like that button. Our own
// icon, drawn in the style of the player's 2026 icons: a speech bubble, hollow
// when off, filled when on; a small dot blinks while working; dimmed when the
// video has nothing to show.

import { injectStyle, whenElement } from '@/core/dom';
import { playerTooltip, type PlayerTooltip } from '@/features/player/tooltip';

const NS = 'http://www.w3.org/2000/svg';
const BUBBLE = 'M6 4H18A3 3 0 0 1 21 7V14A3 3 0 0 1 18 17H11.5L7.5 20.5V17H6A3 3 0 0 1 3 14V7A3 3 0 0 1 6 4Z';
/** Two lines of text: strokes when off, holes when on. */
const LINES_OFF = 'M7.5 9H16.5M7.5 12.5H13';
const LINES_ON = 'M7.5 8H16.5A1 1 0 0 1 16.5 10H7.5A1 1 0 0 1 7.5 8ZM7.5 11.5H13A1 1 0 0 1 13 13.5H7.5A1 1 0 0 1 7.5 11.5Z';

const CSS = `
#movie_player .ytpp-dm-btn { display: flex; align-items: center; justify-content: center; position: relative; }
#movie_player .ytpp-dm-btn svg { width: 24px; height: 24px; display: block; overflow: visible; }
#movie_player .ytpp-dm-btn .on, #movie_player .ytpp-dm-btn[aria-pressed="true"] .off { display: none; }
#movie_player .ytpp-dm-btn[aria-pressed="true"] .on { display: inline; }
#movie_player .ytpp-dm-btn[data-dim] svg { opacity: .3; }
#movie_player .ytpp-dm-btn .dot { display: none; fill: #3ea6ff; stroke: rgba(0,0,0,.55); stroke-width: 1; }
#movie_player .ytpp-dm-btn[data-busy] .dot { display: inline; animation: ytpp-dm-blink 1s ease-in-out infinite; }
@keyframes ytpp-dm-blink { 50% { opacity: .15; } }
`;

export type ButtonLook = {
  on: boolean;
  /** Working (fetching, waiting for Gemini): the dot blinks. */
  busy?: boolean;
  /** Nothing to show here (no comments, live): dimmed. */
  dim?: boolean;
  tip: string;
};

export interface DanmakuButton {
  enable(): void;
  disable(): void;
  set(look: ButtonLook): void;
}

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string>): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

export function icon(): SVGSVGElement {
  const svg = el('svg', { viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true' });
  const off = el('g', { class: 'off', stroke: 'white', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
  off.append(el('path', { d: BUBBLE }), el('path', { d: LINES_OFF }));
  const on = el('g', { class: 'on' });
  on.append(
    el('path', { d: `${BUBBLE}${LINES_ON}`, fill: 'white', 'fill-rule': 'evenodd' }),
    el('path', { d: BUBBLE, stroke: 'white', 'stroke-width': '2', 'stroke-linejoin': 'round' }),
  );
  svg.append(off, on, el('circle', { class: 'dot', cx: '20.5', cy: '4.5', r: '3' }));
  return svg;
}

/** Gap between a tooltip and its button, as the player's own (measured for F-10). */
const TIP_GAP = 22;
const TIP_EDGE = 12;

export function danmakuButton(onClick: () => void): DanmakuButton {
  let removeStyle: (() => void) | undefined;
  let cancelWait: (() => void) | undefined;
  let active = false;
  let queued = false;
  let btn: HTMLButtonElement | undefined;
  let tip: PlayerTooltip | undefined;
  let hovered = false;
  let look: ButtonLook = { on: false, tip: '' };

  const showTip = () => {
    const player = btn?.closest<HTMLElement>('#movie_player');
    if (!btn || !player) return;
    tip ??= playerTooltip('ytpp-dm-tip');
    if (tip.el.parentElement !== player) player.append(tip.el);
    tip.text.style.whiteSpace = 'pre-line';
    tip.text.textContent = look.tip;
    tip.el.style.display = '';
    const p = player.getBoundingClientRect();
    const r = btn.getBoundingClientRect();
    const w = tip.el.offsetWidth;
    const h = tip.el.offsetHeight;
    tip.el.style.left = `${Math.round(Math.max(TIP_EDGE, Math.min(r.left - p.left + r.width / 2 - w / 2, p.width - TIP_EDGE - w)))}px`;
    tip.el.style.top = `${Math.round(r.top - p.top - TIP_GAP - h)}px`;
  };
  const hideTip = () => {
    if (tip) tip.el.style.display = 'none';
  };

  const render = () => {
    if (!btn) return;
    btn.setAttribute('aria-pressed', String(look.on));
    btn.setAttribute('aria-label', look.tip.split('\n')[0] ?? '');
    btn.toggleAttribute('data-busy', !!look.busy && look.on);
    btn.toggleAttribute('data-dim', !!look.dim);
    if (hovered) showTip();
  };

  const make = () => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ytp-button ytpp-dm-btn';
    b.append(icon());
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      onClick();
    });
    b.addEventListener('dblclick', (e) => e.stopPropagation());
    b.addEventListener('mouseenter', () => {
      hovered = true;
      showTip();
    });
    b.addEventListener('mouseleave', () => {
      hovered = false;
      hideTip();
    });
    return b;
  };

  /** Left of the captions button; YouTube may re-render the bar around it. */
  const ensure = () => {
    queued = false;
    if (!active) return;
    const cc = document.querySelector('#movie_player .ytp-subtitles-button');
    if (!cc || btn?.nextElementSibling === cc) return;
    btn ??= make();
    cc.before(btn);
    render();
  };
  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(ensure);
  };
  const mo = new MutationObserver(schedule);

  return {
    enable() {
      active = true;
      removeStyle = injectStyle('ytpp-dm-button', CSS);
      cancelWait = whenElement('#movie_player', (p) => {
        mo.observe(p, { childList: true, subtree: true });
        ensure();
      });
    },
    disable() {
      active = false;
      cancelWait?.();
      mo.disconnect();
      btn?.remove();
      tip?.el.remove();
      btn = tip = undefined;
      hovered = false;
      removeStyle?.();
    },
    set(next) {
      look = next;
      render();
    },
  };
}
