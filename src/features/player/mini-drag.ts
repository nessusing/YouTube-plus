// Miniplayer free drag, edge snapping and remembered position/size
// (F-07-AC2, F-07-AC3).
//
// The official drag (yt-draggable) starts on pointerdown/mousedown, moves the
// window with a transform and snaps to a corner on release. We stop those
// events in the capture phase on the video area and run our own drag. The
// position comes from a stylesheet (!important beats the official inline
// right/bottom).
//
// Size: YouTube keeps the miniplayer size in internal state (default 400 px
// wide), writes it inline on every render, and only its own resizers (trusted
// events) change it. So we never touch the inline sizes: we keep a width
// offset from YouTube's size to the saved one and draw YouTube's size + offset
// through CSS variables, recomputed whenever YouTube writes. The official
// resizers keep working (they move YouTube's size; the offset rides on top).
// The video itself is resized by player-main.ts (setInternalSize), which acts
// while html[data-ytpp-mini-sized] is set. Found 2026-11-18.

import { injectStyle, type Toggleable } from '@/core/dom';
import type { Logger } from '@/core/log';
import { anchorResize, decode, encode, snap, type Rect, type SavedPos, type Viewport } from './geometry';
import { SEL } from './selectors';

import { MINI_POS_KEY } from './consts';
export { MINI_POS_KEY };
const DRAG_THRESHOLD = 4;

const CSS = `
html[data-ytpp-mini-placed] ${SEL.miniplayer} {
  left: var(--ytpp-mini-x) !important;
  top: var(--ytpp-mini-y) !important;
  right: auto !important;
  bottom: auto !important;
  transform: none !important;
}
html[data-ytpp-mini-sized] ${SEL.miniplayer} {
  width: var(--ytpp-mini-w) !important;
  height: var(--ytpp-mini-h) !important;
}
html[data-ytpp-mini-sized] ${SEL.miniVideoArea} {
  width: var(--ytpp-mini-cw) !important;
  height: var(--ytpp-mini-ch) !important;
}
html[data-ytpp-mini-dragging] ${SEL.miniplayer} { transition: none !important; }
html[data-ytpp-mini-dragging], html[data-ytpp-mini-dragging] * { cursor: grabbing !important; user-select: none !important; }
`;

function viewport(): Viewport {
  const mh = document.querySelector(SEL.masthead)?.getBoundingClientRect().height ?? 56;
  return { w: document.documentElement.clientWidth, h: window.innerHeight, top: mh };
}

function rectOf(el: Element): Rect {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}

export function miniDrag(log: Logger): Toggleable & { reset(): Promise<void> } {
  let saved: SavedPos | undefined;
  let removeStyle: (() => void) | undefined;
  let appObserver: MutationObserver | undefined;
  let sizeObserver: MutationObserver | undefined;
  const html = document.documentElement;

  const mini = () => document.querySelector<HTMLElement>(SEL.miniplayer);
  const active = () => !!document.querySelector(SEL.app)?.hasAttribute(SEL.appMiniActiveAttr);

  const place = (r: Rect) => {
    html.style.setProperty('--ytpp-mini-x', `${Math.round(r.x)}px`);
    html.style.setProperty('--ytpp-mini-y', `${Math.round(r.y)}px`);
    html.setAttribute('data-ytpp-mini-placed', '');
  };

  const unplace = () => {
    html.removeAttribute('data-ytpp-mini-placed');
    html.style.removeProperty('--ytpp-mini-x');
    html.style.removeProperty('--ytpp-mini-y');
  };

  // ---- size: YouTube's own size + a width offset (see the top comment) ----
  /** saved width − YouTube's width; 0 = show YouTube's size as is. */
  let dW = 0;
  const SIZE_VARS = ['--ytpp-mini-w', '--ytpp-mini-h', '--ytpp-mini-cw', '--ytpp-mini-ch'];
  const videoArea = () => mini()?.querySelector<HTMLElement>(SEL.miniVideoArea) ?? null;
  /** The size YouTube wrote inline (its state), not what our CSS shows. */
  const ytSize = (el: HTMLElement) => ({
    w: parseFloat(el.style.width) || el.getBoundingClientRect().width,
    h: parseFloat(el.style.height) || el.getBoundingClientRect().height,
  });
  const setVar = (k: string, px: number) => {
    const v = `${Math.round(px)}px`;
    if (html.style.getPropertyValue(k) !== v) html.style.setProperty(k, v);
  };
  const unsize = () => {
    html.removeAttribute('data-ytpp-mini-sized');
    for (const k of SIZE_VARS) html.style.removeProperty(k);
  };

  /** Recompute the shown size from YouTube's current one; call after every YouTube write. */
  const applySize = () => {
    const el = mini();
    const area = videoArea();
    if (!el || !area || !dW || !active()) return unsize();
    const m = ytSize(el);
    const a = ytSize(area);
    if (!a.w) return unsize();
    const cw = a.w + dW;
    const ch = Math.round((cw * a.h) / a.w);
    setVar('--ytpp-mini-w', m.w + dW);
    setVar('--ytpp-mini-h', m.h + (ch - a.h));
    setVar('--ytpp-mini-cw', cw);
    setVar('--ytpp-mini-ch', ch);
    html.setAttribute('data-ytpp-mini-sized', '');
    watchArea(area);
  };

  /** Put the miniplayer where the saved position says, for the current viewport. */
  const restore = () => {
    const el = mini();
    if (!el || !saved || !active()) return;
    // Width only: the height also depends on whether the queue panel is open.
    dW = Math.round(saved.width - ytSize(el).w);
    applySize();
    place(decode({ ...saved, height: rectOf(el).h }, viewport()));
  };

  const save = async (r: Rect) => {
    saved = encode(r, viewport());
    await browser.storage.local.set({ [MINI_POS_KEY]: saved });
    log.debug('miniplayer position saved', saved);
  };

  // ---- our drag ----
  let drag: { id: number; sx: number; sy: number; start: Rect; moved: boolean } | undefined;

  const onDown = (e: PointerEvent | MouseEvent) => {
    const t = e.target as Element | null;
    const area = t?.closest?.(SEL.miniVideoArea);
    if (!area || !active() || t!.closest(SEL.noDrag)) return;
    if (e.button !== 0) return;
    // Keep the official draggable from seeing this press.
    e.stopImmediatePropagation();
    if (e.type !== 'pointerdown') return;
    const el = mini()!;
    drag = { id: (e as PointerEvent).pointerId, sx: e.clientX, sy: e.clientY, start: rectOf(el), moved: false };
  };

  const onMove = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.sx;
    const dy = e.clientY - drag.sy;
    if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    if (!drag.moved) {
      drag.moved = true;
      html.setAttribute('data-ytpp-mini-dragging', '');
    }
    e.preventDefault();
    place({ ...drag.start, x: drag.start.x + dx, y: drag.start.y + dy });
  };

  const onUp = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = undefined;
    html.removeAttribute('data-ytpp-mini-dragging');
    if (!d.moved) return;
    const r = snap({ ...d.start, x: d.start.x + e.clientX - d.sx, y: d.start.y + e.clientY - d.sy }, viewport());
    place(r);
    void save(r);
    // A drag ends with a click on the video, which would pause it.
    const eat = (ev: Event) => { ev.stopImmediatePropagation(); ev.preventDefault(); };
    window.addEventListener('click', eat, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', eat, true), 50);
  };

  // ---- official resize: keep the opposite edge put, save at the end ----
  let resize: { start: Rect; west: boolean; north: boolean } | undefined;

  const onResizeDown = (e: PointerEvent) => {
    const t = (e.target as Element | null)?.closest?.(SEL.miniResizer);
    if (!t || !active()) return;
    const cls = t.className;
    const el = mini()!;
    const start = rectOf(el);
    // Pin our position to the current rect, so official resizing works off it.
    place(start);
    resize = { start, west: /West/.test(cls), north: /North/.test(cls) };
  };

  /** YouTube wrote a size (render or official resize): re-add our offset, keep the anchor. */
  const onSizeMutation = () => {
    applySize();
    const el = mini();
    if (!resize || !el) return;
    const r = rectOf(el);
    place(anchorResize(resize.start, r.w, r.h, resize.west, resize.north));
  };

  const onResizeUp = () => {
    if (!resize) return;
    resize = undefined;
    const el = mini();
    if (el) void save(rectOf(el));
  };

  const onWindowResize = () => restore();

  const onStorage = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area !== 'local' || !(MINI_POS_KEY in changes)) return;
    saved = changes[MINI_POS_KEY]!.newValue as SavedPos | undefined;
    if (saved) restore();
    else {
      dW = 0;
      unsize();
      unplace();
    }
  };

  const observe = () => {
    const app = document.querySelector(SEL.app);
    if (app && !appObserver) {
      appObserver = new MutationObserver(() => {
        if (active()) requestAnimationFrame(restore);
        else unsize();
      });
      appObserver.observe(app, { attributes: true, attributeFilter: [SEL.appMiniActiveAttr] });
    }
    const el = mini();
    if (el && !sizeObserver) {
      sizeObserver = new MutationObserver(onSizeMutation);
      sizeObserver.observe(el, { attributes: true, attributeFilter: ['style'] });
    }
  };

  // The video area is a separate element YouTube may replace: follow it.
  let areaObserver: MutationObserver | undefined;
  let watchedArea: HTMLElement | undefined;
  const watchArea = (area: HTMLElement) => {
    if (watchedArea === area) return;
    areaObserver?.disconnect();
    watchedArea = area;
    areaObserver = new MutationObserver(onSizeMutation);
    areaObserver.observe(area, { attributes: true, attributeFilter: ['style'] });
  };

  const onNavigate = () => {
    observe();
    if (active()) restore();
  };

  return {
    enable() {
      removeStyle = injectStyle('ytpp-mini-drag', CSS);
      window.addEventListener('pointerdown', onResizeDown, true);
      window.addEventListener('pointerdown', onDown, true);
      window.addEventListener('mousedown', onDown, true);
      window.addEventListener('pointermove', onMove, true);
      window.addEventListener('pointerup', onUp, true);
      window.addEventListener('pointercancel', onUp, true);
      window.addEventListener('pointerup', onResizeUp, true);
      window.addEventListener('resize', onWindowResize);
      document.addEventListener('yt-navigate-finish', onNavigate);
      browser.storage.onChanged.addListener(onStorage);
      void browser.storage.local.get(MINI_POS_KEY).then((got) => {
        saved = got[MINI_POS_KEY] as SavedPos | undefined;
        observe();
        restore();
      });
    },
    disable() {
      removeStyle?.();
      window.removeEventListener('pointerdown', onResizeDown, true);
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
      window.removeEventListener('pointerup', onResizeUp, true);
      window.removeEventListener('resize', onWindowResize);
      document.removeEventListener('yt-navigate-finish', onNavigate);
      browser.storage.onChanged.removeListener(onStorage);
      appObserver?.disconnect();
      sizeObserver?.disconnect();
      areaObserver?.disconnect();
      appObserver = sizeObserver = areaObserver = undefined;
      watchedArea = undefined;
      dW = 0;
      unsize();
      unplace();
    },
    async reset() {
      await browser.storage.local.remove(MINI_POS_KEY);
    },
  };
}
