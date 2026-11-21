// Controls in the miniplayer (design §35.1, agreed list Q6), in three states:
// a single video, the native queue, our list.
import type { Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { VIDEOS } from '../support/env';
import { startNativeQueue, toMini } from '../support/ui';
import { player, waitForVideo } from '../support/yt';

const MINI = 'ytd-miniplayer';
const AREA = `${MINI} ytd-miniplayer-player-container`;
const BAR = `${MINI} .ytp-chrome-bottom`;

async function hover(page: Page): Promise<void> {
  const box = (await page.locator(AREA).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 3);
  await page.waitForTimeout(400);
}

async function barShown(page: Page): Promise<boolean> {
  return page.locator(BAR).evaluate((el) => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0.5 && r.width > 0 && r.height > 0;
  }).catch(() => false);
}

const areaBox = async (page: Page) => (await page.locator(AREA).boundingBox())!;
const videoProp = <T>(page: Page, f: (v: HTMLVideoElement) => T) => page.locator('#movie_player video').evaluate(f);

/** Visible, clickable controls of the bar matching `sel`. */
const ctl = (page: Page, sel: string) => page.locator(`${BAR} ${sel}:visible`).first();

async function checkAll(page: Page): Promise<void> {
  await test.step('1. hover shows the control bar; it hides again after the pointer leaves', async () => {
    await page.mouse.move(5, 400);
    await page.waitForTimeout(500);
    expect.soft(await barShown(page), 'hidden before hover').toBe(false);
    await hover(page);
    expect.soft(await barShown(page), 'shown on hover').toBe(true);
    await page.mouse.move(5, 400);
    await expect.poll(() => barShown(page), { timeout: 8000 }).toBe(false);
  });

  await test.step('8. one scrubber dot on the progress bar', async () => {
    await hover(page);
    const dots = await page.locator(`${MINI} .ytp-scrubber-button`).evaluateAll((els) => els.filter((e) => {
      const r = e.getBoundingClientRect();
      const cs = getComputedStyle(e);
      return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0;
    }).length);
    expect.soft(dots).toBe(1);
  });

  await test.step('2. play / pause works and is not swallowed by the scrim', async () => {
    await hover(page);
    const was = await videoProp(page, (v) => v.paused);
    await ctl(page, '.ytp-play-button').click();
    await expect.poll(() => videoProp(page, (v) => v.paused)).toBe(!was);
    await hover(page);
    await ctl(page, '.ytp-play-button').click();
    await expect.poll(() => videoProp(page, (v) => v.paused)).toBe(was);
  });

  await test.step('3. progress bar: click and drag seek; the window does not move', async () => {
    await hover(page);
    const before = await areaBox(page);
    const bar = (await ctl(page, '.ytp-progress-bar').boundingBox())!;
    const y = bar.y + bar.height / 2;
    await page.mouse.click(bar.x + bar.width * 0.5, y);
    const d = await videoProp(page, (v) => v.duration);
    await expect.poll(async () => Math.abs((await videoProp(page, (v) => v.currentTime)) / d - 0.5)).toBeLessThan(0.08);
    await hover(page);
    await page.mouse.move(bar.x + bar.width * 0.2, y);
    await page.mouse.down();
    for (let f = 0.25; f <= 0.7; f += 0.05) await page.mouse.move(bar.x + bar.width * f, y);
    await page.mouse.up();
    await expect.poll(async () => Math.abs((await videoProp(page, (v) => v.currentTime)) / d - 0.7)).toBeLessThan(0.08);
    expect.soft(await areaBox(page)).toEqual(before);
  });

  await test.step('4. mute button and volume slider', async () => {
    await hover(page);
    const muted = await videoProp(page, (v) => v.muted);
    await ctl(page, '.ytp-mute-button').click();
    await expect.poll(() => videoProp(page, (v) => v.muted)).toBe(!muted);
    await hover(page);
    await ctl(page, '.ytp-mute-button').click();
    await expect.poll(() => videoProp(page, (v) => v.muted)).toBe(muted);
    await hover(page);
    await ctl(page, '.ytp-mute-button').hover();
    const slider = page.locator(`${BAR} .ytp-volume-slider`).first();
    await expect(slider).toBeVisible();
    const before = await areaBox(page);
    const s = (await slider.boundingBox())!;
    await page.mouse.click(s.x + s.width * 0.2, s.y + s.height / 2);
    await expect.poll(() => videoProp(page, (v) => v.volume), { message: 'volume near 20 %' }).toBeLessThan(0.4);
    await page.mouse.click(s.x + s.width * 0.9, s.y + s.height / 2);
    await expect.poll(() => videoProp(page, (v) => v.volume), { message: 'volume near 90 %' }).toBeGreaterThan(0.7);
    expect.soft(await areaBox(page)).toEqual(before);
  });

  await test.step('5. the gear menu opens and its items can be clicked', async () => {
    await hover(page);
    await ctl(page, '.ytp-settings-button').click();
    const menu = page.locator(`${MINI} .ytp-settings-menu`);
    await expect(menu).toBeVisible();
    // An item that opens a sub-menu (quality, speed…): clicking it shows the sub-menu's header.
    await menu.locator('.ytp-menuitem[aria-haspopup="true"]').first().click();
    await expect(menu.locator('.ytp-panel-header')).toBeVisible();
    await hover(page);
    await ctl(page, '.ytp-settings-button').click();
    await expect(menu).toBeHidden();
  });

  await test.step('7. expand and close', async () => {
    await hover(page);
    await page.locator(`${MINI} .ytp-miniplayer-expand-watch-page-button:visible`).first().click();
    await expect.poll(async () => (await player(page)).mini).toBe(false);
    await expect(page).toHaveURL(/\/watch\?/);
    await toMini(page);
    await hover(page);
    await page.locator(`${MINI} .ytp-miniplayer-close-button:visible`).first().click();
    // With the native queue, YouTube asks first ("the queue will be cleared"): confirm.
    const dialog = page.locator('tp-yt-paper-dialog:visible');
    if (await dialog.first().waitFor({ timeout: 2000 }).then(() => true, () => false)) await dialog.locator('button').last().click();
    await expect.poll(async () => (await player(page)).mini).toBe(false);
    await expect(page.locator(AREA)).toBeHidden();
  });
}

test('a single video', async ({ page, open }) => {
  await open(`/watch?v=${VIDEOS.a}`);
  await waitForVideo(page, VIDEOS.a);
  await toMini(page);
  await checkAll(page);
});

test('the native queue', async ({ page, open, setProfile }) => {
  await setProfile({ mode: 'native', removeWatched: true });
  await open('/');
  const queue = await startNativeQueue(page, VIDEOS.a);
  void queue;
  await checkAll(page);
});

test('our list', async ({ page, open, lists, setProfile }) => {
  const id = await lists.create([VIDEOS.a, VIDEOS.b, VIDEOS.c], 'controls');
  await setProfile({ mode: 'playlist', listId: id, listName: 'x', removeWatched: true });
  await open(`/watch?v=${VIDEOS.a}&list=${id}`);
  await waitForVideo(page, VIDEOS.a);
  await toMini(page);
  await checkAll(page);
});

// 6. In a list or the queue: previous / next. YouTube's own miniplayer shows
// neither (2026-11-21, also with the player feature off): findings F10.
async function nextWorks(page: Page, next: string): Promise<void> {
  await hover(page);
  const btn = page.locator(`${MINI} .ytp-next-button:visible`).first();
  await expect(btn).toBeVisible({ timeout: 5000 });
  await expect(page.locator(`${MINI} .ytp-prev-button:visible`).first()).toBeVisible();
  await btn.click();
  await waitForVideo(page, next);
  expect((await player(page)).mini).toBe(true);
}

test('the native queue: previous / next', async ({ page, open, setProfile }) => {
  test.fail(true, 'F10: docs/queue-test-findings.md');
  await setProfile({ mode: 'native', removeWatched: true });
  await open('/');
  const queue = await startNativeQueue(page, VIDEOS.a);
  await nextWorks(page, queue[1]!);
});

test('our list: previous / next', async ({ page, open, lists, setProfile }) => {
  test.fail(true, 'F10: docs/queue-test-findings.md');
  const id = await lists.create([VIDEOS.a, VIDEOS.b, VIDEOS.c], 'controls-next');
  await setProfile({ mode: 'playlist', listId: id, listName: 'x', removeWatched: true });
  await open(`/watch?v=${VIDEOS.a}&list=${id}`);
  await waitForVideo(page, VIDEOS.a);
  await toMini(page);
  await nextWorks(page, VIDEOS.b);
});
