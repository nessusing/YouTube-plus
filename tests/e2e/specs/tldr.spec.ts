// TL;DR on real YouTube without asking Gemini: the fixture keeps TL;DR off;
// here it is on with prefetch off (one write, so nothing is prefetched), and
// nothing is clicked. What a click shows (F-03-AC3, AC12) is covered by L2:
// tooltip.test.ts, service.test.ts. The browser is muted (--mute-audio).
import type { BrowserContext, Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { VIDEOS } from '../support/env';
import { toMini } from '../support/ui';
import { storageGet, storageRemove, storageSet, waitForVideo } from '../support/yt';

const CACHE = (id: string) => `tldr/cache/orig:${id}`;
type Settings = { tldr?: Record<string, unknown>; features?: Record<string, boolean> };

// YouTube keeps earlier pages in the DOM, hidden: only the rows on screen.
const row = (page: Page, id: string) => page.locator(`ytd-playlist-video-renderer:visible:has(a[href*="v=${id}"])`).first();
const iconOf = (page: Page, id: string) => row(page, id).locator('ytpp-tldr-icon');

let before: Settings['tldr'];
// `account` first: setting it up turns TL;DR off for the suite (fixtures.ts).
test.beforeEach(async ({ ctx, account }) => {
  void account;
  const s = ((await storageGet(ctx, 'sync', 'settings')) ?? {}) as Settings;
  before = s.tldr;
  await storageSet(ctx, 'sync', { settings: { ...s, features: { ...s.features, tldr: true }, tldr: { ...s.tldr, prefetch: false } } });
});
test.afterEach(async ({ ctx }) => {
  const s = ((await storageGet(ctx, 'sync', 'settings')) ?? {}) as Settings;
  await storageSet(ctx, 'sync', { settings: { ...s, features: { ...s.features, tldr: false }, tldr: before } });
  for (const id of [VIDEOS.a, VIDEOS.zoo]) await storageRemove(ctx, 'local', CACHE(id));
});

test('F-03-AC1 F-03-AC2 an icon on every thumbnail, just above the duration, right edges lined up', async ({ page, open, lists }) => {
  const id = await lists.create([VIDEOS.a, VIDEOS.zoo], 'tldr-icons');
  await open(`/playlist?list=${id}`);
  for (const v of [VIDEOS.a, VIDEOS.zoo]) {
    await expect(iconOf(page, v)).toHaveCount(1, { timeout: 20_000 });
    await expect.poll(async () => {
      const [i, b] = await row(page, v).evaluate((r) => {
        const icon = r.querySelector('ytpp-tldr-icon')!.getBoundingClientRect();
        const badge = r.querySelector('badge-shape, ytd-thumbnail-overlay-time-status-renderer #time-status')!.getBoundingClientRect();
        return [{ right: icon.right, bottom: icon.bottom }, { right: badge.right, top: badge.top }];
      });
      return Math.abs(i!.right - b!.right) <= 2 && i!.bottom <= b!.top + 1 && b!.top - i!.bottom <= 6;
    }, { message: `icon of ${v} above its duration` }).toBe(true);
  }
});

test('F-03-AC2 the icons stay under the masthead and the miniplayer', async ({ page, open }) => {
  await open(`/watch?v=${VIDEOS.a}`);
  await waitForVideo(page, VIDEOS.a);
  const icons = page.locator('#secondary ytpp-tldr-icon');
  await expect.poll(() => icons.count(), { timeout: 30_000 }).toBeGreaterThan(3);
  // Scroll one icon up under the masthead: the masthead is what shows there.
  const covered = await icons.nth(2).evaluate(async (h) => {
    const r = h.getBoundingClientRect();
    window.scrollBy({ top: r.top + r.height / 2 - 28, behavior: 'instant' });
    await new Promise((res) => setTimeout(res, 300));
    const q = h.getBoundingClientRect();
    const hit = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2);
    return { underMasthead: q.top < 56, hitIsIcon: hit === h, hitInMasthead: !!hit?.closest('#masthead-container, ytd-masthead') };
  });
  expect(covered).toEqual({ underMasthead: true, hitIsIcon: false, hitInMasthead: true });

  // The miniplayer over the page below: an icon behind it does not show through.
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await toMini(page);
  const found = await expect.poll(() => page.evaluate(async () => {
    const mini = document.querySelector('ytd-miniplayer')!.getBoundingClientRect();
    for (let y = 0; y < 4000; y += 150) {
      window.scrollTo({ top: y, behavior: 'instant' });
      await new Promise((res) => setTimeout(res, 120));
      for (const h of document.querySelectorAll<HTMLElement>('ytpp-tldr-icon')) {
        const r = h.getBoundingClientRect();
        const x = r.left + r.width / 2;
        const yy = r.top + r.height / 2;
        if (!r.width || x < mini.left + 4 || x > mini.right - 4 || yy < mini.top + 4 || yy > mini.bottom - 4) continue;
        const hit = document.elementFromPoint(x, yy);
        return hit === h ? 'icon on top' : hit?.closest('ytd-miniplayer') ? 'miniplayer on top' : `other: ${hit?.tagName}`;
      }
    }
    return 'no icon behind the miniplayer';
  }), { timeout: 40_000 }).toBe('miniplayer on top');
  void found;
});
