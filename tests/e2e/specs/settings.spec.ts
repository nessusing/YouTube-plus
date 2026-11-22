// The queue tab of the settings page (design §24.5, §24.6, §27): it works
// through the YouTube tab used last, and what it saves takes effect there.
import type { BrowserContext, Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { LIST_PREFIX, VIDEOS } from '../support/env';
import { playButton, rpc, serviceWorker, storageGet, waitForVideo } from '../support/yt';

async function openSettings(ctx: BrowserContext, yt: Page): Promise<Page> {
  // The settings page picks the YouTube tab used last.
  await yt.bringToFront();
  const extId = new URL((await serviceWorker(ctx)).url()).host;
  const opts = await ctx.newPage();
  await opts.goto(`chrome-extension://${extId}/options.html`);
  await opts.getByRole('tab', { name: 'Queue' }).click();
  await expect(opts.locator('section:visible')).toContainText('Settings for: ', { timeout: 15_000 });
  return opts;
}

const listSelect = (opts: Page) => opts.locator('section:visible select.list-select');

test('choose a playlist: saved for this identity, and the open tab switches at once', async ({ page, open, lists, ctx, account }) => {
  const id = await lists.create([VIDEOS.a, VIDEOS.b], 'pick');
  const title = (await lists.read(id)).title;
  await open(`/watch?v=${VIDEOS.c}`);
  await waitForVideo(page, VIDEOS.c);
  expect(await playButton(page).count()).toBeUndefined();
  const opts = await openSettings(ctx, page);
  try {
    await opts.getByText('Use a playlist (recommended)').click();
    await expect(listSelect(opts)).toBeEnabled();
    await expect(listSelect(opts).locator(`option[value="${id}"]`)).toHaveCount(1, { timeout: 30_000 });
    await expect(listSelect(opts).locator(`option[value="${id}"]`)).toHaveText(`${title} · Private`);
    await listSelect(opts).selectOption(id);
    await expect.poll(() => storageGet(ctx, 'sync', `queue/profile/${account.me.key}`)).toMatchObject({ mode: 'playlist', listId: id, listName: title, removeWatched: true });
    const remove = opts.getByRole('switch', { name: 'Remove from the playlist after playing' });
    await remove.uncheck({ force: true });
    await expect.poll(() => storageGet(ctx, 'sync', `queue/profile/${account.me.key}`)).toMatchObject({ removeWatched: false });
  } finally {
    await opts.close();
  }
  // §24.6: the tab already open follows the new mode.
  await expect.poll(() => playButton(page).count(), { timeout: 20_000 }).toBe(2);
  expect(await playButton(page).name()).toBe(title);
});

test('New…: creates a private playlist with the name given and chooses it', async ({ page, open, lists, ctx, account }) => {
  await open('/');
  const opts = await openSettings(ctx, page);
  const name = `${LIST_PREFIX} ${new Date().toISOString()} created-in-settings`;
  try {
    await opts.getByText('Use a playlist (recommended)').click();
    await expect(listSelect(opts).locator('option[value="__new__"]')).toHaveCount(1, { timeout: 30_000 });
    await listSelect(opts).selectOption('__new__');
    const field = opts.getByRole('textbox', { name: 'Name of the new playlist' });
    await expect(field).toHaveValue('YouTube +');
    await field.fill(name);
    await opts.getByRole('button', { name: 'Create' }).click();
    await expect(opts.locator('section:visible')).toContainText(`Created the private playlist "${name}" and chose it`, { timeout: 30_000 });
    const profile = (await storageGet(ctx, 'sync', `queue/profile/${account.me.key}`)) as { listId?: string; listName?: string };
    expect(profile.listName).toBe(name);
    await lists.adopt(profile.listId!, name);
    // Ours, editable and private, as the extension's own check sees it (an empty list's page has no isEditable).
    const mine = (await rpc<{ id: string; privacy: string }[]>(account.helper, 'editablePlaylists')).find((l) => l.id === profile.listId);
    expect(mine?.privacy).toBe('PRIVATE');
    await expect(listSelect(opts)).toHaveValue(profile.listId!);
  } finally {
    await opts.close();
  }
});

test('the settings page opens on General, whichever tab was open last (design §3)', async ({ ctx }) => {
  const extId = new URL((await serviceWorker(ctx)).url()).host;
  const general = (p: Page) => p.getByRole('tab', { name: 'General' });
  const opts = await ctx.newPage();
  try {
    await opts.goto(`chrome-extension://${extId}/options.html`);
    await expect(general(opts)).toHaveAttribute('aria-selected', 'true');
    await opts.getByRole('tab', { name: 'Queue' }).click();
    await opts.reload();
    await expect(general(opts)).toHaveAttribute('aria-selected', 'true');
  } finally {
    await opts.close();
  }
  // An explicit #<tab> still wins.
  const byHash = await ctx.newPage();
  try {
    await byHash.goto(`chrome-extension://${extId}/options.html#queue`);
    await expect(byHash.getByRole('tab', { name: 'Queue' })).toHaveAttribute('aria-selected', 'true');
  } finally {
    await byHash.close();
  }
});
