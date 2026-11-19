import { describe, expect, it } from 'vitest';
import {
  chunk, isWatchedHere, parseCaptured, planClear, planOverwrite, planUndoMoves, reconcile, retryDelayMs,
  SignatureFilter, translate, type ListItem, type TlpqItem,
} from './core';

const T = (v: string, s: string): TlpqItem => ({ videoId: v, setVideoId: s });
const L = (v: string, s: string, percent?: number): ListItem => ({ videoId: v, setVideoId: s, percent });

describe('parseCaptured', () => {
  it('reads queue edits the page sends (recorded shapes, §28.1)', () => {
    expect(parseCaptured('browse/edit_playlist', { playlistId: 'TLPQabc', actions: [{ addedVideoId: 'x', action: 'ACTION_ADD_VIDEO' }] }))
      .toEqual([{ kind: 'add', videoId: 'x' }]);
    expect(parseCaptured('browse/edit_playlist', { playlistId: 'TLPQabc', actions: [{ action: 'ACTION_REMOVE_VIDEO', setVideoId: 'S1' }], params: 'CAE%3D' }))
      .toEqual([{ kind: 'remove', tlpqSetId: 'S1' }]);
    expect(parseCaptured('browse/edit_playlist', { playlistId: 'TLPQabc', actions: [{ action: 'ACTION_MOVE_VIDEO_AFTER', setVideoId: 'S1' }] }))
      .toEqual([{ kind: 'move', tlpqSetId: 'S1', afterTlpqSetId: undefined }]);
    expect(parseCaptured('playlist/create', { title: 'Queue', videoIds: ['a', 'b'], params: 'CAQ%3D' }))
      .toEqual([{ kind: 'create', videoIds: ['a', 'b'] }]);
  });
  it('ignores other playlists and other creates', () => {
    expect(parseCaptured('browse/edit_playlist', { playlistId: 'WL', actions: [{ action: 'ACTION_ADD_VIDEO', addedVideoId: 'x' }] })).toEqual([]);
    expect(parseCaptured('playlist/create', { title: 'Mine', videoIds: ['a'] })).toEqual([]);
    expect(parseCaptured('next', {})).toEqual([]);
  });
});

describe('SignatureFilter', () => {
  it('swallows expected signatures once, within the TTL', () => {
    const f = new SignatureFilter(1000, 0);
    f.expect('add:x', 0);
    expect(f.accept('add:x', 10)).toBe(false);
    expect(f.accept('add:x', 20)).toBe(true);
    f.expect('add:y', 0);
    expect(f.accept('add:y', 2000)).toBe(true);
  });
  it('drops the duplicate the page sends right after', () => {
    const f = new SignatureFilter(1000, 3000);
    expect(f.accept('remove:S', 0)).toBe(true);
    expect(f.accept('remove:S', 100)).toBe(false);
    expect(f.accept('remove:S', 5000)).toBe(true);
  });
});

describe('reconcile', () => {
  it('keeps valid pairs and pairs the rest by video, in order', () => {
    const tlpq = [T('a', 't1'), T('b', 't2'), T('a', 't3')];
    const list = [L('a', 'l1'), L('b', 'l2'), L('a', 'l3')];
    expect(reconcile(tlpq, list, { t3: 'l1' })).toEqual({ t3: 'l1', t1: 'l3', t2: 'l2' });
  });
  it('drops pairs whose list entry is gone', () => {
    expect(reconcile([T('a', 't1')], [], { t1: 'l1' })).toEqual({});
  });
});

describe('translate', () => {
  const map = { t1: 'l1', t2: 'l2' };
  it('adds with dedupe skip', () => {
    expect(translate({ kind: 'add', videoId: 'x' }, map)).toEqual({ actions: [{ action: 'ACTION_ADD_VIDEO', addedVideoId: 'x', dedupeOption: 'DEDUPE_OPTION_SKIP' }] });
  });
  it('removes the mapped list entry, or drops', () => {
    expect(translate({ kind: 'remove', tlpqSetId: 't1' }, map)).toEqual({ actions: [{ action: 'ACTION_REMOVE_VIDEO', setVideoId: 'l1' }] });
    expect(translate({ kind: 'remove', tlpqSetId: 'zz' }, map)).toHaveProperty('drop');
  });
  it('moves with mapped predecessor, or to the top', () => {
    expect(translate({ kind: 'move', tlpqSetId: 't2', afterTlpqSetId: 't1' }, map))
      .toEqual({ actions: [{ action: 'ACTION_MOVE_VIDEO_AFTER', setVideoId: 'l2', movedSetVideoIdPredecessor: 'l1' }] });
    expect(translate({ kind: 'move', tlpqSetId: 't2' }, map)).toEqual({ actions: [{ action: 'ACTION_MOVE_VIDEO_AFTER', setVideoId: 'l2' }] });
  });
});

describe('planOverwrite', () => {
  it('removes queue items gone from the list, adds new ones, keeps the playing one', () => {
    const tlpq = [T('a', 't1'), T('b', 't2'), T('c', 't3')];
    const list = [L('a', 'l1'), L('d', 'l4')];
    const map = { t1: 'l1', t2: 'l2', t3: 'l3' };
    const p = planOverwrite(tlpq, list, map, 't3');
    expect(p.removeTlpq).toEqual(['t2']);
    expect(p.add.map((i) => i.videoId)).toEqual(['d']);
    expect(p.moves).toEqual([]);
  });
  it('reorders to list order', () => {
    const tlpq = [T('a', 't1'), T('b', 't2'), T('c', 't3')];
    const list = [L('c', 'l3'), L('a', 'l1'), L('b', 'l2')];
    const p = planOverwrite(tlpq, list, { t1: 'l1', t2: 'l2', t3: 'l3' });
    expect(p.moves).toEqual([{ tlpqSetId: 't3', afterTlpqSetId: undefined }]);
  });
  it('does nothing when already in sync', () => {
    const p = planOverwrite([T('a', 't1')], [L('a', 'l1')], { t1: 'l1' });
    expect(p).toEqual({ removeTlpq: [], add: [], moves: [] });
  });
});

describe('watched and retry', () => {
  it('counts ended or under 10 s left as watched', () => {
    expect(isWatchedHere(100, 100, true)).toBe(true);
    expect(isWatchedHere(95, 100, false)).toBe(true);
    expect(isWatchedHere(80, 100, false)).toBe(false);
    expect(isWatchedHere(0, 0, false)).toBe(false);
  });
  it('backs off', () => {
    expect([0, 1, 2, 3, 4, 9].map(retryDelayMs)).toEqual([5000, 30000, 120000, 600000, 1800000, 1800000]);
  });
  it('chunks by 100', () => {
    expect(chunk(Array.from({ length: 250 }, (_, i) => i)).map((c) => c.length)).toEqual([100, 100, 50]);
  });
});

describe('clear and undo', () => {
  const items = [L('a', 'l1', 95), L('b', 'l2', 10), L('c', 'l3', 100), L('d', 'l4')];
  it('picks all or only watched (≥ 90 %), recording original positions', () => {
    expect(planClear(items, 'all').removed.map((r) => r.index)).toEqual([0, 1, 2, 3]);
    expect(planClear(items, 'watched').removed).toEqual([{ videoId: 'a', index: 0 }, { videoId: 'c', index: 2 }]);
  });
  it('moves re-added items back to where they were', () => {
    // after removing a and c: [b, d]; re-added at the end: [b, d, a', c']
    const after = [L('b', 'l2'), L('d', 'l4'), L('a', 'n1'), L('c', 'n3')];
    const moves = planUndoMoves(after, ['n1', 'n3'], [{ videoId: 'a', index: 0 }, { videoId: 'c', index: 2 }]);
    expect(moves).toEqual([{ setVideoId: 'n1', afterSetVideoId: undefined }, { setVideoId: 'n3', afterSetVideoId: 'l2' }]);
    // applying them yields a, b, c, d
    const order = after.map((i) => i.setVideoId);
    for (const m of moves) {
      order.splice(order.indexOf(m.setVideoId), 1);
      order.splice(m.afterSetVideoId ? order.indexOf(m.afterSetVideoId) + 1 : 0, 0, m.setVideoId);
    }
    expect(order).toEqual(['n1', 'l2', 'n3', 'l4']);
  });
});
