// F-22: list-page thumbnails move, all the visible ones at once, without a
// player. A card moves while it is on screen, the tab is in front and the
// pointer is elsewhere (hovering belongs to YouTube's own preview).

import { createLogger } from '@/core/log';
import { featureOn, getSettings, onSettingsChanged } from '@/core/settings';
import { type Animation, animate } from './animation';
import { type ThumbCard, thumbCards } from './cards';
import { type Loader, loadImage } from './images';

/** Layers over the page: a thumbnail underneath them is not being hovered. */
const ABOVE = 'ytd-miniplayer, #masthead-container';

interface State {
  card: ThumbCard;
  visible: boolean;
  moving?: Animation;
}

/** Returns a function that stops the feature for good. */
export async function startThumbs({ load = loadImage }: { load?: Loader } = {}): Promise<() => void> {
  const log = createLogger('thumbs');
  const cards = new Map<Element, State>(); // thumbnail element → card
  let enabled = false;
  let mo: MutationObserver | undefined;
  let io: IntersectionObserver | undefined;
  let scanTimer: ReturnType<typeof setTimeout> | undefined;
  /** Where the pointer was last, unless it left the window or is on a layer above the page. */
  let pointer: { x: number; y: number } | undefined;
  let frame: number | undefined;
  let hovered: State | undefined;

  const update = (s: State) => {
    const want = s.visible && s !== hovered && document.visibilityState === 'visible';
    if (want) s.moving ??= animate(s.card, load);
    else {
      s.moving?.stop();
      s.moving = undefined;
    }
  };

  const under = (p: { x: number; y: number }) => {
    for (const s of cards.values()) {
      if (!s.visible) continue;
      // The whole card, by geometry: YouTube's preview is a separate layer on top of it.
      const r = s.card.el.getBoundingClientRect();
      if (p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom) return s;
    }
    return undefined;
  };
  const rehover = () => {
    const was = hovered;
    hovered = pointer && under(pointer);
    if (was === hovered) return;
    if (was) update(was);
    if (hovered) update(hovered);
  };
  const rehoverSoon = () => {
    frame ??= requestAnimationFrame(() => {
      frame = undefined;
      rehover();
    });
  };
  const onPointer = (e: PointerEvent) => {
    const above = e.composedPath().some((n) => n instanceof Element && n.matches(ABOVE));
    pointer = above ? undefined : { x: e.clientX, y: e.clientY };
    rehoverSoon();
  };
  const onMouseOut = (e: MouseEvent) => {
    if (e.relatedTarget) return;
    pointer = undefined;
    rehoverSoon();
  };

  const drop = (thumb: Element, s: State) => {
    io?.unobserve(thumb);
    s.moving?.stop();
    cards.delete(thumb);
    if (hovered === s) hovered = undefined;
  };

  /** Match what we track to the cards on the page now (YouTube reuses elements). */
  const rescan = () => {
    const found = new Map(thumbCards().map((c) => [c.thumb as Element, c]));
    for (const [thumb, s] of cards) if (found.get(thumb)?.videoId !== s.card.videoId) drop(thumb, s);
    for (const [thumb, card] of found) {
      const known = cards.get(thumb);
      if (known) known.moving?.keep();
      else {
        cards.set(thumb, { card, visible: false });
        io?.observe(thumb);
      }
    }
  };
  const rescanSoon = () => {
    scanTimer ??= setTimeout(() => {
      scanTimer = undefined;
      rescan();
    }, 300);
  };

  const onIntersect = (entries: IntersectionObserverEntry[]) => {
    for (const e of entries) {
      const s = cards.get(e.target);
      if (!s) continue;
      s.visible = e.isIntersecting;
      update(s);
    }
    rehover();
  };

  const onVisibility = () => cards.forEach(update);

  const on = () => {
    enabled = true;
    io = new IntersectionObserver(onIntersect);
    mo = new MutationObserver(rescanSoon);
    mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['href'] });
    document.addEventListener('visibilitychange', onVisibility);
    document.addEventListener('pointermove', onPointer, { capture: true, passive: true });
    document.addEventListener('mouseout', onMouseOut, { passive: true });
    document.addEventListener('scroll', rehoverSoon, { capture: true, passive: true });
    window.addEventListener('scroll', rehoverSoon, { passive: true });
    rescan();
  };

  const off = () => {
    enabled = false;
    mo?.disconnect();
    for (const [thumb, s] of cards) drop(thumb, s);
    io?.disconnect();
    mo = io = undefined;
    if (scanTimer) clearTimeout(scanTimer);
    if (frame !== undefined) cancelAnimationFrame(frame);
    scanTimer = frame = pointer = undefined;
    document.removeEventListener('visibilitychange', onVisibility);
    document.removeEventListener('pointermove', onPointer, true);
    document.removeEventListener('mouseout', onMouseOut);
    document.removeEventListener('scroll', rehoverSoon, true);
    window.removeEventListener('scroll', rehoverSoon);
  };

  const apply = (want: boolean) => {
    if (want === enabled) return;
    if (want) on();
    else off();
  };
  const unwatch = onSettingsChanged((s) => apply(featureOn(s, 'thumbs')));
  apply(featureOn(await getSettings(), 'thumbs'));
  log.debug(`started on ${location.pathname}`);
  return () => {
    unwatch();
    apply(false);
  };
}
