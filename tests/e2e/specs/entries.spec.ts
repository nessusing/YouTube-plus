// Every way into Add to queue (F-05-AC6, F-05-AC7): in playlist mode each is
// relabelled "Add to <list>" and adds to the list.
import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { VIDEOS } from '../support/env';
import { addFromMenu, homeItems, OUR_ITEM, pickItem, related, videoIdOf } from '../support/ui';
import { lastToast, waitForVideo } from '../support/yt';

const ENTRIES: { name: string; path: (other: string) => string; items: (page: Page) => Locator }[] = [
  { name: 'home', path: () => '/', items: homeItems },
  { name: 'watch page sidebar', path: () => `/watch?v=${VIDEOS.a}`, items: related },
  { name: 'search results (old-style menu)', path: () => '/results?search_query=guitar+lesson', items: (p) => p.locator('ytd-search ytd-video-renderer') },
  { name: 'someone\'s playlist page', path: (other) => `/playlist?list=${other}`, items: (p) => p.locator('ytd-playlist-video-renderer') },
  { name: 'channel videos', path: () => '/@RickAstleyYT/videos', items: (p) => p.locator('ytd-rich-item-renderer yt-lockup-view-model') },
  { name: 'Shorts shelf', path: () => '/', items: (p) => p.locator('ytm-shorts-lockup-view-model, ytm-shorts-lockup-view-model-v2') },
];

for (const e of ENTRIES) {
  test(`F-05-AC5 F-05-AC7 ${e.name}: relabelled, adds to the list`, async ({ page, open, lists, setProfile }) => {
    const id = await lists.create([VIDEOS.zoo], `entry ${e.name}`);
    const other = await lists.create([VIDEOS.b, VIDEOS.c], 'other');
    await setProfile({ mode: 'playlist', listId: id, listName: 'x', removeWatched: true });
    await open(e.path(other));
    if (e.name.startsWith('watch')) await waitForVideo(page, VIDEOS.a);
    const items = e.items(page);
    // A list made a moment ago can show as empty for a while (findings A4): reload until it is there.
    await expect(async () => {
      if (!(await items.count())) await page.reload();
      await expect(items.first()).toBeVisible({ timeout: 5000 });
    }).toPass({ timeout: 60_000 });
    // Shorts have no watch link to skip by; any item that is not ours will do.
    const item = e.name === 'Shorts shelf' || e.name.includes('playlist page') ? items.first() : await pickItem(items, [VIDEOS.zoo, VIDEOS.a]);
    const videoId = await videoIdOf(item);
    const { label } = await addFromMenu(page, item);
    expect(label).toMatch(OUR_ITEM);
    await expect.poll(() => lastToast(page)).toMatch(/^(Added to|Already in) YouTube\+ e2e/);
    await expect.poll(() => lists.videos(id)).toEqual([VIDEOS.zoo, videoId]);
  });
}

test('F-05-AC5 hover button on a thumbnail: adds to the list and says so', async ({ page, open, lists, setProfile }) => {
  const id = await lists.create([VIDEOS.zoo], 'hover');
  await setProfile({ mode: 'playlist', listId: id, listName: 'x', removeWatched: true });
  await open('/@RickAstleyYT/videos');
  const item = await pickItem(page.locator('ytd-rich-item-renderer yt-lockup-view-model'), [VIDEOS.zoo]);
  const videoId = await videoIdOf(item);
  await item.locator('a[href*="/watch?v="]').first().hover();
  // YouTube's hover buttons: Watch later, then Add to queue.
  const hoverBtns = item.locator('[class*="ThumbnailHoverOverlayToggleActions"] button, ytd-thumbnail-overlay-toggle-button-renderer');
  await expect(hoverBtns.nth(1)).toBeVisible();
  await hoverBtns.nth(1).click();
  await expect.poll(() => lastToast(page)).toMatch(/^Added to YouTube\+ e2e/);
  await expect.poll(() => lists.videos(id)).toEqual([VIDEOS.zoo, videoId]);
});

test('F-05-AC7 hover button label says where it goes', async ({ page, open, lists, setProfile }) => {
  const id = await lists.create([VIDEOS.zoo], 'hover-label');
  await setProfile({ mode: 'playlist', listId: id, listName: 'x', removeWatched: true });
  await open('/@RickAstleyYT/videos');
  const item = page.locator('ytd-rich-item-renderer yt-lockup-view-model').first();
  await item.locator('a[href*="/watch?v="]').first().hover();
  const btn = item.locator('[class*="ThumbnailHoverOverlayToggleActions"] button, ytd-thumbnail-overlay-toggle-button-renderer').nth(1);
  await expect(btn).toBeVisible();
  await btn.hover();
  await page.waitForTimeout(800);
  const label = await btn.evaluate((b) => `${b.getAttribute('aria-label') ?? ''}|${(b as HTMLElement).title}|${document.querySelector('tp-yt-paper-tooltip:not([hidden]) #tooltip, .ytSpecTooltip')?.textContent ?? ''}`);
  expect(label).toMatch(/Add to YouTube\+ e2e/);
});
