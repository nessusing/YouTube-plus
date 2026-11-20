// The list under the miniplayer / beside the watch page (agreed table, Q7):
// it is there, shows the right rows, and survives watch ⇄ miniplayer.
import { expect, test } from '../support/fixtures';
import { VIDEOS } from '../support/env';
import { addFromMenu, homeItems, miniInfo, miniRows, NATIVE_QUEUE_ITEM, OUR_ITEM, pickItem, related, startNativeQueue, toMini, toWatch } from '../support/ui';
import { lastToast, panelData, panelRowsShown, playButton, player, waitForVideo } from '../support/yt';

test('native mode: Add to queue in the miniplayer gives the native queue under it', async ({ page, open, setProfile }) => {
  await setProfile({ mode: 'native', removeWatched: true });
  await open('/');
  const ids = await startNativeQueue(page, VIDEOS.a);
  expect(await miniInfo(page)).toMatch(/• ?1 \/ 3/);
  expect(await miniRows(page)).toEqual(ids);
  await expect(playButton(page).host).toHaveCount(0);
});

test('playlist mode, watching a video outside any list: Add shows the list beside it, this video on top, no reload', async ({ page, open, lists, setProfile }) => {
  const id = await lists.create([VIDEOS.b, VIDEOS.c], 'attach-watch');
  await setProfile({ mode: 'playlist', listId: id, listName: 'x', removeWatched: true });
  await open(`/watch?v=${VIDEOS.a}`);
  await waitForVideo(page, VIDEOS.a);
  const before = await player(page);
  const item = await pickItem(related(page), [VIDEOS.a, VIDEOS.b, VIDEOS.c]);
  const { label, videoId } = await addFromMenu(page, item);
  expect(label).toMatch(OUR_ITEM);
  await expect.poll(() => lastToast(page)).toMatch(/^Added to YouTube\+ e2e/);
  await expect.poll(async () => (await panelData(page)).videoIds).toEqual([VIDEOS.a, VIDEOS.b, VIDEOS.c, videoId]);
  expect(await panelRowsShown(page, 'watch')).toEqual([VIDEOS.a, VIDEOS.b, VIDEOS.c, videoId]);
  const after = await player(page);
  expect(after.playlistId).toBe(id);
  expect(after.videoId).toBe(VIDEOS.a);
  expect(after.time).toBeGreaterThanOrEqual(before.time); // kept playing, no reload
  await expect.poll(() => playButton(page).count()).toBe(3);
  expect(await lists.videos(id)).toEqual([VIDEOS.b, VIDEOS.c, videoId]);
});

test('playlist mode, a single video in the miniplayer: Add shows the list under it', async ({ page, open, lists, setProfile }) => {
  const id = await lists.create([VIDEOS.b, VIDEOS.c], 'attach-mini');
  await setProfile({ mode: 'playlist', listId: id, listName: 'x', removeWatched: true });
  await open(`/watch?v=${VIDEOS.a}`);
  await waitForVideo(page, VIDEOS.a);
  await toMini(page);
  const item = await pickItem(homeItems(page), [VIDEOS.a, VIDEOS.b, VIDEOS.c]);
  const { label, videoId } = await addFromMenu(page, item);
  expect(label).toMatch(OUR_ITEM);
  await expect.poll(() => miniInfo(page)).toMatch(/YouTube\+ e2e.*• ?1 \/ 4/);
  expect(await miniRows(page)).toEqual([VIDEOS.a, VIDEOS.b, VIDEOS.c, videoId]);
  expect((await player(page)).mini).toBe(true);
});

test('playlist mode, another list playing: Add leaves its panel alone', async ({ page, open, lists, setProfile }) => {
  const mine = await lists.create([VIDEOS.b], 'mine');
  const other = await lists.create([VIDEOS.a, VIDEOS.c], 'other');
  await setProfile({ mode: 'playlist', listId: mine, listName: 'x', removeWatched: true });
  await open(`/watch?v=${VIDEOS.a}&list=${other}`);
  await waitForVideo(page, VIDEOS.a);
  await expect.poll(async () => (await panelData(page)).playlistId).toBe(other);
  const item = await pickItem(related(page), [VIDEOS.a, VIDEOS.b, VIDEOS.c]);
  const { videoId } = await addFromMenu(page, item);
  await expect.poll(() => lists.videos(mine)).toEqual([VIDEOS.b, videoId]);
  await page.waitForTimeout(3000);
  expect(await panelData(page)).toEqual({ playlistId: other, videoIds: [VIDEOS.a, VIDEOS.c] });
  expect((await player(page)).playlistId).toBe(other);
});

test('the attached list survives watch → miniplayer → watch', async ({ page, open, lists, setProfile }) => {
  const id = await lists.create([VIDEOS.b, VIDEOS.c], 'roundtrip');
  await setProfile({ mode: 'playlist', listId: id, listName: 'x', removeWatched: true });
  await open(`/watch?v=${VIDEOS.a}`);
  await waitForVideo(page, VIDEOS.a);
  const { videoId } = await addFromMenu(page, await pickItem(related(page), [VIDEOS.a, VIDEOS.b, VIDEOS.c]));
  const rows = [VIDEOS.a, VIDEOS.b, VIDEOS.c, videoId];
  await expect.poll(async () => (await panelData(page)).videoIds).toEqual(rows);
  await toMini(page);
  expect(await miniRows(page)).toEqual(rows);
  expect(await miniInfo(page)).toMatch(/• ?1 \/ 4/);
  await toWatch(page);
  await expect.poll(() => panelRowsShown(page, 'watch')).toEqual(rows);
  await toMini(page);
  expect(await miniRows(page)).toEqual(rows);
});

test('our list playing: the panel survives watch → miniplayer → watch', async ({ page, open, lists, setProfile }) => {
  const id = await lists.create([VIDEOS.a, VIDEOS.b, VIDEOS.c], 'roundtrip-list');
  await setProfile({ mode: 'playlist', listId: id, listName: 'x', removeWatched: true });
  await open(`/watch?v=${VIDEOS.a}&list=${id}`);
  await waitForVideo(page, VIDEOS.a);
  const rows = [VIDEOS.a, VIDEOS.b, VIDEOS.c];
  await expect.poll(() => panelRowsShown(page, 'watch')).toEqual(rows);
  await toMini(page);
  expect(await miniRows(page)).toEqual(rows);
  await toWatch(page);
  await expect.poll(() => panelRowsShown(page, 'watch')).toEqual(rows);
});

test('native mode: Add to queue keeps YouTube\'s own label', async ({ page, open, setProfile }) => {
  await setProfile({ mode: 'native', removeWatched: true });
  await open(`/watch?v=${VIDEOS.a}`);
  await waitForVideo(page, VIDEOS.a);
  const { label } = await addFromMenu(page, await pickItem(related(page), [VIDEOS.a]));
  expect(label).toMatch(NATIVE_QUEUE_ITEM);
});
