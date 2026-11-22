// Page notifications (design §46): YouTube-style toasts that every feature
// shares. A stack centered at the bottom (or under the masthead), newest
// nearest the edge pushing the older ones out and shrinking them a little
// (the feel of Sonner). The whole stack can be dragged sideways; where it was
// left is remembered per machine (storage.local, a fraction of the window
// width). Hovering or dragging pauses every timer. It steps past the
// miniplayer or its minimized bar (§44) when they are in the way: above them at
// the bottom, below them at the top. In fullscreen it moves into the
// fullscreen element.
//
// Each content script is its own bundle, but they share one isolated world:
// the stack lives on globalThis so every feature's notices land in one stack.

import { SEL } from '@/features/player/selectors';
import { MINI_BAR_TAG } from '@/features/player/consts';
import { DEFAULT_SETTINGS, getSettings, onSettingsChanged, type NotifySettings } from './settings';

/** storage.local: the stack's center as a fraction of the window width (0–1). */
export const NOTIFY_X_KEY = 'notify/x';
/** Options page → YouTube tab: show a sample notice. */
export const NOTIFY_PREVIEW = 'YouTube+/notify-preview';

export interface NotifyAction {
  label: string;
  run: () => void;
}

export interface NotifyOptions {
  /** A blue text button on the right ("View", "Settings"…). */
  action?: NotifyAction;
  /** Red warning icon, shown longer. */
  error?: boolean;
}

/** Show a notice in this tab. */
export function notify(text: string, opts: NotifyOptions = {}): void {
  const g = globalThis as { [K in typeof INSTANCE]?: Notifier };
  (g[INSTANCE] ??= createNotifier())(text, opts);
}

type Notifier = (text: string, opts: NotifyOptions) => void;
const INSTANCE = Symbol.for('ytpp.notify');

/** Kept from the window's sides. */
const SIDE_GAP = 16;
/** From the bottom of the window, or below the masthead. */
const BOTTOM_GAP = 24;
const TOP_GAP = 16;
/** Between the stack and the miniplayer / its bar. */
const OBSTACLE_GAP = 16;
/** Between stacked notices. */
const STACK_GAP = 8;
/** Each older notice is this much smaller. */
const SHRINK = 0.04;
const ANIM_MS = 200;
/** While notices show: follow the miniplayer, masthead and window. */
const FOLLOW_MS = 250;

const WARN_PATH = 'M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z';

/** Colors are the theme's inverse, like YouTube's own toasts. */
const STYLE = `
  :host { all: initial; }
  .stack { position: absolute; left: 0; top: 0; }
  .toast {
    position: absolute; left: 0; bottom: 0; box-sizing: border-box;
    display: flex; align-items: center; gap: 12px;
    width: max-content; max-width: min(560px, calc(100vw - ${2 * SIDE_GAP}px)); min-height: 48px;
    padding: 14px 16px; border-radius: 8px;
    background: #0f0f0f; color: #fff;
    font: 400 14px/20px Roboto, Arial, sans-serif;
    box-shadow: 0 4px 32px rgba(0,0,0,.1), 0 1px 4px rgba(0,0,0,.2);
    transform-origin: 50% 100%;
    transition: transform ${ANIM_MS}ms ease, opacity ${ANIM_MS}ms ease;
    cursor: grab; user-select: none; touch-action: none; pointer-events: auto;
  }
  .top .toast { bottom: auto; top: 0; transform-origin: 50% 0; }
  .toast.enter { transition: none; }
  .toast.leaving { pointer-events: none; }
  .toast.with-action { padding: 6px 8px 6px 16px; }
  .dragging .toast { cursor: grabbing; }
  :host([data-dark]) .toast { background: #f1f1f1; color: #0f0f0f; }
  .msg { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; }
  .icon { flex: none; width: 24px; height: 24px; margin-left: -4px; fill: #ff4e45; }
  :host([data-dark]) .icon { fill: #cc0000; }
  .link {
    all: unset; flex: none; height: 36px; padding: 0 12px; border-radius: 18px;
    font-weight: 500; line-height: 36px; white-space: nowrap; cursor: pointer; color: #3ea6ff;
  }
  .link:hover { background: rgba(62,166,255,.15); }
  :host([data-dark]) .link { color: #065fd4; }
  :host([data-dark]) .link:hover { background: rgba(6,95,212,.1); }
  .link:focus-visible { outline: 2px solid currentColor; outline-offset: 1px; }
`;

/** Events that must not reach the page under us (the player pauses on click, hotkeys…). */
const KEEP_IN = ['click', 'dblclick', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchstart', 'wheel', 'contextmenu', 'keydown', 'keyup'];

interface Item {
  el: HTMLElement;
  text: string;
  /** Full time to show. */
  ms: number;
  /** Time left; counts down only while running. */
  left: number;
  since: number;
  timer?: ReturnType<typeof setTimeout>;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
const validX = (v: unknown) => (typeof v === 'number' && v >= 0 && v <= 1 ? v : 0.5);

function createNotifier(): Notifier {
  const html = document.documentElement;
  let cfg: NotifySettings = DEFAULT_SETTINGS.notify;
  let x = 0.5;
  const ready = Promise.all([
    getSettings().then((s) => { cfg = s.notify; }, () => {}),
    browser.storage.local.get(NOTIFY_X_KEY).then((got) => { x = validX(got[NOTIFY_X_KEY]); }, () => {}),
  ]);

  let host: HTMLElement | undefined;
  let stack: HTMLElement | undefined;
  /** Newest first; leaving ones are no longer here. */
  const items: Item[] = [];
  const hovered = new Set<HTMLElement>();
  let drag: { id: number; startX: number; startCx: number } | undefined;
  /** The stack's center as last laid out, px. */
  let cx = 0;
  let follow: ReturnType<typeof setInterval> | undefined;

  const paused = () => hovered.size > 0 || !!drag;
  const max = () => clamp(Math.round(cfg.maxVisible) || 1, 1, 5);
  const bottom = () => cfg.position !== 'top';

  // ---- timers ----
  const run = (it: Item) => {
    if (it.timer || paused()) return;
    it.since = Date.now();
    it.timer = setTimeout(() => dismiss(it), it.left);
  };
  const hold = (it: Item) => {
    if (!it.timer) return;
    clearTimeout(it.timer);
    it.timer = undefined;
    it.left = Math.max(0, it.left - (Date.now() - it.since));
  };
  const syncTimers = () => {
    for (const it of items) (paused() ? hold : run)(it);
  };

  // ---- the host ----
  const ensureHost = () => {
    if (!host) {
      host = document.createElement('ytpp-notify');
      const root = host.attachShadow({ mode: 'closed' });
      const style = document.createElement('style');
      style.textContent = STYLE;
      stack = document.createElement('div');
      stack.className = 'stack';
      stack.setAttribute('role', 'status');
      stack.setAttribute('aria-live', 'polite');
      root.append(style, stack);
      for (const type of KEEP_IN) host.addEventListener(type, (e) => e.stopPropagation());
    }
    // In fullscreen only the fullscreen element shows.
    const fs = document.fullscreenElement;
    const parent = fs && !(fs instanceof HTMLVideoElement) && !(fs instanceof HTMLIFrameElement) ? fs : html;
    if (host.parentNode !== parent) parent.append(host);
  };

  /** What the stack must not cover: the miniplayer and its minimized bar (§44). */
  const obstacles = (): DOMRect[] => {
    if (document.fullscreenElement) return [];
    const out: DOMRect[] = [];
    const miniUp = !!document.querySelector(SEL.app)?.hasAttribute(SEL.appMiniActiveAttr);
    if (miniUp && !html.hasAttribute('data-ytpp-mini-min')) {
      const r = document.querySelector(SEL.miniplayer)?.getBoundingClientRect();
      if (r && r.width && r.height) out.push(r);
    }
    const bar = document.querySelector<HTMLElement>(MINI_BAR_TAG);
    if (bar && bar.style.display !== 'none') {
      const r = bar.getBoundingClientRect();
      if (r.width && r.height) out.push(r);
    }
    return out;
  };

  const layout = () => {
    if (!host || !stack) return;
    host.toggleAttribute('data-dark', html.hasAttribute('dark'));
    const vw = html.clientWidth || window.innerWidth;
    const vh = window.innerHeight;
    let w = 0;
    for (const it of items) w = Math.max(w, it.el.offsetWidth);
    const half = w / 2;
    const want = drag ? cx : x * vw;
    cx = w + 2 * SIDE_GAP >= vw ? vw / 2 : clamp(want, SIDE_GAP + half, vw - SIDE_GAP - half);

    // Step past whatever sits in our half of the window and overlaps us sideways.
    const inOurWay = obstacles().filter((r) => r.right > cx - half && r.left < cx + half
      && (r.top + r.height / 2 > vh / 2) === bottom());
    let gap: number;
    if (bottom()) {
      gap = BOTTOM_GAP;
      for (const r of inOurWay) gap = Math.max(gap, vh - r.top + OBSTACLE_GAP);
    } else {
      const m = document.fullscreenElement ? undefined : document.querySelector(SEL.masthead)?.getBoundingClientRect();
      gap = (m && m.height > 0 && m.bottom > 0 ? m.bottom : 0) + TOP_GAP;
      for (const r of inOurWay) gap = Math.max(gap, r.bottom + OBSTACLE_GAP);
    }
    const pos = `position:fixed;display:block;width:0;height:0;z-index:2300;left:${Math.round(cx)}px;`
      + (bottom() ? `bottom:${Math.round(gap)}px;top:auto;` : `top:${Math.round(gap)}px;bottom:auto;`);
    if (host.style.cssText !== pos) host.style.cssText = pos;
    stack.classList.toggle('top', !bottom());

    const dir = bottom() ? -1 : 1;
    let off = 0;
    items.forEach((it, i) => {
      const s = 1 - SHRINK * i;
      it.el.style.transform = `translate(-50%, ${dir * off}px) scale(${s})`;
      it.el.style.opacity = '1';
      off += it.el.offsetHeight * s + STACK_GAP;
    });
  };

  const startFollowing = () => {
    follow ??= setInterval(layout, FOLLOW_MS);
  };
  const stopFollowing = () => {
    if (follow) clearInterval(follow);
    follow = undefined;
  };
  const onFullscreen = () => {
    if (!items.length) return;
    ensureHost();
    layout();
  };
  window.addEventListener('resize', () => items.length && layout());
  document.addEventListener('fullscreenchange', onFullscreen);

  /** Readable from outside the closed shadow root (e2e tests, debugging): the newest notice. */
  const markNewest = () => {
    if (!host) return;
    if (items[0]) host.dataset.text = items[0].text;
    else delete host.dataset.text;
    items.forEach((it, i) => it.el.classList.toggle('newest', i === 0));
  };

  function dismiss(it: Item) {
    const i = items.indexOf(it);
    if (i < 0) return;
    hold(it);
    items.splice(i, 1);
    hovered.delete(it.el);
    it.el.classList.add('leaving');
    // The one nearest the edge slides back out; older ones just fade.
    const s = 1 - SHRINK * i;
    const dir = bottom() ? 1 : -1;
    it.el.style.transform = i === 0
      ? `translate(-50%, ${dir * it.el.offsetHeight}px) scale(${s})`
      : `${it.el.style.transform.replace(/scale\([^)]*\)/, '')} scale(${s * 0.9})`;
    it.el.style.opacity = '0';
    setTimeout(() => it.el.remove(), ANIM_MS);
    markNewest();
    layout();
    syncTimers();
    if (!items.length) stopFollowing();
  }

  // ---- dragging sideways (the whole stack) ----
  const onDown = (e: PointerEvent) => {
    if (e.button !== 0 || (e.target as Element).closest('button')) return;
    const el = e.currentTarget as HTMLElement;
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    drag = { id: e.pointerId, startX: e.clientX, startCx: cx };
    stack!.classList.add('dragging');
    syncTimers();
  };
  const onMove = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    cx = drag.startCx + e.clientX - drag.startX;
    layout();
  };
  const onUp = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    const moved = e.clientX !== drag.startX;
    drag = undefined;
    stack!.classList.remove('dragging');
    if (moved) {
      x = clamp(cx / (html.clientWidth || window.innerWidth), 0, 1);
      void browser.storage.local.set({ [NOTIFY_X_KEY]: x });
    }
    syncTimers();
  };

  const build = (text: string, opts: NotifyOptions): HTMLElement => {
    const el = document.createElement('div');
    el.className = 'toast';
    if (opts.error) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'icon');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('aria-hidden', 'true');
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', WARN_PATH);
      svg.append(p);
      el.append(svg);
    }
    const msg = document.createElement('span');
    msg.className = 'msg';
    msg.textContent = text;
    el.append(msg);
    if (opts.action) {
      const { label, run: act } = opts.action;
      el.classList.add('with-action');
      const b = document.createElement('button');
      b.className = 'link';
      b.type = 'button';
      b.textContent = label;
      b.addEventListener('click', () => {
        const it = items.find((x) => x.el === el);
        if (it) dismiss(it);
        act();
      });
      el.append(b);
    }
    el.addEventListener('pointerenter', () => { hovered.add(el); syncTimers(); });
    el.addEventListener('pointerleave', () => { hovered.delete(el); syncTimers(); });
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('lostpointercapture', onUp);
    return el;
  };

  const show = (text: string, opts: NotifyOptions) => {
    ensureHost();
    // The same text already showing: just start its time again.
    const same = items.find((it) => it.text === text);
    if (same) {
      hold(same);
      same.left = same.ms;
      run(same);
      return;
    }
    const sec = opts.error ? cfg.errorSec : opts.action ? cfg.actionSec : cfg.plainSec;
    const ms = clamp(sec, 2, 30) * 1000;
    const el = build(text, opts);
    const it: Item = { el, text, ms, left: ms, since: Date.now() };
    // Start just beyond the edge, transparent, then slide in.
    el.classList.add('enter');
    el.style.opacity = '0';
    stack!.append(el);
    stack!.classList.toggle('top', !bottom());
    el.style.transform = `translate(-50%, ${(bottom() ? 1 : -1) * el.offsetHeight}px)`;
    void el.offsetWidth;
    el.classList.remove('enter');
    items.unshift(it);
    while (items.length > max()) dismiss(items.at(-1)!);
    markNewest();
    layout();
    run(it);
    startFollowing();
  };

  onSettingsChanged((s) => {
    cfg = s.notify;
    while (items.length > max()) dismiss(items.at(-1)!);
    layout();
  });
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !(NOTIFY_X_KEY in changes) || drag) return;
    x = validX(changes[NOTIFY_X_KEY]!.newValue);
    layout();
  });

  return (text, opts) => void ready.then(() => show(text, opts));
}
