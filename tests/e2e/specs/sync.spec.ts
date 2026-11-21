// The top bar count and the panel follow the list whoever edits it (§24.8).
import { expect, test } from '../support/fixtures';
import { VIDEOS } from '../support/env';
import { addFromMenu, pickItem, related } from '../support/ui';
import { comeBack, panelData, panelRowsShown, playButton, waitForVideo } from '../support/yt';

const ROWS = [VIDEOS.a, VIDEOS.b, VIDEOS.c, VIDEOS.d];

test('Remove from playlist in the side panel: count and panel follow', async ({ page, open, lists, setProfile }) => {
  const id = await lists.create(ROWS, 'panel-remove');
  await setProfile({ mode: 'playlist', listId: id, listName: 'x', removeWatched: true });
  await open(`/watch?v=${VIDEOS.a}&list=${id}`);
  await waitForVideo(page, VIDEOS.a);
  await expect.poll(() => playButton(page).count()).toBe(4);
  // YouTube's own ⋯ on the row → Remove from playlist.
  const row = page.locator('ytd-watch-flexy ytd-playlist-panel-video-renderer').nth(2);
  await row.hover();
  await row.locator('#menu button, ytd-menu-renderer button').first().click();
  const remove = page.locator('ytd-popup-container ytd-menu-service-item-renderer, ytd-popup-container yt-list-item-view-model').filter({ hasText: /移除|删除|Remove/ }).first();
  await remove.click();
  await expect.poll(() => playButton(page).count(), { timeout: 5000 }).toBe(3);
  // It must not bounce back while reads lag (sampled for 12 s).
  for (let i = 0; i < 12; i++) {
    await page.waitForTimeout(1000);
    expect(await playButton(page).count()).toBe(3);
  }
  expect(await panelRowsShown(page, 'watch')).toEqual([VIDEOS.a, VIDEOS.b, VIDEOS.d]);
  expect(await lists.videos(id)).toEqual([VIDEOS.a, VIDEOS.b, VIDEOS.d]);
});

test('Add while the list plays: count up at once, the panel shows it', async ({ page, open, lists, setProfile }) => {
  const id = await lists.create([VIDEOS.a, VIDEOS.b], 'add-playing');
  await setProfile({ mode: 'playlist', listId: id, listName: 'x', removeWatched: true });
  await open(`/watch?v=${VIDEOS.a}&list=${id}`);
  await waitForVideo(page, VIDEOS.a);
  await expect.poll(() => playButton(page).count()).toBe(2);
  const { videoId } = await addFromMenu(page, await pickItem(related(page), ROWS));
  await expect.poll(() => playButton(page).count(), { timeout: 5000 }).toBe(3);
  await expect.poll(async () => (await panelData(page)).videoIds, { timeout: 20_000 }).toEqual([VIDEOS.a, VIDEOS.b, videoId]);
  expect(await panelRowsShown(page, 'watch')).toEqual([VIDEOS.a, VIDEOS.b, videoId]);
});

test('edited in another tab: caught up when this tab comes back', async ({ page, open, lists, setProfile, account }) => {
  const id = await lists.create([VIDEOS.a, VIDEOS.b, VIDEOS.c], 'elsewhere');
  await setProfile({ mode: 'playlist', listId: id, listName: 'x', removeWatched: true });
  await open(`/watch?v=${VIDEOS.a}&list=${id}`);
  await waitForVideo(page, VIDEOS.a);
  await expect.poll(() => playButton(page).count()).toBe(3);
  await lists.edit(account.helper, id, [{ action: 'ACTION_ADD_VIDEO', addedVideoId: VIDEOS.d }, { action: 'ACTION_ADD_VIDEO', addedVideoId: VIDEOS.e }]);
  await lists.remove(account.helper, id, VIDEOS.b);
  await account.helper.waitForTimeout(8000);
  // Nothing tells this tab; it catches up when the user comes back to it.
  expect(await playButton(page).count()).toBe(3);
  await comeBack(page);
  await expect.poll(() => playButton(page).count(), { timeout: 30_000 }).toBe(4);
  await expect.poll(async () => (await panelData(page)).videoIds, { timeout: 30_000 }).toEqual([VIDEOS.a, VIDEOS.c, VIDEOS.d, VIDEOS.e]);
});

test('a page edit outside the panel (same tab): count follows', async ({ page, open, lists, setProfile }) => {
  const id = await lists.create([VIDEOS.a, VIDEOS.b], 'page-edit');
  await setProfile({ mode: 'playlist', listId: id, listName: 'x', removeWatched: true });
  await open('/');
  await expect.poll(() => playButton(page).count()).toBe(2);
  await lists.edit(page, id, [{ action: 'ACTION_ADD_VIDEO', addedVideoId: VIDEOS.c }]);
  await expect.poll(() => playButton(page).count(), { timeout: 5000 }).toBe(3);
  await lists.remove(page, id, VIDEOS.a);
  await expect.poll(() => playButton(page).count(), { timeout: 5000 }).toBe(2);
  await page.waitForTimeout(10_000);
  expect(await playButton(page).count()).toBe(2);
});
