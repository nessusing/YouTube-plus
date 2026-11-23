// Loop button (design §40.2) on real YouTube: the setting, where the button
// sits in every player form, that it is the right-click "Loop", and how a
// loop counts for the queue's remove after playing. VIDEOS.zoo is 19 s long.
import type { BrowserContext, Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { VIDEOS } from '../support/env';
import { pickItem, related, toMini, videoIdOf } from '../support/ui';
import { player, seekToEnd, storageGet, storageSet, waitForVideo } from '../support/yt';

const BAR = '#movie_player .ytp-left-controls .ytpp-loop-bar';
const MID = '#movie_player .ytp-miniplayer-controls .ytpp-loop-mini';
const ROWS = 'ytd-watch-flexy ytd-playlist-panel-video-renderer';

async function setPlayer(ctx: BrowserContext, patch: Record<string, boolean>): Promise<void> {
  const s = ((await storageGet(ctx, 'sync', 'settings')) ?? {}) as { player?: Record<string, boolean> };
  await storageSet(ctx, 'sync', { settings: { ...s, player: { ...s.player, ...patch } } });
}

const loopOn = (page: Page) => page.evaluate(() => document.querySelector<HTMLVideoElement>('#movie_player video')!.loop);

/** Vertical centre and height of an element, or undefined when not laid out. */
const box = (page: Page, sel: string) => page.evaluate((sel) => {
  const el = document.querySelector(sel);
  const r = el?.getBoundingClientRect();
  return r && r.height ? { mid: r.top + r.height / 2, h: r.height, left: r.left, right: r.right } : undefined;
}, sel);

const iconOpacity = (page: Page, sel: string) =>
  page.locator(`${sel} svg`).evaluate((el) => Number(getComputedStyle(el).opacity));

async function showBar(page: Page): Promise<void> {
  await page.locator('#movie_player').hover();
  await page.mouse.move(400, 300);
}

/** Open the right-click menu; returns its "Loop" item. */
async function rightClickLoop(page: Page) {
  const item = page.locator('.ytp-contextmenu .ytp-menuitem[role="menuitemcheckbox"]').first();
  // A second right-click on an open menu closes it: retry until it is up.
  await expect(async () => {
    if (!(await item.isVisible())) await page.locator('#movie_player video').click({ button: 'right' });
    await expect(item).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 15_000 });
  return item;
}

/** The right-click menu's "Loop" tick; closes the menu again. */
async function menuLoop(page: Page): Promise<string | null> {
  const item = await rightClickLoop(page);
  const checked = await item.getAttribute('aria-checked');
  await page.keyboard.press('Escape');
  await expect(item).toBeHidden();
  return checked;
}

/** In line with ▶ and the volume pill, same height as the pill. */
async function expectAligned(page: Page): Promise<void> {
  await showBar(page);
  const me = (await box(page, BAR))!;
  const play = (await box(page, '#movie_player .ytp-left-controls > .ytp-play-button'))!;
  const vol = (await box(page, '#movie_player .ytp-volume-area'))!;
  expect(Math.abs(me.mid - vol.mid), JSON.stringify({ me, vol })).toBeLessThan(1);
  expect(Math.abs(me.h - vol.h)).toBeLessThan(1);
  expect(me.left).toBeGreaterThan(play.right);
  expect(me.right).toBeLessThan(vol.left);
}

test.describe('loop button', () => {
  test.beforeEach(async ({ ctx }) => setPlayer(ctx, { loopButton: true, miniControls: true }));
  test.afterEach(async ({ ctx }) => setPlayer(ctx, { loopButton: false, miniControls: true }));

  test('F-10-AC1 setting off (the default): no button', async ({ page, open, ctx }) => {
    await setPlayer(ctx, { loopButton: false });
    await open(`/watch?v=${VIDEOS.a}`);
    await waitForVideo(page, VIDEOS.a);
    await page.waitForTimeout(1500);
    expect(await page.locator('.ytpp-loop').count()).toBe(0);
  });

  test('F-10-AC1 F-10-AC2 watch page: right of ▶, in line; it is the right-click Loop, both ways', async ({ page, open }) => {
    await open(`/watch?v=${VIDEOS.a}`);
    await waitForVideo(page, VIDEOS.a);
    await expect(page.locator(BAR)).toHaveCount(1);
    expect(await page.locator(BAR).evaluate((b) => b.previousElementSibling?.classList.contains('ytp-play-button'))).toBe(true);
    await expectAligned(page);

    await expect(page.locator(BAR)).toHaveAttribute('aria-pressed', 'false');
    expect(await iconOpacity(page, BAR)).toBeCloseTo(0.5);
    await page.locator(BAR).click();
    await expect.poll(() => loopOn(page)).toBe(true);
    await expect(page.locator(BAR)).toHaveAttribute('aria-pressed', 'true');
    expect(await iconOpacity(page, BAR)).toBe(1);
    expect(await menuLoop(page)).toBe('true');

    // Off from the right-click menu: the button follows.
    await (await rightClickLoop(page)).click();
    await expect.poll(() => loopOn(page)).toBe(false);
    await expect(page.locator(BAR)).toHaveAttribute('aria-pressed', 'false');
  });

  test('F-10-AC1 tooltip in the player style: "Loop", then "Turn off loop"', async ({ page, open }) => {
    await open(`/watch?v=${VIDEOS.a}`);
    await waitForVideo(page, VIDEOS.a);
    await showBar(page);
    const tip = page.locator('#movie_player > .ytpp-loop-tip');
    await page.locator(BAR).hover();
    await expect(tip).toBeVisible();
    await expect(tip).toHaveText('Loop');
    const t = (await tip.boundingBox())!;
    const b = (await page.locator(BAR).boundingBox())!;
    expect(t.y + t.height).toBeLessThan(b.y);
    await page.locator(BAR).click();
    await expect(tip).toHaveText('Turn off loop');
    await page.mouse.move(400, 300);
    await expect(tip).toBeHidden();
  });

  test('F-10-AC2 on loop the video starts again instead of the next one in a list', async ({ page, open, lists }) => {
    const id = await lists.create([VIDEOS.zoo, VIDEOS.a], 'loop-list');
    await open(`/watch?v=${VIDEOS.zoo}&list=${id}`);
    await waitForVideo(page, VIDEOS.zoo);
    await showBar(page);
    await page.locator(BAR).click();
    await expect.poll(() => loopOn(page)).toBe(true);
    await seekToEnd(page, 2);
    await page.waitForTimeout(5000);
    const p = await player(page);
    expect(p.videoId).toBe(VIDEOS.zoo);
    expect(p.time).toBeLessThan(6);
    expect(p.paused).toBe(false);
  });

  test('F-10-AC2 another video: loop is off again', async ({ page, open }) => {
    await open(`/watch?v=${VIDEOS.a}`);
    await waitForVideo(page, VIDEOS.a);
    await showBar(page);
    await page.locator(BAR).click();
    await expect.poll(() => loopOn(page)).toBe(true);
    const next = await pickItem(related(page), [VIDEOS.a]);
    const nextId = await videoIdOf(next);
    await next.locator('a[href*="/watch?v="]').first().click();
    await waitForVideo(page, nextId);
    await expect.poll(() => loopOn(page)).toBe(false);
    await expect(page.locator(BAR)).toHaveAttribute('aria-pressed', 'false');
  });

  test('F-10-AC1 theater and fullscreen: still right of ▶ and in line', async ({ page, open }) => {
    await open(`/watch?v=${VIDEOS.a}`);
    await waitForVideo(page, VIDEOS.a);
    const flexy = page.locator('ytd-watch-flexy');
    const isTheater = async () => (await flexy.getAttribute('theater')) !== null;
    const theater = await isTheater();
    await showBar(page);
    await page.locator('#movie_player .ytp-size-button').click();
    await expect.poll(isTheater).toBe(!theater);
    await expectAligned(page);
    // Put the user's preference back.
    await showBar(page);
    await page.locator('#movie_player .ytp-size-button').click();

    await showBar(page);
    await page.locator('#movie_player .ytp-fullscreen-button').click();
    await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
    await page.waitForTimeout(800);
    await expectAligned(page);
    await page.locator(BAR).click();
    await expect.poll(() => loopOn(page)).toBe(true);
    await page.evaluate(() => document.exitFullscreen());
    await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(false);
  });

  test('F-10-AC1 miniplayer with our controls: in the bar beside ▶; the middle one stays hidden', async ({ page, open }) => {
    await open(`/watch?v=${VIDEOS.a}`);
    await waitForVideo(page, VIDEOS.a);
    await toMini(page);
    await page.locator('ytd-miniplayer ytd-miniplayer-player-container').hover();
    await expect(page.locator(BAR)).toBeVisible();
    await expect(page.locator(MID)).toBeHidden();
    await page.locator(BAR).click();
    await expect.poll(() => loopOn(page)).toBe(true);
    expect((await player(page)).mini).toBe(true);
  });

  test('F-10-AC1 miniplayer without our controls: right of the big ▶, which stays put; a click does not pause', async ({ page, open, ctx }) => {
    await setPlayer(ctx, { miniControls: false });
    await open(`/watch?v=${VIDEOS.a}`);
    await waitForVideo(page, VIDEOS.a);
    await toMini(page);
    await page.evaluate(() => document.querySelector<HTMLVideoElement>('#movie_player video')!.play());
    await page.locator('ytd-miniplayer ytd-miniplayer-player-container').hover();
    await expect(page.locator(MID)).toBeVisible();
    const play = (await page.locator('ytd-miniplayer .ytp-miniplayer-play-button-container').boundingBox())!;
    const scrim = (await page.locator('ytd-miniplayer .ytp-miniplayer-scrim').boundingBox())!;
    const me = (await page.locator(MID).boundingBox())!;
    expect(Math.abs(play.x + play.width / 2 - (scrim.x + scrim.width / 2))).toBeLessThan(2);
    expect(me.x).toBeGreaterThan(play.x + play.width);
    expect(Math.abs(me.y + me.height / 2 - (play.y + play.height / 2))).toBeLessThan(2);
    await page.locator(MID).click();
    await expect.poll(() => loopOn(page)).toBe(true);
    await expect(page.locator(MID)).toHaveAttribute('aria-pressed', 'true');
    await page.waitForTimeout(500);
    expect((await player(page)).paused).toBe(false);
  });

  test('F-10-AC3 setting turned off while looping: the button goes and the loop stops', async ({ page, open, ctx }) => {
    await open(`/watch?v=${VIDEOS.a}`);
    await waitForVideo(page, VIDEOS.a);
    await showBar(page);
    await page.locator(BAR).click();
    await expect.poll(() => loopOn(page)).toBe(true);
    await setPlayer(ctx, { loopButton: false });
    await expect(page.locator('.ytpp-loop')).toHaveCount(0);
    await expect.poll(() => loopOn(page)).toBe(false);
  });
});

test.describe('loop and remove after playing (§40.2)', () => {
  test.beforeEach(async ({ ctx }) => setPlayer(ctx, { loopButton: true }));
  test.afterEach(async ({ ctx }) => setPlayer(ctx, { loopButton: false }));

  test('F-10-AC4 looped once, then another entry picked: the looped one is removed', async ({ page, open, lists, setProfile }) => {
    const id = await lists.create([VIDEOS.zoo, VIDEOS.a, VIDEOS.b], 'loop-watched');
    await setProfile({ mode: 'playlist', listId: id, listName: 'x', removeWatched: true });
    await open(`/watch?v=${VIDEOS.zoo}&list=${id}`);
    await waitForVideo(page, VIDEOS.zoo);
    await showBar(page);
    await page.locator(BAR).click();
    await expect.poll(() => loopOn(page)).toBe(true);
    await seekToEnd(page, 2);
    // Wrapped back to the start.
    await expect.poll(async () => (await player(page)).time, { timeout: 15_000 }).toBeLessThan(5);
    await page.waitForTimeout(1500);
    expect(await lists.videos(id)).toEqual([VIDEOS.zoo, VIDEOS.a, VIDEOS.b]);
    await page.locator(ROWS).nth(2).click();
    await waitForVideo(page, VIDEOS.b);
    await expect.poll(() => lists.videos(id), { timeout: 30_000 }).toEqual([VIDEOS.a, VIDEOS.b]);
  });

  test('F-10-AC4 on loop, left in its last 10 s before it looped: kept', async ({ page, open, lists, setProfile }) => {
    const id = await lists.create([VIDEOS.a, VIDEOS.zoo, VIDEOS.b], 'loop-kept');
    await setProfile({ mode: 'playlist', listId: id, listName: 'x', removeWatched: true });
    await open(`/watch?v=${VIDEOS.a}&list=${id}`);
    await waitForVideo(page, VIDEOS.a);
    await showBar(page);
    await page.locator(BAR).click();
    await expect.poll(() => loopOn(page)).toBe(true);
    await seekToEnd(page, 8);
    await page.waitForTimeout(1500);
    // Paused ~6 s before the end: a slow click below must not let it reach the end and loop (D-022, was flaky).
    await page.evaluate(() => document.querySelector<HTMLVideoElement>('#movie_player video')!.pause());
    await page.locator(ROWS).nth(2).click();
    await waitForVideo(page, VIDEOS.b);
    await page.waitForTimeout(8000);
    expect(await lists.videos(id)).toEqual([VIDEOS.a, VIDEOS.zoo, VIDEOS.b]);
  });
});
