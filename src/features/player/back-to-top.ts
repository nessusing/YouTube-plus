// "Back to top" button on every YouTube page except Shorts (design §37).
// The miniplayer sits above it when they overlap (z-index), by decision.

import { t } from '@/core/i18n';
import type { Toggleable } from '@/core/dom';

const SHOW_AFTER = 300;

export function backToTop(): Toggleable {
  let host: HTMLElement | undefined;
  let btn: HTMLButtonElement | undefined;

  const update = () => {
    if (!btn) return;
    const show = window.scrollY > SHOW_AFTER && !location.pathname.startsWith('/shorts');
    btn.classList.toggle('show', show);
  };

  const onScroll = () => update();

  return {
    enable() {
      if (host) return;
      host = document.createElement('ytpp-back-to-top');
      // Below ytd-miniplayer (2030) so the miniplayer covers it; above page content.
      host.style.cssText = 'position:fixed;right:24px;bottom:24px;z-index:2025;width:48px;height:48px;pointer-events:none;';
      const root = host.attachShadow({ mode: 'closed' });
      root.innerHTML = `
        <style>
          button {
            all: unset; box-sizing: border-box; width: 48px; height: 48px; border-radius: 50%;
            display: grid; place-items: center; cursor: pointer;
            background: rgba(32,33,36,.55); color: #8ab4f8;
            opacity: 0; transform: translateY(8px); pointer-events: none;
            transition: opacity .2s, transform .2s, background-color .15s;
          }
          button.show { opacity: 1; transform: none; pointer-events: auto; }
          button:hover { background: rgba(32,33,36,.85); }
          button:focus-visible { outline: 2px solid #8ab4f8; outline-offset: 2px; }
          svg { width: 24px; height: 24px; }
        </style>
        <button type="button" aria-label="${t('backToTop')}" title="${t('backToTop')}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
        </button>`;
      btn = root.querySelector('button')!;
      // Jump, not smooth: theater mode only switches back at scrollY === 0 (§37).
      btn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'instant' }));
      document.documentElement.append(host);
      window.addEventListener('scroll', onScroll, { passive: true });
      document.addEventListener('yt-navigate-finish', onScroll);
      update();
    },
    disable() {
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('yt-navigate-finish', onScroll);
      host?.remove();
      host = btn = undefined;
    },
  };
}
