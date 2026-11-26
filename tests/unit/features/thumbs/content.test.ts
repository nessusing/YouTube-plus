// @vitest-environment happy-dom
// F-22: the content script — what moves when. IntersectionObserver and image
// loading are faked; the page-world script is the real one.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { startThumbs } from '@/features/thumbs/content';
import { startThumbsMain } from '@/features/thumbs/main-world';
import { frameUrl, lockup, lockupData, movingUrl, renderer, searchData } from './helpers';

const MOVING = 'aaaaaaaaaaa'; // has YouTube's animation
const FRAMES = 'bbbbbbbbbbb'; // only the three frames
const NOTHING = 'ccccccccccc'; // neither

/** URLs that "exist"; loads of anything else fail. */
let available: Set<string>;
let loads: string[];
/** While set, loads wait for release(). */
let held: (() => void)[] | undefined;
const load = (url: string) => {
  loads.push(url);
  const img = document.createElement('img');
  img.src = url;
  const result = () => (available.has(url) ? img : undefined);
  return held ? new Promise<HTMLImageElement | undefined>((r) => held!.push(() => r(result()))) : Promise.resolve(result());
};
const release = async () => {
  for (const r of held!.splice(0)) r();
  await wait(0);
};

let observers: FakeIO[];
let onScreen: Set<Element>;
class FakeIO {
  targets = new Set<Element>();
  constructor(public cb: (e: { target: Element; isIntersecting: boolean }[]) => void) { observers.push(this); }
  // Like the real one, a new observation reports where its target is now.
  observe(el: Element) {
    this.targets.add(el);
    if (onScreen.has(el)) queueMicrotask(() => this.targets.has(el) && this.cb([{ target: el, isIntersecting: true }]));
  }
  unobserve(el: Element) { this.targets.delete(el); }
  disconnect() { this.targets.clear(); }
}

const wait = (ms: number) => vi.advanceTimersByTimeAsync(ms);
const card = (id: string) => document.querySelector<HTMLElement>(`[data-id="${id}"]`)!;
const thumb = (id: string) => card(id).querySelector<HTMLElement>('yt-thumbnail-view-model, ytd-thumbnail')!;
const layer = (id: string) => card(id).querySelector<HTMLElement>('ytpp-thumb-anim');
/** The picture covering the static thumbnail, if any. */
const showing = (id: string) => [...(layer(id)?.querySelectorAll('img') ?? [])].filter((i) => i.style.visibility !== 'hidden').map((i) => i.src)[0];

async function see(isIntersecting: boolean, ...ids: string[]) {
  for (const id of ids) onScreen[isIntersecting ? 'add' : 'delete'](thumb(id));
  for (const io of observers) {
    const entries = ids.map((id) => thumb(id)).filter((t) => io.targets.has(t)).map((target) => ({ target, isIntersecting }));
    if (entries.length) io.cb(entries);
  }
  await wait(0);
}

async function setFeature(thumbs: boolean, enabled = true) {
  await fakeBrowser.storage.sync.set({ settings: { enabled, features: { thumbs } } });
  await wait(400);
}

function tabHidden(hidden: boolean) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });
  document.dispatchEvent(new Event('visibilitychange'));
}

/** Cards stacked 200px apart; point at one (or at nothing). */
function layOut() {
  [MOVING, FRAMES, NOTHING].forEach((id, i) => {
    card(id).getBoundingClientRect = () => ({ left: 0, right: 300, top: i * 200, bottom: i * 200 + 180, width: 300, height: 180, x: 0, y: i * 200 }) as DOMRect;
  });
}
async function point(x: number, y: number, target: Element = document.body) {
  target.dispatchEvent(new MouseEvent('pointermove', { clientX: x, clientY: y, bubbles: true, composed: true }));
  await wait(50);
}

let stopMain: () => void;
let stop: (() => void) | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  fakeBrowser.reset();
  observers = [];
  onScreen = new Set();
  loads = [];
  held = undefined;
  vi.stubGlobal('IntersectionObserver', FakeIO);
  available = new Set([movingUrl(MOVING), ...[1, 2, 3].map((n) => frameUrl(FRAMES, n))]);
  document.body.innerHTML = renderer('ytd-video-renderer', MOVING) + lockup(FRAMES) + lockup(NOTHING);
  (card(MOVING) as HTMLElement & { data?: unknown }).data = searchData(MOVING);
  (card(FRAMES) as HTMLElement & { data?: unknown }).data = lockupData(FRAMES);
  layOut();
  tabHidden(false);
  stopMain = startThumbsMain();
});

afterEach(() => {
  stop?.();
  stop = undefined;
  stopMain();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function start(thumbs = true) {
  await fakeBrowser.storage.sync.set({ settings: { features: { thumbs } } });
  stop = await startThumbs({ load });
  await wait(400);
}

describe('F-22-AC1 visible cards move', () => {
  it('F-22-AC1 shows YouTube\'s own animation when the card has one, and loads no frames', async () => {
    await start();
    await see(true, MOVING);
    expect(showing(MOVING)).toBe(movingUrl(MOVING));
    expect(loads).toEqual([movingUrl(MOVING)]);
    await wait(5000);
    expect(showing(MOVING)).toBe(movingUrl(MOVING));
  });

  it('F-22-AC1 otherwise cycles the three frames, about a second each, round and round', async () => {
    await start();
    await see(true, FRAMES);
    const seen = [showing(FRAMES)];
    for (let i = 0; i < 4; i++) {
      await wait(1000);
      seen.push(showing(FRAMES));
    }
    expect(seen).toEqual([1, 2, 3, 1, 2].map((n) => frameUrl(FRAMES, n)));
  });

  it('F-22-AC1 falls back to the frames when the animation does not load', async () => {
    available = new Set([1, 2, 3].map((n) => frameUrl(MOVING, n)));
    await start();
    await see(true, MOVING);
    expect(showing(MOVING)).toBe(frameUrl(MOVING, 1));
  });

  it('F-22-AC1 cycles the frames there are when one is missing', async () => {
    available.delete(frameUrl(FRAMES, 2));
    await start();
    await see(true, FRAMES);
    await wait(1000);
    expect(showing(FRAMES)).toBe(frameUrl(FRAMES, 3));
    await wait(1000);
    expect(showing(FRAMES)).toBe(frameUrl(FRAMES, 1));
  });

  it('F-22-AC1 a card with neither stays as it is; so does one with a single frame', async () => {
    await start();
    await see(true, NOTHING);
    await wait(3000);
    expect(layer(NOTHING)).toBeNull();
    available.add(frameUrl(NOTHING, 1));
    await see(false, NOTHING);
    await see(true, NOTHING);
    expect(layer(NOTHING)).toBeNull();
  });

  it('F-22-AC1 keeps the static thumbnail until the pictures are downloaded', async () => {
    await start();
    held = [];
    await see(true, MOVING, FRAMES);
    expect(layer(MOVING)).toBeNull();
    expect(layer(FRAMES)).toBeNull();
    await release();
    await release();
    expect(showing(MOVING)).toBe(movingUrl(MOVING));
    expect(showing(FRAMES)).toBe(frameUrl(FRAMES, 1));
  });

  it('F-22-AC1 opens no player and plays nothing', async () => {
    await start();
    await see(true, MOVING, FRAMES);
    expect(document.querySelector('video, audio, iframe')).toBeNull();
  });
});

describe('F-22-AC2 only the cards on screen', () => {
  it('F-22-AC2 nothing is loaded for cards out of view', async () => {
    await start();
    await wait(2000);
    expect(loads).toEqual([]);
    expect(document.querySelector('ytpp-thumb-anim')).toBeNull();
  });

  it('F-22-AC2 scrolling a card out puts the static thumbnail back; back in, it moves again', async () => {
    await start();
    await see(true, MOVING, FRAMES);
    await see(false, FRAMES);
    expect(layer(FRAMES)).toBeNull();
    expect(showing(MOVING)).toBeDefined();
    await see(true, FRAMES);
    expect(showing(FRAMES)).toBe(frameUrl(FRAMES, 1));
  });

  it('F-22-AC2 a card scrolled out while loading shows nothing', async () => {
    await start();
    held = [];
    await see(true, MOVING, FRAMES);
    await see(false, MOVING, FRAMES);
    await release();
    await release();
    expect(document.querySelector('ytpp-thumb-anim')).toBeNull();
  });

  it('F-22-AC2 stops in a background tab and resumes in front', async () => {
    await start();
    await see(true, MOVING, FRAMES);
    tabHidden(true);
    await wait(2000);
    expect(document.querySelector('ytpp-thumb-anim')).toBeNull();
    tabHidden(false);
    await wait(0);
    expect(showing(MOVING)).toBeDefined();
    expect(showing(FRAMES)).toBeDefined();
  });
});

describe('F-22-AC3 its own switch', () => {
  it('F-22-AC3 off by default: nothing is watched or loaded', async () => {
    stop = await startThumbs({ load });
    await wait(400);
    await see(true, MOVING);
    expect(observers.flatMap((o) => [...o.targets])).toEqual([]);
    expect(loads).toEqual([]);
  });

  it('F-22-AC3 switching on and off takes effect at once and restores every thumbnail', async () => {
    const before = document.body.innerHTML;
    await start(false);
    await setFeature(true);
    await see(true, MOVING, FRAMES);
    expect(showing(MOVING)).toBeDefined();
    expect(showing(FRAMES)).toBeDefined();
    await setFeature(false);
    expect(document.body.innerHTML).toBe(before);
    await wait(3000);
    expect(document.body.innerHTML).toBe(before);
    await setFeature(true);
    await see(true, FRAMES);
    expect(showing(FRAMES)).toBeDefined();
  });

  it('F-22-AC3 the master switch turns it off too', async () => {
    await start();
    await see(true, MOVING);
    await setFeature(true, false);
    expect(document.querySelector('ytpp-thumb-anim')).toBeNull();
  });
});

describe('F-22-AC4 hovering is YouTube\'s', () => {
  it('F-22-AC4 the card under the pointer is static; the others keep moving; it resumes after', async () => {
    await start();
    await see(true, MOVING, FRAMES);
    await point(100, 250); // over FRAMES
    expect(layer(FRAMES)).toBeNull();
    expect(showing(MOVING)).toBeDefined();
    await point(100, 50); // over MOVING
    expect(layer(MOVING)).toBeNull();
    expect(showing(FRAMES)).toBeDefined();
    await point(900, 900); // over nothing
    expect(showing(MOVING)).toBeDefined();
  });

  it('F-22-AC4 also when YouTube\'s preview layer is what the pointer hits, and never touches it', async () => {
    const preview = document.createElement('ytd-video-preview');
    preview.innerHTML = '<video></video>';
    document.body.append(preview);
    const html = preview.outerHTML;
    await start();
    await see(true, FRAMES);
    await point(100, 250, preview);
    expect(layer(FRAMES)).toBeNull();
    expect(preview.outerHTML).toBe(html);
  });

  it('F-22-AC4 scrolling under a still pointer moves the hover with it', async () => {
    await start();
    await see(true, MOVING, FRAMES);
    await point(100, 50);
    // Scrolled by one card: FRAMES is now where the pointer is.
    card(MOVING).getBoundingClientRect = () => ({ left: 0, right: 300, top: -200, bottom: -20, width: 300, height: 180 }) as DOMRect;
    card(FRAMES).getBoundingClientRect = () => ({ left: 0, right: 300, top: 0, bottom: 180, width: 300, height: 180 }) as DOMRect;
    window.dispatchEvent(new Event('scroll'));
    await wait(50);
    expect(layer(FRAMES)).toBeNull();
    expect(showing(MOVING)).toBeDefined();
  });

  it('F-22-AC4 the pointer leaving the window, or on the masthead or miniplayer, hovers nothing', async () => {
    const mini = document.createElement('ytd-miniplayer');
    document.body.append(mini);
    await start();
    await see(true, MOVING);
    await point(100, 50);
    await point(100, 50, mini);
    expect(showing(MOVING)).toBeDefined();
    await point(100, 50);
    document.dispatchEvent(new MouseEvent('mouseout', { relatedTarget: null, bubbles: true }));
    await wait(50);
    expect(showing(MOVING)).toBeDefined();
  });
});

describe('F-22-AC5 cards that come and go', () => {
  const LATE = 'ddddddddddd';

  it('F-22-AC5 cards added by scrolling or in-app navigation move too', async () => {
    available.add(movingUrl(LATE));
    await start();
    document.body.insertAdjacentHTML('beforeend', renderer('ytd-video-renderer', LATE));
    (card(LATE) as HTMLElement & { data?: unknown }).data = searchData(LATE);
    await wait(400);
    await see(true, LATE);
    expect(showing(LATE)).toBe(movingUrl(LATE));
  });

  it('F-22-AC5 an element YouTube reuses for another video shows that video\'s pictures', async () => {
    await start();
    await see(true, FRAMES);
    for (const n of [1, 2, 3]) available.add(frameUrl(LATE, n));
    card(FRAMES).querySelector('a')!.setAttribute('href', `/watch?v=${LATE}`);
    await wait(400);
    expect(showing(FRAMES)).toBe(frameUrl(LATE, 1));
    expect(card(FRAMES).querySelectorAll('ytpp-thumb-anim').length).toBe(1);
  });

  it('F-22-AC5 a card that turns out to be live stops', async () => {
    await start();
    await see(true, FRAMES);
    card(FRAMES).querySelector('badge-shape')!.innerHTML = 'LIVE';
    await wait(400);
    expect(layer(FRAMES)).toBeNull();
  });
});

describe('F-22-AC6 the thumbnail keeps working', () => {
  const stays = (id: string) => {
    const l = layer(id)!;
    expect(l.style.pointerEvents).toBe('none');
    expect(l.style.zIndex).toBe('');
    return l;
  };

  it('F-22-AC6 the pictures sit over the static image and under YouTube\'s overlays, and take no clicks', async () => {
    await start();
    await see(true, MOVING, FRAMES);
    // Lockup: image layer, ours, then the overlays.
    const a = stays(FRAMES);
    expect(a.previousElementSibling!.className).toBe('ytThumbnailViewModelImage');
    expect(a.nextElementSibling!.localName).toBe('yt-thumbnail-bottom-overlay-view-model');
    // Older renderer: inside the link, between the image and the overlays.
    const b = stays(MOVING);
    expect(b.parentElement!.id).toBe('thumbnail');
    expect(b.previousElementSibling!.localName).toBe('yt-image');
    expect(b.nextElementSibling!.id).toBe('overlays');
  });

  it('F-22-AC6 comes back if YouTube redraws the thumbnail', async () => {
    await start();
    await see(true, FRAMES);
    layer(FRAMES)!.remove();
    await wait(400);
    expect(showing(FRAMES)).toBeDefined();
    expect(card(FRAMES).querySelectorAll('ytpp-thumb-anim').length).toBe(1);
  });
});
