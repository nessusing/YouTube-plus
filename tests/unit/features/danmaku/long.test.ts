// F-12-AC17: the long-comment rule.
import { describe, expect, it } from 'vitest';
import { fitLong } from '@/features/danmaku/long';
import { DEFAULT_PARAMS, type DisplayParams, paramsWithDefaults } from '@/features/danmaku/params';
import { buildTimeline } from '@/features/danmaku/timeline';
import { commentLines } from '@/features/danmaku/timing';
import { comment } from './helpers';

const P = DEFAULT_PARAMS.display;
const words = (n: number) => 'word '.repeat(n).trim();
const short = comment('short and sweet, really', { id: 'short' });
const long = comment(words(60), { id: 'long' }); // 300 characters: 7 lines at 50 wide
const toc = comment('0:00 Intro\n1:20 Setup\n3:05 Test one\n5:40 Test two\n8:12 Results', { id: 'toc' });
const stampedLong = comment(`2:00 ${words(60)}`, { id: 'sl' });
const display = (more: Partial<DisplayParams>) => ({ ...DEFAULT_PARAMS, display: { ...P, ...more } });
const input = (cs: ReturnType<typeof comment>[]) => ({ videoId: 'vid', duration: 600, total: 100, comments: cs, heat: cs.map(() => 0.5), heatmap: [] });
const ids = (ss: ReturnType<typeof buildTimeline>) => ss.flatMap((s) => s.items.map((c) => c.id)).sort();

describe('F-12-AC17 long comments', () => {
  it('F-12-AC17 defaults: more than 4 lines is long, and long ones are not shown', () => {
    expect([P.longLines, P.longMode]).toEqual([4, 'hide']);
    expect(fitLong(short, P, 'card', false)).toBe(short);
    expect(fitLong(long, P, 'card', false)).toBeUndefined();
    expect(fitLong(long, P, 'fly', false)).toBeUndefined();
  });

  it('F-12-AC17 0 lines: nothing is long', () => {
    expect(fitLong(long, { ...P, longLines: 0 }, 'card', false)).toBe(long);
  });

  it('F-12-AC17 the avatar and handle count towards the lines', () => {
    const text = 'x'.repeat(P.longLines * P.refLineWidth - 5);
    expect(fitLong(comment(text, { author: '@ann' }), P, 'card', false)).toBeDefined();
    expect(fitLong(comment(text, { author: '@ann', avatar: 'data:x' }), P, 'card', false)).toBeUndefined();
  });

  it('F-12-AC17 truncate: cut to the line limit, ending in …', () => {
    const p = { ...P, longMode: 'truncate' as const };
    for (const style of ['card', 'fly'] as const) {
      const c = fitLong(long, p, style, false)!;
      expect(c.text.endsWith('…')).toBe(true);
      expect(c.text.length).toBeLessThan(long.text.length);
      expect(commentLines(c, p)).toBeLessThanOrEqual(p.longLines);
      expect(c.cut).toBe(true);
      expect(c.id).toBe('long');
    }
    const lines = fitLong(comment('a\nb\nc\nd\ne\nf', { id: 'nl' }), p, 'card', false)!;
    expect(lines.text).toBe('a\nb\nc\nd…');
  });

  it('F-12-AC17 truncate keeps member emoji that are left and drops the cut ones', () => {
    const text = `:a: ${words(60)} :b:`;
    const c = comment(text, { images: [{ start: 0, len: 3, url: 'u', alt: 'a' }, { start: text.length - 3, len: 3, url: 'u', alt: 'b' }] });
    expect(fitLong(c, { ...P, longMode: 'truncate' }, 'card', false)!.images.map((i) => i.alt)).toEqual(['a']);
  });

  it('F-12-AC17 scroll: the card keeps the whole text; flying cuts it', () => {
    const p = { ...P, longMode: 'scroll' as const };
    expect(fitLong(long, p, 'card', false)).toBe(long);
    expect(fitLong(long, p, 'fly', false)!.text.endsWith('…')).toBe(true);
  });

  it('F-12-AC17 a table of contents is exempt on the card, not flying', () => {
    expect(ids(buildTimeline(input([toc]), 'stamps', DEFAULT_PARAMS, 'card'))).toEqual(['toc']);
    expect(buildTimeline(input([toc]), 'stamps', display({ longMode: 'truncate' }), 'card')[0]!.items[0]!.text).toBe(toc.text);
    expect(buildTimeline(input([toc]), 'stamps', DEFAULT_PARAMS, 'fly')).toEqual([]);
    // Cut for flying, it is still a table of contents: once, at 0:00.
    expect(buildTimeline(input([toc]), 'stamps', display({ longMode: 'truncate' }), 'fly').map((s) => s.start)).toEqual([0]);
  });

  it('F-12-AC17 the rule covers timestamped comments too, in both styles', () => {
    for (const style of ['card', 'fly'] as const) {
      expect(ids(buildTimeline(input([stampedLong, short]), 'local', DEFAULT_PARAMS, style))).toEqual(['short']);
      expect(ids(buildTimeline(input([stampedLong, short]), 'local', display({ longLines: 0 }), style))).toEqual(['short', 'sl']);
    }
  });

  it('F-12-AC17 F-12-AC16 stored settings: a bad mode falls back to the default', () => {
    expect(paramsWithDefaults({ display: { longMode: 'nope', longLines: 2 } }).display).toMatchObject({ longMode: 'hide', longLines: 2 });
    expect(paramsWithDefaults({ display: { longMode: 'scroll' } }).display.longMode).toBe('scroll');
  });
});
