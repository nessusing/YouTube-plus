import { describe, expect, it } from 'vitest';
import { stampCards } from '@/features/danmaku/cards';
import { DEFAULT_PARAMS } from '@/features/danmaku/params';
import { comment } from './helpers';

const cards = (...cs: ReturnType<typeof comment>[]) => stampCards(cs, 600, DEFAULT_PARAMS);
const texts = (s: { items: { text: string }[] }) => s.items.map((c) => c.text);

describe('stampCards', () => {
  it('shows a table of contents once at 0:00', () => {
    const toc = comment('0:00 Intro\n1:20 Setup\n3:05 Test one\n5:40 Test two\n8:12 Results');
    expect(cards(toc)).toEqual([{ start: 0, kind: 'toc', items: [toc], durs: [15], extra: 0 }]); // 5 lines → 3 screens
  });

  it('puts comments within ±2 s on one card, most liked first, starting at the earliest', () => {
    const a = comment('1:00 the jump was great', { likes: 5 });
    const b = comment('1:03 look at his face', { likes: 50 });
    const c = comment('1:05 and then the fall', { likes: 1 });
    const r = cards(a, b, c);
    expect(r.map((s) => [s.start, texts(s)])).toEqual([[60, [b.text, a.text]], [65, [c.text]]]);
    expect(r[0]!.durs).toEqual([1.5, 1.5]);
  });

  it('rotates at most three and counts the rest', () => {
    const cs = [1, 7, 3, 9, 5].map((likes) => comment(`2:00 comment with ${likes} likes`, { likes }));
    const [card] = cards(...cs);
    expect(texts(card!)).toEqual(['2:00 comment with 9 likes', '2:00 comment with 7 likes', '2:00 comment with 5 likes']);
    expect(card!.extra).toBe(2);
  });

  it('appears at every timestamp, once per moment, inside the video', () => {
    const c = comment('1:00 and 1:01 here, then 5:00, then 59:00');
    expect(cards(c).map((s) => s.start)).toEqual([60, 300]);
  });
});
