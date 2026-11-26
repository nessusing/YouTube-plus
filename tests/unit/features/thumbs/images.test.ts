// @vitest-environment happy-dom
// F-22-AC1: what counts as a picture YouTube has.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { frameUrls, loadImage } from '@/features/thumbs/images';

afterEach(() => vi.restoreAllMocks());

/** The next image created answers with this event and width. */
function answer(event: 'load' | 'error', width: number) {
  const create = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
    const el = create(tag);
    Object.defineProperty(el, 'naturalWidth', { get: () => width });
    queueMicrotask(() => el.dispatchEvent(new Event(event)));
    return el;
  }) as typeof document.createElement);
}

describe('pictures', () => {
  it('F-22-AC1 the three frames are the small ones YouTube cuts from start, middle and end', () => {
    expect(frameUrls('abcdefghijk')).toEqual([1, 2, 3].map((n) => `https://i.ytimg.com/vi/abcdefghijk/mq${n}.jpg`));
  });

  it('F-22-AC1 a loaded picture is used', async () => {
    answer('load', 320);
    expect(await loadImage('https://i.ytimg.com/x.jpg')).toBeInstanceOf(HTMLImageElement);
  });

  it('F-22-AC1 the grey 120x90 placeholder and a failed load are not', async () => {
    answer('load', 120);
    expect(await loadImage('https://i.ytimg.com/x.jpg')).toBeUndefined();
    vi.restoreAllMocks();
    answer('error', 0);
    expect(await loadImage('https://i.ytimg.com/y.jpg')).toBeUndefined();
  });
});
