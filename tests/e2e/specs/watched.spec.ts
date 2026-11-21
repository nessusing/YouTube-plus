// After a video from the list is watched (§24.4). VIDEOS.zoo is 19 s long.
import { expect, test } from '../support/fixtures';
import { VIDEOS } from '../support/env';
import { addFromMenu, pickItem, related } from '../support/ui';
import { panelRowsShown, playButton, player, seekToEnd, waitForVideo } from '../support/yt';

test('watched to the end: the next entry plays, the watched one is removed', async ({ page, open, lists, setProfile }) => {
  const id = await lists.create([VIDEOS.zoo, VIDEOS.a, VIDEOS.b], 'ended');
  await setProfile({ mode: 'playlist', listId: id, listName: 'x', removeWatched: true });
  await open(`/watch?v=${VIDEOS.zoo}&list=${id}`);
  await waitForVideo(page, VIDEOS.zoo);
  await seekToEnd(page, 3);
  await waitForVideo(page, VIDEOS.a);
  // getPlaylistId() is empty for a moment while the next video loads.
  await expect.poll(async () => (await player(page)).playlistId).toBe(id);
  await expect.poll(() => lists.videos(id), { timeout: 30_000 }).toEqual([VIDEOS.a, VIDEOS.b]);
  await expect.poll(() => playButton(page).count()).toBe(2);
  await expect.poll(() => panelRowsShown(page, 'watch'), { timeout: 20_000 }).toEqual([VIDEOS.a, VIDEOS.b]);
});

// The last entry: removed; what plays next is up to YouTube's own autoplay
// (with it on, a recommended video after the end screen). Decided 2026-11-21 (F9).
test('the last entry: removed, the button goes, YouTube decides what plays next', async ({ page, open, lists, setProfile }) => {
  const id = await lists.create([VIDEOS.zoo], 'last');
  await setProfile({ mode: 'playlist', listId: id, listName: 'x', removeWatched: true });
  await open(`/watch?v=${VIDEOS.zoo}&list=${id}`);
  await waitForVideo(page, VIDEOS.zoo);
  await seekToEnd(page, 3);
  await expect.poll(() => lists.videos(id), { timeout: 30_000 }).toEqual([]);
  await expect.poll(() => playButton(page).count()).toBe(0);
});

test('left with under 10 s to go: removed, the video picked plays', async ({ page, open, lists, setProfile }) => {
  const id = await lists.create([VIDEOS.a, VIDEOS.zoo, VIDEOS.b], 'left');
  await setProfile({ mode: 'playlist', listId: id, listName: 'x', removeWatched: true });
  await open(`/watch?v=${VIDEOS.a}&list=${id}`);
  await waitForVideo(page, VIDEOS.a);
  await seekToEnd(page, 8);
  await page.waitForTimeout(1500);
  await page.locator('ytd-watch-flexy ytd-playlist-panel-video-renderer').nth(2).click();
  await waitForVideo(page, VIDEOS.b);
  await expect.poll(() => lists.videos(id), { timeout: 30_000 }).toEqual([VIDEOS.zoo, VIDEOS.b]);
  await page.waitForTimeout(3000);
  expect((await player(page)).videoId).toBe(VIDEOS.b);
});

test('left early: nothing removed', async ({ page, open, lists, setProfile }) => {
  const id = await lists.create([VIDEOS.a, VIDEOS.b], 'left-early');
  await setProfile({ mode: 'playlist', listId: id, listName: 'x', removeWatched: true });
  await open(`/watch?v=${VIDEOS.a}&list=${id}`);
  await waitForVideo(page, VIDEOS.a);
  await page.locator('ytd-watch-flexy ytd-playlist-panel-video-renderer').nth(1).click();
  await waitForVideo(page, VIDEOS.b);
  await page.waitForTimeout(8000);
  expect(await lists.videos(id)).toEqual([VIDEOS.a, VIDEOS.b]);
});

test('remove after playing off: YouTube plays on, nothing removed', async ({ page, open, lists, setProfile }) => {
  const id = await lists.create([VIDEOS.zoo, VIDEOS.a], 'keep');
  await setProfile({ mode: 'playlist', listId: id, listName: 'x', removeWatched: false });
  await open(`/watch?v=${VIDEOS.zoo}&list=${id}`);
  await waitForVideo(page, VIDEOS.zoo);
  await seekToEnd(page, 3);
  await waitForVideo(page, VIDEOS.a);
  await page.waitForTimeout(8000);
  expect(await lists.videos(id)).toEqual([VIDEOS.zoo, VIDEOS.a]);
});

test('the video the list was attached to ends: the list plays from its first entry, nothing removed', async ({ page, open, lists, setProfile }) => {
  const id = await lists.create([VIDEOS.a, VIDEOS.b], 'attached-end');
  await setProfile({ mode: 'playlist', listId: id, listName: 'x', removeWatched: true });
  await open(`/watch?v=${VIDEOS.zoo}`);
  await waitForVideo(page, VIDEOS.zoo);
  const { videoId } = await addFromMenu(page, await pickItem(related(page), [VIDEOS.zoo, VIDEOS.a, VIDEOS.b]));
  await expect.poll(async () => (await player(page)).playlistId, { timeout: 20_000 }).toBe(id);
  await seekToEnd(page, 3);
  await waitForVideo(page, VIDEOS.a);
  await page.waitForTimeout(8000);
  expect(await lists.videos(id)).toEqual([VIDEOS.a, VIDEOS.b, videoId]);
});
