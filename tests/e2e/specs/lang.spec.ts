// F-04: the extension's language follows YouTube's interface language. The
// language is switched the way YouTube's own picker does it (PREF hl, then a
// page load); the fixture leaves YouTube in English, and so does this file.
import type { BrowserContext, Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { extensionLang, pageLang, serviceWorker, setYouTubeLang, waitForExtension } from '../support/yt';

async function switchYouTube(ctx: BrowserContext, page: Page, hl: string): Promise<void> {
  await setYouTubeLang(ctx, hl);
  await page.goto('https://www.youtube.com/');
  await waitForExtension(page);
  expect(await pageLang(page), `YouTube did not switch to ${hl}`).toMatch(new RegExp(`^${hl.split('-')[0]}`, 'i'));
}

async function openSettings(ctx: BrowserContext): Promise<Page> {
  const extId = new URL((await serviceWorker(ctx)).url()).host;
  const opts = await ctx.newPage();
  await opts.goto(`chrome-extension://${extId}/options.html`);
  return opts;
}

test('F-04-AC1 F-04-AC4 YouTube in Chinese (simplified or traditional) → extension in Chinese; any other language → English', async ({ ctx, page }) => {
  let opts: Page | undefined;
  try {
    await switchYouTube(ctx, page, 'zh-CN');
    await expect.poll(() => extensionLang(ctx)).toBe('zh');
    opts = await openSettings(ctx);
    await expect(opts.locator('html')).toHaveAttribute('lang', 'zh-CN');
    await expect(opts.getByRole('tab', { name: '队列' })).toBeVisible();

    await switchYouTube(ctx, page, 'zh-TW');
    await expect.poll(() => extensionLang(ctx)).toBe('zh');

    // AC4: an extension page already open follows the switch on its own.
    await switchYouTube(ctx, page, 'fr');
    await expect.poll(() => extensionLang(ctx)).toBe('en');
    await expect(opts.locator('html')).toHaveAttribute('lang', 'en');
    await expect(opts.getByRole('tab', { name: 'Queue' })).toBeVisible();
  } finally {
    await opts?.close();
    await switchYouTube(ctx, page, 'en');
    await expect.poll(() => extensionLang(ctx)).toBe('en');
  }
});
