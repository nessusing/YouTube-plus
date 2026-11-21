// The player feature on real YouTube: miniplayer drag, snap and remembered
// position (§35.2, §35.3), the watch page's sticky player and theater mode
// (§36), back to top (§37). Miniplayer controls are in mini-controls.spec.ts.
import type { BrowserContext, Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { VIDEOS } from '../support/env';
import { inClosedShadow, toMini } from '../support/ui';
import { player, storageGet, storageRemove, waitForVideo } from '../support/yt';

const MINI = 'ytd-miniplayer';
const POS_KEY = 'player/miniPos';
/** Snapped edges keep this gap (geometry.ts EDGE_GAP). */
const GAP = 16;

type Box = { x: number; y: number; width: number; height: number };
const miniBox = async (page: Page): Promise<Box> => (await page.locator(MINI).boundingBox())!;
const near = (a: number, b: number, tol = 3) => Math.abs(a - b) <= tol;
const viewport = (page: Page) => page.evaluate(() => ({
  w: document.documentElement.clientWidth,
  h: window.innerHeight,
  top: document.querySelector('#masthead-container')?.getBoundingClientRect().height ?? 56,
}));

/** Drag the miniplayer by its video area so that its top-left lands at (x, y). */
async function dragTo(page: Page, x: number, y: number): Promise<void> {
  const b = await miniBox(page);
  const area = (await page.locator(`${MINI} ytd-miniplayer-player-container`).boundingBox())!;
  // A spot on the picture, clear of the middle buttons and the bottom bar.
  const sx = area.x + area.width * 0.25;
  const sy = area.y + area.height * 0.3;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  const steps = 12;
  for (let i = 1; i <= steps; i++) await page.mouse.move(sx + ((x - b.x) * i) / steps, sy + ((y - b.y) * i) / steps);
  await page.mouse.up();
  await page.waitForTimeout(400);
}

async function miniOn(page: Page, open: (p: string) => Promise<Page>, v: string): Promise<void> {
  await open(`/watch?v=${v}`);
  await waitForVideo(page, v);
  await toMini(page);
  await page.waitForTimeout(500);
}

test.describe('miniplayer drag', () => {
  test.beforeEach(async ({ ctx }) => storageRemove(ctx, 'local', POS_KEY));
  test.afterEach(async ({ ctx }) => storageRemove(ctx, 'local', POS_KEY));

  test('dragged to the middle: stays where dropped, keeps playing, position saved', async ({ page, open, ctx }) => {
    await miniOn(page, open, VIDEOS.a);
    await page.evaluate(() => document.querySelector<HTMLVideoElement>('#movie_player video')!.play());
    const vp = await viewport(page);
    const b = await miniBox(page);
    const x = Math.round(vp.w / 2 - b.width / 2);
    const y = Math.round(vp.h / 2 - b.height / 2);
    await dragTo(page, x, y);
    const after = await miniBox(page);
    expect(near(after.x, x) && near(after.y, y), JSON.stringify({ x, y, after })).toBe(true);
    expect((await player(page)).paused, 'a drag must not pause').toBe(false);
    const saved = (await storageGet(ctx, 'local', POS_KEY)) as { corner: string; width: number } | undefined;
    expect(saved?.corner).toMatch(/^[tb][lr]$/);
    expect(near(saved!.width, after.width)).toBe(true);
  });

  test('dropped near an edge: snaps to it; near a corner: snaps to the corner', async ({ page, open }) => {
    await miniOn(page, open, VIDEOS.a);
    const vp = await viewport(page);
    const b = await miniBox(page);
    // 10 px from the left edge, vertically in the middle.
    await dragTo(page, 10, Math.round(vp.h / 2 - b.height / 2));
    let r = await miniBox(page);
    expect(near(r.x, GAP), `left edge: ${JSON.stringify(r)}`).toBe(true);
    expect(near(r.y, vp.h / 2 - b.height / 2, 4), 'y unchanged').toBe(true);
    // Into the top-left corner, under the masthead.
    await dragTo(page, 8, vp.top + 8);
    r = await miniBox(page);
    expect(near(r.x, GAP) && near(r.y, vp.top + GAP), `top-left corner: ${JSON.stringify(r)}`).toBe(true);
  });

  test('the position is remembered on the next page load; clearing it puts the miniplayer back', async ({ page, open, ctx }) => {
    await miniOn(page, open, VIDEOS.a);
    const home = await miniBox(page);
    const vp = await viewport(page);
    await dragTo(page, 200, Math.round(vp.top + 150));
    const placed = await miniBox(page);
    await expect.poll(() => storageGet(ctx, 'local', POS_KEY)).toBeTruthy();

    await miniOn(page, open, VIDEOS.b);
    const again = await miniBox(page);
    expect(near(again.x, placed.x) && near(again.y, placed.y), JSON.stringify({ placed, again })).toBe(true);

    // What "Reset miniplayer position" in the settings does.
    await storageRemove(ctx, 'local', POS_KEY);
    await expect.poll(async () => {
      const r = await miniBox(page);
      return near(r.x, home.x) && near(r.y, home.y);
    }).toBe(true);
  });
});

// ---------- watch page ----------

async function cookie(ctx: BrowserContext, name: string): Promise<string | undefined> {
  return (await ctx.cookies('https://www.youtube.com')).find((c) => c.name === name)?.value;
}

async function setWide(ctx: BrowserContext, v: '0' | '1'): Promise<void> {
  await ctx.addCookies([{ name: 'wide', value: v, domain: '.youtube.com', path: '/', secure: true, expires: Math.floor(Date.now() / 1000) + 3600 * 24 * 365 }]);
}

const theater = (page: Page) => page.locator('ytd-watch-flexy').evaluate((f) => f.hasAttribute('theater'));
const scrollTo = (page: Page, y: number) => page.evaluate((y) => window.scrollTo({ top: y, behavior: 'instant' }), y);
const scrollY = (page: Page) => page.evaluate(() => window.scrollY);
const playerTop = (page: Page) => page.locator('#primary-inner > #player').evaluate((e) => e.getBoundingClientRect().top);
const mastheadH = (page: Page) => page.evaluate(() => document.querySelector('#masthead-container')!.getBoundingClientRect().height);

test.describe('watch page', () => {
  let wideBefore: string | undefined;
  test.beforeEach(async ({ ctx }) => { wideBefore = await cookie(ctx, 'wide'); });
  test.afterEach(async ({ ctx }) => { if (wideBefore === '0' || wideBefore === '1') await setWide(ctx, wideBefore); });

  test('normal mode: the player stays at the top while the page scrolls', async ({ page, open, ctx }) => {
    await setWide(ctx, '0');
    await open(`/watch?v=${VIDEOS.a}`);
    await waitForVideo(page, VIDEOS.a);
    expect(await theater(page)).toBe(false);
    const mh = await mastheadH(page);
    for (const y of [600, 1500]) {
      await scrollTo(page, y);
      await page.waitForTimeout(400);
      expect(near(await playerTop(page), mh, 2), `player top at scrollY ${y}`).toBe(true);
    }
  });

  test('theater mode: scrolling down switches to normal (stuck), back at the top it returns; the preference is kept', async ({ page, open, ctx }) => {
    await setWide(ctx, '1');
    await open(`/watch?v=${VIDEOS.a}`);
    await waitForVideo(page, VIDEOS.a);
    await expect.poll(() => theater(page)).toBe(true);
    await page.mouse.move(700, 500);
    await page.mouse.wheel(0, 800);
    await expect.poll(() => theater(page)).toBe(false);
    // Our switch must not throw the page back to the top.
    await page.waitForTimeout(1000);
    expect(await scrollY(page)).toBeGreaterThan(200);
    expect(near(await playerTop(page), await mastheadH(page), 2), 'stuck').toBe(true);
    await expect.poll(() => cookie(ctx, 'wide'), { message: 'preference unchanged' }).toBe('1');
    await scrollTo(page, 0);
    await expect.poll(() => theater(page)).toBe(true);
    await page.waitForTimeout(2000);
    expect(await cookie(ctx, 'wide')).toBe('1');
  });

  test('stuck in normal mode, pressing t: back to the top in theater mode, saved as the preference', async ({ page, open, ctx }) => {
    await setWide(ctx, '0');
    await open(`/watch?v=${VIDEOS.a}`);
    await waitForVideo(page, VIDEOS.a);
    await scrollTo(page, 900);
    await page.waitForTimeout(500);
    // The shortcut goes to the page, not to a text field.
    await page.locator('#movie_player').click({ position: { x: 20, y: 20 } }).catch(() => {});
    await page.evaluate(() => document.querySelector<HTMLVideoElement>('#movie_player video')!.play());
    await page.keyboard.press('t');
    await expect.poll(() => theater(page)).toBe(true);
    await expect.poll(() => scrollY(page)).toBe(0);
    await expect.poll(() => cookie(ctx, 'wide')).toBe('1');
  });

  test('stuck: a timestamp link seeks without scrolling the page', async ({ page, open, ctx }) => {
    await setWide(ctx, '0');
    await open(`/watch?v=${VIDEOS.a}`);
    await waitForVideo(page, VIDEOS.a);
    // A timestamp like the ones YouTube makes in descriptions and comments.
    await page.locator('#primary-inner').evaluate((inner, v) => {
      const a = document.createElement('a');
      a.id = 'ytpp-e2e-ts';
      a.href = `/watch?v=${v}&t=95s`;
      a.textContent = '1:35';
      a.style.cssText = 'display:block;font-size:20px;';
      // Right under the title and description, where a timestamp would be; above the
      // comments, which load later and would push it down.
      const meta = inner.querySelector('ytd-watch-metadata');
      if (meta) meta.after(a);
      else inner.append(a);
    }, VIDEOS.a);
    const ts = page.locator('#ytpp-e2e-ts');
    // Scroll so the link sits in the lower half of the window, well below the stuck player.
    await ts.evaluate((a) => window.scrollTo({ top: window.scrollY + a.getBoundingClientRect().top - window.innerHeight * 0.75, behavior: 'instant' }));
    await page.waitForTimeout(500);
    // Measure and click with the mouse: a locator click could scroll first.
    const y = await scrollY(page);
    expect(y).toBeGreaterThan(0);
    const box = (await ts.boundingBox())!;
    await page.mouse.click(box.x + 10, box.y + box.height / 2);
    await expect.poll(async () => Math.round((await player(page)).time)).toBeGreaterThanOrEqual(95);
    await page.waitForTimeout(1500);
    expect(near(await scrollY(page), y, 5), 'no scroll').toBe(true);
    expect(page.url()).toContain(`v=${VIDEOS.a}`);
  });
});

// ---------- back to top ----------

test('back to top: shows after scrolling, jumps to the top, hides again', async ({ page, open }) => {
  await open('/');
  await expect(page.locator('ytd-rich-item-renderer').first()).toBeVisible({ timeout: 30_000 });
  const btn = () => inClosedShadow(page, 'ytpp-back-to-top', 'button');
  expect((await btn())?.className).not.toContain('show');
  await page.mouse.move(700, 500);
  await page.mouse.wheel(0, 1500);
  await expect.poll(async () => (await btn())?.className).toContain('show');
  await page.waitForTimeout(300);
  const b = (await btn())!;
  await page.mouse.click(b.x + b.w / 2, b.y + b.h / 2);
  await expect.poll(() => scrollY(page)).toBe(0);
  await expect.poll(async () => (await btn())?.className).not.toContain('show');
});
