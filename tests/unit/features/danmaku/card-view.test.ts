// @vitest-environment happy-dom
// F-12-AC12 / F-12-AC17: how cards stack and how tall they get.
import { describe, expect, it, vi } from 'vitest';
import { CardView, fontPx, LINE_HEIGHT } from '@/features/danmaku/card-view';
import { DEFAULT_PARAMS, type DisplayParams } from '@/features/danmaku/params';
import type { Slot } from '@/features/danmaku/schedule';
import { comment } from './helpers';

const H = 720;
const lh = fontPx(H, DEFAULT_PARAMS.display) * LINE_HEIGHT;
const opts = (p: Partial<DisplayParams> = {}, height = H) => ({ p: { ...DEFAULT_PARAMS.display, ...p }, width: 1280, height, top: 20 });
const slot = (id: string, start: number, more: { cut?: boolean } = {}): Slot => ({ start, kind: 'local', items: [comment(`text of ${id}`, { id, ...more })], durs: [10], extra: 0 });

/** A view whose comments take the given number of lines. */
function view(lines: Record<string, number> = {}) {
  const v = new CardView();
  vi.spyOn(v, 'lines').mockImplementation((c) => lines[c.id] ?? 1);
  return v;
}
const cards = (v: CardView) => [...v.host.shadowRoot!.querySelectorAll<HTMLElement>('.card:not(.measure)')].map((c) => ({
  id: c.querySelector('.text')!.textContent!.replace(/.*text of /, ''),
  top: parseFloat(c.parentElement!.style.top),
  height: parseFloat(c.querySelector<HTMLElement>('.view')!.style.height),
  /** The lines it is clamped to, if it is. */
  clamp: c.querySelector('.text')!.classList.contains('clamp') ? c.querySelector<HTMLElement>('.text')!.style.getPropertyValue('--lines') : '',
  c,
})).sort((a, b) => a.top - b.top);
const show = (v: CardView, slots: Slot[], t: number, o = opts()) => v.draw(slots.map((s) => ({ slot: s, t: t - s.start })), o);

describe('F-12-AC12 stacked cards', () => {
  const a = slot('a', 0);
  const b = slot('b', 1);
  const c = slot('c', 2);

  it('F-12-AC12 draws one card per row, downwards, not overlapping', () => {
    const v = view({ a: 2 });
    show(v, [a, b], 3);
    const [first, second] = cards(v);
    expect([first!.id, second!.id]).toEqual(['a', 'b']);
    expect(first!.top).toBe(0);
    expect(second!.top).toBeGreaterThanOrEqual(2 * lh);
  });

  it('F-12-AC12 a card stays where it appeared; a new one takes the topmost free spot', () => {
    const v = view();
    show(v, [a, b], 3);
    const bTop = cards(v)[1]!.top;
    show(v, [b], 11);
    expect(cards(v).map((x) => [x.id, x.top])).toEqual([['b', bTop]]);
    show(v, [b, c], 11);
    expect(cards(v).map((x) => [x.id, x.top])).toEqual([['c', 0], ['b', bTop]]);
  });

  it('F-12-AC12 leaves out a card the player has no room for', () => {
    const v = view({ a: 2, b: 2, c: 2 });
    show(v, [a, b, c], 3, opts({ cardRows: 3 }, 100));
    expect(cards(v).length).toBeLessThan(3);
    expect(cards(v)[0]!.id).toBe('a');
    for (const x of cards(v)) expect(20 + x.top + x.height).toBeLessThanOrEqual(100);
  });

  it('F-12-AC12 draws nothing for no cards', () => {
    const v = view();
    show(v, [a], 3);
    v.draw([], opts());
    expect(cards(v)).toEqual([]);
  });
});

describe('F-12-AC17 card height', () => {
  const s = slot('a', 0);
  const height = (lines: number, p: Partial<DisplayParams>, sl = s) => {
    const v = view({ a: lines });
    show(v, [sl], 0.5, opts(p));
    return cards(v)[0]!;
  };

  it('F-12-AC17 at most the long-comment lines tall; two when unlimited', () => {
    expect(height(3, { longLines: 4 }).height).toBeCloseTo(3 * lh);
    expect(height(9, { longLines: 4, longMode: 'scroll' }).height).toBeCloseTo(4 * lh);
    expect(height(9, { longLines: 0 }).height).toBeCloseTo(2 * lh);
  });

  it('F-12-AC17 scrolls a screen of that many lines at a time', () => {
    const v = view({ a: 9 });
    show(v, [s], 4, opts({ longLines: 4, longMode: 'scroll' })); // 3 screens over 10 s
    expect(cards(v)[0]!.c.querySelector<HTMLElement>('.text')!.style.transform).toBe(`translateY(${-4 * lh}px)`);
  });

  it('F-12-AC17 a truncated comment is clamped to those lines', () => {
    const cut = slot('a', 0, { cut: true });
    const x = height(6, { longLines: 4, longMode: 'truncate' }, cut);
    expect(x.clamp).toBe('4');
    expect(x.height).toBeCloseTo(4 * lh);
    expect(height(3, { longLines: 4 }).clamp).toBe('');
  });
});
