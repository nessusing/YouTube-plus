// F-19-AC3 the settings page preview's sample cards carry avatars. Needs no
// YouTube and no sign-in: its own Chromium with a fresh profile, so it can run
// on its own:
//   npx wxt build && npx playwright test -c tests/e2e/playwright.config.ts specs/danmaku-preview.spec.ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect, test, type BrowserContext } from '@playwright/test';
import { LAUNCH_ARGS } from '../support/env';
import { serviceWorker, storageGet, storageSet } from '../support/yt';

let ctx: BrowserContext;
let profile: string;

test.beforeAll(async () => {
  profile = mkdtempSync(join(tmpdir(), 'ytpp-dm-preview-'));
  ctx = await chromium.launchPersistentContext(profile, { headless: true, channel: 'chromium', args: LAUNCH_ARGS, viewport: null });
});
test.afterAll(async () => {
  await ctx?.close();
  rmSync(profile, { recursive: true, force: true });
});

test('F-19-AC3 the preview\'s sample card shows a round, loaded avatar before the handle', async () => {
  const sw = await serviceWorker(ctx);
  const extId = new URL(sw.url()).host;
  const settings = ((await storageGet(ctx, 'sync', 'settings')) ?? {}) as { features?: Record<string, boolean> };
  await storageSet(ctx, 'sync', { settings: { ...settings, lang: 'en', features: { ...settings.features, danmaku: true } } });
  const page = await ctx.newPage();
  try {
    await page.goto(`chrome-extension://${extId}/options.html`);
    await page.getByRole('tab').nth(4).click(); // Comment danmaku
    const avatar = () => page.evaluate(() => {
      const root = [...document.querySelectorAll<HTMLElement>('.dm-preview > div')].map((d) => d.shadowRoot).find((r) => r?.querySelector('.card'));
      const card = root?.querySelector<HTMLElement>('.card:not(.measure)');
      const img = card?.querySelector<HTMLImageElement>('.text img.avatar');
      const handle = card?.querySelector<HTMLElement>('.text .handle');
      if (!card || card.hidden || !img || !handle || !img.complete || !img.naturalWidth) return undefined;
      const a = img.getBoundingClientRect();
      const h = handle.getBoundingClientRect();
      const cs = getComputedStyle(card);
      return {
        radius: getComputedStyle(img).borderRadius,
        width: a.width, height: a.height,
        font: parseFloat(cs.fontSize), line: parseFloat(cs.lineHeight),
        beforeHandle: a.right <= h.left + 0.5,
        sameLine: Math.abs((a.top + a.bottom) / 2 - (h.top + h.bottom) / 2) < parseFloat(cs.lineHeight) / 2,
      };
    });
    await expect.poll(avatar, { timeout: 10_000 }).toBeTruthy();
    const a = (await avatar())!;
    expect(a.radius).toBe('50%');
    expect(Math.abs(a.width - a.height)).toBeLessThan(1);
    expect(a.height).toBeGreaterThanOrEqual(a.font);
    expect(a.height).toBeLessThanOrEqual(a.line);
    expect(a.beforeHandle).toBe(true);
    expect(a.sameLine).toBe(true);
  } finally {
    await page.close();
  }
});
