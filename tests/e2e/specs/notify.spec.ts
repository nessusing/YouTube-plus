// F-02 page notifications on real YouTube: in fullscreen the notice shows in
// the fullscreen player (only the fullscreen element is on screen), at the
// bottom, inside the screen. Shown the way the options page's Preview does it.
import type { BrowserContext, Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { VIDEOS } from '../support/env';
import { lastToast, serviceWorker, waitForVideo } from '../support/yt';

/** The options page's Preview: a message to this tab (core/notify.ts NOTIFY_PREVIEW). */
async function preview(ctx: BrowserContext, page: Page): Promise<void> {
  const url = page.url();
  const sw = await serviceWorker(ctx);
  await sw.evaluate(async (url) => {
    const c = (globalThis as unknown as { chrome: { tabs: { query(q: object): Promise<{ id: number; url?: string }[]>; sendMessage(id: number, m: unknown): Promise<unknown> } } }).chrome;
    const tab = (await c.tabs.query({})).find((t) => t.url === url);
    await c.tabs.sendMessage(tab!.id, { type: 'YouTube+/notify-preview' });
  }, url);
}

test('F-02-AC6 in fullscreen: the notice shows inside the fullscreen player, on screen', async ({ page, open, ctx }) => {
  await open(`/watch?v=${VIDEOS.a}`);
  await waitForVideo(page, VIDEOS.a);
  await page.locator('#movie_player .ytp-fullscreen-button').click();
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
  try {
    await preview(ctx, page);
    await expect.poll(() => lastToast(page)).toContain('YouTube+');
    const where = await page.evaluate(() => {
      const host = document.querySelector('ytpp-notify')!;
      const fs = document.fullscreenElement!;
      const r = host.getBoundingClientRect();
      return { inside: fs.contains(host), left: r.left, bottom: r.bottom, w: innerWidth, h: innerHeight };
    });
    expect(where.inside, 'inside the fullscreen element').toBe(true);
    expect(where.left).toBeGreaterThan(0);
    expect(where.left).toBeLessThan(where.w);
    expect(where.bottom).toBeGreaterThan(where.h / 2);
    expect(where.bottom).toBeLessThanOrEqual(where.h);
    await page.screenshot({ path: test.info().outputPath('fullscreen-notice.png') });
  } finally {
    await page.evaluate(() => document.exitFullscreen().catch(() => {}));
  }
});

/** The notice's bottom edge and the control bar's top, in the page. */
const edges = (page: Page) => page.evaluate(() => {
  const p = document.querySelector('#movie_player')!;
  return {
    notice: document.querySelector('ytpp-notify')?.getBoundingClientRect().bottom ?? NaN,
    bar: p.querySelector('.ytp-chrome-bottom')!.getBoundingClientRect().top,
    controls: !p.classList.contains('ytp-autohide'),
    h: innerHeight,
  };
});

test('F-02-AC6 in fullscreen: above the control bar while it shows, back to the bottom once it hides', async ({ page, open, ctx }) => {
  await open(`/watch?v=${VIDEOS.a}`);
  await waitForVideo(page, VIDEOS.a);
  await page.locator('#movie_player .ytp-fullscreen-button').click();
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
  try {
    // Controls up: the pointer moves over the player.
    await page.mouse.move(400, 300);
    await page.mouse.move(420, 320);
    await expect.poll(async () => (await edges(page)).controls).toBe(true);
    await preview(ctx, page);
    await expect.poll(() => lastToast(page)).toContain('YouTube+');
    await expect.poll(async () => { const e = await edges(page); return e.notice <= e.bar; }, { timeout: 3000 }).toBe(true);
    // Controls hide once the pointer rests (playing): the notice goes back down.
    await page.evaluate(() => (document.querySelector('#movie_player video') as HTMLVideoElement).play());
    await expect.poll(async () => (await edges(page)).controls, { timeout: 10_000 }).toBe(false);
    await expect.poll(async () => { const e = await edges(page); return e.notice > e.bar; }, { timeout: 3000 }).toBe(true);
  } finally {
    await page.evaluate(() => document.exitFullscreen().catch(() => {}));
  }
});
