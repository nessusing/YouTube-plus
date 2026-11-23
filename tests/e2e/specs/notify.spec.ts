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

test('F-02 in fullscreen: the notice shows inside the fullscreen player, on screen', async ({ page, open, ctx }) => {
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
