// F-22 probe 5: where in the DOM a card's an_webp link hangs (element `.data`
// or a view-model property), what the thumbnail's DOM looks like, whether that
// survives scrolling and in-app navigation, and how often an an_webp loops.
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

// PRIVATE: the signed-in e2e profile (docs/PRIVACY.md).
const profile = process.env.YTPP_E2E_PROFILE ?? join(homedir(), '.cache', 'ytpp-e2e-profile');
const ctx = await chromium.launchPersistentContext(profile, { headless: true, channel: 'chromium', viewport: { width: 1400, height: 1000 }, args: ['--mute-audio', '--lang=en-US'] });
const page = await ctx.newPage();

const look = () => page.evaluate(() => {
  const ITEM = 'yt-lockup-view-model, ytd-video-renderer, ytd-compact-video-renderer, ytd-rich-grid-media, ytd-grid-video-renderer, ytd-playlist-video-renderer, ytd-playlist-panel-video-renderer';
  const items = [...document.querySelectorAll(ITEM)].filter((e) => !e.querySelector(ITEM) && e.getClientRects().length);
  const where = {};
  let shape;
  for (const el of items) {
    const a = el.querySelector('a[href*="/watch?v="]');
    const id = a && new URL(a.href).searchParams.get('v');
    if (!id) continue;
    let found = 'none';
    for (let n = el, d = 0; n && d < 6; n = n.parentElement, d++) {
      const props = {};
      for (const k of ['data', 'rawProps', 'props', '__data', 'viewModel', 'componentProps']) { try { if (n[k] && typeof n[k] === 'object') props[k] = n[k]; } catch { /* getter */ } }
      let hit;
      for (const [k, v] of Object.entries(props)) { try { if (JSON.stringify(v).includes(`/an_webp/${id}/`)) { hit = k; break; } } catch { /* cycle */ } }
      if (hit) { found = `${d}:${n.localName}.${hit}`; break; }
    }
    const key = `${el.localName} ${found}`;
    where[key] = (where[key] ?? 0) + 1;
    const thumb = el.querySelector('yt-thumbnail-view-model, ytd-thumbnail');
    if (!shape && thumb) {
      const draw = (n, d) => d > 4 ? '' : `${'  '.repeat(d)}${n.localName}${n.id ? '#' + n.id : ''}.${[...n.classList].join('.')} [${getComputedStyle(n).position} z=${getComputedStyle(n).zIndex} ${Math.round(n.getBoundingClientRect().width)}x${Math.round(n.getBoundingClientRect().height)}]\n${[...n.children].map((c) => draw(c, d + 1)).join('')}`;
      shape = draw(thumb, 0);
    }
  }
  return { path: location.pathname, items: items.length, where, shape };
});

for (const path of (process.argv[3] ?? '/results?search_query=cooking /@veritasium/videos /@veritasium /watch?v=jNQXAC9IVRw /feed/history / /playlist?list=LL').split(' ')) {
  await page.goto(`https://www.youtube.com${path}`, { waitUntil: 'load' });
  await page.waitForTimeout(4000);
  for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, 2500); await page.waitForTimeout(1500); }
  const r = await look();
  console.log(path, r.items, JSON.stringify(r.where));
  console.log(r.shape);
}

// In-app navigation: search from the masthead, then to a channel by link.
await page.goto('https://www.youtube.com/', { waitUntil: 'load' });
await page.waitForTimeout(3000);
await page.locator('input[name="search_query"]').fill('veritasium');
await page.keyboard.press('Enter');
await page.waitForTimeout(5000);
console.log('spa search', JSON.stringify((await look()).where));
await page.locator('ytd-video-renderer #channel-info a[href^="/@"]:visible, ytd-channel-renderer a#main-link:visible').first().click();
await page.waitForTimeout(5000);
console.log('spa channel', page.url(), JSON.stringify((await look()).where));

// Hover preview: what marks the hovered card while YouTube's preview plays.
await page.goto('https://www.youtube.com/results?search_query=cooking', { waitUntil: 'load' });
await page.waitForTimeout(3000);
await page.locator('ytd-video-renderer ytd-thumbnail').first().hover();
await page.waitForTimeout(4000);
console.log('preview', JSON.stringify(await page.evaluate(() => {
  const p = document.querySelector('ytd-video-preview');
  const t = document.querySelector('ytd-video-renderer ytd-thumbnail');
  const r = (e) => { const b = e.getBoundingClientRect(); return [b.x, b.y, b.width, b.height].map(Math.round); };
  return { preview: p && { rect: r(p), hidden: p.hidden, active: p.hasAttribute('active'), playing: p.hasAttribute('playing'), z: getComputedStyle(p).zIndex }, thumb: t && r(t), moving: [...document.querySelectorAll('ytd-moving-thumbnail-renderer, yt-animated-thumbnail-overlay-view-model')].map((e) => ({ tag: e.localName, kids: e.children.length, img: e.querySelector('img')?.src?.slice(0, 60) })).slice(0, 4) };
})));
await page.screenshot({ path: process.argv[2] });

// Loop count of an an_webp: the ANIM chunk is bg colour (4 bytes) + loop count (2 bytes).
const url = await page.evaluate(() => JSON.stringify(window.ytInitialData).match(/https:\/\/i\.ytimg\.com\/an_webp\/[^"]+/)[0].replace(/\\u0026/g, '&'));
const body = await (await ctx.request.get(url)).body();
const at = body.indexOf('ANIM');
let frames = 0;
for (let i = body.indexOf('ANMF'); i >= 0; i = body.indexOf('ANMF', i + 4)) frames++;
console.log('webp loops', at < 0 ? 'no ANIM' : body.readUInt16LE(at + 12), 'frames', frames);
await ctx.close();
