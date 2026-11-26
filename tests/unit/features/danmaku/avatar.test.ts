// @vitest-environment happy-dom
// F-19 avatars in the danmaku: drawn before the handle, counted in the
// estimates, in the settings page preview, kept in the cache.
import { describe, expect, it } from 'vitest';
import { durOf } from '@/features/danmaku/cards';
import { CardView, commentNodes } from '@/features/danmaku/card-view';
import { lean } from '@/features/danmaku/comments';
import { demoTimeline } from '@/features/danmaku/demo';
import { estimateFlyWidth } from '@/features/danmaku/fly';
import { FlyView } from '@/features/danmaku/fly-view';
import { DEFAULT_PARAMS } from '@/features/danmaku/params';
import { fitLong } from '@/features/danmaku/long';
import { AVATAR_EM, commentLines } from '@/features/danmaku/timing';
import { comment } from './helpers';

const AV = 'https://yt3.test/A=s88';
const P = DEFAULT_PARAMS.display;

const nodesOf = (c: ReturnType<typeof comment>) => {
  const box = document.createElement('div');
  box.append(...commentNodes(document, c));
  return box;
};

describe('F-19-AC1 avatar before the handle', () => {
  it('F-19-AC1 a round avatar image comes first, then the handle', () => {
    const box = nodesOf(comment('nice one, really nice', { author: '@ann', avatar: AV }));
    const [first, second] = [...box.children] as HTMLElement[];
    expect(first!.tagName).toBe('IMG');
    expect(first!.className).toBe('avatar');
    expect((first as HTMLImageElement).src).toBe(AV);
    expect((first as HTMLImageElement).alt).toBe('');
    expect((first as HTMLImageElement).referrerPolicy).toBe('no-referrer');
    expect(second!.className).toBe('handle');
    expect(second!.textContent).toBe('@ann');
  });

  it('F-19-AC1 F-19-AC4 no avatar address (e.g. an older cached comment): no image, no gap', () => {
    const box = nodesOf(comment('nice one, really nice', { author: '@ann' }));
    expect(box.querySelector('img')).toBeNull();
    expect(box.firstElementChild!.className).toBe('handle');
  });

  it('F-19-AC1 an avatar that fails to load is removed, leaving no gap', () => {
    const box = nodesOf(comment('nice one, really nice', { author: '@ann', avatar: AV }));
    const img = box.querySelector('img.avatar')!;
    img.dispatchEvent(new Event('error'));
    expect(box.querySelector('img.avatar')).toBeNull();
    expect(box.firstElementChild!.className).toBe('handle');
  });

  it('F-19-AC1 the card and the flying strips style it round and one line tall', () => {
    for (const host of [new CardView().host, new FlyView().host]) {
      const css = host.shadowRoot!.querySelector('style')!.textContent!;
      const rule = css.match(/\.avatar\s*\{([^}]*)\}/)?.[1] ?? '';
      expect(rule).toMatch(/border-radius:\s*50%/);
      expect(rule).toMatch(/height:\s*[\d.]+em/);
      const h = Number(rule.match(/height:\s*([\d.]+)em/)![1]);
      // As tall as a line of text: about the font size, never taller than the line box.
      expect(h).toBeGreaterThanOrEqual(1);
      expect(h).toBeLessThanOrEqual(1.35);
    }
  });
});

describe('F-19-AC2 the avatar counts in the estimates', () => {
  // '@ann ' is 5 wide; refLineWidth 50.
  const fits = 'x'.repeat(45);

  it('F-19-AC2 a comment that just fits one line takes two with an avatar', () => {
    expect(commentLines(comment(fits, { author: '@ann' }), P)).toBe(1);
    expect(commentLines(comment(fits, { author: '@ann', avatar: AV }), P)).toBe(2);
  });

  it('F-19-AC2 the card time follows: one line and more lines differ the same way', () => {
    // Two estimated lines are at most one screen; three or more are a screen per two lines.
    const two = 'x'.repeat(95);
    expect(durOf(comment(two, { author: '@ann' }), P)).toBeLessThanOrEqual(P.screenSec);
    expect(durOf(comment(two, { author: '@ann', avatar: AV }), P)).toBe(2 * P.screenSec);
  });

  it('F-19-AC2 too long: the avatar can tip a comment over the line limit', () => {
    const text = 'x'.repeat(P.longLines * P.refLineWidth - 5);
    expect(fitLong(comment(text, { id: 'a', author: '@ann' }), P, 'fly', false)).toBeDefined();
    expect(fitLong(comment(text, { id: 'b', author: '@ann', avatar: AV }), P, 'fly', false)).toBeUndefined();
  });

  it('F-19-AC2 lane planning: the avatar adds its width to the estimate', () => {
    const font = 20;
    const plain = estimateFlyWidth(comment('nice one, really nice', { author: '@ann' }), font);
    const withAv = estimateFlyWidth(comment('nice one, really nice', { author: '@ann', avatar: AV }), font);
    expect(withAv - plain).toBeCloseTo(AVATAR_EM * font, 5);
  });
});

describe('F-19-AC3 the settings page preview', () => {
  it('F-19-AC3 every sample comment has an avatar the page can draw offline', () => {
    const items = demoTimeline(DEFAULT_PARAMS).slots.flatMap((s) => s.items);
    expect(items.length).toBeGreaterThan(0);
    for (const c of items) expect(c.avatar).toMatch(/^data:image\/svg\+xml,/);
  });
});

describe('F-19-AC4 the cache', () => {
  it('F-19-AC4 lean() keeps the avatar for the danmaku cache', () => {
    const c = comment('nice one, really nice', { avatar: AV, published: '1 day ago', level: 1, replyToken: 'T' });
    expect(lean(c)).toMatchObject({ avatar: AV });
  });

  it('F-19-AC4 the cache cap defaults to 3 MB', () => {
    expect(DEFAULT_PARAMS.cache.mb).toBe(3);
  });
});
