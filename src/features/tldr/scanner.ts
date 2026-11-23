// Finds video thumbnails, filters out Shorts and live/upcoming, and reports
// which are on screen (F-03-AC1, F-03 VisibilityTracker).

import { BADGES, ITEM, LINK, LIVEISH, SHORTS, THUMB, TITLE } from './selectors';

export interface Found { el: Element; thumb: HTMLElement; videoId: string; title: string }

export function videoIdOf(el: Element): string | undefined {
  const a = el.querySelector<HTMLAnchorElement>(LINK);
  if (!a) return undefined;
  try {
    const u = new URL(a.href, location.origin);
    if (u.pathname.startsWith('/shorts/')) return undefined;
    const v = u.searchParams.get('v');
    return v && /^[\w-]{11}$/.test(v) ? v : undefined;
  } catch {
    return undefined;
  }
}

export function inspect(el: Element): Found | undefined {
  if (el.closest(SHORTS) || el.querySelector(SHORTS)) return undefined;
  const videoId = videoIdOf(el);
  const thumb = el.querySelector<HTMLElement>(THUMB);
  if (!videoId || !thumb) return undefined;
  for (const b of thumb.querySelectorAll(BADGES)) {
    if (LIVEISH.test(b.textContent ?? '') || /live|upcoming/i.test((b as HTMLElement).className ?? '')) return undefined;
  }
  const t = el.querySelector(TITLE);
  const title = (t?.getAttribute('title') ?? t?.textContent ?? '').trim();
  return { el, thumb, videoId, title };
}

export function scan(root: ParentNode = document): Found[] {
  const out: Found[] = [];
  for (const el of root.querySelectorAll(ITEM)) {
    // Nested matches (e.g. a lockup inside a renderer): keep the innermost.
    if (el.querySelector(ITEM)) continue;
    const f = inspect(el);
    if (f) out.push(f);
  }
  return out;
}
