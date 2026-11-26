// F-22 probe 2: pages whose data has no animated thumbnail (home, subscriptions).
// What do their cards carry, what does hovering one request, do the unsigned
// frame images and the signed an_webp links work, and what does a storyboard cost?
// usage: node scripts/thumbs/probe-home.mjs [--headed]
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

// PRIVATE: the signed-in e2e profile (docs/PRIVACY.md).
const profile = process.env.YTPP_E2E_PROFILE ?? join(homedir(), '.cache', 'ytpp-e2e-profile');
const headed = process.argv.includes('--headed');
const ctx = await chromium.launchPersistentContext(profile, {
  ...(headed ? { headless: false } : { headless: true, channel: 'chromium' }),
  viewport: { width: 1400, height: 1000 }, args: ['--mute-audio', '--lang=en-US'],
});
const page = await ctx.newPage();
const requests = [];
page.on('request', (r) => requests.push(r.url()));

for (const path of ['/', '/feed/subscriptions']) {
  await page.goto(`https://www.youtube.com${path}`, { waitUntil: 'load', timeout: 60_000 });
  await page.waitForTimeout(5000);
  const info = await page.evaluate(() => {
    const keys = new Set();
    const walk = (o) => {
      if (!o || typeof o !== 'object') return;
      for (const [k, v] of Object.entries(o)) { if (/anim|moving|preview|inline|richThumb|storyboard/i.test(k)) keys.add(k); walk(v); }
    };
    walk(window.ytInitialData);
    const cards = [...document.querySelectorAll('ytd-rich-item-renderer')];
    const first = cards.find((c) => c.data?.content?.lockupViewModel);
    const lv = first?.data.content.lockupViewModel;
    return {
      ua: navigator.userAgent, keys: [...keys], cards: cards.length, cardsWithData: cards.filter((c) => c.data).length,
      overlays: lv?.contentImage?.thumbnailViewModel?.overlays?.map((o) => Object.keys(o)[0]),
      onTap: Object.keys(lv?.rendererContext?.commandContext?.onTap?.innertubeCommand ?? {}),
      ids: cards.map((c) => c.data?.content?.lockupViewModel).filter((v) => v?.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO').map((v) => v.contentId),
    };
  });
  const { ids, ...rest } = info;
  console.log(path, JSON.stringify(rest, null, 1), 'video ids:', ids.length);

  const before = requests.length;
  await page.locator('ytd-rich-item-renderer yt-thumbnail-view-model').first().hover();
  await page.waitForTimeout(5000);
  const hovered = requests.slice(before).filter((u) => /ytimg\.com|youtubei|videoplayback/.test(u));
  console.log('hover requests:', [...new Set(hovered.map((u) => u.replace(/^https:\/\/([^/]+)(\/[^?]*).*/, (_, h, p) => `${h.replace(/^rr\d+---[^.]+/, 'rr')}${p}`)))].slice(0, 25));
  await page.mouse.move(2, 500);

  if (path === '/') {
    // Unsigned frames and the storyboard spec, for real home videos.
    const sample = ids.slice(0, 24);
    const frames = await page.evaluate(async (ids) => {
      const out = {};
      for (const name of ['mq1', 'mq2', 'mq3', 'hq720_1', 'maxres1', 'hq1']) {
        const got = await Promise.all(ids.map((id) => new Promise((res) => {
          const i = new Image();
          i.onload = () => res(`${i.naturalWidth}x${i.naturalHeight}`);
          i.onerror = () => res('error');
          i.src = `https://i.ytimg.com/vi/${id}/${name}.jpg`;
        })));
        out[name] = got.reduce((m, s) => ((m[s] = (m[s] ?? 0) + 1), m), {});
      }
      out.bytes = performance.getEntriesByType('resource').filter((e) => /\/mq[123]\.jpg$/.test(e.name)).slice(0, 6).map((e) => e.encodedBodySize || e.transferSize);
      return out;
    }, sample);
    console.log('frames over', sample.length, JSON.stringify(frames));
    const boards = await page.evaluate(async (ids) => {
      const out = [];
      for (const videoId of ids) {
        const t = performance.now();
        const r = await fetch('/youtubei/v1/player?prettyPrint=false', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ context: ytcfg.get('INNERTUBE_CONTEXT'), videoId }) });
        const text = await r.text();
        const j = JSON.parse(text);
        out.push({ status: r.status, ms: Math.round(performance.now() - t), kB: Math.round(text.length / 1024), playable: j.playabilityStatus?.status, spec: !!j.storyboards?.playerStoryboardSpecRenderer?.spec });
      }
      return out;
    }, ids.slice(0, 6));
    console.log('player/storyboard', JSON.stringify(boards));
    // Does search by video ID give that video's an_webp link?
    const bySearch = await page.evaluate(async (ids) => {
      const out = [];
      for (const id of ids) {
        const t = performance.now();
        const r = await fetch('/youtubei/v1/search?prettyPrint=false', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ context: ytcfg.get('INNERTUBE_CONTEXT'), query: id }) });
        const text = await r.text();
        out.push({ ms: Math.round(performance.now() - t), kB: Math.round(text.length / 1024), found: text.includes(`/an_webp/${id}/`) });
      }
      return out;
    }, ids.slice(0, 6));
    console.log('search by id', JSON.stringify(bySearch));
  }
}

// A signed an_webp link from search: size, type, cache lifetime.
await page.goto('https://www.youtube.com/results?search_query=cooking', { waitUntil: 'load' });
const links = await page.evaluate(() => JSON.stringify(window.ytInitialData).match(/https:\/\/i\.ytimg\.com\/an_webp\/[^"]+/g).slice(0, 10).map((u) => u.replace(/\\u0026/g, '&')));
const sizes = [];
for (const u of links) {
  const r = await ctx.request.get(u);
  sizes.push({ status: r.status(), type: r.headers()['content-type'], kB: Math.round((await r.body()).length / 1024), cache: r.headers()['cache-control'] });
}
console.log('an_webp', JSON.stringify(sizes));
const unsigned = await ctx.request.get(links[0].split('?')[0]);
console.log('an_webp without signature:', unsigned.status());
const cardData = await page.evaluate(() => [...document.querySelectorAll('ytd-video-renderer')].slice(0, 3).map((c) => ({ hasData: !!c.data, moving: !!c.data?.richThumbnail?.movingThumbnailRenderer })));
console.log('search DOM data', JSON.stringify(cardData));
await ctx.close();
