// What a fresh install does before any sign-in: each test launches its own
// Chromium with an empty profile (never the signed-in e2e one), so it can run
// on its own and touches no account:
//   npx wxt build && npx playwright test -c tests/e2e/playwright.config.ts specs/fresh-profile.spec.ts
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { EXTENSION_DIR, LAUNCH_ARGS } from '../support/env';
import { extensionLang, pageLang, serviceWorker, setYouTubeLang, storageGet, storageSet } from '../support/yt';

/** A fresh profile with the extension and `args` added; `lang` is the browser language. */
async function fresh(args: string[], use: (ctx: BrowserContext) => Promise<void>, lang = 'en-US'): Promise<void> {
  const profile = mkdtempSync(join(tmpdir(), 'ytpp-fresh-'));
  // Playwright's locale is what reaches navigator.language (--lang does not on Linux).
  const ctx = await chromium.launchPersistentContext(profile, {
    headless: true, channel: 'chromium', viewport: null, locale: lang,
    args: [...LAUNCH_ARGS.filter((a) => !a.startsWith('--lang=')), `--lang=${lang}`, ...args],
  });
  try {
    await use(ctx);
  } finally {
    await ctx.close();
    rmSync(profile, { recursive: true, force: true });
  }
}

async function options(ctx: BrowserContext, hash = ''): Promise<Page> {
  const extId = new URL((await serviceWorker(ctx)).url()).host;
  const page = await ctx.newPage();
  await page.goto(`chrome-extension://${extId}/options.html${hash}`);
  await expect(page.getByRole('tab').first()).toBeVisible();
  return page;
}

test('F-01-AC2 the toolbar icon follows only the master switch; clicking it opens the settings page', async () => {
  await fresh([], async (ctx) => {
    const sw = await serviceWorker(ctx);
    // Record what the background sets from now on.
    await sw.evaluate(() => {
      const g = globalThis as unknown as { chrome: { action: { setIcon(d: { path: Record<string, string> }): Promise<void> } }; __icons: string[] };
      g.__icons = [];
      const real = g.chrome.action.setIcon.bind(g.chrome.action);
      g.chrome.action.setIcon = (d) => { g.__icons.push(d.path['16']!); return real(d); };
    });
    const icons = () => sw.evaluate(() => (globalThis as unknown as { __icons: string[] }).__icons);
    const settings = async () => ((await storageGet(ctx, 'sync', 'settings')) ?? {}) as Record<string, unknown>;
    await storageSet(ctx, 'sync', { settings: { ...(await settings()), enabled: false } });
    await expect.poll(async () => (await icons()).at(-1)).toBe('/icon/gray-16.png');
    // A feature switch is not the master switch: the icon stays gray.
    const s = await settings();
    await storageSet(ctx, 'sync', { settings: { ...s, features: { ...(s.features as object), danmaku: true } } });
    await expect.poll(async () => (await icons()).length).toBeGreaterThanOrEqual(2);
    expect((await icons()).at(-1)).toBe('/icon/gray-16.png');
    await storageSet(ctx, 'sync', { settings: { ...(await settings()), enabled: true } });
    await expect.poll(async () => (await icons()).at(-1)).toBe('/icon/16.png');
    // No popup, so a click reaches the background, which opens the settings page.
    const manifest = JSON.parse(readFileSync(`${EXTENSION_DIR}/manifest.json`, 'utf8')) as { action?: { default_popup?: string } };
    expect(manifest.action).toBeDefined();
    expect(manifest.action?.default_popup).toBeUndefined();
  });
});

test('F-04-AC2 the settings page has no language option', async () => {
  await fresh([], async (ctx) => {
    const page = await options(ctx);
    const tabs = page.getByRole('tab');
    for (let i = 0; i < (await tabs.count()); i++) {
      await tabs.nth(i).click();
      const found = await page.evaluate(() => {
        const sec = document.querySelector('section:not([hidden])')!;
        const labels = [...sec.querySelectorAll('.row-label, .switch-row .text, .radios label, h3')].map((e) => e.textContent?.trim() ?? '');
        const options = [...sec.querySelectorAll('select option')].map((o) => o.textContent?.trim() ?? '');
        return [...labels.filter((l) => /^(language|语言|界面语言)\b/i.test(l)), ...options.filter((o) => /^(english|中文|简体中文)$/i.test(o))];
      });
      expect(found, `tab ${i}`).toEqual([]);
    }
  });
});

test('F-04-AC3 before YouTube is opened the browser language is used; opening YouTube switches to its language', async () => {
  await fresh([], async (ctx) => {
    let page = await options(ctx);
    await expect(page.getByRole('tab').first()).toHaveText('通用');
    await page.close();
    // YouTube switched to English the way its own picker does (no sign-in needed): the extension follows.
    await setYouTubeLang(ctx, 'en');
    const yt = await ctx.newPage();
    await yt.goto('https://www.youtube.com/');
    await expect.poll(() => pageLang(yt)).toMatch(/^en/);
    await expect.poll(() => extensionLang(ctx), { timeout: 30_000 }).toBe('en');
    page = await options(ctx);
    await expect(page.getByRole('tab').first()).toHaveText('General');
  }, 'zh-CN');
  await fresh([], async (ctx) => {
    const page = await options(ctx);
    await expect(page.getByRole('tab').first()).toHaveText('General');
  }, 'en-US');
});

test('F-11-AC1 without Document PiP: the pop-out switch is grayed out and the self-check says "note", not fail', async () => {
  await fresh(['--disable-blink-features=DocumentPictureInPictureAPI'], async (ctx) => {
    const page = await options(ctx);
    await page.getByRole('tab', { name: 'Player' }).click();
    const sw = page.getByRole('switch', { name: /Pop the miniplayer out|pop-out|Pop out/i });
    await expect(sw).toBeDisabled();
    await expect(page.locator('section:not([hidden])')).toContainText('Needs Chrome / Edge 116 or later');
    // The player's page checks run in a YouTube tab.
    const yt = await ctx.newPage();
    await yt.goto('https://www.youtube.com/?hl=en');
    await yt.waitForLoadState('domcontentloaded');
    const results = await page.evaluate(() => (globalThis as unknown as { chrome: { runtime: { sendMessage(m: unknown): Promise<{ results: { name: string; status: string }[] }> } } })
      .chrome.runtime.sendMessage({ type: 'YouTube+/selfcheck' }));
    const pip = results.results.find((r) => /Document PiP/.test(r.name));
    expect(pip?.status).toBe('warn');
  });
});
