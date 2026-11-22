import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  buildBatchPrompt, buildInner, buildPrompt, CHANNEL_CLOSE, channelHeaders, channelOpen, channelPrompt, channelSid, classifyChannel,
  extractTokens, mapChannelStatus, mapErrorCode, parseBatch, parseChannel, parseStream, parseSummary, sapisidHash, splitChannelFrames,
} from '@/features/tldr/protocol';

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
    expect(extractTokens('x"SNlM0e":"AT1"y"cfb2h":"boq_1"z"FdrFJe":"-42"w"d2zJAe":"AIzaK"')).toEqual({ at: 'AT1', bl: 'boq_1', sid: '-42', key: 'AIzaK' });
    expect(extractTokens('<html>guest</html>').at).toBeUndefined();
  });
});

/** A downstream frame as recorded on 2026-11-21: the length does not count the newline. */
function chFrame(items: unknown[]): string {
  const f = JSON.stringify(items);
  return `${f.length}\n${f}`;
}

/** A content payload around one answer array. */
function content(answer: unknown, done = false): unknown {
  return [[null, [7, null, null, null, null, null, [[done ? 1 : 0, ['r_1'], null, [null, null, null, answer]]]]]];
}

describe('processSession', () => {
  it('splits frames exactly as recorded and keeps an incomplete tail', () => {
    expect(splitChannelFrames('14\n[[1,["noop"]]]')).toEqual({ items: [[1, ['noop']]], rest: '' });
    const two = chFrame([[2, ['noop']]]) + chFrame([[3, ['x 中文 😀']]]);
    expect(splitChannelFrames(two).items).toEqual([[2, ['noop']], [3, ['x 中文 😀']]]);
    const cut = two.slice(0, -3);
    const r = splitChannelFrames(cut);
    expect(r.items).toEqual([[2, ['noop']]]);
    expect(splitChannelFrames(r.rest + two.slice(-3)).items).toEqual([[3, ['x 中文 😀']]]);
  });

  it('reads SID from the handshake body', () => {
    expect(channelSid(`${chFrame([[0, ['c', 'SID-1', '', 8, 15, 30000]]])}\n`)).toBe('SID-1');
    expect(channelSid('garbage')).toBeUndefined();
  });

  it('classifies downstream payloads', () => {
    expect(classifyChannel(['noop'])).toEqual({ kind: 'noop' });
    expect(classifyChannel([[[]]])).toEqual({ kind: 'ack' });
    expect(classifyChannel([[null, null, null, []]])).toEqual({ kind: 'end' });
    expect(classifyChannel(['close'])).toEqual({ kind: 'end' });
    expect(classifyChannel(content(['A'], true))).toEqual({ kind: 'content', answer: ['A'], done: true });
    expect(classifyChannel(content(null))).toEqual({ kind: 'content', answer: null, done: false });
    expect(classifyChannel({ __sm__: { status: [[[16, 'missing credential']]] } })).toEqual({ kind: 'error', status: 16, message: 'missing credential' });
    expect(classifyChannel({ __sm__: { status: [[{ error: { code: 400, message: 'Root element' } }]] } })).toEqual({ kind: 'error', status: 400, message: 'Root element' });
    expect(mapChannelStatus(16)).toEqual({ code: 'auth' });
    expect(mapChannelStatus(400)).toEqual({ code: 'protocol' });
  });

  it('builds the three upstream messages', () => {
    const open = channelOpen('U') as unknown[][][];
    expect(open[0]![0]).toEqual([1, null, 'en', 'U']);
    const inner = (open[0]![7] as unknown[])[4] as unknown[];
    expect((inner[0] as unknown[])[0]).toEqual(['', 0, null, null, null, null, 0]); // prompt slot empty
    expect((inner[0] as unknown[])[59]).toBe('U');
    expect(channelPrompt('hi')).toEqual([null, [1, null, null, null, null, null, null, null, ['hi']]]);
    expect(CHANNEL_CLOSE).toEqual([null, null, null, [1]]);
  });

  it('signs with SAPISIDHASH and picks the account by header', async () => {
    const want = createHash('sha1').update('1700000000 abc https://gemini.google.com').digest('hex');
    expect(await sapisidHash('abc', 1700000000)).toBe(`SAPISIDHASH 1700000000_${want}`);
    const h = channelHeaders('KEY', 'SAPISIDHASH x', 2);
    expect(h.split('\r\n')).toEqual([
      'X-Goog-Api-Key:KEY', 'x-goog-ext-525001261-bin:CAE=', 'X-WebChannel-Content-Type:application/json+protobuf',
      'Authorization:SAPISIDHASH x', 'X-Goog-AuthUser:2', '',
    ]);
  });

  it('parses answers like parseStream: ids, last text, card fallback, errors', () => {
    const card: unknown[] = ['rc', ['http://googleusercontent.com/card_content/0']];
    card[22] = ['card text'];
    const answers = [
      [null, ['c_abc', 'r_1']],
      [null, ['c_abc', 'r_1'], null, null, [['rc', ['{"po']]]],
      [null, ['c_abc', 'r_1'], null, null, [['rc', ['{"points":["中文"]}']]]],
      [null, null, null, null, [['rc']]], // title-only frame after the answer: keeps the text
    ];
    const p = parseChannel(answers, '');
    expect(p).toEqual({ cid: 'c_abc', rid: 'r_1', text: '{"points":["中文"]}' });
    expect(parseChannel([[null, ['c_x'], null, null, [card]]], '').text).toBe('card text');
    expect(parseChannel([JSON.stringify([null, ['c_s'], null, null, [['rc', ['s']]]])], '').text).toBe('s'); // answer as a JSON string
    expect(parseChannel([], '"BardErrorInfo [1037]"').errorCode).toBe(1037);
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
  it('takes the first object when the answer is written twice', () => {
    expect(parseSummary('{"status":"ok","points":["a }"]}{"status":"ok","points":["b"]}', 'en')).toMatchObject({ kind: 'ok', data: { points: ['a }'] } });
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
  it('takes the first array when the answer is written twice (seen 2026-11-21)', () => {
    const one = JSON.stringify(ids.map((id, n) => ({ id, status: 'ok', points: [`p${n}`] })));
    const m = parseBatch(one + one, ids, 'en');
    expect(ids.map((id) => (m.get(id) as { data: { points: string[] } }).data.points[0])).toEqual(['p0', 'p1', 'p2']);
  });
  it('keeps the good objects when one is broken (seen 2026-11-21)', () => {
    const text = '[{"id":"aaaaaaaaaaa","status":"ok","lang":"zh","yue","points":["x"]},'
      + '{"id":"bbbbbbbbbbb","status":"ok","points":["y [z] {w}"],"titleMatch":{"verdict":"match","reason":"r"}},'
      + '{"id":"ccccccccccc","status":"no_transcript"}]';
    const m = parseBatch(text, ids, 'en');
    expect(m.has('aaaaaaaaaaa')).toBe(false);
    expect(m.get('bbbbbbbbbbb')).toMatchObject({ kind: 'ok', data: { points: ['y [z] {w}'], titleMatch: { verdict: 'match' } } });
    expect(m.get('ccccccccccc')?.kind).toBe('unreadable');
  });
  it('skips brackets in prose before the array', () => {
    const m = parseBatch('Note [1]: done [{"id":"aaaaaaaaaaa","status":"ok","points":["x"]}] bye', ids, 'en');
    expect(m.get('aaaaaaaaaaa')?.kind).toBe('ok');
  });
});
