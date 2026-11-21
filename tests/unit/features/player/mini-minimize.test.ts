// @vitest-environment happy-dom
// Miniplayer minimize (§44): the button sits left of ✕; minimizing hides the
// miniplayer and shows a bar with only the title; clicking the bar restores;
// the state is remembered and only shows while a miniplayer is up.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { t } from '@/core/i18n';
import type { Logger } from '@/core/log';
import { MINI_MIN_KEY } from '@/features/player/consts';
import { miniMinimize, type MiniMinimize } from '@/features/player/mini-minimize';

const frame = () => new Promise((r) => requestAnimationFrame(() => r(undefined)));
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => {
  await tick();
  await frame();
  await tick();
};

const log: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
let part: MiniMinimize | undefined;

const app = () => document.querySelector('ytd-app')!;
const btn = () => document.querySelector<HTMLButtonElement>('.ytpp-mini-min');
const host = () => document.querySelector<HTMLElement>('ytpp-mini-bar');
const barShown = () => !!host() && host()!.style.display !== 'none';
const barText = () => host()?.shadowRoot?.querySelector('span')?.textContent;
const hidden = () => document.documentElement.hasAttribute('data-ytpp-mini-min');
const stored = async () => (await fakeBrowser.storage.local.get(MINI_MIN_KEY))[MINI_MIN_KEY];
const setTitle = (s: string) => {
  document.querySelector('[class*="ytdMiniplayerInfoBarTitle"] span')!.textContent = s;
};

beforeEach(() => {
  fakeBrowser.reset();
  document.body.innerHTML = `
    <ytd-app miniplayer-is-active="">
      <ytd-miniplayer>
        <div id="movie_player">
          <video></video>
          <div class="ytp-miniplayer-ui"><div class="ytp-miniplayer-scrim">
            <button class="ytp-miniplayer-close-button ytp-button"></button>
            <button class="ytp-miniplayer-expand-watch-page-button ytp-button"></button>
          </div></div>
        </div>
        <ytd-miniplayer-info-bar><div class="ytdMiniplayerInfoBarContent">
          <h1 class="ytdMiniplayerInfoBarTitle"><span>First video</span></h1>
        </div></ytd-miniplayer-info-bar>
      </ytd-miniplayer>
    </ytd-app>`;
});

afterEach(() => {
  part?.disable();
  part = undefined;
});

async function start(): Promise<MiniMinimize> {
  part = miniMinimize(log);
  part.enable();
  await settle();
  return part;
}

describe('miniplayer minimize', () => {
  it('sits right before ✕, labelled, and nothing is minimized yet', async () => {
    await start();
    expect(btn()?.nextElementSibling?.matches('.ytp-miniplayer-close-button')).toBe(true);
    expect(btn()?.getAttribute('aria-label')).toBe(t('player.miniMinimize'));
    expect(hidden()).toBe(false);
    expect(barShown()).toBe(false);
  });

  it('minimize: miniplayer hidden, bar with the title, remembered', async () => {
    await start();
    btn()!.click();
    await settle();
    expect(hidden()).toBe(true);
    expect(barShown()).toBe(true);
    expect(barText()).toBe('First video');
    expect(await stored()).toBe(true);
  });

  it('a click does not reach the player (the miniplayer scrim pauses on click)', async () => {
    await start();
    let reached = 0;
    document.querySelector('#movie_player')!.addEventListener('click', () => reached++);
    btn()!.click();
    expect(reached).toBe(0);
  });

  it('the bar follows the title of the next video', async () => {
    await start();
    btn()!.click();
    await settle();
    setTitle('Second video');
    await settle();
    expect(barText()).toBe('Second video');
  });

  it('clicking the bar restores and forgets', async () => {
    await start();
    btn()!.click();
    await settle();
    host()!.shadowRoot!.querySelector('button')!.click();
    await settle();
    expect(hidden()).toBe(false);
    expect(barShown()).toBe(false);
    expect(await stored()).toBeUndefined();
  });

  it('remembered: starts as the bar', async () => {
    await fakeBrowser.storage.local.set({ [MINI_MIN_KEY]: true });
    await start();
    expect(hidden()).toBe(true);
    expect(barShown()).toBe(true);
  });

  it('no miniplayer (watch page): no bar; it comes back with the miniplayer', async () => {
    await fakeBrowser.storage.local.set({ [MINI_MIN_KEY]: true });
    await start();
    app().removeAttribute('miniplayer-is-active');
    await settle();
    expect(hidden()).toBe(false);
    expect(barShown()).toBe(false);
    app().setAttribute('miniplayer-is-active', '');
    await settle();
    expect(hidden()).toBe(true);
    expect(barShown()).toBe(true);
  });

  it('follows another tab minimizing or restoring', async () => {
    await start();
    await fakeBrowser.storage.local.set({ [MINI_MIN_KEY]: true });
    await settle();
    expect(barShown()).toBe(true);
    await fakeBrowser.storage.local.remove(MINI_MIN_KEY);
    await settle();
    expect(barShown()).toBe(false);
  });

  it('comes back when YouTube re-renders the scrim', async () => {
    await start();
    const scrim = document.querySelector('.ytp-miniplayer-scrim')!;
    const close = document.createElement('button');
    close.className = 'ytp-miniplayer-close-button ytp-button';
    scrim.replaceChildren(close);
    await settle();
    expect(btn()?.nextElementSibling).toBe(close);
  });

  it('turned off: button and bar go, the miniplayer shows, the state is kept', async () => {
    const p = await start();
    btn()!.click();
    await settle();
    p.disable();
    part = undefined;
    expect(btn()).toBeNull();
    expect(host()).toBeNull();
    expect(hidden()).toBe(false);
    expect(document.getElementById('ytpp-mini-minimize')).toBeNull();
    expect(await stored()).toBe(true);
  });
});
