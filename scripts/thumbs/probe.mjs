// F-22 probe: what animated thumbnail sources do YouTube list pages offer?
// Uses the e2e profile (signed in), headless and muted; reads only.
// usage: node scripts/thumbs/probe.mjs <outFile.json> <path>...
import { writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

// PRIVATE: the signed-in e2e profile (docs/PRIVACY.md).
const profile = process.env.YTPP_E2E_PROFILE ?? join(homedir(), '.cache', 'ytpp-e2e-profile');
const [out, ...paths] = process.argv.slice(2);
const ctx = await chromium.launchPersistentContext(profile, {
  headless: true, channel: 'chromium', viewport: { width: 1400, height: 1000 },
  args: ['--mute-audio', '--lang=en-US'],
});

/** Where `an_webp` links and video IDs sit in a data tree. */
function survey(data) {
  const an = [], ids = new Set(), kinds = {}, movingPaths = {};
  const walk = (o, path, card) => {
    if (typeof o === 'string') {
      if (o.includes('/an_webp/') || o.includes('/an/')) {
        an.push({ url: o, card });
        const key = path.filter((p) => !/^\d+$/.test(p)).slice(-6).join('.');
        movingPaths[key] = (movingPaths[key] ?? 0) + 1;
      }
      return;
    }
    if (!o || typeof o !== 'object') return;
    for (const [k, v] of Object.entries(o)) {
      let c = card;
      if (/(videoRenderer|VideoRenderer|lockupViewModel|reelItemRenderer|shortsLockupViewModel)$/i.test(k)) {
        kinds[k] = (kinds[k] ?? 0) + 1;
        c = k;
        const id = v?.videoId ?? v?.contentId;
        if (id) ids.add(id);
      }
      walk(v, [...path, k], c);
    }
  };
  walk(data, [], null);
  return { cards: kinds, videos: ids.size, anWebp: an.length, anByCard: an.reduce((m, a) => ((m[a.card] = (m[a.card] ?? 0) + 1), m), {}), movingPaths, sample: an[0]?.url, ids: [...ids] };
}

const results = [];
for (const path of paths) {
  const page = await ctx.newPage();
  const continuations = [];
  page.on('response', async (r) => {
    const m = r.url().match(/youtubei\/v1\/(browse|search|next)\b/);
    if (!m) return;
    try { continuations.push({ endpoint: m[1], ...survey(await r.json()) }); } catch { /* not JSON */ }
  });
  await page.goto(`https://www.youtube.com${path}`, { waitUntil: 'load', timeout: 60_000 });
  await page.waitForTimeout(4000);
  const initial = survey(await page.evaluate(() => window.ytInitialData));
  for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, 2500); await page.waitForTimeout(1500); }
  const dom = await page.evaluate(() => {
    const count = (s) => document.querySelectorAll(s).length;
    return {
      richItem: count('ytd-rich-item-renderer'), video: count('ytd-video-renderer'), grid: count('ytd-grid-video-renderer'),
      compact: count('ytd-compact-video-renderer'), playlistVideo: count('ytd-playlist-video-renderer'),
      lockup: count('yt-lockup-view-model'), shorts: count('ytm-shorts-lockup-view-model, ytm-shorts-lockup-view-model-v2'),
      imgs: [...document.querySelectorAll('img')].filter((i) => /i\.ytimg\.com\/vi/.test(i.src)).length,
      thumbSample: [...document.querySelectorAll('img')].map((i) => i.src).find((s) => /i\.ytimg\.com\/vi/.test(s)),
    };
  });
  results.push({ path, url: page.url(), initial, continuations, dom });
  await page.close();
}
writeFileSync(out, JSON.stringify(results, null, 2));
for (const r of results) {
  const brief = ({ ids, ...s }) => s;
  console.log(JSON.stringify({ path: r.path, dom: r.dom, initial: brief(r.initial), continuations: r.continuations.map(brief) }, null, 1));
}
await ctx.close();
