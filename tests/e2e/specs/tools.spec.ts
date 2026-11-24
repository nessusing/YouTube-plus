// "Clear all" and "Remove watched" in the official ⋮ menus (F-06):
// on the page of a list we can edit, and while taking over, in the panel
// showing the chosen list. No confirm, no undo. Dragging an entry out of the
// panel removes it (F-06).
import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { VIDEOS } from '../support/env';
import { lastToast, panelData, player, waitForVideo } from '../support/yt';

const OURS = ['Clear all', 'Remove watched'];

/** The list's rows on its page (video IDs, in order); not the recommended videos under it, which have no setVideoId. */
const pageRows = (page: Page) => page.locator('ytd-playlist-video-renderer').evaluateAll(
  (els) => els.map((e) => (e as HTMLElement & { data?: { videoId?: string; setVideoId?: string } }).data)
    .filter((d) => d?.setVideoId).map((d) => d!.videoId ?? ''),
).catch(() => [] as string[]);

async function openList(page: Page, open: (p: string) => Promise<Page>, id: string, n: number): Promise<void> {
  // The page can come with the list as it was a few seconds ago (findings A4): load it again.
  await expect(async () => {
    await open(`/playlist?list=${id}`);
    await expect.poll(() => pageRows(page).then((r) => r.length), { timeout: 8000 }).toBe(n);
  }).toPass({ timeout: 45_000 });
}

/** The items of the menu open now (new-style sheet or old-style popup). */
const menuItems = (page: Page) => page.locator('ytd-popup-container tp-yt-iron-dropdown:visible').locator('yt-list-item-view-model, ytd-menu-service-item-renderer');
const itemTexts = async (page: Page) => (await menuItems(page).allInnerTexts()).map((s) => s.trim()).filter(Boolean);

/** The ⋮ in the list page's header. */
const headerMore = (page: Page) => page.locator('yt-page-header-renderer:visible').getByRole('button', { name: 'More actions' }).first();
/** The ⋮ in the panel's header (beside the watch page). */
const panelMore = (page: Page) => page.locator('ytd-watch-flexy ytd-playlist-panel-renderer').locator('#overflow-menu ytd-menu-renderer button, #overflow-menu-top-row ytd-menu-renderer button').locator('visible=true').first();

/** Open a ⋮ menu; `ours`: whether our two items belong in it (then wait for them). */
async function openMenu(page: Page, more: Locator, ours = true): Promise<string[]> {
  await more.click();
  await expect(menuItems(page).first()).toBeVisible({ timeout: 10_000 });
  // Ours go in once it opens, sometimes a moment later (seen flaky with a fixed 300 ms wait).
  if (ours) await expect.poll(async () => (await itemTexts(page)).slice(-2), { timeout: 5000 }).toEqual(OURS);
  else await page.waitForTimeout(1500); // time enough for them to have gone in, were they wrongly added
  return itemTexts(page);
}

async function pick(page: Page, more: Locator, item: 'Clear all' | 'Remove watched'): Promise<void> {
  const texts = await openMenu(page, more);
  expect(texts.slice(-2)).toEqual(OURS);
  await menuItems(page).filter({ hasText: item }).click();
  await expect(page.locator('ytd-popup-container tp-yt-iron-dropdown:visible')).toHaveCount(0);
}

test.describe('list page', () => {
  test('F-06-AC1 F-06-AC2 Clear all: at the bottom of the official ⋮; everything goes at once, no confirm', async ({ page, open, lists }) => {
    const id = await lists.create([VIDEOS.a, VIDEOS.b, VIDEOS.c, VIDEOS.d], 'clear');
    await openList(page, open, id, 4);
    await pick(page, headerMore(page), 'Clear all');
    await expect.poll(() => lastToast(page)).toBe('Removed 4');
    await expect.poll(() => pageRows(page)).toEqual([]);
    await expect.poll(() => lists.videos(id), { timeout: 30_000 }).toEqual([]);
  });

  test('F-06-AC2 Remove watched: only the entries watched to the end go', async ({ page, open, lists }) => {
    // Watch VIDEOS.zoo (0:19) to the end first, so the history has it as watched.
    await open(`/watch?v=${VIDEOS.zoo}`);
    await waitForVideo(page, VIDEOS.zoo);
    // Played through from the start: a jump to near the end is not always saved as watched.
    await page.evaluate(() => { const v = document.querySelector<HTMLVideoElement>('#movie_player video')!; v.currentTime = 0; void v.play(); });
    await expect.poll(() => page.evaluate(() => document.querySelector<HTMLVideoElement>('#movie_player video')!.ended), { timeout: 45_000 }).toBe(true);
    const id = await lists.create([VIDEOS.c, VIDEOS.zoo, VIDEOS.d], 'watched');
    const pct = async () => Object.fromEntries((await lists.read(id)).items.map((i) => [i.videoId, (i as { percent?: number }).percent ?? 0]));
    await expect.poll(async () => (await pct())[VIDEOS.zoo], { timeout: 30_000, message: 'the history shows it watched' }).toBeGreaterThanOrEqual(90);
    const p = await pct();
    test.skip(p[VIDEOS.c]! >= 90 || p[VIDEOS.d]! >= 90, `c / d show as watched in this account's history: ${JSON.stringify(p)}`);
    await openList(page, open, id, 3);
    await pick(page, headerMore(page), 'Remove watched');
    await expect.poll(() => lastToast(page)).toBe('Removed 1');
    await expect.poll(() => lists.videos(id), { timeout: 30_000 }).toEqual([VIDEOS.c, VIDEOS.d]);
    await expect.poll(() => pageRows(page)).toEqual([VIDEOS.c, VIDEOS.d]);
  });

  test('F-06-AC2 Remove watched with none watched: says so', async ({ page, open, lists }) => {
    const id = await lists.create([VIDEOS.c, VIDEOS.d], 'none-watched');
    await openList(page, open, id, 2);
    await pick(page, headerMore(page), 'Remove watched');
    await expect.poll(() => lastToast(page)).toBe('Nothing to remove');
    expect(await lists.videos(id)).toEqual([VIDEOS.c, VIDEOS.d]);
  });

  test('F-06-AC1 a list we cannot edit: its ⋮ stays as YouTube made it', async ({ page, open }) => {
    // Someone else's public list: the first playlist a search finds.
    await open('/results?search_query=music+playlist&sp=EgIQAw%3D%3D');
    const href = await page.locator('ytd-search a[href*="list=PL"]').first().getAttribute('href', { timeout: 30_000 });
    const other = new URL(href!, 'https://www.youtube.com').searchParams.get('list')!;
    await open(`/playlist?list=${other}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(3000);
    const texts = await openMenu(page, headerMore(page), false);
    for (const o of OURS) expect(texts).not.toContain(o);
  });
});

test.describe('panel beside the watch page', () => {
  test('F-06-AC1 F-05-AC13 the chosen list: Clear all empties it, the panel shows 1 / 0, the video plays on', async ({ page, open, lists, setProfile }) => {
    const id = await lists.create([VIDEOS.a, VIDEOS.b, VIDEOS.c], 'panel-clear');
    await setProfile({ mode: 'playlist', listId: id, listName: 'x', removeWatched: true });
    await open(`/watch?v=${VIDEOS.a}&list=${id}`);
    await waitForVideo(page, VIDEOS.a);
    await expect.poll(async () => (await panelData(page)).videoIds).toEqual([VIDEOS.a, VIDEOS.b, VIDEOS.c]);
    const before = await player(page);
    await pick(page, panelMore(page), 'Clear all');
    await expect.poll(() => lastToast(page)).toBe('Removed 3');
    await expect.poll(() => lists.videos(id), { timeout: 30_000 }).toEqual([]);
    // F-05-AC13: the panel empties at once and counts "1 / 0", as YouTube's own does.
    await expect.poll(async () => (await panelData(page)).videoIds).toEqual([]);
    await expect.poll(() => page.evaluate(() => {
      const panel = [...document.querySelectorAll<HTMLElement>('ytd-watch-flexy ytd-playlist-panel-renderer')].find((e) => e.offsetParent !== null);
      return panel?.innerText.replace(/\s+/g, ' ') ?? '';
    })).toMatch(/\b1 \/ 0\b/);
    const after = await player(page);
    expect(after.videoId).toBe(VIDEOS.a);
    expect(after.time).toBeGreaterThanOrEqual(before.time); // no reload
  });

  test('F-06-AC1 another list: its ⋮ stays as YouTube made it', async ({ page, open, lists, setProfile }) => {
    const mine = await lists.create([VIDEOS.b], 'panel-mine');
    const other = await lists.create([VIDEOS.a, VIDEOS.c], 'panel-other');
    await setProfile({ mode: 'playlist', listId: mine, listName: 'x', removeWatched: true });
    await open(`/watch?v=${VIDEOS.a}&list=${other}`);
    await waitForVideo(page, VIDEOS.a);
    await expect.poll(async () => (await panelData(page)).playlistId).toBe(other);
    const texts = await openMenu(page, panelMore(page), false);
    for (const o of OURS) expect(texts).not.toContain(o);
  });
});

test.describe('drag out of the panel (F-06)', () => {
  const rows = (page: Page) => page.locator('ytd-watch-flexy ytd-playlist-panel-renderer ytd-playlist-panel-video-renderer:visible');

  /** Drag `row` by its handle to (x, y), slowly enough for the page's drag to follow. */
  async function dragTo(page: Page, row: Locator, x: number, y: number): Promise<boolean> {
    await row.hover();
    const handle = row.locator('#reorder');
    const b = (await handle.boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 + 10, { steps: 5 });
    await page.mouse.move(x, y, { steps: 20 });
    const marked = await page.locator('ytd-app > ytd-playlist-panel-video-renderer.dragging[ytpp-drop-delete]').count() > 0;
    await page.mouse.up();
    return marked;
  }

  test('F-06-AC4 F-06-AC5 dropped outside: the entry is removed, no notice; dropped inside: a plain reorder', async ({ page, open, lists, setProfile }) => {
    const id = await lists.create([VIDEOS.a, VIDEOS.b, VIDEOS.c], 'drag');
    await setProfile({ mode: 'playlist', listId: id, listName: 'x', removeWatched: true });
    await open(`/watch?v=${VIDEOS.a}&list=${id}`);
    await waitForVideo(page, VIDEOS.a);
    await expect(rows(page)).toHaveCount(3, { timeout: 15_000 });
    const toast = await lastToast(page);

    // Out over the video: marked while outside, gone once dropped.
    const video = (await page.locator('#movie_player').boundingBox())!;
    expect(await dragTo(page, rows(page).nth(1), video.x + video.width / 2, video.y + video.height / 2)).toBe(true);
    await expect.poll(() => lists.videos(id), { timeout: 30_000 }).toEqual([VIDEOS.a, VIDEOS.c]);
    await expect.poll(async () => (await panelData(page)).videoIds, { timeout: 30_000 }).toEqual([VIDEOS.a, VIDEOS.c]);
    expect(await lastToast(page)).toBe(toast);
    expect((await player(page)).videoId).toBe(VIDEOS.a);

    // Within the panel: the last entry to the top, nothing removed.
    const first = (await rows(page).first().boundingBox())!;
    expect(await dragTo(page, rows(page).last(), first.x + first.width / 2, first.y + 5)).toBe(false);
    await expect.poll(() => lists.videos(id), { timeout: 30_000 }).toEqual([VIDEOS.c, VIDEOS.a]);
  });
});
