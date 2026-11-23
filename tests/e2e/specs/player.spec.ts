// The player feature on real YouTube: miniplayer drag, snap and remembered
// position (F-07-AC2, F-07-AC3), the watch page's small window (F-08, with F-08-AC4 and
// F-08-AC5), back to top (F-09). Miniplayer controls are in mini-controls.spec.ts.
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

  test('F-07-AC2 dragged to the middle: stays where dropped, keeps playing, position saved', async ({ page, open, ctx }) => {
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

  test('F-07-AC2 dropped near an edge: snaps to it; near a corner: snaps to the corner', async ({ page, open }) => {
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

  test('F-07-AC3 the position is remembered on the next page load; clearing it puts the miniplayer back', async ({ page, open, ctx }) => {
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

// ---------- watch page: the small window (F-08) ----------

async function cookie(ctx: BrowserContext, name: string): Promise<string | undefined> {
  return (await ctx.cookies('https://www.youtube.com')).find((c) => c.name === name)?.value;
}

async function setWide(ctx: BrowserContext, v: '0' | '1'): Promise<void> {
  await ctx.addCookies([{ name: 'wide', value: v, domain: '.youtube.com', path: '/', secure: true, expires: Math.floor(Date.now() / 1000) + 3600 * 24 * 365 }]);
}

const FLOAT_KEY = 'player/floatPos';
/** float-state.ts: 400×225; right edge 24 + 48 + 16 px from the window's, bottom 24 px. */
const FLOAT = { w: 400, h: 225, right: 88, bottom: 24 };
const theater = (page: Page) => page.locator('ytd-watch-flexy').evaluate((f) => f.hasAttribute('theater'));
const scrollTo = (page: Page, y: number) => page.evaluate((y) => window.scrollTo({ top: y, behavior: 'instant' }), y);
const scrollY = (page: Page) => page.evaluate(() => window.scrollY);
const floating = (page: Page) => page.evaluate(() => document.documentElement.hasAttribute('data-ytpp-float'));
const floatBox = async (page: Page): Promise<Box> => (await page.locator('ytd-watch-flexy #player-container').boundingBox())!;
const videoBox = async (page: Page): Promise<Box> => (await page.locator('#movie_player video').boundingBox())!;

async function watch(page: Page, open: (p: string) => Promise<Page>, ctx: BrowserContext, wide: '0' | '1'): Promise<void> {
  await setWide(ctx, wide);
  await open(`/watch?v=${VIDEOS.a}`);
  await waitForVideo(page, VIDEOS.a);
  await page.evaluate(() => document.querySelector<HTMLVideoElement>('#movie_player video')!.play());
}

/**
 * Scroll down to the comments and wait for the window to float. The scroll is
 * repeated while waiting: right after load the page can be too short to reach
 * `y`, and stopping where the player is still mostly on screen never floats.
 */
async function floatIt(page: Page, y = 1500): Promise<void> {
  await expect.poll(async () => {
    await scrollTo(page, y);
    return floating(page);
  }).toBe(true);
  await page.waitForTimeout(500);
}

test.describe('watch page', () => {
  let wideBefore: string | undefined;
  test.beforeEach(async ({ ctx }) => {
    wideBefore = await cookie(ctx, 'wide');
    await storageRemove(ctx, 'local', FLOAT_KEY);
  });
  test.afterEach(async ({ ctx }) => {
    if (wideBefore === '0' || wideBefore === '1') await setWide(ctx, wideBefore);
    await storageRemove(ctx, 'local', FLOAT_KEY);
  });

  test('F-08-AC1 normal mode: scrolled down, the player floats bottom right left of "back to top"; back up, it returns', async ({ page, open, ctx }) => {
    await watch(page, open, ctx, '0');
    const inPage = await floatBox(page);
    await scrollTo(page, Math.round(inPage.height * 0.2));
    await page.waitForTimeout(400);
    expect(await floating(page), 'mostly on screen: stays').toBe(false);

    await floatIt(page);
    const vp = await viewport(page);
    const b = await floatBox(page);
    expect(near(b.width, FLOAT.w) && near(b.height, FLOAT.h), JSON.stringify(b)).toBe(true);
    expect(near(vp.w - (b.x + b.width), FLOAT.right) && near(vp.h - (b.y + b.height), FLOAT.bottom), JSON.stringify({ vp, b })).toBe(true);
    // YouTube refits the video to the window.
    await expect.poll(async () => (await videoBox(page)).width <= FLOAT.w + 1).toBe(true);
    expect((await player(page)).paused, 'keeps playing').toBe(false);

    await scrollTo(page, 0);
    await expect.poll(() => floating(page)).toBe(false);
    await expect.poll(async () => near((await floatBox(page)).width, inPage.width)).toBe(true);
    await expect.poll(async () => (await videoBox(page)).width > FLOAT.w + 100).toBe(true);
  });

  test('F-08-AC1 theater mode: floats too, and stays in theater mode', async ({ page, open, ctx }) => {
    await watch(page, open, ctx, '1');
    await expect.poll(() => theater(page)).toBe(true);
    await floatIt(page);
    expect(await theater(page)).toBe(true);
    const b = await floatBox(page);
    expect(near(b.width, FLOAT.w) && near(b.height, FLOAT.h), JSON.stringify(b)).toBe(true);
    // On top of the right column's thumbnails (in theater mode they used to cover it).
    const onTop = await page.evaluate(() => {
      const box = document.querySelector('ytd-watch-flexy #player-container')!;
      const r = box.getBoundingClientRect();
      return [[0.5, 0.5], [0.9, 0.5], [0.5, 0.9]].map(([x, y]) => box.contains(document.elementFromPoint(r.left + r.width * x!, r.top + r.height * y!)));
    });
    expect(onTop, 'nothing covers the window').toEqual([true, true, true]);
    await scrollTo(page, 0);
    await expect.poll(() => floating(page)).toBe(false);
    expect(await theater(page)).toBe(true);
    expect(await cookie(ctx, 'wide')).toBe('1');
  });

  test('F-08-AC4 floating, pressing t: back to the top in theater mode', async ({ page, open, ctx }) => {
    await watch(page, open, ctx, '0');
    await floatIt(page, 900);
    // The shortcut goes to the page, not to a text field.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
    await page.keyboard.press('t');
    await expect.poll(() => theater(page)).toBe(true);
    await expect.poll(() => scrollY(page)).toBe(0);
    await expect.poll(() => floating(page)).toBe(false);
  });

  test('F-08-AC3 floating: the Expand button goes back to the top', async ({ page, open, ctx }) => {
    await watch(page, open, ctx, '0');
    await floatIt(page);
    const b = await floatBox(page);
    // Controls (and the button) show while the mouse moves over the window.
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.move(b.x + 20, b.y + 20, { steps: 4 });
    await page.locator('#movie_player .ytpp-float-expand').click();
    await expect.poll(() => scrollY(page)).toBe(0);
    await expect.poll(() => floating(page)).toBe(false);
    expect((await player(page)).paused, 'the click must not pause').toBe(false);
  });

  test('F-08-AC2 floating: dragged to the middle it stays there, keeps playing, and is remembered', async ({ page, open, ctx }) => {
    await watch(page, open, ctx, '0');
    await floatIt(page);
    const vp = await viewport(page);
    const b = await floatBox(page);
    const x = Math.round(vp.w / 2 - b.width / 2);
    const y = Math.round(vp.h / 2 - b.height / 2);
    // A spot on the picture, clear of the top buttons and the bottom bar.
    const sx = b.x + b.width * 0.5;
    const sy = b.y + b.height * 0.45;
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) await page.mouse.move(sx + ((x - b.x) * i) / 12, sy + ((y - b.y) * i) / 12);
    await page.mouse.up();
    await page.waitForTimeout(400);
    const after = await floatBox(page);
    expect(near(after.x, x) && near(after.y, y), JSON.stringify({ x, y, after })).toBe(true);
    expect((await player(page)).paused, 'a drag must not pause').toBe(false);
    await expect.poll(() => storageGet(ctx, 'local', FLOAT_KEY)).toBeTruthy();

    // Back in the page and out again: same place.
    await scrollTo(page, 0);
    await expect.poll(() => floating(page)).toBe(false);
    await floatIt(page);
    const again = await floatBox(page);
    expect(near(again.x, x) && near(again.y, y), JSON.stringify({ x, y, again })).toBe(true);

    // What "Reset … positions" in the settings does.
    await storageRemove(ctx, 'local', FLOAT_KEY);
    await expect.poll(async () => {
      const r = await floatBox(page);
      return near(vp.w - (r.x + r.width), FLOAT.right) && near(vp.h - (r.y + r.height), FLOAT.bottom);
    }).toBe(true);
  });

  test('F-08-AC5 floating: a timestamp link seeks without scrolling the page', async ({ page, open, ctx }) => {
    await watch(page, open, ctx, '0');
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
    // Scroll so the link sits near the top of the window, with the player floating.
    await ts.evaluate((a) => window.scrollTo({ top: window.scrollY + a.getBoundingClientRect().top - window.innerHeight * 0.3, behavior: 'instant' }));
    await expect.poll(() => floating(page)).toBe(true);
    await page.waitForTimeout(500);
    // Measure and click with the mouse: a locator click could scroll first.
    const y = await scrollY(page);
    const box = (await ts.boundingBox())!;
    await page.mouse.click(box.x + 10, box.y + box.height / 2);
    await expect.poll(async () => Math.round((await player(page)).time)).toBeGreaterThanOrEqual(95);
    await page.waitForTimeout(1500);
    expect(near(await scrollY(page), y, 5), 'no scroll').toBe(true);
    expect(page.url()).toContain(`v=${VIDEOS.a}`);
  });
});

// ---------- back to top ----------

test('F-09-AC1 back to top: shows after scrolling, jumps to the top, hides again', async ({ page, open }) => {
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

test('F-09-AC2 where back to top and the miniplayer overlap, the miniplayer is on top', async ({ page, open }) => {
  await open(`/watch?v=${VIDEOS.a}`);
  await waitForVideo(page, VIDEOS.a);
  await toMini(page);
  await page.mouse.move(400, 400);
  await page.mouse.wheel(0, 1500);
  const btn = () => inClosedShadow(page, 'ytpp-back-to-top', 'button');
  await expect.poll(async () => (await btn())?.className).toContain('show');
  await page.waitForTimeout(300);
  const b = (await btn())!;
  const m = (await page.locator('ytd-miniplayer').boundingBox())!;
  // The overlap of the two, if any.
  const x0 = Math.max(b.x, m.x), x1 = Math.min(b.x + b.w, m.x + m.width);
  const y0 = Math.max(b.y, m.y), y1 = Math.min(b.y + b.h, m.y + m.height);
  expect(x1 > x0 && y1 > y0, `they overlap: button ${JSON.stringify(b)}, miniplayer ${JSON.stringify(m)}`).toBe(true);
  const onTop = await page.evaluate(([x, y]) => {
    const hit = document.elementFromPoint(x!, y!);
    return hit?.closest('ytd-miniplayer') ? 'miniplayer' : hit?.tagName.toLowerCase();
  }, [(x0 + x1) / 2, (y0 + y1) / 2]);
  expect(onTop).toBe('miniplayer');
});
