import { describe, expect, it } from 'vitest';
import { buildBatchPrompt, buildInner, buildPrompt, extractTokens, mapErrorCode, parseBatch, parseStream, parseSummary } from '@/features/tldr/protocol';

/** Build a response shaped like the one recorded on 2026-11-18. */
function frame(inner: unknown): string {
  const f = JSON.stringify([['wrb.fr', null, JSON.stringify(inner)]]);
  // The prefix counts the newline that follows it (as in the real stream).
  return `${f.length + 1}\n${f}\n`;
}

describe('parseStream', () => {
  it('takes cid and the last full text from length-prefixed frames', () => {
    const raw = ")]}'\n\n"
      + frame([null, ['c_abc', 'r_1']])
      + frame([null, ['c_abc', 'r_1'], null, null, [['rc_1', ['{"status":"ok","po']]]])
      + frame([null, ['c_abc', 'r_1'], null, null, [['rc_1', ['{"status":"ok","points":["中文 ✓ 😀"]}']]]])
      + '26\n[["e",4,null,null,144]]\n';
    const p = parseStream(raw);
    expect(p.cid).toBe('c_abc');
    expect(p.text).toBe('{"status":"ok","points":["中文 ✓ 😀"]}');
    expect(p.errorCode).toBeUndefined();
  });

  it('uses candidate[22] when [1] is a card placeholder', () => {
    const cand: unknown[] = ['rc', ['http://googleusercontent.com/card_content/0']];
    cand[22] = ['real text'];
    expect(parseStream(")]}'\n" + frame([null, ['c_x'], null, null, [cand]])).text).toBe('real text');
  });

  it('reports BardErrorInfo codes', () => {
    expect(parseStream(")]}'\n31\n[[\"x\",\"BardErrorInfo [1037]\"]]\n").errorCode).toBe(1037);
    expect(mapErrorCode(1037)).toEqual({ code: 'quota' });
    expect(mapErrorCode(1152)).toEqual({ code: 'blocked' });
    expect(mapErrorCode(1013)).toEqual({ code: 'transient' });
  });
});

describe('request building', () => {
  it('fills the known slots and leaves temporary chat and model unset', () => {
    const inner = buildInner('hi', 'U');
    expect(inner).toHaveLength(80);
    expect(inner[0]).toEqual(['hi', 0, null, null, null, null, 0]);
    expect(inner[59]).toBe('U');
    expect(inner[45]).toBeNull();
    expect(inner[79]).toBeNull();
  });
  it('builds the prompt from settings', () => {
    const p = buildPrompt({ videoId: 'abc', title: 'T "q"', lang: 'zh', titleCheck: false });
    expect(p).toContain('watch?v=abc');
    expect(p).toContain('Simplified Chinese');
    expect(p).not.toContain('titleMatch');
    expect(buildPrompt({ videoId: 'abc', title: 't', lang: 'en', titleCheck: true })).toContain('titleMatch');
  });
  it('extracts tokens from the app HTML', () => {
    expect(extractTokens('x"SNlM0e":"AT1"y"cfb2h":"boq_1"z"FdrFJe":"-42"')).toEqual({ at: 'AT1', bl: 'boq_1', sid: '-42' });
    expect(extractTokens('<html>guest</html>').at).toBeUndefined();
  });
});

describe('parseSummary', () => {
  it('parses clean JSON', () => {
    const r = parseSummary('{"status":"ok","lang":"en","points":["a","b","c"],"titleMatch":{"verdict":"match","reason":"r"}}', 'x');
    expect(r).toEqual({ kind: 'ok', data: { points: ['a', 'b', 'c'], lang: 'en', titleMatch: { verdict: 'match', reason: 'r' } } });
  });
  it('digs JSON out of fences or chatter', () => {
    expect(parseSummary('```json\n{"status":"ok","points":["a"]}\n```', 'zh')).toMatchObject({ kind: 'ok', data: { points: ['a'], lang: 'zh' } });
    expect(parseSummary('Sure! {"status":"ok","points":["a"]} Hope this helps', 'zh')).toMatchObject({ kind: 'ok', data: { points: ['a'] } });
  });
  it('maps no_transcript to unreadable', () => {
    expect(parseSummary('{"status":"no_transcript"}', 'en').kind).toBe('unreadable');
  });
  it('keeps unparsable text as raw', () => {
    expect(parseSummary('just prose', 'en')).toEqual({ kind: 'ok', data: { points: [], lang: 'en', raw: 'just prose' } });
  });
});

describe('batch', () => {
  const ids = ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc'];
  it('lists every video in order and asks for an array', () => {
    const p = buildBatchPrompt(ids.map((videoId) => ({ videoId, title: `T ${videoId}`, lang: 'zh', titleCheck: true })));
    expect(p.indexOf('v=aaaaaaaaaaa')).toBeLessThan(p.indexOf('v=bbbbbbbbbbb'));
    expect(p).toContain('JSON array');
    expect(p).toContain('"id":"<video id>"');
    expect(p).toContain('titleMatch');
  });
  it('matches answers by id, keeps no_transcript, leaves out what is missing', () => {
    const text = '```json\n' + JSON.stringify([
      { id: 'bbbbbbbbbbb', status: 'no_transcript' },
      { id: 'aaaaaaaaaaa', status: 'ok', lang: 'en', points: ['x'], titleMatch: { verdict: 'match', reason: 'r' } },
      { id: 'zzzzzzzzzzz', status: 'ok', points: ['stray'] },
    ]) + '\n```';
    const m = parseBatch(text, ids, 'en');
    expect(m.get('aaaaaaaaaaa')).toEqual({ kind: 'ok', data: { points: ['x'], lang: 'en', titleMatch: { verdict: 'match', reason: 'r' } } });
    expect(m.get('bbbbbbbbbbb')?.kind).toBe('unreadable');
    expect(m.has('ccccccccccc')).toBe(false);
    expect(m.size).toBe(2);
  });
  it('falls back to position when ids are dropped and the count matches', () => {
    const m = parseBatch(JSON.stringify(ids.map((_, n) => ({ status: 'ok', points: [`p${n}`] }))), ids, 'en');
    expect(ids.map((id) => (m.get(id) as { data: { points: string[] } }).data.points[0])).toEqual(['p0', 'p1', 'p2']);
  });
  it('returns nothing for text that is not an array', () => {
    expect(parseBatch('sorry, I cannot', ids, 'en').size).toBe(0);
  });
});
