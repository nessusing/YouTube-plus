// @vitest-environment happy-dom
// QueueController: switching mode in a tab that is already open (§24.6).
// Agreed 2026-11-20: the switch takes effect in open tabs at once; switching to
// the native queue, the extension leaves everything alone (Q1 "完全不管"),
// even when the page then adds straight into our list playing.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '@/core/i18n';
import type { QueueProfile } from '@/features/queue/core';
import type { FakeYouTube } from '../../../support/fake-youtube';
import { setup, type Harness } from '../../../support/queue-harness';

vi.mock('@/features/queue/toast', () => import('../../../support/toasts'));

beforeEach(() => vi.useFakeTimers({ now: 1_000_000 }));
afterEach(() => vi.useRealTimers());

const LISTS = { PLq: ['a', 'b', 'c'], PLr: ['r1', 'r2'] };
const NATIVE: Partial<QueueProfile> = { mode: 'native', listId: 'PLq', listName: 'List PLq', removeWatched: true };
const PLAYLIST: Partial<QueueProfile> = { mode: 'playlist', listId: 'PLq', listName: 'List PLq', removeWatched: true };

/** Starting states of the matrix. */
const STATES: Record<string, (yt: FakeYouTube) => void> = {
  '① nothing playing': () => {},
  '② a single video in the miniplayer': (yt) => yt.load('v1', undefined, { mini: true }),
  '③ the native queue in the miniplayer': (yt) => yt.playNativeQueue(['v1', 'q1', 'q2']),
  '④ our list playing': (yt) => yt.load('a', 'PLq'),
};

async function switchTo(h: Harness, p: Partial<QueueProfile>): Promise<void> {
  await h.setProfile(p);
  await h.settle();
}

function expectTaking(h: Harness, count: number, name = 'List PLq'): void {
  expect(h.ctl.decision).toBe('take');
  expect(h.yt.takeover).toEqual({ decision: 'take', label: t('queue.addTo', { name }) });
  expect(h.button).toMatchObject({ visible: true, name, count });
}

function expectNative(h: Harness): void {
  expect(h.ctl.decision).toBe('native');
  expect(h.yt.takeover.decision).toBe('native');
  expect(h.button.visible).toBe(false);
}

describe.each(Object.entries(STATES))('native → playlist, from %s', (_name, state) => {
  it('takes over at once, shows the button, says a reload completes it', async () => {
    const h = await setup({ lists: LISTS, profile: NATIVE, before: state });
    const panelBefore = h.yt.panel;
    const playerBefore = { ...h.yt.player };
    await switchTo(h, { mode: 'playlist' });
    expectTaking(h, 3);
    expect(h.toasts.map((x) => x.text)).toEqual([t('queue.switchedPlaylist')]);
    // Switching alone attaches nothing and moves nothing.
    expect(h.yt.panel).toEqual(panelBefore);
    expect(h.yt.player).toEqual(playerBefore);
    expect(h.yt.navigations).toEqual([]);
  });

  it('then Add goes into the list', async () => {
    const h = await setup({ lists: LISTS, profile: NATIVE, before: state });
    await switchTo(h, { mode: 'playlist' });
    await h.ctl.onAdd(['x']);
    await h.settle();
    expect(h.yt.truth('PLq')).toEqual(['a', 'b', 'c', 'x']);
    expect(h.button.count).toBe(4);
  });
});

describe('native → playlist, what is playing afterwards', () => {
  it('② single video: Add attaches the list under the miniplayer', async () => {
    const h = await setup({ lists: LISTS, profile: NATIVE, before: STATES['② a single video in the miniplayer'] });
    await switchTo(h, { mode: 'playlist' });
    await h.ctl.onAdd(['x']);
    await h.settle();
    expect(h.yt.panel).toMatchObject({ playlistId: 'PLq', top: 'v1' });
  });

  // F8: docs/queue-test-findings.md
  it.fails('③ native queue: Add leaves the native queue playing', async () => {
    const h = await setup({ lists: LISTS, profile: NATIVE, before: STATES['③ the native queue in the miniplayer'] });
    await switchTo(h, { mode: 'playlist' });
    await h.ctl.onAdd(['x']);
    await h.settle();
    expect(h.yt.panel?.playlistId).toBe('TLPQabc');
    expect(h.yt.player.playlistId).toBeUndefined();
    // Its videos ending is none of our business.
    h.ctl.onPlayer(h.yt.playerEvent('ended'));
    await h.settle();
    expect(h.yt.navigations).toEqual([]);
  });

  it('④ our list already playing: from now on a watched entry is removed and the next one played', async () => {
    const h = await setup({ lists: LISTS, profile: NATIVE, before: STATES['④ our list playing'] });
    await switchTo(h, { mode: 'playlist' });
    h.ctl.onPlayer(h.yt.playerEvent('ended'));
    await h.settle();
    expect(h.yt.navigations).toEqual(['/watch?v=b&list=PLq']);
    expect(h.yt.truth('PLq')).toEqual(['b', 'c']);
    expect(h.button.count).toBe(2);
  });
});

describe.each(Object.entries(STATES))('playlist → native, from %s', (_name, state) => {
  it('stops taking over at once, hides the button, says a reload completes it', async () => {
    const h = await setup({ lists: LISTS, profile: PLAYLIST, before: state });
    expectTaking(h, 3);
    await switchTo(h, { mode: 'native' });
    expectNative(h);
    expect(h.toasts.map((x) => x.text)).toEqual([t('queue.switchedNative')]);
  });

  it('then Add is left to YouTube', async () => {
    const h = await setup({ lists: LISTS, profile: PLAYLIST, before: state });
    await switchTo(h, { mode: 'native' });
    await h.ctl.onAdd(['x']);
    await h.settle();
    expect(h.yt.truth('PLq')).toEqual(['a', 'b', 'c']);
  });
});

describe('playlist → native while our list plays (④): the extension keeps out', () => {
  it('a watched entry is neither removed nor skipped past', async () => {
    const h = await setup({ lists: LISTS, profile: PLAYLIST, before: STATES['④ our list playing'] });
    await switchTo(h, { mode: 'native' });
    h.ctl.onPlayer(h.yt.playerEvent('near'));
    h.ctl.onPlayer(h.yt.playerEvent('ended'));
    await h.settle();
    expect(h.yt.navigations).toEqual([]);
    expect(h.yt.truth('PLq')).toEqual(['a', 'b', 'c']);
    expect(h.yt.armed).toBeUndefined();
  });

  // F1: docs/queue-test-findings.md
  it.fails('an unload removal armed before the switch is disarmed', async () => {
    const h = await setup({ lists: LISTS, profile: PLAYLIST, before: STATES['④ our list playing'] });
    h.ctl.onPlayer(h.yt.playerEvent('near'));
    await h.settle();
    expect(h.yt.armed).toMatchObject({ listId: 'PLq', videoId: 'a' });
    await switchTo(h, { mode: 'native' });
    // Closing the tab now would still remove 'a' from the list behind the user's back.
    expect(h.yt.armed).toBeUndefined();
  });

  it('the page adding straight into the list playing is left alone (native behaviour)', async () => {
    const h = await setup({ lists: LISTS, profile: PLAYLIST, before: STATES['④ our list playing'] });
    await switchTo(h, { mode: 'native' });
    const syncs = h.yt.callsOf('syncList').length;
    h.yt.pageEdit('PLq', [{ action: 'ACTION_ADD_VIDEO', addedVideoId: 'x' }]);
    await h.settle();
    expect(h.yt.callsOf('syncList')).toHaveLength(syncs);
    expect(h.button.visible).toBe(false);
  });
});

describe('back to playlist mode after edits made meanwhile', () => {
  it('an add made while native shows in the count when switching back within 30 s', async () => {
    const h = await setup({ lists: LISTS, profile: PLAYLIST, before: STATES['④ our list playing'] });
    await switchTo(h, { mode: 'native' });
    h.yt.pageEdit('PLq', [{ action: 'ACTION_ADD_VIDEO', addedVideoId: 'x' }]);
    await vi.advanceTimersByTimeAsync(1000);
    await switchTo(h, { mode: 'playlist' });
    expectTaking(h, 4);
  });

  // F4: docs/queue-test-findings.md
  it.fails('a removal made while native shows in the count when switching back, even while reads lag', async () => {
    const h = await setup({ lists: LISTS, profile: PLAYLIST, before: (yt) => { STATES['④ our list playing']!(yt); yt.removalLagMs = 4000; } });
    await switchTo(h, { mode: 'native' });
    const b = h.yt.entries('PLq').find((e) => e.videoId === 'b')!;
    h.yt.pageEdit('PLq', [{ action: 'ACTION_REMOVE_VIDEO', setVideoId: b.setVideoId }]);
    await vi.advanceTimersByTimeAsync(1000);
    await switchTo(h, { mode: 'playlist' });
    expect(h.yt.truth('PLq')).toEqual(['a', 'c']);
    expect(h.button.count).toBe(2);
  });

  // F3: docs/queue-test-findings.md
  it.fails('edits made in playlist mode do not linger into a later switch back', async () => {
    const h = await setup({ lists: LISTS, profile: PLAYLIST });
    await h.ctl.onAdd(['x']);
    await vi.advanceTimersByTimeAsync(500);
    await switchTo(h, { mode: 'native' });
    // Removed elsewhere while this tab is native.
    const x = h.yt.entries('PLq').find((e) => e.videoId === 'x')!;
    h.yt.externalEdit('PLq', [{ action: 'ACTION_REMOVE_VIDEO', setVideoId: x.setVideoId }]);
    await switchTo(h, { mode: 'playlist' });
    expect(h.button.count).toBe(3);
  });
});

describe('list A → list B', () => {
  it('the button and label follow the new list', async () => {
    const h = await setup({ lists: LISTS, profile: PLAYLIST });
    await switchTo(h, { listId: 'PLr', listName: 'List PLr' });
    expectTaking(h, 2, 'List PLr');
    expect(h.toasts).toHaveLength(0); // same mode: no reload hint
  });

  it('A playing: its entries ending are no longer ours to remove', async () => {
    const h = await setup({ lists: LISTS, profile: PLAYLIST, before: STATES['④ our list playing'] });
    await switchTo(h, { listId: 'PLr', listName: 'List PLr' });
    h.ctl.onPlayer(h.yt.playerEvent('ended'));
    await h.settle();
    expect(h.yt.truth('PLq')).toEqual(['a', 'b', 'c']);
    expect(h.yt.navigations).toEqual([]);
  });

  // F2: docs/queue-test-findings.md
  it.fails('edits and panel updates of A do not touch B\'s count', async () => {
    const h = await setup({ lists: LISTS, profile: PLAYLIST, before: STATES['④ our list playing'] });
    await h.ctl.onAdd(['x']);
    await vi.advanceTimersByTimeAsync(100);
    await switchTo(h, { listId: 'PLr', listName: 'List PLr' });
    h.yt.pageEdit('PLq', [{ action: 'ACTION_ADD_VIDEO', addedVideoId: 'y' }]);
    await h.settle();
    expect(h.button.count).toBe(2);
  });

  it('to a list that is gone: forgets it, stops taking over', async () => {
    const h = await setup({ lists: LISTS, profile: PLAYLIST });
    await switchTo(h, { listId: 'PLgone', listName: 'Gone' });
    expect(h.ctl.decision).toBe('noList');
    expect(h.button.visible).toBe(false);
    expect(h.yt.takeover.decision).toBe('noList');
  });
});

describe('switching quickly back and forth', () => {
  it('native → playlist → native: ends native', async () => {
    const h = await setup({ lists: LISTS, profile: NATIVE });
    await h.setProfile({ mode: 'playlist' });
    await vi.advanceTimersByTimeAsync(0);
    await h.setProfile({ mode: 'native' });
    await h.settle();
    expectNative(h);
  });

  it('playlist → native → playlist: ends taking over with the right count', async () => {
    const h = await setup({ lists: LISTS, profile: PLAYLIST });
    await h.setProfile({ mode: 'native' });
    await vi.advanceTimersByTimeAsync(0);
    await h.setProfile({ mode: 'playlist' });
    await h.settle();
    expectTaking(h, 3);
  });

  it('with slow reads: the last choice wins', async () => {
    const h = await setup({ lists: LISTS, profile: NATIVE });
    const read = h.yt.rpc.editablePlaylists;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    h.yt.rpc.editablePlaylists = async () => {
      await gate;
      return read();
    };
    await h.setProfile({ mode: 'playlist' });
    await vi.advanceTimersByTimeAsync(10);
    await h.setProfile({ mode: 'native' });
    await vi.advanceTimersByTimeAsync(10);
    release();
    await h.settle();
    expectNative(h);
  });
});

describe('other settings changes', () => {
  it('turning remove-after-playing off applies at once, without a reload hint', async () => {
    const h = await setup({ lists: LISTS, profile: PLAYLIST, before: STATES['④ our list playing'] });
    await switchTo(h, { removeWatched: false });
    expect(h.toasts).toHaveLength(0);
    h.ctl.onPlayer(h.yt.playerEvent('ended'));
    await h.settle();
    expect(h.yt.truth('PLq')).toEqual(['a', 'b', 'c']);
    expect(h.yt.navigations).toEqual([]);
  });

  it('switched while the tab is in the background: the hint waits until it is visible', async () => {
    const h = await setup({ lists: LISTS, profile: NATIVE });
    h.setVisible(false);
    await switchTo(h, { mode: 'playlist' });
    expect(h.toasts).toHaveLength(0);
    expect(h.ctl.decision).toBe('take');
    h.setVisible(true);
    await h.settle();
    expect(h.toasts.map((x) => x.text)).toEqual([t('queue.switchedPlaylist')]);
  });

  it('switched twice in the background: one hint, for the mode it ended in', async () => {
    const h = await setup({ lists: LISTS, profile: NATIVE });
    h.setVisible(false);
    await switchTo(h, { mode: 'playlist' });
    await switchTo(h, { mode: 'native' });
    h.setVisible(true);
    await h.settle();
    expect(h.toasts.map((x) => x.text)).toEqual([t('queue.switchedNative')]);
  });

  it('to playlist mode with no list chosen: the first Add says so', async () => {
    const h = await setup({ lists: LISTS, profile: { mode: 'native' } });
    await switchTo(h, { mode: 'playlist' });
    expect(h.ctl.decision).toBe('noList');
    h.ctl.onNativeAdd();
    expect(h.toasts.at(-1)?.text).toBe(t('queue.noList'));
  });
});
