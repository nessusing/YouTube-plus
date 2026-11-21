// @vitest-environment happy-dom
// QueueController: the top bar count and the playlist panel follow the list,
// whoever edits it (§24.8).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ListAction } from '@/features/queue/core';
import { setup, type Harness } from '../../../support/queue-harness';

vi.mock('@/features/queue/toast', () => import('../../../support/toasts'));

beforeEach(() => vi.useFakeTimers({ now: 1_000_000 }));
afterEach(() => vi.useRealTimers());

const PLAYLIST = { mode: 'playlist' as const, listId: 'PLq', listName: 'List PLq' };

const panelIds = (h: Harness) => h.yt.panel?.rows.map((r) => r.videoId);
const setOf = (h: Harness, v: string) => h.yt.entries('PLq').find((e) => e.videoId === v)!.setVideoId;
const remove = (h: Harness, v: string): ListAction => ({ action: 'ACTION_REMOVE_VIDEO', setVideoId: setOf(h, v) });
const add = (v: string): ListAction => ({ action: 'ACTION_ADD_VIDEO', addedVideoId: v });

/** Sample the count every `step` ms for `ms`. */
async function counts(h: Harness, ms: number, step = 250): Promise<number[]> {
  const out: number[] = [];
  for (let t = 0; t < ms; t += step) {
    await vi.advanceTimersByTimeAsync(step);
    out.push(h.button.count!);
  }
  return out;
}

describe('the page removes an entry from the panel', () => {
  for (const lag of [0, 1000, 4000]) {
    it(`count drops at once and never comes back, panel ends right (reads lag ${lag} ms)`, async () => {
      const h = await setup({ lists: { PLq: ['a', 'b', 'c', 'd'] }, profile: PLAYLIST, before: (yt) => { yt.load('a', 'PLq'); yt.removalLagMs = lag; } });
      h.yt.pageEdit('PLq', [remove(h, 'c')]);
      const seen = await counts(h, 15_000);
      expect(new Set(seen)).toEqual(new Set([3]));
      expect(panelIds(h)).toEqual(['a', 'b', 'd']);
    });
  }

  it('reads lagging longer than the retries (12 s): the count still ends right', async () => {
    const h = await setup({ lists: { PLq: ['a', 'b', 'c', 'd'] }, profile: PLAYLIST, before: (yt) => { yt.load('a', 'PLq'); yt.removalLagMs = 12_000; } });
    h.yt.pageEdit('PLq', [remove(h, 'c')]);
    await h.settle(60_000);
    expect(h.yt.truth('PLq')).toEqual(['a', 'b', 'd']);
    expect(h.button.count).toBe(3);
  });
});

describe('our own edits', () => {
  it('Add while the list plays: count up at once, panel shows it', async () => {
    const h = await setup({ lists: { PLq: ['a', 'b'] }, profile: PLAYLIST, before: (yt) => yt.load('a', 'PLq') });
    const done = h.ctl.onAdd(['x']);
    await vi.advanceTimersByTimeAsync(1);
    await done;
    await vi.advanceTimersByTimeAsync(1);
    expect(h.button.count).toBe(3);
    await h.settle();
    expect(panelIds(h)).toEqual(['a', 'b', 'x']);
  });

  it('Add while the list is not playing: count up, the panel of what plays is left alone', async () => {
    const h = await setup({ lists: { PLq: ['a'], PLo: ['o1'] }, profile: PLAYLIST, before: (yt) => yt.load('o1', 'PLo') });
    await h.ctl.onAdd(['x']);
    await h.settle();
    expect(h.button.count).toBe(2);
    expect(h.yt.panel?.playlistId).toBe('PLo');
  });

  it('clear all (two batches of 100 and 50): count 0, the panel is synced once', async () => {
    const vids = Array.from({ length: 150 }, (_, i) => `v${i}`);
    const h = await setup({ lists: { PLq: vids }, profile: PLAYLIST, before: (yt) => yt.load('v0', 'PLq') });
    const syncs = h.yt.callsOf('syncList').length;
    const sets = h.yt.entries('PLq').map((e) => e.setVideoId);
    await h.yt.rpc.editPlaylist('PLq', sets.slice(0, 100).map((s) => ({ action: 'ACTION_REMOVE_VIDEO', setVideoId: s })));
    await vi.advanceTimersByTimeAsync(50);
    await h.yt.rpc.editPlaylist('PLq', sets.slice(100).map((s) => ({ action: 'ACTION_REMOVE_VIDEO', setVideoId: s })));
    await h.settle();
    expect(h.button.count).toBe(0);
    expect(h.yt.callsOf('syncList').length - syncs).toBe(1);
  });
});

describe('edits close together', () => {
  it('several page edits within 300 ms: one panel sync, every edit counted', async () => {
    const h = await setup({ lists: { PLq: ['a', 'b', 'c', 'd', 'e'] }, profile: PLAYLIST, before: (yt) => yt.load('a', 'PLq') });
    const syncs = h.yt.callsOf('syncList').length;
    h.yt.pageEdit('PLq', [remove(h, 'b')]);
    await vi.advanceTimersByTimeAsync(50);
    h.yt.pageEdit('PLq', [remove(h, 'c')]);
    await vi.advanceTimersByTimeAsync(50);
    h.yt.pageEdit('PLq', [add('x')]);
    await h.settle();
    expect(h.yt.callsOf('syncList').length - syncs).toBe(1);
    expect(h.button.count).toBe(4);
    expect(panelIds(h)).toEqual(['a', 'd', 'e', 'x']);
  });

  it('added, then removed in the panel as soon as it shows: not counted', async () => {
    const h = await setup({ lists: { PLq: ['a', 'b'] }, profile: PLAYLIST, before: (yt) => yt.load('a', 'PLq') });
    await h.ctl.onAdd(['x']);
    for (let i = 0; i < 100 && !panelIds(h)?.includes('x'); i++) await vi.advanceTimersByTimeAsync(10);
    h.yt.pageEdit('PLq', [remove(h, 'x')]);
    await h.settle();
    expect(h.button.count).toBe(2);
    expect(panelIds(h)).toEqual(['a', 'b']);
  });

  it('edits spread over a few seconds while reads lag: the count tracks every step', async () => {
    const h = await setup({ lists: { PLq: ['a', 'b', 'c', 'd'] }, profile: PLAYLIST, before: (yt) => { yt.load('a', 'PLq'); yt.removalLagMs = 3000; } });
    h.yt.pageEdit('PLq', [remove(h, 'b')]);
    expect(new Set(await counts(h, 2000))).toEqual(new Set([3]));
    h.yt.pageEdit('PLq', [remove(h, 'c')]);
    expect(new Set(await counts(h, 2000))).toEqual(new Set([2]));
    await h.ctl.onAdd(['x']);
    expect(new Set(await counts(h, 15_000))).toEqual(new Set([3]));
    expect(panelIds(h)).toEqual(['a', 'd', 'x']);
  });
});

describe('panel snapshots', () => {
  it('the page showing our list in the panel sets the count', async () => {
    const h = await setup({ lists: { PLq: ['a', 'b', 'c'] }, profile: PLAYLIST });
    h.yt.externalEdit('PLq', [add('x')]);
    h.yt.load('a', 'PLq'); // the page loads it with the list, which reads 4
    await h.settle();
    expect(h.button.count).toBe(4);
  });

  it('another list in the panel does not change the count', async () => {
    const h = await setup({ lists: { PLq: ['a', 'b', 'c'], PLo: ['o1'] }, profile: PLAYLIST });
    h.yt.load('o1', 'PLo');
    await h.settle();
    expect(h.button.count).toBe(3);
  });

  it('a snapshot older than the newest is ignored', async () => {
    const h = await setup({ lists: { PLq: ['a', 'b', 'c'] }, profile: PLAYLIST });
    h.ctl.onPanel('PLq', { rows: [{ videoId: 'a', setVideoId: 's' }], total: 1, at: 0 });
    expect(h.button.count).toBe(3);
  });

  it('the attached panel (this video on top, not in the list) counts only the list', async () => {
    const h = await setup({ lists: { PLq: ['a', 'b'] }, profile: PLAYLIST, before: (yt) => yt.load('v1') });
    await h.ctl.onAdd(['x']);
    await h.settle();
    expect(h.yt.panel?.top).toBe('v1');
    expect(h.button.count).toBe(3);
  });
});

describe('changes made elsewhere (other tab, phone)', () => {
  it('back to the tab after more than 5 s: reads again, count and panel catch up', async () => {
    const h = await setup({ lists: { PLq: ['a', 'b'] }, profile: PLAYLIST, before: (yt) => yt.load('a', 'PLq') });
    h.setVisible(false);
    h.yt.externalEdit('PLq', [add('x')]);
    await vi.advanceTimersByTimeAsync(6000);
    h.setVisible(true);
    await h.settle();
    expect(h.button.count).toBe(3);
    expect(panelIds(h)).toEqual(['a', 'b', 'x']);
  });

  it('back within 5 s of the last read: no read', async () => {
    const h = await setup({ lists: { PLq: ['a', 'b'] }, profile: PLAYLIST });
    await h.ctl.refresh();
    const reads = h.yt.callsOf('readPlaylist').length;
    h.setVisible(false);
    h.setVisible(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.yt.callsOf('readPlaylist')).toHaveLength(reads);
  });

  it('the list unchanged: the panel is left alone', async () => {
    const h = await setup({ lists: { PLq: ['a', 'b'] }, profile: PLAYLIST, before: (yt) => yt.load('a', 'PLq') });
    await h.settle(10_000);
    const syncs = h.yt.callsOf('syncList').length;
    h.setVisible(false);
    h.setVisible(true);
    await h.settle();
    expect(h.yt.callsOf('syncList')).toHaveLength(syncs);
  });

  // Findings F5, fixed 2026-11-21.
  it('the list deleted elsewhere: noticed on the way back to the tab', async () => {
    const h = await setup({ lists: { PLq: ['a', 'b'] }, profile: PLAYLIST });
    h.yt.deleteList('PLq');
    await vi.advanceTimersByTimeAsync(6000);
    h.setVisible(false);
    h.setVisible(true);
    await h.settle();
    expect(h.ctl.decision).toBe('noList');
    expect(h.button.visible).toBe(false);
  });
});

describe('a list just created (findings F16)', () => {
  it('reads as missing for a moment: the choice is kept and the list is used', async () => {
    const h = await setup({ profile: { mode: 'playlist', removeWatched: true } });
    h.yt.newListLagMs = 1500;
    // The settings page creates a list and chooses it.
    const id = await h.yt.rpc.createPrivatePlaylist('New');
    await h.setProfile({ listId: id, listName: 'New' });
    await h.settle();
    expect((await h.profile())?.listId).toBe(id);
    expect(h.ctl.decision).toBe('take');
    expect(h.toasts).toHaveLength(0);
  });

  it('still gone after the re-reads: the choice is cleared', async () => {
    const h = await setup({ profile: { mode: 'playlist', removeWatched: true } });
    await h.setProfile({ listId: 'PLnone', listName: 'Gone' });
    await h.settle();
    expect((await h.profile())?.listId).toBeUndefined();
    expect(h.ctl.decision).toBe('noList');
  });
});

describe('sync failures stay quiet', () => {
  it('a failed read during the recount keeps the count from the edit', async () => {
    const h = await setup({ lists: { PLq: ['a', 'b'] }, profile: PLAYLIST });
    h.yt.fail('readPlaylist', new Error('net'), 5);
    h.yt.pageEdit('PLq', [add('x')]);
    await h.settle();
    expect(h.button.count).toBe(3);
    expect(h.toasts).toHaveLength(0);
  });

  it('the page script not answering (syncList hangs) does not block the count', async () => {
    const h = await setup({ lists: { PLq: ['a', 'b'] }, profile: PLAYLIST, before: (yt) => yt.load('a', 'PLq') });
    h.yt.fail('syncList', 'hang');
    h.yt.pageEdit('PLq', [add('x')]);
    await h.settle();
    expect(h.button.count).toBe(3);
  });
});
