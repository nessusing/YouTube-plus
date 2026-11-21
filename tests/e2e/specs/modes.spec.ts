// Switching mode in a tab that is already open (§24.6; agreed: takes effect
// at once; switching to the native queue, the extension keeps out).
// States: ② a single video in the miniplayer, ③ the native queue in the
// miniplayer, ④ our list playing.
import { expect, test } from '../support/fixtures';
import { VIDEOS } from '../support/env';
import { addFromMenu, closeMenu, homeItems, miniInfo, miniRows, NATIVE_QUEUE_ITEM, openMenu, OUR_ITEM, pickItem, related, startNativeQueue, toMini } from '../support/ui';
import { lastToast, playButton, player, seekToEnd, waitForVideo, type QueueProfile } from '../support/yt';

const SWITCHED_PLAYLIST = 'Switched to playlist mode; reload the page for it to take full effect';
const SWITCHED_NATIVE = 'Switched to YouTube\'s own queue; reload the page for it to take full effect';

/** The Add to queue label the menu of this item shows now. */
async function queueLabel(page: import('@playwright/test').Page, items: import('@playwright/test').Locator): Promise<string | undefined> {
  const texts = await openMenu(page, items.first());
  await closeMenu(page);
  return texts.find((t) => OUR_ITEM.test(t) || NATIVE_QUEUE_ITEM.test(t));
}

test.describe('native → playlist', () => {
  test('② single video in the miniplayer: relabelled at once, the button shows, Add attaches the list under it', async ({ page, open, lists, setProfile }) => {
    const id = await lists.create([VIDEOS.b, VIDEOS.c], 'mode-2');
    const p: QueueProfile = { mode: 'native', listId: id, listName: 'x', removeWatched: true };
    await setProfile(p);
    await open(`/watch?v=${VIDEOS.a}`);
    await waitForVideo(page, VIDEOS.a);
    await toMini(page);
    expect(await queueLabel(page, homeItems(page))).toMatch(NATIVE_QUEUE_ITEM);
    await setProfile({ ...p, mode: 'playlist' });
    await expect.poll(() => lastToast(page)).toBe(SWITCHED_PLAYLIST);
    await expect.poll(() => playButton(page).count()).toBe(2);
    expect(await queueLabel(page, homeItems(page))).toMatch(OUR_ITEM);
    const { videoId } = await addFromMenu(page, await pickItem(homeItems(page), [VIDEOS.a, VIDEOS.b, VIDEOS.c]));
    await expect.poll(() => miniInfo(page)).toMatch(/YouTube\+ e2e.*1 \/ 4/);
    expect(await miniRows(page)).toEqual([VIDEOS.a, VIDEOS.b, VIDEOS.c, videoId]);
  });

  test('③ native queue in the miniplayer: Add goes into the list, the native queue stays', async ({ page, open, lists, setProfile }) => {
    const id = await lists.create([VIDEOS.b], 'mode-3');
    const p: QueueProfile = { mode: 'native', listId: id, listName: 'x', removeWatched: true };
    await setProfile(p);
    await open('/');
    const queue = await startNativeQueue(page, VIDEOS.a);
    await setProfile({ ...p, mode: 'playlist' });
    await expect.poll(() => lastToast(page)).toBe(SWITCHED_PLAYLIST);
    const { videoId } = await addFromMenu(page, await pickItem(homeItems(page), [...queue, VIDEOS.b]));
    await expect.poll(() => lists.videos(id)).toEqual([VIDEOS.b, videoId]);
    await page.waitForTimeout(4000);
    expect(await miniInfo(page)).toMatch(/1 \/ 3/);
    expect(await miniRows(page)).toEqual(queue);
  });

  test('④ our list already playing: watched entries are removed from now on', async ({ page, open, lists, setProfile }) => {
    const id = await lists.create([VIDEOS.zoo, VIDEOS.a], 'mode-4');
    const p: QueueProfile = { mode: 'native', listId: id, listName: 'x', removeWatched: true };
    await setProfile(p);
    await open(`/watch?v=${VIDEOS.zoo}&list=${id}`);
    await waitForVideo(page, VIDEOS.zoo);
    await setProfile({ ...p, mode: 'playlist' });
    await expect.poll(() => playButton(page).count()).toBe(2);
    await seekToEnd(page, 3);
    await waitForVideo(page, VIDEOS.a);
    await expect.poll(() => lists.videos(id), { timeout: 30_000 }).toEqual([VIDEOS.a]);
  });
});

test.describe('playlist → native', () => {
  test('② the menu label goes back, the button goes away', async ({ page, open, lists, setProfile }) => {
    const id = await lists.create([VIDEOS.b], 'mode-back-2');
    const p: QueueProfile = { mode: 'playlist', listId: id, listName: 'x', removeWatched: true };
    await setProfile(p);
    await open(`/watch?v=${VIDEOS.a}`);
    await waitForVideo(page, VIDEOS.a);
    await toMini(page);
    expect(await queueLabel(page, homeItems(page))).toMatch(OUR_ITEM);
    await setProfile({ ...p, mode: 'native' });
    await expect.poll(() => lastToast(page)).toBe(SWITCHED_NATIVE);
    await expect(playButton(page).host).toHaveCount(0);
    // The popup menu is reused: the old label must not stick.
    expect(await queueLabel(page, homeItems(page))).toMatch(NATIVE_QUEUE_ITEM);
  });

  test('④ our list playing: a watched entry is left in the list', async ({ page, open, lists, setProfile }) => {
    const id = await lists.create([VIDEOS.zoo, VIDEOS.a], 'mode-back-4');
    const p: QueueProfile = { mode: 'playlist', listId: id, listName: 'x', removeWatched: true };
    await setProfile(p);
    await open(`/watch?v=${VIDEOS.zoo}&list=${id}`);
    await waitForVideo(page, VIDEOS.zoo);
    await setProfile({ ...p, mode: 'native' });
    await expect(playButton(page).host).toHaveCount(0);
    await seekToEnd(page, 3);
    await waitForVideo(page, VIDEOS.a); // YouTube's own autoplay
    await page.waitForTimeout(8000);
    expect(await lists.videos(id)).toEqual([VIDEOS.zoo, VIDEOS.a]);
  });
});

test.describe('switching quickly', () => {
  test('native → playlist → native: ends native', async ({ page, open, lists, setProfile }) => {
    const id = await lists.create([VIDEOS.b], 'quick-1');
    const p: QueueProfile = { mode: 'native', listId: id, listName: 'x', removeWatched: true };
    await setProfile(p);
    await open(`/watch?v=${VIDEOS.a}`);
    await waitForVideo(page, VIDEOS.a);
    await setProfile({ ...p, mode: 'playlist' });
    await setProfile({ ...p, mode: 'native' });
    await page.waitForTimeout(5000);
    await expect(playButton(page).host).toHaveCount(0);
    expect(await queueLabel(page, related(page))).toMatch(NATIVE_QUEUE_ITEM);
  });

  test('playlist → native → playlist: ends taking over, right count', async ({ page, open, lists, setProfile }) => {
    const id = await lists.create([VIDEOS.b, VIDEOS.c], 'quick-2');
    const p: QueueProfile = { mode: 'playlist', listId: id, listName: 'x', removeWatched: true };
    await setProfile(p);
    await open(`/watch?v=${VIDEOS.a}`);
    await waitForVideo(page, VIDEOS.a);
    await expect.poll(() => playButton(page).count()).toBe(2);
    await setProfile({ ...p, mode: 'native' });
    await setProfile({ ...p, mode: 'playlist' });
    await page.waitForTimeout(5000);
    expect(await playButton(page).count()).toBe(2);
    expect(await queueLabel(page, related(page))).toMatch(OUR_ITEM);
    expect((await player(page)).playlistId).toBeUndefined();
  });
});
