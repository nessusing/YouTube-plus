// Playwright fixtures: one Chromium with the extension and the signed-in
// profile per run; a fresh tab per test; test lists from a pool kept between runs.

import { existsSync } from 'node:fs';
import { chromium, expect, test as base, type BrowserContext, type Page } from '@playwright/test';
import { EXTENSION_DIR, LAUNCH_ARGS, PROFILE_DIR, WINDOW } from './env';
import { extensionLang, pageLang, rpc, serviceWorker, setQueueProfile, setYouTubeLang, storageGet, storageSet, TestLists, waitForExtension, type Identity, type QueueProfile } from './yt';

export interface Account {
  me: Identity & { key: string };
  /** A YouTube tab kept open for reads and for edits "from elsewhere". */
  helper: Page;
}

interface TestFixtures {
  page: Page;
  lists: TestLists;
  /** Set this identity's queue settings, as the settings page would. */
  setProfile: (p: QueueProfile) => Promise<void>;
  /** A YouTube page with the extension ready. */
  open: (path: string) => Promise<Page>;
}

interface WorkerFixtures {
  ctx: BrowserContext;
  account: Account;
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  ctx: [async ({}, use) => {
    if (!existsSync(`${EXTENSION_DIR}/manifest.json`)) throw new Error(`no build at ${EXTENSION_DIR}: run wxt build (npm run test:e2e does)`);
    if (!existsSync(PROFILE_DIR)) throw new Error(`no signed-in profile at ${PROFILE_DIR}: run npm run e2e:login first`);
    const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
      // The new headless mode ('chromium' channel) runs extensions.
      ...(WINDOW === 'headless' ? { headless: true, channel: 'chromium' } : { headless: false }),
      args: LAUNCH_ARGS,
      viewport: null,
    });
    if (WINDOW === 'minimized') {
      const minimize = async (page: Page) => {
        const cdp = await ctx.newCDPSession(page);
        const { windowId } = (await cdp.send('Browser.getWindowForTarget')) as { windowId: number };
        await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'minimized' } });
        await cdp.detach();
      };
      for (const p of ctx.pages()) await minimize(p).catch(() => {});
      ctx.on('page', (p) => void minimize(p).catch(() => {}));
    }
    await ctx.tracing.start({ screenshots: true, snapshots: true });
    await use(ctx);
    await ctx.tracing.stop();
    await ctx.close();
  }, { scope: 'worker' }],

  account: [async ({ ctx }, use) => {
    await serviceWorker(ctx);
    // The extension's language follows YouTube's (F-04), and the suite reads
    // our English texts, so YouTube itself is put in English for this profile.
    await setYouTubeLang(ctx, 'en');
    const helper = await ctx.newPage();
    await helper.goto('https://www.youtube.com/');
    await waitForExtension(helper);
    const hl = await pageLang(helper);
    if (!/^en\b/i.test(hl)) throw new Error(`YouTube is shown in "${hl}" even with PREF hl=en: set this account's YouTube language to English (avatar → Language) in the e2e profile`);
    await expect.poll(() => extensionLang(ctx), { message: 'the extension did not follow YouTube to English' }).toBe('en');
    const me = await rpc<Identity>(helper, 'identity');
    if (!me.loggedIn || !me.key) throw new Error('not signed in to YouTube in the e2e profile: run npm run e2e:login');
    const left = await TestLists.sweep(helper);
    if (left.length) console.log(`deleted ${left.length} test list(s) left by an earlier run`);
    // TL;DR off (it would call Gemini for every thumbnail).
    const settings = ((await storageGet(ctx, 'sync', 'settings')) ?? {}) as { features?: Record<string, boolean> };
    await storageSet(ctx, 'sync', { settings: { ...settings, features: { ...settings.features, tldr: false, queue: true, player: true } } });
    await use({ me: me as Account['me'], helper });
    await helper.close();
  }, { scope: 'worker' }],

  page: async ({ ctx }, use, info) => {
    await ctx.tracing.startChunk({ title: info.title });
    const page = await ctx.newPage();
    await use(page);
    const failed = info.status !== info.expectedStatus;
    await ctx.tracing.stopChunk(failed ? { path: info.outputPath('trace.zip') } : undefined);
    if (failed) {
      const log = await storageGet(ctx, 'local', 'log').catch(() => undefined);
      if (log) await info.attach('extension-log.json', { body: JSON.stringify(log, null, 2), contentType: 'application/json' });
    }
    await page.close();
  },

  lists: async ({ account }, use) => {
    const lists = new TestLists(account.helper);
    await use(lists);
    await lists.release();
  },

  setProfile: async ({ ctx, account }, use) => {
    await use((p) => setQueueProfile(ctx, account.me.key, p));
    // Leave the identity on the native queue between tests.
    await setQueueProfile(ctx, account.me.key, { mode: 'native', removeWatched: true });
  },

  open: async ({ page }, use) => {
    await use(async (path) => {
      await page.goto(`https://www.youtube.com${path}`);
      await waitForExtension(page);
      return page;
    });
  },
});

export { expect } from '@playwright/test';
