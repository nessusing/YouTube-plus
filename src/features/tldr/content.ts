// TL;DR in YouTube tabs (design §9 content script): scan thumbnails, add
// icons, track visibility and foreground, talk to the service worker.

import { initLang } from '@/core/i18n';
import { createLogger } from '@/core/log';
import { getSettings, onSettingsChanged } from '@/core/settings';
import { Icon } from './icon';
import { PORT_NAME, type ToService, type ToTab } from './messages';
import { scan, type Found } from './scanner';
import { Tooltip } from './tooltip';
import type { BadgeState } from './types';

export async function startTldr(): Promise<void> {
  const log = createLogger('tldr');
  let enabled = (await getSettings()).features.tldr;
  let port: Browser.runtime.Port | undefined;
  const icons = new Map<Element, Icon>(); // item element → icon (items get recycled)
  const states = new Map<string, BadgeState>();
  const titles = new Map<string, string>();
  const visible = new Set<string>();
  let mo: MutationObserver | undefined;
  let io: IntersectionObserver | undefined;
  let scanTimer: ReturnType<typeof setTimeout> | undefined;
  let ping: ReturnType<typeof setInterval> | undefined;

  const send = (m: ToService) => {
    try {
      if (!port) connect();
      port?.postMessage(m);
    } catch {
      port = undefined;
    }
  };

  const tooltip = new Tooltip({
    regenerate: (videoId) => send({ type: 'regenerate', item: { videoId, title: titles.get(videoId) ?? '' } }),
  });

  // YouTube's hover preview player is a separate layer above the thumbnail
  // (§14.1 wants the icon above it): float a copy over the hovered item.
  let floater: { icon: Icon; for: Icon } | undefined;
  const hideFloater = () => {
    floater?.icon.host.remove();
    floater = undefined;
  };
  const showFloater = (real: Icon) => {
    if (floater?.for === real) return;
    hideFloater();
    const r = real.host.getBoundingClientRect();
    if (!r.width) return;
    const icon = new Icon(real.videoId, () => onIconClick(real));
    icon.set(real.state);
    // Above the preview (z-index auto) but below the masthead (2020) and the miniplayer (2030).
    icon.host.style.cssText = `position:fixed;left:${r.left}px;top:${r.top}px;right:auto;bottom:auto;z-index:2010;`;
    document.documentElement.append(icon.host);
    floater = { icon, for: real };
  };
  // The preview layer is not inside the item, so match by geometry.
  let pending: PointerEvent | undefined;
  const onPointerOver = (e: PointerEvent) => {
    if (!pending) requestAnimationFrame(() => {
      const ev = pending!;
      pending = undefined;
      const path = ev.composedPath();
      if (floater && path.includes(floater.icon.host)) return;
      // A thumbnail under the miniplayer or the masthead is not being hovered.
      if (path.some((n) => n instanceof Element && (n.tagName === 'YTD-MINIPLAYER' || n.id === 'masthead-container'))) return hideFloater();
      for (const icon of icons.values()) {
        const r = icon.host.parentElement?.getBoundingClientRect();
        if (r && ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom) return showFloater(icon);
      }
      hideFloater();
    });
    pending = e;
  };

  const onState = (m: ToTab) => {
    states.set(m.videoId, m.badge);
    for (const icon of icons.values()) if (icon.videoId === m.videoId) icon.set(m.badge);
    if (floater?.for.videoId === m.videoId) floater.icon.set(m.badge);
    tooltip.update(m.videoId, m.badge);
  };

  function connect() {
    port = browser.runtime.connect({ name: PORT_NAME });
    port.onMessage.addListener((m: ToTab) => m.type === 'state' && onState(m));
    port.onDisconnect.addListener(() => {
      port = undefined;
      // Service worker restarted: re-announce what we have.
      if (enabled) setTimeout(() => announce([...icons.keys()].map((el) => el), true), 1000);
    });
    port.postMessage({ type: 'foreground', visible: document.visibilityState === 'visible' } satisfies ToService);
  }

  const onIconClick = (icon: Icon) => {
    const title = titles.get(icon.videoId) ?? '';
    const anchor = icon.host.parentElement ?? icon.host;
    if (icon.state.state === 'error' || icon.state.state === 'idle' || icon.state.state === 'queued') {
      send({ type: 'click', item: { videoId: icon.videoId, title } });
    }
    tooltip.open(anchor, icon.videoId, states.get(icon.videoId) ?? icon.state);
  };

  /** Make sure each found item has an icon for its current video; report new ones. */
  const announce = (els: Element[], force = false) => {
    const fresh: Found[] = [];
    for (const f of scan(document)) {
      if (els.length && !els.includes(f.el) && !force) continue;
      titles.set(f.videoId, f.title);
      let icon = icons.get(f.el);
      if (!icon || icon.videoId !== f.videoId) {
        icon?.host.remove();
        icon = new Icon(f.videoId, onIconClick);
        icons.set(f.el, icon);
        const known = states.get(f.videoId);
        if (known) icon.set(known);
        else fresh.push(f);
        io?.observe(f.el);
      } else if (force) fresh.push(f);
      icon.attach(f.thumb);
    }
    if (fresh.length) send({ type: 'want', items: fresh.map((f) => ({ videoId: f.videoId, title: f.title, visible: visible.has(f.videoId) })) });
  };

  const rescan = () => {
    if (scanTimer) return;
    scanTimer = setTimeout(() => {
      scanTimer = undefined;
      // Drop icons for items that left the page.
      for (const [el, icon] of icons) if (!el.isConnected) {
        icon.host.remove();
        icons.delete(el);
      }
      announce([], true);
    }, 300);
  };

  const onIntersect = (entries: IntersectionObserverEntry[]) => {
    const shown: string[] = [];
    const hidden: string[] = [];
    for (const e of entries) {
      const id = icons.get(e.target)?.videoId;
      if (!id) continue;
      if (e.isIntersecting) {
        visible.add(id);
        shown.push(id);
      } else {
        visible.delete(id);
        hidden.push(id);
      }
    }
    if (shown.length || hidden.length) send({ type: 'visible', shown, hidden });
  };

  const onVisibility = () => send({ type: 'foreground', visible: document.visibilityState === 'visible' });

  const on = () => {
    io = new IntersectionObserver(onIntersect, { rootMargin: '200px 0px' });
    mo = new MutationObserver(rescan);
    mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['href'] });
    document.addEventListener('visibilitychange', onVisibility);
    document.addEventListener('pointermove', onPointerOver, { capture: true, passive: true });
    window.addEventListener('scroll', hideFloater, { passive: true });
    // Keep the service worker awake while this tab is in front (MV3 idles it after ~30 s).
    ping = setInterval(() => document.visibilityState === 'visible' && send({ type: 'ping' }), 20_000);
    rescan();
  };

  const off = () => {
    mo?.disconnect();
    io?.disconnect();
    mo = io = undefined;
    if (ping) clearInterval(ping);
    document.removeEventListener('visibilitychange', onVisibility);
    document.removeEventListener('pointermove', onPointerOver, true);
    window.removeEventListener('scroll', hideFloater);
    hideFloater();
    for (const icon of icons.values()) icon.host.remove();
    icons.clear();
    tooltip.close();
    port?.disconnect();
    port = undefined;
  };

  // New language: summaries differ, so ask the service for every video again.
  await initLang(() => {
    if (!enabled) return;
    states.clear();
    tooltip.close();
    announce([], true);
  });
  onSettingsChanged((s) => {
    if (s.features.tldr === enabled) return;
    enabled = s.features.tldr;
    if (enabled) on();
    else off();
  });
  if (enabled) on();
  log.debug(`started on ${location.pathname}`);
}
