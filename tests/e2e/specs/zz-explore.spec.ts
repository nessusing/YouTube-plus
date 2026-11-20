import { test } from '../support/fixtures';
import { VIDEOS } from '../support/env';
import { panelData, panelRowsShown, player } from '../support/yt';

const SP = '/tmp/claude-1000/-home-larryw-Documents-code-YouTube-/6c199420-fe76-409d-bd1b-9bb8b52ac44e/scratchpad';
const info = (page: import('@playwright/test').Page) => page.locator('ytd-miniplayer-info-bar').innerText();

test('explore mini native queue', async ({ open, setProfile, account }) => {
  test.setTimeout(240_000);
  await setProfile({ mode: 'native', removeWatched: true });
  const page = await open(`/watch?v=${VIDEOS.a}`);
  await page.waitForTimeout(4000);
  await page.keyboard.press('i');
  await page.waitForTimeout(3000);
  console.log('INFO single', JSON.stringify(await info(page)));
  // home page: add two videos to the native queue
  for (const n of [0, 1]) {
    const lock = page.locator('ytd-rich-item-renderer yt-lockup-view-model').nth(n);
    await lock.scrollIntoViewIfNeeded();
    await lock.locator('button[aria-label]:not([aria-label^="TL;DR"])').last().click();
    await page.waitForTimeout(800);
    const items = await page.locator('ytd-popup-container yt-list-item-view-model').allInnerTexts();
    console.log('MENU', JSON.stringify(items.slice(0, 3)));
    await page.locator('ytd-popup-container yt-list-item-view-model').first().click();
    await page.waitForTimeout(2500);
  }
  console.log('INFO queue', JSON.stringify(await info(page)), JSON.stringify(await player(page)), JSON.stringify(await panelData(page)));
  await page.locator('ytd-miniplayer-info-bar button').click();
  await page.waitForTimeout(1500);
  console.log('ROWS mini', JSON.stringify(await panelRowsShown(page, 'mini')));
  await page.screenshot({ path: `${SP}/mini-native.png` });
});
