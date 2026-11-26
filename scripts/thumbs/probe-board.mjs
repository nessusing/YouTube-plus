// F-22 probe 3: can a storyboard spec be had from InnerTube at all, and how
// good are the unsigned frames (mq1–mq3) on a larger, mixed sample?
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

// PRIVATE: the signed-in e2e profile (docs/PRIVACY.md).
const profile = process.env.YTPP_E2E_PROFILE ?? join(homedir(), '.cache', 'ytpp-e2e-profile');
const ctx = await chromium.launchPersistentContext(profile, { headless: true, channel: 'chromium', viewport: { width: 1400, height: 1000 }, args: ['--mute-audio', '--lang=en-US'] });
const page = await ctx.newPage();

// The player request the home page's own hover preview makes, and what it answers.
const own = [];
page.on('response', async (r) => {
  if (!/youtubei\/v1\/player\b/.test(r.url())) return;
  try {
    const text = await r.text();
    const j = JSON.parse(text);
    own.push({ kB: Math.round(text.length / 1024), status: j.playabilityStatus?.status, spec: !!j.storyboards?.playerStoryboardSpecRenderer?.spec, bodyKeys: Object.keys(JSON.parse(r.request().postData() ?? '{}')) });
  } catch { /* compressed or not JSON */ }
});
await page.goto('https://www.youtube.com/', { waitUntil: 'load' });
await page.waitForTimeout(4000);
await page.locator('ytd-rich-item-renderer yt-thumbnail-view-model').first().hover();
await page.waitForTimeout(5000);
console.log('hover preview player', JSON.stringify(own));
await page.mouse.move(2, 500);

const ids = await page.evaluate(() => [...document.querySelectorAll('ytd-rich-item-renderer')].map((c) => c.data?.content?.lockupViewModel).filter((v) => v?.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO').map((v) => v.contentId).slice(0, 3));
const tries = await page.evaluate(async (ids) => {
  const out = [];
  for (const videoId of ids) {
    const r = await fetch('/youtubei/v1/player?prettyPrint=false', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ context: ytcfg.get('INNERTUBE_CONTEXT'), videoId, playbackContext: { contentPlaybackContext: { signatureTimestamp: ytcfg.get('STS'), html5Preference: 'HTML5_PREF_WANTS' } } }) });
    const j = await r.json();
    const html = await (await fetch(`/watch?v=${videoId}`)).text();
    out.push({ player: j.playabilityStatus?.status, playerSpec: !!j.storyboards, watchPageKB: Math.round(html.length / 1024), watchSpec: html.includes('playerStoryboardSpecRenderer') });
  }
  return out;
}, ids);
console.log('storyboard', JSON.stringify(tries));

// Frames on a mixed sample, from several pages; a tiny placeholder (120x90) means "no such frame".
const sample = new Set();
for (const path of ['/', '/feed/subscriptions', '/feed/history', '/results?search_query=live', '/results?search_query=2007+home+video', '/@YouTube/shorts', '/playlist?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf', '/playlist?list=LL']) {
  await page.goto(`https://www.youtube.com${path}`, { waitUntil: 'load' });
  await page.waitForTimeout(3000);
  const got = await page.evaluate(() => {
    const raw = JSON.stringify(window.ytInitialData);
    const tags = ['ytd-rich-item-renderer', 'ytd-video-renderer', 'ytd-playlist-video-renderer', 'yt-lockup-view-model', 'ytm-shorts-lockup-view-model', 'ytd-grid-video-renderer', 'ytd-compact-video-renderer'];
    return {
      ids: [...new Set([...raw.matchAll(/"videoId":"([\w-]{11})"/g)].map((m) => m[1]))].slice(0, 40),
      tags: Object.fromEntries(tags.map((t) => [t, document.querySelectorAll(t).length]).filter(([, n]) => n)),
      moving: (raw.match(/\/an_webp\//g) ?? []).length,
    };
  });
  console.log(path, JSON.stringify(got.tags), 'ids', got.ids.length, 'an_webp', got.moving);
  got.ids.forEach((i) => sample.add(i));
}
const frames = await page.evaluate(async (ids) => {
  const out = {};
  const bad = new Set();
  for (const name of ['mq1', 'mq2', 'mq3']) {
    const got = await Promise.all(ids.map((id) => new Promise((res) => {
      const i = new Image();
      i.onload = () => res([id, `${i.naturalWidth}x${i.naturalHeight}`]);
      i.onerror = () => res([id, 'error']);
      i.src = `https://i.ytimg.com/vi/${id}/${name}.jpg`;
    })));
    out[name] = got.reduce((m, [id, s]) => { m[s] = (m[s] ?? 0) + 1; if (s !== '320x180') bad.add(id); return m; }, {});
  }
  return { out, bad: [...bad] };
}, [...sample]);
console.log('frames over', sample.size, JSON.stringify(frames));
await ctx.close();
