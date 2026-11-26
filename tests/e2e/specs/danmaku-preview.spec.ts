// F-19-AC3 the settings page preview's sample cards carry avatars. Needs no
// YouTube and no sign-in: its own Chromium with a fresh profile, so it can run
// on its own:
//   npx wxt build && npx playwright test -c tests/e2e/playwright.config.ts specs/danmaku-preview.spec.ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { LAUNCH_ARGS } from '../support/env';
import { serviceWorker, storageGet, storageRemove, storageSet } from '../support/yt';

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

// ---------- rows, long comments and the real-data preview (D-026) ----------

const CACHE = 'danmaku/cache/ytppPreview';
const WORDS = 'the light here changes slowly and nobody in the room seems to notice it at all';

/** 150 comments of one to three lines, a few timestamped, one far too long. */
function seeded() {
  const comments = Array.from({ length: 150 }, (_, k) => {
    const text = k === 0 ? `${WORDS}. `.repeat(8) : `${k % 10 === 0 ? '1:00 ' : ''}Comment ${k}: ${WORDS.slice(0, 20 + (k % 3) * 28)}`;
    const stamps = k && k % 10 === 0 ? [{ sec: 60, start: 0, len: 4 }] : [];
    return { id: `p${k}`, text, author: `@viewer${k}`, likes: 1000 - k, replies: 0, ageDays: 3, stamps, images: [], hasLink: false };
  });
  const heatmap = Array.from({ length: 20 }, (_, i) => ({ start: i * 12, dur: 12, score: (i % 5) / 4 }));
  return { t: Date.now(), used: Date.now(), total: 3000, heatmap, comments, complete: true, title: 'A seeded video', duration: 240 };
}

/** The settings page on the danmaku tab, with these danmaku settings. */
async function openTab(style: 'card' | 'fly', display: Record<string, unknown> = {}): Promise<Page> {
  const sw = await serviceWorker(ctx);
  const extId = new URL(sw.url()).host;
  const settings = ((await storageGet(ctx, 'sync', 'settings')) ?? {}) as { features?: Record<string, boolean> };
  await storageSet(ctx, 'sync', { settings: { ...settings, lang: 'en', features: { ...settings.features, danmaku: true }, danmaku: { style, params: { display } } } });
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`chrome-extension://${extId}/options.html`);
  await page.getByRole('tab').nth(4).click();
  return page;
}

/** The numbers of the flow line: fetched, after filtering, on the timeline. */
const flow = async (page: Page) => {
  const m = (await page.locator('.dm-flow').textContent())!.match(/(\d+) fetched → (\d+) after filtering → (\d+) on/)!;
  return { fetched: Number(m[1]), kept: Number(m[2]), placed: Number(m[3]) };
};
const field = (page: Page, label: string) => page.locator('.row', { has: page.getByText(label, { exact: true }) }).locator('input.num');
async function setField(page: Page, label: string, value: number): Promise<void> {
  await field(page, label).fill(String(value));
  await field(page, label).press('Enter');
  await field(page, label).blur();
}

/** The mock player's cards (or flying strips) as boxes. */
const boxes = (page: Page, sel: '.card:not(.measure)' | '.strip') => page.evaluate((sel) => {
  for (const host of document.querySelectorAll<HTMLElement>('.dm-preview > div')) {
    const found = [...(host.shadowRoot?.querySelectorAll<HTMLElement>(sel) ?? [])];
    if (found.length) {
      return found.map((e) => {
        const r = e.getBoundingClientRect();
        const text = e.querySelector<HTMLElement>('.text');
        return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, lines: text ? Math.round(text.getBoundingClientRect().height / parseFloat(getComputedStyle(e).lineHeight)) : 1 };
      });
    }
  }
  return [];
}, sel);

test.describe('the preview with a cached video', () => {
  test.beforeEach(() => storageSet(ctx, 'local', { [CACHE]: seeded() }));
  test.afterEach(() => storageRemove(ctx, 'local', CACHE));

  test('F-12-AC18 F-12-AC19 shows the latest cached video with its counts and timeline', async () => {
    const page = await openTab('card');
    try {
      await expect(page.locator('select.dm-video')).toHaveValue('ytppPreview');
      await expect(page.locator('select.dm-video option:checked')).toHaveText('A seeded video（4:00）');
      const f = await flow(page);
      expect([f.fetched, f.kept]).toEqual([150, 150]);
      expect(f.placed).toBeGreaterThan(20);
      await expect(page.locator('.dm-left')).toContainText('too long 1');
      await expect(page.locator('.dm-block')).not.toHaveCount(0);
      await expect(page.locator('.dm-block.stamp')).not.toHaveCount(0);
      await expect(page.locator('.dm-strip-bars svg path')).toHaveCount(1);
      await expect(page.getByText('reach watched videos only when their cache expires (7 days)')).toBeVisible();
    } finally {
      await page.close();
    }
  });

  test('F-12-AC16 F-12-AC18 F-12-AC19 F-12-AC10 more rows: more comments at once, the difference shown', async () => {
    const page = await openTab('card');
    try {
      const before = (await flow(page)).placed;
      await expect(page.locator('.dm-delta')).toHaveText('');
      await setField(page, 'Cards at once, at most', 4);
      await expect.poll(async () => (await flow(page)).placed).toBeGreaterThan(before);
      const after = (await flow(page)).placed;
      await expect(page.locator('.dm-delta')).toHaveText(`+${after - before} since before the last change`);

      // F-12-AC12: at the timestamped moment, several cards stacked without touching.
      await page.locator('.dm-block.stamp').first().click();
      await expect.poll(async () => (await boxes(page, '.card:not(.measure)')).length).toBeGreaterThan(1);
      const cards = (await boxes(page, '.card:not(.measure)')).sort((a, b) => a.top - b.top);
      expect(cards.length).toBeLessThanOrEqual(4);
      for (let k = 1; k < cards.length; k++) expect(cards[k]!.top).toBeGreaterThanOrEqual(cards[k - 1]!.bottom - 0.5);
      await expect(page.locator('.dm-player .muted').last()).toContainText('1:00');

      // A group's "restore defaults" leaves the rows alone.
      const display = page.locator('.group', { has: page.getByRole('heading', { name: 'Display', exact: true }) });
      await display.getByRole('button', { name: 'Restore defaults' }).click();
      await expect(field(page, 'Cards at once, at most')).toHaveValue('4');
    } finally {
      await page.close();
    }
  });

  test('F-12-AC16 F-12-AC19 the per-minute limit and the long-comment settings change the counts', async () => {
    const page = await openTab('card', { cardRows: 4 });
    try {
      await setField(page, 'Local: at most per minute', 2);
      await expect(page.locator('.dm-left')).not.toContainText('over the per-minute limit 0');
      await setField(page, 'Long means more than', 1);
      await expect(page.locator('.dm-left')).not.toContainText('too long 1 ·');
      await page.getByLabel('Cut, ending in "…"').check();
      await expect(page.locator('.dm-left')).toContainText('too long 0');
    } finally {
      await page.close();
    }
  });

  test('F-12-AC17 a cut comment takes no more than the line limit', async () => {
    const page = await openTab('card', { longLines: 2, longMode: 'truncate' });
    try {
      const long = page.locator('.dm-block[data-text*="@viewer0 "]');
      await expect(long).toHaveCount(1);
      await long.click();
      await expect.poll(async () => (await boxes(page, '.card:not(.measure)')).length).toBe(1);
      expect((await boxes(page, '.card:not(.measure)'))[0]!.lines).toBeLessThanOrEqual(2);
      const clamp = await page.evaluate(() => {
        const text = [...document.querySelectorAll<HTMLElement>('.dm-preview > div')].map((h) => h.shadowRoot?.querySelector<HTMLElement>('.card:not(.measure) .text')).find(Boolean)!;
        return [getComputedStyle(text).webkitLineClamp, text.textContent!.endsWith('…')];
      });
      expect(clamp).toEqual(['2', true]);
    } finally {
      await page.close();
    }
  });

  test('F-12-AC19 the counts and timeline stay on screen further down the page', async () => {
    const page = await openTab('card');
    try {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await expect.poll(async () => Math.round((await page.locator('.dm-stats').boundingBox())!.y)).toBe(56);
      await expect(page.locator('.dm-strip-bars')).toBeInViewport();
    } finally {
      await page.close();
    }
  });

  test('F-12-AC13 F-12-AC18 flying: lanes never overlap as drawn', async () => {
    const page = await openTab('fly', { flyRows: 4 });
    try {
      await expect(page.locator('.dm-block')).not.toHaveCount(0);
      await page.getByRole('button', { name: 'Pause' }).click();
      let most = 0;
      // Seek along the timeline and look at every strip on screen.
      const width = (await page.locator('.dm-strip-bars').boundingBox())!.width;
      for (let k = 1; k < 40; k++) {
        await page.locator('.dm-strip-bars').evaluate((el, x) => {
          const r = el.getBoundingClientRect();
          el.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.left + x, clientY: r.top + 1 }));
        }, (width * k) / 40);
        await page.waitForTimeout(80);
        const on = await boxes(page, '.strip');
        most = Math.max(most, on.length);
        expect(new Set(on.map((b) => Math.round(b.top))).size).toBeLessThanOrEqual(4);
        for (const a of on) for (const b of on) {
          if (a !== b && Math.abs(a.top - b.top) < 1 && a.left <= b.left) expect(b.left, `at ${k}/40`).toBeGreaterThanOrEqual(a.right - 0.5);
        }
      }
      expect(most).toBeGreaterThan(2);
    } finally {
      await page.close();
    }
  });
});

test('F-12-AC18 without a cached video: the sample comments, and no counts', async () => {
  await storageRemove(ctx, 'local', CACHE);
  const page = await openTab('card');
  try {
    await expect(page.locator('select.dm-video')).toHaveValue('');
    await expect(page.locator('.dm-stats')).toBeHidden();
    await expect(page.getByText('No video to choose yet.')).toBeVisible();
    await expect.poll(async () => (await boxes(page, '.card:not(.measure)')).length, { timeout: 10_000 }).toBeGreaterThan(0);
  } finally {
    await page.close();
  }
});
