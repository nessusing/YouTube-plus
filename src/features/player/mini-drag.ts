// Miniplayer free drag, edge snapping and remembered position/size
// (design §35.2, §35.3).
//
// The official drag (yt-draggable) starts on pointerdown/mousedown, moves the
// window with a transform and snaps to a corner on release. We stop those
// events in the capture phase on the video area and run our own drag. The
// position comes from a stylesheet (!important beats the official inline
// right/bottom); size stays inline so the official resizers keep working.

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

  const setSize = (el: HTMLElement, w: number, h: number) => {
    if (Math.round(el.getBoundingClientRect().width) !== w) el.style.width = `${w}px`;
    if (Math.round(el.getBoundingClientRect().height) !== h) el.style.height = `${h}px`;
  };

  /** Put the miniplayer where the saved position says, for the current viewport. */
  const restore = () => {
    const el = mini();
    if (!el || !saved || !active()) return;
    setSize(el, saved.width, saved.height);
    place(decode(saved, viewport()));
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

  const onResizeMutation = () => {
    const el = mini();
    if (!resize || !el) return;
    const w = parseFloat(el.style.width) || resize.start.w;
    const h = parseFloat(el.style.height) || resize.start.h;
    place(anchorResize(resize.start, w, h, resize.west, resize.north));
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
    else unplace();
  };

  const observe = () => {
    const app = document.querySelector(SEL.app);
    if (app && !appObserver) {
      appObserver = new MutationObserver(() => {
        if (active()) requestAnimationFrame(restore);
      });
      appObserver.observe(app, { attributes: true, attributeFilter: [SEL.appMiniActiveAttr] });
    }
    const el = mini();
    if (el && !sizeObserver) {
      sizeObserver = new MutationObserver(onResizeMutation);
      sizeObserver.observe(el, { attributes: true, attributeFilter: ['style'] });
    }
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
      appObserver = sizeObserver = undefined;
      unplace();
    },
    async reset() {
      await browser.storage.local.remove(MINI_POS_KEY);
    },
  };
}
