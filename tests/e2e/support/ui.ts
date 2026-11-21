// Driving YouTube's own UI. The account's UI language is whatever it is
// (measured: Chinese), so these find things by structure, not by text,
// except for the menu item the extension relabels.

import { expect, type Locator, type Page } from '@playwright/test';
import { panelRowsShown, player } from './yt';

/** "Add to queue" as YouTube words it (zh / en). */
export const NATIVE_QUEUE_ITEM = /^(添加到待播列表|加入队列|Add to queue)$/;
/** Our label, "Add to <list name>". */
export const OUR_ITEM = /^Add to YouTube\+ e2e/;

export const related = (page: Page) => page.locator('ytd-watch-flexy #secondary yt-lockup-view-model');
export const homeItems = (page: Page) => page.locator('ytd-rich-item-renderer yt-lockup-view-model');

export async function videoIdOf(lockup: Locator): Promise<string> {
  const href = await lockup.locator('a[href*="/watch?v="], a[href*="/shorts/"]').first().getAttribute('href');
  const url = href ? new URL(href, 'https://www.youtube.com') : undefined;
  const id = url?.searchParams.get('v') ?? url?.pathname.match(/^\/shorts\/([\w-]+)/)?.[1];
  if (!id) throw new Error('no video link in this item');
  return id;
}

/** New-style (yt-list-item-view-model) and old-style (ytd-menu-service-item-renderer) menu items. */
const MENU_ITEMS = 'ytd-popup-container yt-list-item-view-model, ytd-popup-container ytd-menu-service-item-renderer';
const visibleItems = (page: Page) => page.locator(MENU_ITEMS).filter({ visible: true });

/** Open the ⋯ menu of a thumbnail item; returns the visible menu item texts. */
export async function openMenu(page: Page, lockup: Locator): Promise<string[]> {
  await lockup.scrollIntoViewIfNeeded();
  await lockup.hover();
  const old = lockup.locator('ytd-menu-renderer button');
  await ((await old.count()) ? old.first() : lockup.locator('button[aria-label]:not([aria-label^="TL;DR"])').last()).click();
  await expect(visibleItems(page).first()).toBeVisible();
  // The relabel runs a frame or two after the menu opens.
  await page.waitForTimeout(500);
  return (await visibleItems(page).allInnerTexts()).map((t) => t.trim()).filter(Boolean);
}

/** Close it by clicking a blank spot of the top bar (Escape would also close the miniplayer). */
export async function closeMenu(page: Page): Promise<void> {
  const start = await page.locator('ytd-masthead #start').boundingBox();
  if (!start) throw new Error('no masthead');
  await page.mouse.click(start.x + start.width + 12, start.y + start.height / 2);
  await expect(visibleItems(page)).toHaveCount(0).catch(() => {});
}

/**
 * Click the item's Add to queue (ours or YouTube's, whichever the menu shows)
 * and return the clicked label and the video ID.
 */
export async function addFromMenu(page: Page, lockup: Locator): Promise<{ label: string; videoId: string }> {
  const videoId = await videoIdOf(lockup);
  const texts = await openMenu(page, lockup);
  const label = texts.find((t) => OUR_ITEM.test(t) || NATIVE_QUEUE_ITEM.test(t));
  if (!label) throw new Error(`no Add to queue item in the menu: ${JSON.stringify(texts)}`);
  await visibleItems(page).filter({ hasText: label }).first().click();
  return { label, videoId };
}

/** The first related / home item that is not one of `skip`. */
export async function pickItem(items: Locator, skip: string[] = []): Promise<Locator> {
  await expect(items.first()).toBeVisible();
  const n = await items.count();
  for (let i = 0; i < n; i++) {
    const it = items.nth(i);
    const id = await videoIdOf(it).catch(() => undefined);
    // Skip Shorts, mixes and the videos the test already uses.
    if (id && !skip.includes(id) && !(await it.locator('a[href*="list="], a[href*="/shorts/"]').count())) return it;
  }
  throw new Error('no usable item on the page');
}

// ---------- miniplayer ----------

export async function toMini(page: Page): Promise<void> {
  // The player's own miniplayer button; the "i" shortcut depends on where focus is.
  await expect(async () => {
    if ((await player(page)).mini) return;
    await page.locator('#movie_player').hover();
    const btn = page.locator('#movie_player .ytp-miniplayer-button:visible');
    if (await btn.count()) await btn.first().click();
    else await page.keyboard.press('i');
    await expect.poll(async () => (await player(page)).mini, { timeout: 3000 }).toBe(true);
  }).toPass({ timeout: 20_000 });
  await page.mouse.move(5, 300);
}

export async function toWatch(page: Page): Promise<void> {
  await page.locator('ytd-miniplayer #movie_player').hover();
  await page.locator('ytd-miniplayer .ytp-miniplayer-expand-watch-page-button:visible').first().click();
  await expect.poll(async () => (await player(page)).mini).toBe(false);
  await expect(page).toHaveURL(/\/watch\?/);
}

/** The miniplayer's info bar: title, and "<list> • i / n" when in a list or the queue. */
export async function miniInfo(page: Page): Promise<string> {
  return (await page.locator('ytd-miniplayer-info-bar').innerText()).replace(/\s+/g, ' ').trim();
}

/** The rows of the list panel under the miniplayer, expanding it if needed. */
export async function miniRows(page: Page): Promise<string[]> {
  let rows = await panelRowsShown(page, 'mini');
  if (!rows.length) {
    await page.locator('ytd-miniplayer-info-bar button').last().click();
    await page.waitForTimeout(1000);
    rows = await panelRowsShown(page, 'mini');
  }
  return rows;
}

/** Native queue in the miniplayer, playing `first`, with two more items from the home page. */
export async function startNativeQueue(page: Page, first: string): Promise<string[]> {
  await page.goto(`https://www.youtube.com/watch?v=${first}`);
  await expect.poll(async () => (await player(page)).videoId, { timeout: 30_000 }).toBe(first);
  await toMini(page);
  const added: string[] = [];
  for (let i = 0; i < 2; i++) {
    const it = await pickItem(homeItems(page), [first, ...added]);
    const r = await addFromMenu(page, it);
    expect(r.label).toMatch(NATIVE_QUEUE_ITEM);
    added.push(r.videoId);
    await page.waitForTimeout(1500);
  }
  await expect.poll(() => miniInfo(page)).toMatch(/1 \/ 3/);
  return [first, ...added];
}
