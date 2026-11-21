// "Clear all" and "Remove watched" on our own playlist page (design §25):
// confirm, batch removal, toast with Undo, snapshot restored from the
// settings page.
import type { BrowserContext, Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { VIDEOS } from '../support/env';
import { clickToastAction } from '../support/ui';
import { lastToast, serviceWorker, storageGet, waitForVideo } from '../support/yt';

const TOOLS = 'ytpp-playlist-tools';

/** The list's rows on its page (video IDs, in order); not the recommended videos under it, which have no setVideoId. */
const pageRows = (page: Page) => page.locator('ytd-playlist-video-renderer').evaluateAll(
  (els) => els.map((e) => (e as HTMLElement & { data?: { videoId?: string; setVideoId?: string } }).data)
    .filter((d) => d?.setVideoId).map((d) => d!.videoId ?? ''),
).catch(() => [] as string[]); // the page may be reloading (after Undo)

async function openList(page: Page, open: (p: string) => Promise<Page>, id: string, n: number): Promise<void> {
  // The page can come with the list as it was a few seconds ago (findings A4): load it again.
  await expect(async () => {
    await open(`/playlist?list=${id}`);
    await expect.poll(() => pageRows(page).then((r) => r.length), { timeout: 8000 }).toBe(n);
  }).toPass({ timeout: 45_000 });
  await expect(page.locator(`${TOOLS} .btn.more`)).toBeVisible({ timeout: 15_000 });
}

async function pick(page: Page, item: 'Clear all' | 'Remove watched'): Promise<void> {
  await page.locator(`${TOOLS} .btn.more`).click();
  await page.locator(`${TOOLS} .menu button`, { hasText: item }).click();
}

const dialog = (page: Page) => page.locator(`${TOOLS} .dialog`);

async function snapshot(ctx: BrowserContext, key: string) {
  return (await storageGet(ctx, 'local', `queue/snapshot/${key}`)) as { listId: string; mode: string; removed: { videoId: string; index: number }[] } | undefined;
}

test('Clear all: confirm removes every entry; Undo puts them back in order', async ({ page, open, lists, ctx, account }) => {
  const all = [VIDEOS.a, VIDEOS.b, VIDEOS.c, VIDEOS.d];
  const id = await lists.create(all, 'clear');
  await openList(page, open, id, 4);
  await pick(page, 'Clear all');
  await expect(dialog(page)).toContainText('Remove 4 videos from "YouTube+ e2e');
  await dialog(page).locator('.ok').click();
  await expect(dialog(page)).toBeHidden();
  await expect.poll(() => lastToast(page)).toBe('Removed 4');
  await expect.poll(() => pageRows(page)).toEqual([]);
  await expect.poll(() => lists.videos(id), { timeout: 30_000 }).toEqual([]);
  const snap = await snapshot(ctx, account.me.key);
  expect(snap?.listId).toBe(id);
  expect(snap?.mode).toBe('all');
  expect(snap?.removed).toEqual(all.map((videoId, index) => ({ videoId, index })));

  // Undo re-adds, moves each back to its place, and reloads the page.
  await clickToastAction(page);
  await expect.poll(() => lists.videos(id), { timeout: 30_000 }).toEqual(all);
  await expect.poll(() => pageRows(page), { timeout: 30_000 }).toEqual(all);
});

test('Cancel: nothing is removed', async ({ page, open, lists }) => {
  const id = await lists.create([VIDEOS.a, VIDEOS.b], 'cancel');
  await openList(page, open, id, 2);
  await pick(page, 'Clear all');
  await dialog(page).locator('.cancel').click();
  await expect(dialog(page)).toBeHidden();
  await page.waitForTimeout(3000);
  expect(await lists.videos(id)).toEqual([VIDEOS.a, VIDEOS.b]);
  expect(await pageRows(page)).toEqual([VIDEOS.a, VIDEOS.b]);
});

test('Remove watched: only the entries watched to the end go', async ({ page, open, lists }) => {
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
  await pick(page, 'Remove watched');
  await expect(dialog(page)).toContainText('Remove 1 videos');
  await dialog(page).locator('.ok').click();
  await expect.poll(() => lastToast(page)).toBe('Removed 1');
  await expect.poll(() => lists.videos(id), { timeout: 30_000 }).toEqual([VIDEOS.c, VIDEOS.d]);
  await expect.poll(() => pageRows(page)).toEqual([VIDEOS.c, VIDEOS.d]);
});

test('Remove watched with none watched: says so, asks nothing', async ({ page, open, lists }) => {
  const id = await lists.create([VIDEOS.c, VIDEOS.d], 'none-watched');
  await openList(page, open, id, 2);
  await pick(page, 'Remove watched');
  await expect.poll(() => lastToast(page)).toBe('No watched videos');
  await expect(dialog(page)).toHaveCount(0);
  expect(await lists.videos(id)).toEqual([VIDEOS.c, VIDEOS.d]);
});

test('the last clear can be restored from the settings page', async ({ page, open, lists, ctx }) => {
  const all = [VIDEOS.a, VIDEOS.b, VIDEOS.c];
  const id = await lists.create(all, 'restore');
  await openList(page, open, id, 3);
  await pick(page, 'Clear all');
  await dialog(page).locator('.ok').click();
  await expect.poll(() => lists.videos(id), { timeout: 30_000 }).toEqual([]);

  // The settings page works through the YouTube tab used last.
  await page.bringToFront();
  const extId = new URL((await serviceWorker(ctx)).url()).host;
  const opts = await ctx.newPage();
  try {
    await opts.goto(`chrome-extension://${extId}/options.html`);
    await opts.getByRole('tab', { name: 'Queue' }).click();
    const group = opts.locator('section:visible').filter({ hasText: 'Last clear' });
    await expect(group).toContainText('Clear all from "YouTube+ e2e', { timeout: 15_000 });
    await expect(group).toContainText('3 videos');
    await group.getByRole('button', { name: 'Resume' }).click();
    await expect(group).toContainText('Restored 3 videos', { timeout: 60_000 });
  } finally {
    await opts.close();
  }
  await expect.poll(() => lists.videos(id), { timeout: 30_000 }).toEqual(all);
});

test('no tools on a list we cannot edit, nor off playlist pages', async ({ page, open }) => {
  // Someone else's public list: the first playlist a search finds.
  await open('/results?search_query=music+playlist&sp=EgIQAw%3D%3D');
  const href = await page.locator('ytd-search a[href*="list=PL"]').first().getAttribute('href', { timeout: 30_000 });
  const other = new URL(href!, 'https://www.youtube.com').searchParams.get('list')!;
  await open(`/playlist?list=${other}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(3000);
  await expect(page.locator(TOOLS)).toHaveCount(0);
  await open(`/watch?v=${VIDEOS.a}`);
  await page.waitForTimeout(2000);
  await expect(page.locator(TOOLS)).toHaveCount(0);
});
