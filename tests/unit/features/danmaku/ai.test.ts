import { describe, expect, it } from 'vitest';
import { buildPlacementPrompt, missingPlaceholders, parsePlacement, withCutoff } from '@/features/danmaku/ai';
import { DEFAULT_PROMPT, PROMPT_PLACEHOLDERS } from '@/features/danmaku/params';

const input = {
  videoId: 'E7uGvsT_nnM',
  title: 'Why "Apollo" Astronauts Trained',
  duration: 788.4,
  comments: [{ id: 1, text: 'line one\nline two' }, { id: 2, text: 'mentions {{url}} literally' }, { id: 3, text: '这是一条很长的评论' }],
};

describe('buildPlacementPrompt', () => {
  it('F-12-AC9 fills the default prompt', () => {
    const p = buildPlacementPrompt(DEFAULT_PROMPT, input, 400);
    expect(p).toContain('Read the YouTube video https://www.youtube.com/watch?v=E7uGvsT_nnM (title: "Why \\"Apollo\\" Astronauts Trained") with the YouTube app');
    expect(p).toContain('The video is 788 seconds long; every time you give is between 0 and 788.');
    expect(p).toContain('Comments:\n1|line one line two\n2|mentions {{url}} literally\n3|这是一条很长的评论\nYour entire reply');
  });

  it('F-12-AC9 cuts long comments by characters', () => {
    expect(buildPlacementPrompt('{{url}}\n{{comments}}', { ...input, comments: [input.comments[2]!] }, 4)).toMatch(/\n3\|这是一条…$/);
  });

  it('F-12-AC16 lists required placeholders the template lost', () => {
    expect(missingPlaceholders(DEFAULT_PROMPT)).toEqual([]);
    expect(missingPlaceholders('Read {{title}}')).toEqual(['{{url}}', '{{comments}}']);
    for (const p of PROMPT_PLACEHOLDERS) expect(DEFAULT_PROMPT).toContain(p);
  });
});

const parse = (reply: string) => parsePlacement(reply, { duration: 788, highConf: 0.9 });
const items = (reply: string) => {
  const r = parse(reply);
  if (r.status !== 'ok') throw new Error(r.status);
  return Object.fromEntries(r.items);
};

describe('parsePlacement', () => {
  it('F-12-AC9 uses only high-confidence times', () => {
    expect(items('1|247|0.95\n2|126|0.9\n3|526|0.8\n4|54|0.3')).toEqual({
      1: { kind: 'at', sec: 247, conf: 0.95 },
      2: { kind: 'at', sec: 126, conf: 0.9 },
      3: { kind: 'ambient', why: 'low', sec: 526, conf: 0.8 },
      4: { kind: 'ambient', why: 'low', sec: 54, conf: 0.3 },
    });
  });

  it('F-12-AC9 reads a and x, with or without a stray confidence', () => {
    expect(items('5|a\n6|x|0.9\n7|A|0.2\n8|x')).toEqual({
      5: { kind: 'ambient', why: 'a' }, 6: { kind: 'hide' }, 7: { kind: 'ambient', why: 'a' }, 8: { kind: 'hide' },
    });
  });

  it('F-12-AC9 turns times outside the video into ambient', () => {
    expect(items('3|854|0.9')).toEqual({ 3: { kind: 'ambient', why: 'range', sec: 854, conf: 0.9 } });
  });

  it('F-12-AC9 accepts m:ss, spaces, bullets and code fences', () => {
    expect(items('```\n- 1 | 4:07 | 0.95\n* 2|1:02:03|0.99\n```')).toEqual({
      1: { kind: 'at', sec: 247, conf: 0.95 },
      2: { kind: 'ambient', why: 'range', sec: 3723, conf: 0.99 },
    });
  });

  it('F-12-AC9 treats a time without confidence as low', () => {
    expect(items('1|247')).toEqual({ 1: { kind: 'ambient', why: 'low', sec: 247, conf: 0 } });
  });

  it('F-12-AC9 keeps the first line for an id and skips junk', () => {
    expect(items('Here you go:\n1|247|0.95\n1|a\n2|soon|0.9\n3|x')).toEqual({ 1: { kind: 'at', sec: 247, conf: 0.95 }, 3: { kind: 'hide' } });
  });

  it('F-12-AC9 recognizes no_transcript and unparsable replies', () => {
    expect(parse('no_transcript')).toEqual({ status: 'no_transcript' });
    expect(parse('  no_transcript\n')).toEqual({ status: 'no_transcript' });
    expect(parse('Sorry, I cannot help with that.')).toEqual({ status: 'unparsed' });
  });
});

describe('withCutoff', () => {
  it('F-12-AC9 moves stored placements across a new cut-off', () => {
    expect(withCutoff({ kind: 'at', sec: 10, conf: 0.9 }, 0.95)).toEqual({ kind: 'ambient', why: 'low', sec: 10, conf: 0.9 });
    expect(withCutoff({ kind: 'ambient', why: 'low', sec: 10, conf: 0.85 }, 0.85)).toEqual({ kind: 'at', sec: 10, conf: 0.85 });
    expect(withCutoff({ kind: 'ambient', why: 'range', sec: 900, conf: 0.99 }, 0.5)).toEqual({ kind: 'ambient', why: 'range', sec: 900, conf: 0.99 });
    expect(withCutoff({ kind: 'hide' }, 0.9)).toEqual({ kind: 'hide' });
  });
});
