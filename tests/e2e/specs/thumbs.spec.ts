// F-22 list-page thumbnails that move, on real YouTube: which source each page
// gives, where the pictures sit in the thumbnail, and that hovering, scrolling
// and the switch take them away again.
//   npx wxt build && npx playwright test -c tests/e2e/playwright.config.ts specs/thumbs.spec.ts --project=e2e
import type { BrowserContext, Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { VIDEOS } from '../support/env';
import { storageGet, storageSet } from '../support/yt';

async function setThumbs(ctx: BrowserContext, on: boolean): Promise<void> {
  const s = ((await storageGet(ctx, 'sync', 'settings')) ?? {}) as { features?: Record<string, boolean> };
  await storageSet(ctx, 'sync', { settings: { ...s, features: { ...s.features, thumbs: on } } });
}

test.afterEach(async ({ ctx }) => setThumbs(ctx, false));

interface Card {
  id: string;
  /** Sources of the picture showing now; undefined when the card is static. */
  src?: string;
  onScreen: boolean;
  loaded: boolean;
  /** The pictures cover exactly the thumbnail, above its image and below its overlays. */
  fits: boolean;
  /** YouTube's data for this card holds an animation link. */
  hasAnim: boolean;
}

const THUMBS = 'yt-thumbnail-view-model, ytd-thumbnail';
/** A search that gives ordinary videos: some queries fill the first screen with Shorts, which stay static. */
const QUERY = 'documentary';
const SEARCH = `/results?search_query=${encodeURIComponent(QUERY)}`;

/** Every laid-out horizontal video thumbnail and what covers it. */
const cards = (page: Page, root = 'ytd-app') => page.evaluate(({ root, THUMBS }) => {
  const out: Card[] = [];
  for (const thumb of document.querySelectorAll<HTMLElement>(`${root} :is(${THUMBS})`)) {
    if (thumb.closest('ytd-video-preview, ytd-miniplayer, ytm-shorts-lockup-view-model, yt-collection-thumbnail-view-model')) continue;
    const a = thumb.closest('a') ?? thumb.querySelector('a');
    const href = a?.getAttribute('href') ?? '';
    if (!href.startsWith('/watch?v=')) continue;
    // Live and upcoming cards stay static (F-22-AC5).
    if ([...thumb.querySelectorAll('badge-shape')].some((b) => /^(LIVE|UPCOMING|PREMIERE)/.test(b.textContent?.trim() ?? ''))) continue;
    const t = thumb.getBoundingClientRect();
    if (!t.width) continue;
    const layer = thumb.querySelector<HTMLElement>('ytpp-thumb-anim');
    const img = [...(layer?.querySelectorAll('img') ?? [])].find((i) => i.style.visibility !== 'hidden');
    const r = layer?.getBoundingClientRect();
    const under = layer?.previousElementSibling;
    const over = layer?.nextElementSibling;
    const id = new URL(href, location.origin).searchParams.get('v')!;
    let hasAnim = false;
    for (let n: Element | null = thumb, i = 0; n && i < 9 && !hasAnim; n = n.parentElement, i++) {
      const data = (n as Element & { data?: unknown }).data;
      if (data && typeof data === 'object') hasAnim = JSON.stringify(data).includes(`/an_webp/${id}/`);
    }
    out.push({
      id,
      hasAnim,
      src: img?.src,
      onScreen: t.bottom > 0 && t.top < innerHeight && t.right > 0 && t.left < innerWidth,
      loaded: !!img && img.complete && img.naturalWidth > 120,
      fits: !!r && Math.abs(r.left - t.left) < 1.5 && Math.abs(r.top - t.top) < 1.5 && Math.abs(r.width - t.width) < 1.5 && Math.abs(r.height - t.height) < 1.5
        && !!under?.querySelector('img') && (!over || !over.querySelector('img[src*="/vi/"], img[src*="/an_webp/"]')),
    });
  }
  return out;
}, { root, THUMBS });

const moving = async (page: Page, root?: string) => (await cards(page, root)).filter((c) => c.src);
const isAnim = (c: Card) => c.src!.startsWith(`https://i.ytimg.com/an_webp/${c.id}/`);
const isFrame = (c: Card) => new RegExp(`^https://i\\.ytimg\\.com/vi/${c.id}/mq[123]\\.jpg$`).test(c.src!);

/** Wait until most cards on screen move; return all that move. */
async function allMove(page: Page, root?: string, min = 2): Promise<Card[]> {
  await expect(async () => {
    const on = (await cards(page, root)).filter((c) => c.onScreen);
    const now = JSON.stringify(on.map((c) => [c.id, c.src?.split('?')[0] ?? 'static']));
    expect(on.length, now).toBeGreaterThanOrEqual(min);
    // A few videos have no frames (none cut): those stay static.
    expect(on.filter((c) => !c.src).length, now).toBeLessThanOrEqual(Math.floor(on.length * 0.3));
  }).toPass({ timeout: 30_000 });
  return moving(page, root);
}

test('F-22-AC3 off by default; the switch in settings turns it on and off at once', async ({ ctx, open }) => {
  const sw = ctx.serviceWorkers()[0]!;
  const options = await ctx.newPage();
  await options.goto(`chrome-extension://${new URL(sw.url()).host}/options.html#general`);
  const toggle = options.locator('label.switch-row', { hasText: 'Moving thumbnails' }).locator('input');
  await expect(toggle).not.toBeChecked();

  const page = await open(SEARCH);
  await page.bringToFront();
  await page.waitForTimeout(3000);
  await expect(page.locator('ytpp-thumb-anim')).toHaveCount(0);

  await toggle.click();
  await expect(toggle).toBeChecked();
  await page.bringToFront();
  await allMove(page);
  await toggle.click();
  await expect(page.locator('ytpp-thumb-anim')).toHaveCount(0);
  await page.waitForTimeout(2000);
  await expect(page.locator('ytpp-thumb-anim')).toHaveCount(0);
  await options.close();
});

test('F-22-AC1 search: YouTube\'s own animations, over the thumbnails, no player', async ({ ctx, open }, info) => {
  await setThumbs(ctx, true);
  const page = await open(SEARCH);
  const got = await allMove(page);
  await expect.poll(async () => (await moving(page)).filter((c) => c.onScreen).every((c) => c.loaded && c.fits)).toBe(true);
  expect(got.some(isAnim), 'official animations in search results').toBe(true);
  // A card with an animation shows it; one without shows the frames.
  for (const c of got) expect(c.hasAnim ? isAnim(c) : isFrame(c), `${c.id} (animation: ${c.hasAnim}) shows ${c.src}`).toBe(true);
  expect(await page.locator('ytpp-thumb-anim :is(video, audio, iframe)').count()).toBe(0);
  expect(await page.evaluate(() => [...document.querySelectorAll('video')].filter((v) => !v.paused).length)).toBe(0);
  await info.attach('search.png', { body: await page.screenshot(), contentType: 'image/png' });
});

test('F-22-AC1 home: the three frames in turn, about a second each', async ({ ctx, open }, info) => {
  await setThumbs(ctx, true);
  const page = await open('/');
  const first = (await allMove(page)).filter((c) => c.onScreen && isFrame(c))[0]!;
  expect(first, 'a home card showing frames').toBeTruthy();
  const seen = new Set<string>();
  await expect.poll(async () => {
    const now = (await cards(page)).find((c) => c.id === first.id)?.src;
    if (now) seen.add(now);
    return seen.size;
  }, { intervals: [250], timeout: 8000 }).toBeGreaterThanOrEqual(2);
  expect([...seen].every((src) => src.includes(`/vi/${first.id}/mq`))).toBe(true);
  expect((await moving(page)).filter((c) => c.onScreen).every((c) => c.fits)).toBe(true);
  await info.attach('home.png', { body: await page.screenshot(), contentType: 'image/png' });
});

test('F-22-AC2 only what is on screen: scrolled-out cards go static, new ones move', async ({ ctx, open }) => {
  await setThumbs(ctx, true);
  const page = await open(SEARCH);
  const top = (await allMove(page)).filter((c) => c.onScreen);
  expect((await cards(page)).filter((c) => !c.onScreen && c.src)).toEqual([]);
  await page.mouse.wheel(0, 4000);
  await expect.poll(async () => (await moving(page)).filter((c) => !c.onScreen).length).toBe(0);
  expect((await moving(page)).map((c) => c.id)).not.toContain(top[0]!.id);
  await allMove(page, undefined, 1);
  await page.mouse.wheel(0, -20_000);
  await expect.poll(async () => (await moving(page)).map((c) => c.id)).toContain(top[0]!.id);
});

test('F-22-AC4 the hovered card is static and YouTube\'s preview is left alone', async ({ ctx, open }) => {
  await setThumbs(ctx, true);
  const page = await open(SEARCH);
  const [one, two] = (await allMove(page)).filter((c) => c.onScreen);
  const has = async (id: string) => (await moving(page)).some((c) => c.id === id);
  await page.locator(`ytd-video-renderer ytd-thumbnail:has(a[href*="v=${one!.id}"])`).hover();
  await expect.poll(() => has(one!.id)).toBe(false);
  // Held while the pointer stays, with YouTube's preview on top.
  await page.waitForTimeout(3000);
  expect(await has(one!.id)).toBe(false);
  expect(await has(two!.id)).toBe(true);
  expect(await page.locator('ytd-video-preview ytpp-thumb-anim').count()).toBe(0);
  await page.mouse.move(5, 500);
  await expect.poll(() => has(one!.id)).toBe(true);
});

test('F-22-AC5 channel, watch sidebar and playlist, across in-app navigation; no Shorts', async ({ ctx, open, lists }, info) => {
  const list = await lists.create([VIDEOS.a, VIDEOS.b, VIDEOS.c], 'thumbs');
  await setThumbs(ctx, true);

  const page = await open('/@veritasium/videos');
  expect((await allMove(page)).some(isAnim), 'channel videos').toBe(true);

  await page.goto(`https://www.youtube.com/watch?v=${VIDEOS.zoo}`);
  // The sidebar starts below the fold in this window.
  await expect(page.locator('ytd-watch-flexy #secondary yt-thumbnail-view-model').first()).toBeAttached();
  await page.mouse.wheel(0, 700);
  expect((await allMove(page, 'ytd-watch-flexy #secondary')).some(isAnim), 'watch sidebar').toBe(true);

  await page.goto(`https://www.youtube.com/playlist?list=${list}`);
  const rows = await allMove(page, 'ytd-browse[page-subtype="playlist"]', 3);
  expect(rows.map((c) => c.id)).toEqual(expect.arrayContaining([VIDEOS.a, VIDEOS.b, VIDEOS.c]));
  await info.attach('playlist.png', { body: await page.screenshot(), contentType: 'image/png' });

  // In-app: search from the masthead.
  await page.locator('input[name="search_query"]').fill(QUERY);
  await page.keyboard.press('Enter');
  await page.waitForURL(/results/);
  await allMove(page, 'ytd-search');
  expect(await page.locator(':is(ytm-shorts-lockup-view-model, ytm-shorts-lockup-view-model-v2, ytd-reel-item-renderer) ytpp-thumb-anim').count()).toBe(0);
  // The pages left behind hold nothing.
  await expect(page.locator('ytd-browse ytpp-thumb-anim')).toHaveCount(0);
});

test('F-22-AC6 the duration stays on top and a click still opens the video', async ({ ctx, open }, info) => {
  await setThumbs(ctx, true);
  const page = await open('/@veritasium/videos');
  const card = (await allMove(page)).filter((c) => c.onScreen)[0]!;
  const thumb = page.locator(`ytd-rich-item-renderer a[href*="v=${card.id}"] yt-thumbnail-view-model`).first();
  const badge = thumb.locator('badge-shape').first();
  await expect(badge).toBeVisible();
  // The overlay paints after our layer.
  expect(await thumb.evaluate((t) => {
    const layer = t.querySelector('ytpp-thumb-anim')!;
    const b = t.querySelector('badge-shape')!;
    return !!(layer.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
  })).toBe(true);
  await info.attach('badge.png', { body: await thumb.screenshot(), contentType: 'image/png' });
  await thumb.click();
  await page.waitForURL(new RegExp(`/watch\\?v=${card.id}`));
});
