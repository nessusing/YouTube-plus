// Top bar button, left of the avatar: "▶ <list name> · N" (design §24.4).

import { t } from '@/core/i18n';

const STYLE = `
  :host { all: initial; display: inline-flex; align-items: center; margin: 0 8px; }
  button { all: unset; box-sizing: border-box; cursor: pointer; display: inline-flex; align-items: center; gap: 6px;
    height: 36px; padding: 0 14px 0 10px; border-radius: 18px; max-width: 220px;
    font: 500 14px/1 Roboto, Arial, sans-serif; color: var(--yt-spec-text-primary, #0f0f0f);
    background: var(--yt-spec-badge-chip-background, rgba(0,0,0,.05)); }
  button:hover { background: var(--yt-spec-button-chip-background-hover, rgba(0,0,0,.1)); }
  button:focus-visible { outline: 2px solid #065fd4; outline-offset: 2px; }
  button[disabled] { cursor: default; opacity: .5; }
  .icon { flex: none; width: 0; height: 0; border-style: solid; border-width: 6px 0 6px 10px;
    border-color: transparent transparent transparent currentColor; }
  .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .n { flex: none; color: var(--yt-spec-text-secondary, #606060); }
  /* YouTube no longer sets the --yt-spec-* variables where we can see them. */
  :host-context(html[dark]) button { color: #f1f1f1; background: rgba(255,255,255,.1); }
  :host-context(html[dark]) button:hover { background: rgba(255,255,255,.2); }
  :host-context(html[dark]) .n { color: #aaa; }
`;

export interface PlayButton {
  show(name: string, count: number): void;
  hide(): void;
}

export function playButton(onClick: () => void): PlayButton {
  let host: HTMLElement | undefined;
  let btn: HTMLButtonElement | undefined;
  let want: { name: string; count: number } | undefined;
  let mo: MutationObserver | undefined;

  const render = () => {
    if (!btn || !want) return;
    btn.querySelector('.name')!.textContent = want.name;
    btn.querySelector('.n')!.textContent = `· ${want.count}`;
    btn.disabled = want.count === 0;
    const label = want.count ? t('queue.playLabel', { name: want.name, n: want.count }) : t('queue.playEmpty', { name: want.name });
    btn.title = label;
    btn.setAttribute('aria-label', label);
  };

  /** Put it before the avatar; the masthead can re-render, so keep checking. */
  const mount = () => {
    if (!want) return;
    const avatar = document.querySelector('ytd-masthead #end #avatar-btn')?.closest('ytd-topbar-menu-button-renderer')
      ?? document.querySelector('ytd-masthead #end ytd-topbar-menu-button-renderer:last-of-type');
    const end = document.querySelector('ytd-masthead #end');
    if (!avatar && !end) return;
    if (!host) {
      host = document.createElement('ytpp-queue-play');
      const root = host.attachShadow({ mode: 'closed' });
      root.innerHTML = `<style>${STYLE}</style><button type="button"><span class="icon"></span><span class="name"></span><span class="n"></span></button>`;
      btn = root.querySelector('button')!;
      btn.addEventListener('click', onClick);
    }
    if (avatar?.parentElement) {
      if (host.nextElementSibling !== avatar) avatar.before(host);
    } else if (end && host.parentElement !== end) {
      end.prepend(host);
    }
    render();
  };

  return {
    show(name, count) {
      want = { name, count };
      mount();
      if (!mo) {
        mo = new MutationObserver(() => {
          if (!host?.isConnected) mount();
        });
        mo.observe(document.documentElement, { childList: true, subtree: true });
      }
    },
    hide() {
      want = undefined;
      mo?.disconnect();
      mo = undefined;
      host?.remove();
    },
  };
}
