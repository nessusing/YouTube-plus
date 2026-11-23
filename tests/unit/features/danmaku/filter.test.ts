import { describe, expect, it } from 'vitest';
import { filterComments, ownText } from '@/features/danmaku/filter';
import { DEFAULT_PARAMS } from '@/features/danmaku/params';
import { comment } from './helpers';

const P = DEFAULT_PARAMS.comments; // minLength 12, cjkWeight 3
const run = (...cs: ReturnType<typeof comment>[]) => filterComments(cs, P);
const reasons = (r: ReturnType<typeof run>) => r.dropped.map((d) => [d.comment.text, d.reason]);

describe('filterComments', () => {
  it('F-12-AC5 drops links', () => {
    expect(reasons(run(comment('a long enough comment', { hasLink: true })))).toEqual([['a long enough comment', 'link']]);
  });

  it('F-12-AC5 drops pure emoji, custom emoji codes and member emoji', () => {
    const member = comment('❤❤❤', { images: [{ start: 0, len: 3, url: 'u', alt: '❤' }] });
    const r = run(comment('😂😂😂 !!! 👍🏽'), comment(':face-blue-smiling: :hand-pink-waving:'), member, comment('🇨🇦🇨🇦'));
    expect(r.kept).toEqual([]);
    expect(r.dropped.every((d) => d.reason === 'emoji')).toBe(true);
  });

  it('F-12-AC5 drops short comments, counting a CJK letter as three', () => {
    const r = run(comment('eleven char'), comment('twelve chars'), comment('哈哈哈'), comment('木蘭當戶織'));
    expect(r.kept.map((c) => c.text)).toEqual(['twelve chars', '木蘭當戶織']);
    expect(reasons(r)).toEqual([['eleven char', 'short'], ['哈哈哈', 'short']]);
  });

  it('F-12-AC5 does not count the timestamp as words', () => {
    const c = comment('2:35 so good');
    expect(ownText(c)).toBe('so good');
    expect(reasons(run(c))).toEqual([['2:35 so good', 'short']]);
  });

  it('F-12-AC5 keeps the most liked of duplicates, in the original order', () => {
    const a = comment('Never gonna give you up', { id: 'a', likes: 3 });
    const b = comment('other comment here', { id: 'b' });
    const c = comment('never gonna give you up!!! 😂', { id: 'c', likes: 50 });
    const r = run(a, b, c);
    expect(r.kept.map((x) => x.id)).toEqual(['b', 'c']);
    expect(r.dropped).toEqual([{ comment: a, reason: 'duplicate' }]);
  });
});
