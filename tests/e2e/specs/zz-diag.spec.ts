import { test } from '../support/fixtures';
import { VIDEOS } from '../support/env';
import { panelData, panelRowsShown, playButton, player, seekToEnd, waitForVideo } from '../support/yt';

test('trace elsewhere', async ({ page, open, lists, setProfile, account }) => {
  const id = await lists.create([VIDEOS.a, VIDEOS.b, VIDEOS.c], 'elsewhere');
  await setProfile({ mode: 'playlist', listId: id, listName: 'x', removeWatched: true });
  await open(`/watch?v=${VIDEOS.a}&list=${id}`);
  await waitForVideo(page, VIDEOS.a);
  await page.waitForTimeout(3000);
  const s = async (tag: string) => console.log(tag, await playButton(page).count(), JSON.stringify(await player(page)), JSON.stringify(await panelData(page)), JSON.stringify(await panelRowsShown(page, 'watch')), await page.evaluate(() => document.visibilityState));
  await s('BEFORE');
  await account.helper.bringToFront();
  await lists.edit(account.helper, id, [{ action: 'ACTION_ADD_VIDEO', addedVideoId: VIDEOS.d }]);
  await lists.remove(account.helper, id, VIDEOS.b);
  await account.helper.waitForTimeout(8000);
  await s('HIDDEN');
  await page.bringToFront();
  for (let i = 0; i < 8; i++) { await page.waitForTimeout(1500); await s(`T${i}`); }
});

test('trace last entry', async ({ page, open, lists, setProfile }) => {
  const id = await lists.create([VIDEOS.zoo], 'last');
  await setProfile({ mode: 'playlist', listId: id, listName: 'x', removeWatched: false });
  await open(`/watch?v=${VIDEOS.zoo}&list=${id}`);
  await waitForVideo(page, VIDEOS.zoo);
  const autoplay = await page.evaluate(() => document.querySelector('.ytp-autonav-toggle-button')?.getAttribute('aria-checked'));
  console.log('AUTOPLAY toggle', autoplay);
  await seekToEnd(page, 3);
  for (let i = 0; i < 8; i++) { await page.waitForTimeout(1500); console.log(`L${i}`, JSON.stringify(await player(page)), page.url().replace('https://www.youtube.com', '')); }
});
