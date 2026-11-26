// F-22 probe 4: (a) is the missing an_webp on home an artefact of the headless
// user agent or of this account? (b) what a storyboard offers per video;
// (c) coverage of the larger frame images hq720_1..3.
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

// PRIVATE: the signed-in e2e profile (docs/PRIVACY.md).
const profile = process.env.YTPP_E2E_PROFILE ?? join(homedir(), '.cache', 'ytpp-e2e-profile');
const ua = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/159.0.0.0 Safari/537.36';
const args = ['--mute-audio', '--lang=en-US'];
const count = (page) => page.evaluate(() => ({ cards: document.querySelectorAll('ytd-rich-item-renderer, ytd-video-renderer').length, anWebp: (JSON.stringify(window.ytInitialData).match(/\/an_webp\//g) ?? []).length }));

const anon = await chromium.launch({ headless: true, channel: 'chromium', args });
const guest = await (await anon.newContext({ userAgent: ua })).newPage();
for (const path of ['/results?search_query=cooking', '/@veritasium/videos', '/feed/trending']) {
  await guest.goto(`https://www.youtube.com${path}`, { waitUntil: 'load' });
  await guest.waitForTimeout(3000);
  console.log('signed out', path, JSON.stringify(await count(guest)));
}
await anon.close();

const ctx = await chromium.launchPersistentContext(profile, { headless: true, channel: 'chromium', viewport: { width: 1400, height: 1000 }, userAgent: ua, args });
const page = await ctx.newPage();
for (const path of ['/', '/feed/subscriptions']) {
  await page.goto(`https://www.youtube.com${path}`, { waitUntil: 'load' });
  await page.waitForTimeout(3000);
  console.log('normal UA', path, JSON.stringify(await count(page)));
}
const r = await page.evaluate(async () => {
  const ids = [...document.querySelectorAll('ytd-rich-item-renderer')].map((c) => c.data?.content?.lockupViewModel).filter((v) => v?.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO').map((v) => v.contentId).slice(0, 40);
  const t = performance.now();
  const res = await fetch('/youtubei/v1/player?prettyPrint=false', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ context: ytcfg.get('INNERTUBE_CONTEXT'), videoId: ids[0], playbackContext: { contentPlaybackContext: { signatureTimestamp: ytcfg.get('STS') } } }) });
  const text = await res.text();
  const spec = JSON.parse(text).storyboards?.playerStoryboardSpecRenderer?.spec;
  const levels = spec?.split('|').slice(1).map((l) => { const [w, h, n, cols, rows, interval] = l.split('#'); return { w, h, frames: n, grid: `${cols}x${rows}`, interval }; });
  const coverage = {};
  for (const name of ['hq720_1', 'hq720_2', 'hq720_3']) {
    const got = await Promise.all(ids.map((id) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(`${i.naturalWidth}x${i.naturalHeight}`); i.onerror = () => ok('error'); i.src = `https://i.ytimg.com/vi/${id}/${name}.jpg`; })));
    coverage[name] = got.reduce((m, s) => ((m[s] = (m[s] ?? 0) + 1), m), {});
  }
  return { player: { ms: Math.round(performance.now() - t), kB: Math.round(text.length / 1024), levels }, id: ids[0], coverage };
});
console.log(JSON.stringify(r, null, 1));
const kB = [];
for (const n of ['mq1', 'mq2', 'mq3', 'hq720_1', 'hq720_2', 'hq720_3']) {
  const res = await ctx.request.get(`https://i.ytimg.com/vi/${r.id}/${n}.jpg`);
  kB.push([n, res.status(), Math.round((await res.body()).length / 1024), res.headers()['cache-control']]);
}
console.log(JSON.stringify(kB));
await ctx.close();
