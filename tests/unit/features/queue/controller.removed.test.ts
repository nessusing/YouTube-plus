// @vitest-environment happy-dom
// Clear all / Remove watched from the official ⋮ menus (F-06) and dragging an
// entry out of the panel (F-06): what gets removed, what the notice says, and
// the entry playing removed while it plays.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '@/core/i18n';
import { playlistTools } from '@/features/queue/playlist-tools';
import { setup, type Harness } from '../../../support/queue-harness';

vi.mock('@/core/notify', () => import('../../../support/toasts'));

beforeEach(() => vi.useFakeTimers({ now: 1_000_000 }));
afterEach(() => vi.useRealTimers());

const PLAYLIST = { mode: 'playlist' as const, listId: 'PLq', listName: 'List PLq', removeWatched: true };
const LISTS = { PLq: ['a', 'b', 'c', 'd'] };

/** The tools wired to the controller the way index.ts does it. */
function toolsFor(h: Harness) {
  const tools = playlistTools(h.yt.rpc, h.log, (listId, before, removed, playing) => h.ctl.noteRemoved(listId, before, removed, playing));
  tools.enable();
  return tools;
}

/** An entry dragged out of the panel and removed, as the page script reports it. */
async function dropOut(h: Harness, videoId: string, ok = true) {
  const before = h.yt.entries('PLq');
  const entry = before.find((e) => e.videoId === videoId)!;
  if (ok) h.yt.pageEdit('PLq', [{ action: 'ACTION_REMOVE_VIDEO', setVideoId: entry.setVideoId }]);
  await h.ctl.onDropped({ listId: 'PLq', setVideoId: entry.setVideoId, videoId, ok, error: ok ? undefined : 'HTTP 500', before });
}

describe('the menus', () => {
  it('F-06-AC1 while taking over, the page script knows the chosen list (its panels get the items)', async () => {
    const h = await setup({ lists: LISTS, profile: PLAYLIST });
    expect(h.yt.takeover).toMatchObject({ decision: 'take', listId: 'PLq' });
    await h.setProfile({ mode: 'native' });
    await h.settle();
    expect(h.yt.takeover.listId).toBeUndefined();
  });

  it('F-06-AC1 the labels go to the page script when the tools start', async () => {
    const h = await setup({ lists: LISTS, profile: PLAYLIST });
    toolsFor(h);
    await h.settle();
    expect(h.yt.menu.labels).toEqual({ clearAll: t('queue.clearAll'), removeWatched: t('queue.removeWatched'), dropToDelete: t('queue.dropToDelete') });
  });
});

describe('clear all / remove watched (F-06)', () => {
  it('F-06-AC2 clear all: everything goes at once, no confirm, a notice says how many', async () => {
    const h = await setup({ lists: LISTS, profile: PLAYLIST });
    const tools = toolsFor(h);
    await tools.run('all', 'PLq');
    await h.settle();
    expect(h.yt.truth('PLq')).toEqual([]);
    expect(h.toasts.at(-1)).toEqual({ text: t('queue.deleted', { n: 4 }) });
    expect(h.button.count).toBe(0);
  });

  it('F-06-AC2 remove watched: only entries watched to 90 % or more', async () => {
    const h = await setup({ lists: LISTS, profile: PLAYLIST, before: (yt) => { yt.watched('PLq', 'a', 95); yt.watched('PLq', 'c', 90); yt.watched('PLq', 'd', 89); } });
    const tools = toolsFor(h);
    await tools.run('watched', 'PLq');
    await h.settle();
    expect(h.yt.truth('PLq')).toEqual(['b', 'd']);
    expect(h.toasts.at(-1)?.text).toBe(t('queue.deleted', { n: 2 }));
  });

  it('F-06-AC2 nothing to remove: says so', async () => {
    const h = await setup({ lists: LISTS, profile: PLAYLIST });
    const tools = toolsFor(h);
    await tools.run('watched', 'PLq');
    expect(h.toasts.at(-1)?.text).toBe(t('queue.nothing'));
    expect(h.yt.callsOf('editPlaylist')).toEqual([]);
  });

  it('F-06-AC2 F-05-AC15 a failed batch: the notice and the log say so, no retry (F-05-AC15)', async () => {
    const h = await setup({ lists: LISTS, profile: PLAYLIST });
    const tools = toolsFor(h);
    h.yt.editStatus = 500;
    await tools.run('all', 'PLq');
    expect(h.yt.truth('PLq')).toEqual(['a', 'b', 'c', 'd']);
    expect(h.toasts.at(-1)).toEqual({ text: t('queue.failed'), error: true });
    expect(h.log.lines.some((l) => l.level === 'warn' && l.msg.includes('clear all'))).toBe(true);
    expect(h.yt.callsOf('editPlaylist')).toHaveLength(1);
  });
});

describe('the entry playing removed (F-06)', () => {
  it('F-06-AC3 remove watched takes the one playing: it plays on, then the entry after it', async () => {
    const h = await setup({ lists: LISTS, profile: PLAYLIST, before: (yt) => { yt.load('b', 'PLq'); yt.watched('PLq', 'a', 100); yt.watched('PLq', 'b', 95); } });
    const tools = toolsFor(h);
    await tools.run('watched', 'PLq');
    await h.settle();
    expect(h.yt.truth('PLq')).toEqual(['c', 'd']);
    expect(h.yt.navigations).toEqual([]);
    h.ctl.onPlayer(h.yt.playerEvent('ended'));
    await h.settle();
    expect(h.yt.navigations).toEqual(['/watch?v=c&list=PLq']);
    // Nothing more removed: c is up next, not watched.
    expect(h.yt.truth('PLq')).toEqual(['c', 'd']);
  });

  it('F-06-AC3 clear all while playing: when it ends, YouTube decides what is next', async () => {
    const h = await setup({ lists: LISTS, profile: PLAYLIST, before: (yt) => yt.load('b', 'PLq') });
    const tools = toolsFor(h);
    await tools.run('all', 'PLq');
    await h.settle();
    h.ctl.onPlayer(h.yt.playerEvent('ended'));
    await h.settle();
    expect(h.yt.navigations).toEqual([]);
  });

  it('F-06-AC3 cleared, then something added: that plays next', async () => {
    const h = await setup({ lists: LISTS, profile: PLAYLIST, before: (yt) => yt.load('b', 'PLq') });
    const tools = toolsFor(h);
    await tools.run('all', 'PLq');
    await h.settle();
    h.yt.externalEdit('PLq', [{ action: 'ACTION_ADD_VIDEO', addedVideoId: 'x' }]);
    h.ctl.onPlayer(h.yt.playerEvent('ended'));
    await h.settle();
    expect(h.yt.navigations).toEqual(['/watch?v=x&list=PLq']);
  });

  it('F-06-AC3 dragged out while playing, remove after playing off: still the entry after it', async () => {
    const h = await setup({ lists: LISTS, profile: { ...PLAYLIST, removeWatched: false }, before: (yt) => yt.load('b', 'PLq') });
    await dropOut(h, 'b');
    await h.settle();
    expect(h.yt.truth('PLq')).toEqual(['a', 'c', 'd']);
    h.ctl.onPlayer(h.yt.playerEvent('ended'));
    await h.settle();
    expect(h.yt.navigations).toEqual(['/watch?v=c&list=PLq']);
  });

  it('F-06-AC3 a different entry dragged out: the one playing carries on as usual', async () => {
    const h = await setup({ lists: LISTS, profile: PLAYLIST, before: (yt) => yt.load('b', 'PLq') });
    await dropOut(h, 'c');
    await h.settle();
    h.ctl.onPlayer(h.yt.playerEvent('ended'));
    await h.settle();
    expect(h.yt.navigations).toEqual(['/watch?v=d&list=PLq']);
    expect(h.yt.truth('PLq')).toEqual(['a', 'd']);
  });

  it('F-06-AC3 the next video starts: what was known about the removed one is dropped', async () => {
    const h = await setup({ lists: LISTS, profile: { ...PLAYLIST, removeWatched: false }, before: (yt) => yt.load('b', 'PLq') });
    await dropOut(h, 'b');
    h.yt.load('c', 'PLq');
    h.ctl.onPlayer(h.yt.playerEvent('ended'));
    await h.settle();
    // Remove after playing is off and c was not removed: left to YouTube.
    expect(h.yt.navigations).toEqual([]);
  });
});

describe('drag out to delete (F-06)', () => {
  it('F-06-AC5 failed: a notice and the log say so; nothing else changes', async () => {
    const h = await setup({ lists: LISTS, profile: PLAYLIST, before: (yt) => yt.load('b', 'PLq') });
    await dropOut(h, 'c', false);
    expect(h.toasts.at(-1)).toEqual({ text: t('queue.dropFailed'), error: true });
    expect(h.log.lines.some((l) => l.level === 'warn' && l.msg.includes('drag out'))).toBe(true);
    expect(h.yt.truth('PLq')).toEqual(['a', 'b', 'c', 'd']);
  });

  it('F-06-AC5 F-05-AC13 succeeded: no notice; the count follows', async () => {
    const h = await setup({ lists: LISTS, profile: PLAYLIST });
    const before = h.toasts.length;
    await dropOut(h, 'c');
    await h.settle();
    expect(h.toasts.length).toBe(before);
    expect(h.button.count).toBe(3);
  });
});
