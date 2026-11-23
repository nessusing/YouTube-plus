// Pop the miniplayer out to a Document PiP window (§50): open from the watch
// page with the shortcut and from the miniplayer's button; the keys and the
// buttons in the PiP window; back in on the shortcut, ✕ and Esc; the shortcut
// setting; full screen from PiP goes to the tab. The browser is muted (--mute-audio).
import type { BrowserContext, Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { VIDEOS } from '../support/env';
import { toMini } from '../support/ui';
import { storageGet, storageSet } from '../support/yt';

interface PipState {
  popped: boolean;
  mini: boolean;
  path: string;
  bar: string[];
  paused?: boolean;
  t?: number;
  muted?: boolean;
  fitted: boolean;
}

/** Where the player is and how it looks, from the page (it can see into the PiP window). */
function pipState(page: Page): Promise<PipState> {
  return page.evaluate(() => {
    type P = HTMLElement & { isMuted?(): boolean };
    const pw = (window as unknown as { documentPictureInPicture?: { window: Window | null } }).documentPictureInPicture?.window;
    const p = document.querySelector<P>('#movie_player') ?? pw?.document.querySelector<P>('#movie_player');
    const v = p?.querySelector('video');
    const r = p?.getBoundingClientRect();
    const vw = v ? parseFloat(v.style.width) : 0;
    const vh = v ? parseFloat(v.style.height) : 0;
    return {
      popped: !!pw && p?.ownerDocument === pw.document,
      mini: !!document.querySelector('ytd-app')?.hasAttribute('miniplayer-is-active'),
      path: location.pathname,
      bar: [...document.querySelectorAll<HTMLElement>('ytpp-mini-bar')].filter((b) => b.style.display !== 'none')
        .map((b) => b.shadowRoot?.querySelector('span')?.textContent ?? ''),
      paused: v?.paused,
      t: v?.currentTime,
      muted: p?.isMuted?.(),
      fitted: !!r && !!v && (Math.abs(vw - r.width) <= 1 || Math.abs(vh - r.height) <= 1),
    };
  });
}

/** Run `act` and return the PiP window it opens. */
async function opens(ctx: BrowserContext, act: () => Promise<unknown>): Promise<Page> {
  const [pip] = await Promise.all([ctx.waitForEvent('page'), act()]);
  return pip;
}

/** The setting as the options page saves it. */
async function setPipShortcut(ctx: BrowserContext, v: string): Promise<void> {
  const s = ((await storageGet(ctx, 'sync', 'settings')) ?? {}) as { shortcuts?: Record<string, string> };
  await storageSet(ctx, 'sync', { settings: { ...s, shortcuts: { ...s.shortcuts, pip: v } } });
}

/**
 * Whether YouTube's own Esc closes the miniplayer on this account (F-11-AC4
 * relies on it). Some accounts get an experiment where it does not; then the
 * step is skipped with a note instead of failing (D-022). Leaves the page in
 * the miniplayer either way.
 */
async function escClosesMini(page: Page): Promise<boolean> {
  await page.bringToFront();
  await page.keyboard.press('Escape');
  const closed = await expect.poll(async () => (await pipState(page)).mini, { timeout: 5000 }).toBe(false).then(() => true, () => false);
  if (!closed) {
    const note = 'YouTube on this account does not close the miniplayer on Esc (an experiment?); Esc step skipped';
    test.info().annotations.push({ type: 'skipped step', description: note });
    console.log(`NOTE: ${note}`);
    return false;
  }
  await page.goto(`https://www.youtube.com/watch?v=${VIDEOS.b}`);
  await expect.poll(async () => (await pipState(page)).t ?? 0, { timeout: 30_000 }).toBeGreaterThan(1);
  await toMini(page);
  return true;
}

test.describe('pop-out (§50)', () => {
  test.afterEach(async ({ ctx }) => setPipShortcut(ctx, 'Shift+I'));

  test('F-11-AC2 F-11-AC3 F-11-AC4 watch page → Shift+I → PiP: keys, buttons, back in', async ({ ctx, open }) => {
    const page = await open(`/watch?v=${VIDEOS.a}`);
    await expect.poll(async () => (await pipState(page)).t ?? 0, { timeout: 30_000 }).toBeGreaterThan(1);
    await page.locator('#movie_player').hover();

    const pip = await opens(ctx, () => page.keyboard.press('Shift+I'));
    await test.step('popped out from the watch page, as `i` would', async () => {
      await expect.poll(async () => (await pipState(page)).popped, { timeout: 10_000 }).toBe(true);
      const s = await pipState(page);
      expect.soft(s.mini, 'the page is in its miniplayer state').toBe(true);
      expect.soft(s.path, 'left the watch page').not.toBe('/watch');
      expect.soft(s.bar, 'the bar stands in for the miniplayer').toEqual(['Playing in the pop-out window']);
      await expect.poll(async () => (await pipState(page)).fitted, { message: 'video fits the window' }).toBe(true);
      expect.soft(s.paused, 'still playing').toBe(false);
    });

    await test.step('keys in the PiP window', async () => {
      await pip.keyboard.press('k');
      await expect.poll(async () => (await pipState(page)).paused).toBe(true);
      await pip.keyboard.press('Space');
      await expect.poll(async () => (await pipState(page)).paused).toBe(false);
      const t0 = (await pipState(page)).t!;
      await pip.keyboard.press('ArrowRight');
      await expect.poll(async () => (await pipState(page)).t! - t0).toBeGreaterThan(4);
      const m0 = (await pipState(page)).muted;
      await pip.keyboard.press('m');
      await expect.poll(async () => (await pipState(page)).muted).toBe(!m0);
      await pip.keyboard.press('m');
    });

    await test.step('✕ in the player: back in the miniplayer, still playing', async () => {
      await pip.mouse.move(200, 200);
      await pip.locator('.ytpp-pip-close').click();
      await expect.poll(async () => (await pipState(page)).popped).toBe(false);
      const s = await pipState(page);
      expect.soft(s.mini).toBe(true);
      expect.soft(s.bar).toEqual([]);
      expect.soft(s.paused).toBe(false);
    });
  });

  test('F-11-AC2 F-11-AC4 miniplayer button, Shift+I back, Esc, shortcut off', async ({ ctx, open }) => {
    const page = await open(`/watch?v=${VIDEOS.b}`);
    await expect.poll(async () => (await pipState(page)).t ?? 0, { timeout: 30_000 }).toBeGreaterThan(1);
    await toMini(page);

    await test.step('the button right of Expand, with its tooltip', async () => {
      await page.locator('ytd-miniplayer #movie_player').hover();
      await page.locator('.ytpp-pip-open').hover();
      await expect(page.locator('.ytpp-pip-open-tip')).toHaveText('PiP (Shift+I)');
      await opens(ctx, () => page.locator('.ytpp-pip-open').click());
      await expect.poll(async () => (await pipState(page)).popped).toBe(true);
    });

    await test.step('Shift+I on the page: back in', async () => {
      await page.bringToFront();
      await page.mouse.move(700, 500);
      await page.keyboard.press('Shift+I');
      await expect.poll(async () => (await pipState(page)).popped).toBe(false);
    });

    await test.step('Esc closes the miniplayer: the PiP window goes too', async () => {
      if (!(await escClosesMini(page))) return;
      await opens(ctx, () => page.keyboard.press('Shift+I'));
      await expect.poll(async () => (await pipState(page)).popped).toBe(true);
      await page.bringToFront();
      await page.keyboard.press('Escape');
      await expect.poll(async () => (await pipState(page)).mini).toBe(false);
      expect.soft((await pipState(page)).popped).toBe(false);
    });

    await test.step('shortcut cleared: Shift+I does nothing', async () => {
      await page.goto(`https://www.youtube.com/watch?v=${VIDEOS.b}`);
      await expect.poll(async () => (await pipState(page)).t ?? 0, { timeout: 30_000 }).toBeGreaterThan(1);
      await toMini(page);
      await setPipShortcut(ctx, '');
      await page.waitForTimeout(500);
      await page.keyboard.press('Shift+I');
      await page.waitForTimeout(1500);
      expect.soft((await pipState(page)).popped).toBe(false);
    });
  });

  test('F-11-AC5 full screen from PiP: the tab, the watch page covered; f back into PiP', async ({ ctx, open }) => {
    const page = await open(`/watch?v=${VIDEOS.c}`);
    await expect.poll(async () => (await pipState(page)).t ?? 0, { timeout: 30_000 }).toBeGreaterThan(1);
    await page.locator('#movie_player').hover();
    const pip = await opens(ctx, () => page.keyboard.press('Shift+I'));
    await expect.poll(async () => (await pipState(page)).popped, { timeout: 10_000 }).toBe(true);
    expect.soft(await pip.locator('.ytpp-pip-in').count(), 'only ✕ in the player').toBe(1);

    await pip.mouse.move(200, 200);
    await pip.locator('.ytp-chrome-bottom .ytp-fullscreen-button').click();
    await expect.poll(async () => (await pipState(page)).path, { timeout: 10_000 }).toBe('/watch');
    const cover = () => page.evaluate(() => {
      const r = document.querySelector('ytd-watch-flexy #player-container')?.getBoundingClientRect();
      return document.documentElement.hasAttribute('data-ytpp-full') && !!r && Math.round(r.width) === innerWidth && Math.round(r.height) === innerHeight;
    });
    await expect.poll(cover, { message: 'the player covers the page' }).toBe(true);
    const s = await pipState(page);
    expect.soft(s.popped).toBe(false);
    expect.soft(s.paused).toBe(false);

    // f is the user's key: the browser lets the PiP window open again.
    await opens(ctx, () => page.keyboard.press('f'));
    await expect.poll(async () => (await pipState(page)).popped, { timeout: 10_000 }).toBe(true);
    expect.soft(await page.evaluate(() => document.documentElement.hasAttribute('data-ytpp-full'))).toBe(false);
    await expect.poll(async () => (await pipState(page)).fitted).toBe(true);
  });
});
