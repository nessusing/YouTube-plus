// Comment danmaku (F-12) on real YouTube. Most tests seed the cache with
// fixed comments, so cards land at known times and AI mode needs no Gemini:
// every comment already has Gemini's verdict. One test fetches for real.
import type { BrowserContext, Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { VIDEOS } from '../support/env';
import { toMini, toWatch } from '../support/ui';
import { player, serviceWorker, storageGet, storageRemove, storageSet, waitForVideo } from '../support/yt';

const BTN = '#movie_player .ytpp-dm-btn';
const CACHE = (id: string) => `danmaku/cache/${id}`;

interface Seeded {
  id: string;
  text: string;
  likes?: number;
  /** Timestamps written in the text as m:ss. */
  stamped?: boolean;
  /** The author's avatar (F-19). */
  avatar?: string;
}

/** A small round-ish image that needs no network (F-19). */
const AVATAR_OK = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="#26a69a"/></svg>')}`;
/** An avatar address that does not load. */
const AVATAR_BROKEN = 'https://www.youtube.com/ytpp-e2e-missing-avatar.png';

/**
 * Seven estimated lines (refLineWidth 50): 4 × screenSec = 20 s on the card,
 * 0:20–0:40. On the e2e window's player it wraps to three or more real lines,
 * so with no long-comment limit (two lines a screen) the card pages to a second
 * screen in its later half.
 */
const LONG = '0:20 this is the part everyone waits for, and it still holds up after all these years; the timing of the turn is perfect and the whole crowd knows it is coming before it does. Every time I watch it again I notice something new in the background, a face in the crowd or a small move nobody talks about.';
const AI_TEXT = 'the way the camera moves right here is something you only notice on the third watch';
const HIDDEN_TEXT = 'subscribe to my channel for more of the same, link in my profile, thanks everyone';
const AMBIENT_TEXT = 'I come back to this song every single year and it never gets old for some reason';
const OTHER = '0:40 and this one belongs to the other video only, it must never show on the first one at all, not even for a moment, not once';

function comment(s: Seeded) {
  const stamps = s.stamped
    ? [...s.text.matchAll(/\b(\d{1,2}):(\d{2})\b/g)].map((m) => ({ sec: Number(m[1]) * 60 + Number(m[2]), start: m.index!, len: m[0].length }))
    : [];
  return { id: s.id, text: s.text, author: `@e2e-${s.id}`, likes: s.likes ?? 1, replies: 0, ageDays: 10, stamps, images: [], hasLink: false, ...(s.avatar ? { avatar: s.avatar } : {}) };
}

/** A fresh, complete cache entry: run() uses it and fetches nothing. */
async function seed(ctx: BrowserContext, videoId: string, cs: Seeded[], placements: Record<string, unknown> = {}): Promise<void> {
  const now = Date.now();
  await storageSet(ctx, 'local', {
    [CACHE(videoId)]: { t: now, used: now, total: 1000, heatmap: [], comments: cs.map(comment), complete: true, placements },
  });
}

async function setDanmaku(ctx: BrowserContext, on: boolean, patch: Record<string, unknown> = {}): Promise<void> {
  const s = ((await storageGet(ctx, 'sync', 'settings')) ?? {}) as { features?: Record<string, boolean>; danmaku?: Record<string, unknown> };
  await storageSet(ctx, 'sync', {
    settings: {
      ...s,
      features: { ...s.features, danmaku: on },
      // No long-comment limit unless a test sets one: LONG is longer than the default.
      danmaku: { ...s.danmaku, active: true, placement: 'local', style: 'card', debug: true, params: { display: { longLines: 0 } }, ...patch },
    },
  });
}

/** The card as shown: text (handle included), source label, transform of the text; undefined when hidden. */
const card = (page: Page) => page.evaluate(() => {
  const root = document.querySelector('#movie_player .ytpp-dm-layer')?.shadowRoot;
  const c = root?.querySelector<HTMLElement>('.card:not(.measure)');
  if (!c || c.hidden) return undefined;
  const label = c.querySelector<HTMLElement>('.label');
  const text = c.querySelector<HTMLElement>('.text')!;
  const r = c.getBoundingClientRect();
  return { text: text.textContent ?? '', label: label && !label.hidden ? label.textContent : '', transform: text.style.transform, top: r.top, bottom: r.bottom, opacity: Number(c.style.opacity) };
});

/** The button's tooltip text, opened the way a pointer does. */
const tooltip = (page: Page) => page.evaluate(async () => {
  const b = document.querySelector('#movie_player .ytpp-dm-btn')!;
  b.dispatchEvent(new MouseEvent('mouseenter'));
  await new Promise((r) => setTimeout(r, 100));
  const text = document.querySelector('.ytpp-dm-tip .ytp-tooltip-text')?.textContent ?? '';
  b.dispatchEvent(new MouseEvent('mouseleave'));
  return text;
});

/** Wait for a card containing `text` (the session may still be loading). */
async function expectCard(page: Page, text: string): Promise<void> {
  await expect.poll(async () => (await card(page))?.text ?? '', { timeout: 20_000 }).toContain(text);
}

async function noAd(page: Page): Promise<void> {
  await expect.poll(async () => (await player(page)).ad, { timeout: 90_000 }).toBe(false);
}

/** Paused at `t` (after any ad); one frame later the layer has drawn. */
async function pauseAt(page: Page, t: number): Promise<void> {
  await noAd(page);
  await page.evaluate((t) => {
    const p = document.querySelector('#movie_player') as HTMLElement & { seekTo(s: number, a: boolean): void; pauseVideo(): void };
    p.pauseVideo();
    p.seekTo(t, true);
  }, t);
  await expect.poll(async () => Math.abs((await player(page)).time - t) < 0.3).toBe(true);
  await page.waitForTimeout(300);
}

async function openWatch(page: Page, open: (p: string) => Promise<Page>, videoId: string): Promise<void> {
  await open(`/watch?v=${videoId}`);
  await waitForVideo(page, videoId);
  await expect(page.locator(BTN)).toHaveCount(1, { timeout: 20_000 });
}

/** Navigate inside the page, as clicking a video does (no reload). */
async function navigate(page: Page, videoId: string): Promise<void> {
  await page.evaluate((videoId) => {
    document.querySelector('ytd-app')!.dispatchEvent(new CustomEvent('yt-navigate', {
      bubbles: true, composed: true,
      detail: { endpoint: { commandMetadata: { webCommandMetadata: { url: `/watch?v=${videoId}`, webPageType: 'WEB_PAGE_TYPE_WATCH', rootVe: 3832 } }, watchEndpoint: { videoId } } },
    }));
  }, videoId);
  await waitForVideo(page, videoId);
}

async function showBar(page: Page): Promise<void> {
  await page.locator('#movie_player').hover();
  await page.mouse.move(400, 300);
  await page.mouse.move(420, 320);
  await expect.poll(() => page.evaluate(() => !document.querySelector('#movie_player')!.classList.contains('ytp-autohide'))).toBe(true);
}

test.describe('comment danmaku', () => {
  const SEEDED = [VIDEOS.a, VIDEOS.c, VIDEOS.d];
  test.afterEach(async ({ ctx }) => {
    await setDanmaku(ctx, false);
    for (const id of [...SEEDED, VIDEOS.b]) await storageRemove(ctx, 'local', CACHE(id));
  });

  test('F-12-AC1 feature off (the default): no button, no layer', async ({ page, open, ctx }) => {
    await setDanmaku(ctx, false);
    await open(`/watch?v=${VIDEOS.a}`);
    await waitForVideo(page, VIDEOS.a);
    await page.waitForTimeout(1500);
    expect(await page.locator('.ytpp-dm-btn').count()).toBe(0);
    expect(await page.locator('.ytpp-dm-layer').count()).toBe(0);
  });

  test('F-12-AC1 the button sits left of captions and switches danmaku off and on for every video', async ({ page, open, ctx }) => {
    await seed(ctx, VIDEOS.a, [{ id: 's', text: LONG, stamped: true }]);
    await setDanmaku(ctx, true);
    await openWatch(page, open, VIDEOS.a);
    expect(await page.evaluate((sel) => document.querySelector(sel)!.nextElementSibling?.classList.contains('ytp-subtitles-button'), BTN)).toBe(true);
    await expect(page.locator(BTN)).toHaveAttribute('aria-pressed', 'true');
    await pauseAt(page, 22);
    await expectCard(page, 'everyone waits for');

    await showBar(page);
    await page.locator(BTN).click();
    await expect(page.locator(BTN)).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(() => card(page)).toBeUndefined();
    expect(((await storageGet(ctx, 'sync', 'settings')) as { danmaku: { active: boolean } }).danmaku.active).toBe(false);

    // Turned back on mid-card: the card at the playhead comes back.
    await showBar(page);
    await page.locator(BTN).click();
    await expect(page.locator(BTN)).toHaveAttribute('aria-pressed', 'true');
    await expectCard(page, 'everyone waits for');
  });

  test('F-12-AC6 F-12-AC10 a timestamped card: at its moment, paging, paused, seeking back and into its end', async ({ page, open, ctx }) => {
    await seed(ctx, VIDEOS.a, [{ id: 's', text: LONG, stamped: true }]);
    await setDanmaku(ctx, true);
    await openWatch(page, open, VIDEOS.a);

    await pauseAt(page, 21);
    await expectCard(page, 'everyone waits for');
    const first = (await card(page))!;
    expect(first.text).toContain('@e2e-s');
    expect(first.label).toBe('timestamp');
    expect(first.transform).toBe('translateY(0px)');
    // Paused: it stays, on the same screen.
    await page.waitForTimeout(1500);
    expect((await card(page))?.transform).toBe('translateY(0px)');

    await pauseAt(page, 19);
    expect(await card(page)).toBeUndefined();

    // Late in the card the text has scrolled up to a later screen.
    await pauseAt(page, 37);
    expect((await card(page))?.transform).not.toBe('translateY(0px)');

    // Seeking back replays it; seeking to under resumeMinSec (1.5 s) before its end does not show it.
    await pauseAt(page, 5);
    expect(await card(page)).toBeUndefined();
    await pauseAt(page, 21);
    expect((await card(page))?.text).toContain('everyone waits for');
    await pauseAt(page, 39.2);
    expect(await card(page)).toBeUndefined();
  });

  test('F-12-AC12 sits at the top of the player, clear of the control bar', async ({ page, open, ctx }) => {
    await seed(ctx, VIDEOS.a, [{ id: 's', text: LONG, stamped: true }]);
    await setDanmaku(ctx, true);
    await openWatch(page, open, VIDEOS.a);
    await pauseAt(page, 22);
    await expectCard(page, 'everyone waits for');
    await showBar(page);
    const [playerTop, playerH, barTop] = await page.evaluate(() => {
      const p = document.querySelector('#movie_player')!.getBoundingClientRect();
      return [p.top, p.height, document.querySelector('#movie_player .ytp-chrome-bottom')!.getBoundingClientRect().top];
    });
    const c = (await card(page))!;
    expect(c.top).toBeGreaterThanOrEqual(playerTop);
    expect(c.top - playerTop).toBeLessThan(playerH / 4);
    expect(c.bottom).toBeLessThanOrEqual(barTop);
  });

  test('F-12-AC2 F-12-AC12 in fullscreen: at the top of the screen, below the title, clear of the control bar', async ({ page, open, ctx }) => {
    await seed(ctx, VIDEOS.a, [{ id: 's', text: LONG, stamped: true }]);
    await setDanmaku(ctx, true);
    await openWatch(page, open, VIDEOS.a);
    await pauseAt(page, 22);
    await expectCard(page, 'everyone waits for');
    await page.locator('#movie_player .ytp-fullscreen-button').click();
    await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
    try {
      await showBar(page);
      await expectCard(page, 'everyone waits for');
      await page.waitForTimeout(400); // the card eases to its place (top 200 ms)
      const [playerTop, playerH, barTop, titleBottom] = await page.evaluate(() => {
        const p = document.querySelector('#movie_player')!;
        const r = p.getBoundingClientRect();
        const title = [...p.querySelectorAll<HTMLElement>('.ytp-chrome-top, .ytp-fullscreen-metadata')]
          .map((e) => e.getBoundingClientRect()).filter((b) => b.height && b.top - r.top < r.height / 4);
        return [r.top, r.height, p.querySelector('.ytp-chrome-bottom')!.getBoundingClientRect().top, Math.max(0, ...title.map((b) => b.bottom))];
      });
      expect(playerH, 'the player fills the screen').toBeGreaterThan(800);
      const c = (await card(page))!;
      expect(c.top).toBeGreaterThanOrEqual(Math.max(playerTop, titleBottom));
      expect(c.top - playerTop).toBeLessThan(playerH / 4);
      expect(c.bottom).toBeLessThanOrEqual(barTop);
    } finally {
      await page.evaluate(() => document.exitFullscreen().catch(() => {}));
    }
  });

  test('F-12-AC12 captions in the upper half: the card goes below them', async ({ page, open, ctx }) => {
    await seed(ctx, VIDEOS.a, [{ id: 's', text: LONG, stamped: true }]);
    await setDanmaku(ctx, true);
    await openWatch(page, open, VIDEOS.a);
    await pauseAt(page, 22);
    await expectCard(page, 'everyone waits for');
    const before = (await card(page))!;
    // A caption window the user dragged near the top, as YouTube lays it out.
    const capBottom = await page.evaluate((top) => {
      const p = document.querySelector('#movie_player')!;
      let box = p.querySelector('.ytp-caption-window-container');
      if (!box) { box = document.createElement('div'); box.className = 'ytp-caption-window-container'; p.append(box); }
      const w = document.createElement('div');
      w.className = 'caption-window ytp-caption-window-top ytpp-e2e-caption';
      const pr = p.getBoundingClientRect();
      w.style.cssText = `position:absolute;left:30%;width:40%;top:${top - pr.top + 4}px;height:60px;`;
      box.append(w);
      return w.getBoundingClientRect().bottom;
    }, before.top);
    await page.locator('#movie_player').hover(); // a frame or two to redraw
    await expect.poll(async () => (await card(page))?.top ?? 0).toBeGreaterThanOrEqual(capBottom);
    await page.evaluate(() => document.querySelector('.ytpp-e2e-caption')?.remove());
  });

  test('F-19-AC1 a round avatar before the handle, on the card and flying; one that fails to load leaves no gap', async ({ page, open, ctx }) => {
    await seed(ctx, VIDEOS.a, [
      { id: 'av', text: '0:50 the one with a face next to its name', stamped: true, avatar: AVATAR_OK },
      { id: 'nf', text: '1:10 this face never loads, so no room for it', stamped: true, avatar: AVATAR_BROKEN },
    ]);
    await setDanmaku(ctx, true, { style: 'card' });
    await openWatch(page, open, VIDEOS.a);
    /** The avatar and handle of what is shown in `host` (card or strips): geometry and state. */
    const look = (sel: string, item: string) => page.evaluate(([sel, item]) => {
      const root = document.querySelector(`#movie_player ${sel}`)?.shadowRoot;
      const box = root?.querySelector<HTMLElement>(item);
      if (!box || box.hidden) return undefined;
      const img = box.querySelector<HTMLImageElement>('img.avatar');
      const handle = box.querySelector<HTMLElement>('.handle')!;
      const cs = getComputedStyle(box);
      const h = handle.getBoundingClientRect();
      const first = box.querySelector('.text, .strip') ?? box;
      const textLeft = (first.firstElementChild as HTMLElement | null)?.getBoundingClientRect().left;
      if (!img) return { img: false, handleFirst: h.left === textLeft };
      const a = img.getBoundingClientRect();
      return {
        img: true, loaded: img.complete && img.naturalWidth > 0, radius: getComputedStyle(img).borderRadius,
        w: a.width, h: a.height, font: parseFloat(cs.fontSize), line: parseFloat(cs.lineHeight),
        before: a.right <= h.left + 0.5, sameLine: Math.abs((a.top + a.bottom) / 2 - (h.top + h.bottom) / 2) < parseFloat(cs.lineHeight) / 2,
      };
    }, [sel, item] as const);

    await pauseAt(page, 51);
    await expectCard(page, 'a face next to its name');
    await expect.poll(async () => (await look('.ytpp-dm-layer', '.card:not(.measure)'))?.loaded).toBe(true);
    const c = (await look('.ytpp-dm-layer', '.card:not(.measure)'))!;
    expect(c).toMatchObject({ radius: '50%', before: true, sameLine: true });
    expect(Math.abs(c.w! - c.h!)).toBeLessThan(1);
    expect(c.h).toBeGreaterThanOrEqual(c.font!);
    expect(c.h).toBeLessThanOrEqual(c.line!);

    await pauseAt(page, 71);
    await expectCard(page, 'this face never loads');
    await expect.poll(async () => (await look('.ytpp-dm-layer', '.card:not(.measure)'))?.img).toBe(false);
    expect((await look('.ytpp-dm-layer', '.card:not(.measure)'))!.handleFirst).toBe(true);

    await setDanmaku(ctx, true, { style: 'fly' });
    await pauseAt(page, 51);
    await expect.poll(async () => (await look('.ytpp-dm-fly', '.strip'))?.loaded, { timeout: 10_000 }).toBe(true);
    const f = (await look('.ytpp-dm-fly', '.strip'))!;
    expect(f).toMatchObject({ radius: '50%', before: true, sameLine: true });
    expect(f.h).toBeGreaterThanOrEqual(f.font!);
    expect(f.h).toBeLessThanOrEqual(f.line!);
  });

  test('F-12-AC11 the three styles switch at once: caption card, flying, side panel', async ({ page, open, ctx }) => {
    await seed(ctx, VIDEOS.a, [{ id: 'f', text: '0:50 the short one that flies across', stamped: true }]);
    await setDanmaku(ctx, true, { style: 'card' });
    await openWatch(page, open, VIDEOS.a);
    await pauseAt(page, 51);
    await expectCard(page, 'the short one that flies across');
    const flying = () => page.evaluate(() => [...(document.querySelector('#movie_player .ytpp-dm-fly')?.shadowRoot?.querySelectorAll('.strip') ?? [])].map((e) => e.textContent ?? ''));
    const panelShown = () => page.evaluate(() => !!document.querySelector('#movie_player .ytpp-dm-panel'));

    // As the settings page saves it: no reload.
    await setDanmaku(ctx, true, { style: 'fly' });
    await expect.poll(flying).toEqual([expect.stringContaining('the short one that flies across')]);
    expect(await card(page)).toBeUndefined();
    expect(await panelShown()).toBe(false);

    await setDanmaku(ctx, true, { style: 'panel' });
    await expect.poll(panelShown, { timeout: 20_000 }).toBe(true);
    expect(await flying()).toEqual([]);
    expect(await card(page)).toBeUndefined();

    await setDanmaku(ctx, true, { style: 'card' });
    await expectCard(page, 'the short one that flies across');
    await expect.poll(panelShown).toBe(false);
  });

  test('F-12-AC6 F-12-AC10 F-12-AC12 three rows: a moment\'s comments stacked at the top, none covering another', async ({ page, open, ctx }) => {
    await seed(ctx, VIDEOS.a, [
      { id: 'r1', text: '0:50 the first of three on the same moment', stamped: true, likes: 30 },
      { id: 'r2', text: '0:50 the second one, a good deal longer than the others so that it surely wraps onto another line of the card on this player', stamped: true, likes: 20 },
      { id: 'r3', text: '0:50 the third of three on the same moment', stamped: true, likes: 10 },
    ]);
    await setDanmaku(ctx, true, { style: 'card', params: { display: { cardRows: 3 } } });
    await openWatch(page, open, VIDEOS.a);
    await pauseAt(page, 51);
    const cards = () => page.evaluate(() => [...(document.querySelector('#movie_player .ytpp-dm-layer')?.shadowRoot?.querySelectorAll<HTMLElement>('.card:not(.measure)') ?? [])]
      .map((c) => { const r = c.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, text: c.querySelector('.text')!.textContent! }; })
      .sort((a, b) => a.top - b.top));
    await expect.poll(async () => (await cards()).length, { timeout: 20_000 }).toBe(3);
    const c = await cards();
    expect(c.map((x) => x.text.match(/@e2e-r\d/)![0])).toEqual(['@e2e-r1', '@e2e-r2', '@e2e-r3']);
    for (let k = 1; k < c.length; k++) expect(c[k]!.top).toBeGreaterThanOrEqual(c[k - 1]!.bottom);
    const [playerTop, playerH] = await page.evaluate(() => { const r = document.querySelector('#movie_player')!.getBoundingClientRect(); return [r.top, r.height]; });
    expect(c[0]!.top).toBeGreaterThanOrEqual(playerTop);
    expect(c.at(-1)!.bottom).toBeLessThan(playerTop + playerH * 0.6);

    // One row: the same three take turns on one card. (What has already shown
    // keeps its layout, so the video is opened again.)
    await setDanmaku(ctx, true, { params: { display: { cardRows: 1 } } });
    await openWatch(page, open, VIDEOS.a);
    await pauseAt(page, 50.5);
    await expect.poll(async () => (await cards()).length, { timeout: 20_000 }).toBe(1);
  });

  test('F-12-AC13 flying lanes on the player: one each, no overlap; the long ones left out by default', async ({ page, open, ctx }) => {
    await seed(ctx, VIDEOS.a, [
      { id: 'f1', text: '0:50 first across the player', stamped: true },
      { id: 'f2', text: '0:50 second across the player', stamped: true },
      { id: 'f3', text: LONG.replace('0:20', '0:50'), stamped: true },
    ]);
    await setDanmaku(ctx, true, { style: 'fly', params: { display: { flyRows: 2 } } });
    await openWatch(page, open, VIDEOS.a);
    await pauseAt(page, 53);
    const strips = () => page.evaluate(() => [...(document.querySelector('#movie_player .ytpp-dm-fly')?.shadowRoot?.querySelectorAll<HTMLElement>('.strip') ?? [])]
      .map((c) => ({ top: c.getBoundingClientRect().top, text: c.textContent! })));
    await expect.poll(async () => (await strips()).length, { timeout: 20_000 }).toBe(2);
    const s = await strips();
    expect(new Set(s.map((x) => Math.round(x.top))).size).toBe(2);
    expect(s.map((x) => x.text).join()).not.toContain('everyone waits for');
  });

  test('F-12-AC9 AI mode uses Gemini\'s confident times; hidden comments never show', async ({ page, open, ctx }) => {
    await seed(ctx, VIDEOS.a, [
      { id: 'ai', text: AI_TEXT, likes: 50 },
      { id: 'x', text: HIDDEN_TEXT, likes: 500 },
      { id: 'amb', text: AMBIENT_TEXT, likes: 5 },
    ], {
      ai: { kind: 'at', sec: 60, conf: 0.95 },
      x: { kind: 'hide' },
      amb: { kind: 'ambient', why: 'a' },
    });
    await setDanmaku(ctx, true, { placement: 'ai' });
    await openWatch(page, open, VIDEOS.a);
    await expect.poll(() => tooltip(page)).toContain('· AI');
    await pauseAt(page, 60.5);
    await expectCard(page, 'camera moves');
    const c = (await card(page))!;
    expect(c.label).toBe('AI 0.95');
    // Every 2 s of the video: the hidden one never comes up.
    for (let t = 1; t < 210; t += 2) {
      await page.evaluate((t) => (document.querySelector('#movie_player') as HTMLElement & { seekTo(s: number, a: boolean): void }).seekTo(t, true), t);
      await page.waitForTimeout(60);
      expect((await card(page))?.text ?? '').not.toContain('subscribe to my channel');
    }
  });

  test('F-12-AC2 hidden in the miniplayer, back on the watch page', async ({ page, open, ctx }) => {
    await seed(ctx, VIDEOS.a, [{ id: 's', text: LONG, stamped: true }]);
    await setDanmaku(ctx, true);
    await openWatch(page, open, VIDEOS.a);
    await pauseAt(page, 22);
    await expectCard(page, 'everyone waits for');
    await toMini(page);
    await expect.poll(() => card(page)).toBeUndefined();
    await toWatch(page);
    await pauseAt(page, 22);
    await expectCard(page, 'everyone waits for');
  });

  test('F-12-AC3 another video: its own cards only', async ({ page, open, ctx }) => {
    await seed(ctx, VIDEOS.a, [{ id: 's', text: LONG, stamped: true }]);
    await seed(ctx, VIDEOS.c, [{ id: 'o', text: OTHER, stamped: true }]);
    await setDanmaku(ctx, true);
    await openWatch(page, open, VIDEOS.a);
    await pauseAt(page, 22);
    await expectCard(page, 'everyone waits for');
    await navigate(page, VIDEOS.c);
    await pauseAt(page, 42);
    await expectCard(page, 'other video only');
    // The first video's card is not carried over to the same moment here.
    await pauseAt(page, 22);
    expect(await card(page)).toBeUndefined();
  });

  test('F-12-AC2 no comments: dimmed, and says so', async ({ page, open, ctx }) => {
    await seed(ctx, VIDEOS.d, []);
    await setDanmaku(ctx, true);
    await openWatch(page, open, VIDEOS.d);
    await expect(page.locator(BTN)).toHaveAttribute('data-dim', '');
    await expect.poll(() => tooltip(page)).toContain('This video has no comments');
  });

  test('F-12-AC4 F-12-AC15 F-19-AC4 fetches the comments and caches them, avatars included; the self-check fetches a page', async ({ page, open, ctx }) => {
    await storageRemove(ctx, 'local', CACHE(VIDEOS.b));
    await setDanmaku(ctx, true);
    await openWatch(page, open, VIDEOS.b);
    // 200 comments for a 4-minute video (minCount), 20 a page.
    const entry = () => storageGet(ctx, 'local', CACHE(VIDEOS.b)) as Promise<{ complete: boolean; comments: { avatar?: string }[]; total: number; title?: string; duration?: number } | undefined>;
    await expect.poll(async () => (await entry())?.complete ?? false, { timeout: 60_000 }).toBe(true);
    const e = (await entry())!;
    expect(e.comments.length).toBeGreaterThanOrEqual(190);
    expect(e.comments.length).toBeLessThanOrEqual(220);
    expect(e.total).toBeGreaterThan(100_000);
    // F-12-AC15: the title and length, for the settings page preview.
    expect(e.title).toBeTruthy();
    expect(e.duration).toBeGreaterThan(200);
    // F-19-AC4: the cache keeps each author's avatar address.
    expect(e.comments.filter((c) => /^https:\/\//.test(c.avatar ?? '')).length).toBeGreaterThanOrEqual(e.comments.length * 0.9);
    expect(await tooltip(page)).toMatch(/\d+ comments, \d+ cards · local/);

    const sw = await serviceWorker(ctx);
    const result = await sw.evaluate(async (url) => {
      type Tabs = { query(q: { url: string }): Promise<{ id?: number }[]>; sendMessage(id: number, m: unknown, o: { frameId: number }): Promise<unknown> };
      const tabs = (globalThis as unknown as { chrome: { tabs: Tabs } }).chrome.tabs;
      const [tab] = await tabs.query({ url });
      return tabs.sendMessage(tab!.id!, { type: 'YouTube+/page-check', feature: 'danmaku', name: 'check.dm.fetch' }, { frameId: 0 });
    }, page.url().replace(/[?#].*$/, '*'));
    expect(result).toMatchObject({ status: 'pass' });
  });
});
