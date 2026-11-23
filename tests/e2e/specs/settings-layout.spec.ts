// F-01 settings page layout (bug P28): in every label/options row the label
// keeps clear of its options — on every tab, in English and Chinese, in a wide
// and a narrow window. Needs no YouTube and no sign-in: its own Chromium with
// a fresh profile, so it can run on its own:
//   npx wxt build && npx playwright test -c tests/e2e/playwright.config.ts specs/settings-layout.spec.ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { EXTENSION_DIR, LAUNCH_ARGS } from '../support/env';
import { serviceWorker, storageGet, storageSet } from '../support/yt';

/** Least room between a label's text and its options, in px. */
const MIN_GAP = 16;

let ctx: BrowserContext;
let profile: string;

test.beforeAll(async () => {
  profile = mkdtempSync(join(tmpdir(), 'ytpp-layout-'));
  ctx = await chromium.launchPersistentContext(profile, { headless: true, channel: 'chromium', args: LAUNCH_ARGS, viewport: null });
});
test.afterAll(async () => {
  await ctx?.close();
  rmSync(profile, { recursive: true, force: true });
});

/**
 * Every visible .row on the page that is too tight: wide layout (label left of
 * the options) needs MIN_GAP between the label's longest line and the options;
 * narrow layout (label above) needs the label to end above the options.
 */
function tightRows(page: Page) {
  return page.evaluate((minGap) => {
    const out: string[] = [];
    for (const row of document.querySelectorAll<HTMLElement>('section:not([hidden]) .row')) {
      const label = row.querySelector<HTMLElement>(':scope > .row-label');
      const body = row.querySelector<HTMLElement>(':scope > .row-body');
      if (!label || !body || !label.textContent?.trim() || !row.offsetParent) continue;
      const range = document.createRange();
      range.selectNodeContents(label);
      const lines = [...range.getClientRects()];
      const textRight = Math.max(...lines.map((r) => r.right));
      const textBottom = Math.max(...lines.map((r) => r.bottom));
      const b = body.getBoundingClientRect();
      const beside = b.left > label.getBoundingClientRect().left + 1;
      if (beside ? b.left - textRight < minGap : b.top < textBottom) {
        out.push(`${label.textContent.trim()} (${beside ? `gap ${Math.round(b.left - textRight)}px` : 'overlaps'})`);
      }
    }
    return out;
  }, MIN_GAP);
}

for (const lang of ['en', 'zh'] as const) {
  for (const width of [1400, 700]) {
    test(`F-01 P28 settings rows: labels keep clear of their options (${lang}, ${width}px)`, async () => {
      const sw = await serviceWorker(ctx);
      const extId = new URL(sw.url()).host;
      const settings = ((await storageGet(ctx, 'sync', 'settings')) ?? {}) as Record<string, unknown>;
      await storageSet(ctx, 'sync', { settings: { ...settings, lang } });
      const page = await ctx.newPage();
      try {
        await page.setViewportSize({ width, height: 1000 });
        await page.goto(`chrome-extension://${extId}/options.html`);
        const tabs = page.getByRole('tab');
        await expect(tabs.first()).toBeVisible();
        const tight: string[] = [];
        for (let i = 0; i < (await tabs.count()); i++) {
          await tabs.nth(i).click();
          const name = (await tabs.nth(i).textContent())?.trim();
          for (const r of await tightRows(page)) tight.push(`${name}: ${r}`);
        }
        expect(tight).toEqual([]);
      } finally {
        await page.close();
      }
    });
  }
}
