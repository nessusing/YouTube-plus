// @vitest-environment happy-dom
// QueueController: when to take over (§24.1, §24.5, §24.7, §26) and Add (§24.2).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { t } from '@/core/i18n';
import { PROFILE_PREFIX, PROTOCOL_ERROR_KEY } from '@/features/queue/keys';
import { setup } from '../../../support/queue-harness';

vi.mock('@/features/queue/toast', () => import('../../../support/toasts'));

beforeEach(() => vi.useFakeTimers({ now: 1_000_000 }));
afterEach(() => vi.useRealTimers());

const LISTS = { PLq: ['a', 'b', 'c'] };
const PLAYLIST = { mode: 'playlist' as const, listId: 'PLq', listName: 'List PLq' };

describe('deciding to take over (§24.1)', () => {
  it('native mode: leaves Add to queue alone and shows no button', async () => {
    const h = await setup({ lists: LISTS, profile: { mode: 'native', listId: 'PLq' } });
    expect(h.ctl.decision).toBe('native');
    expect(h.yt.takeover.decision).toBe('native');
    expect(h.button.visible).toBe(false);
    expect(h.tools.on).toBe(true); // clear all / remove watched work in both modes (§25)
  });

  it('playlist mode with an editable list: takes over, relabels, shows the count', async () => {
    const h = await setup({ lists: LISTS, profile: PLAYLIST });
    expect(h.ctl.decision).toBe('take');
    expect(h.yt.takeover).toEqual({ decision: 'take', label: t('queue.addTo', { name: 'List PLq' }) });
    expect(h.button).toMatchObject({ visible: true, name: 'List PLq', count: 3 });
  });

  it('no list chosen: native this time, says why once per page', async () => {
    const h = await setup({ lists: LISTS, profile: { mode: 'playlist' } });
    expect(h.ctl.decision).toBe('noList');
    expect(h.yt.takeover.decision).toBe('noList');
    h.ctl.onNativeAdd();
    h.ctl.onNativeAdd();
    expect(h.toasts.map((x) => x.text)).toEqual([t('queue.noList')]);
  });

  it('list this identity cannot edit: native, keeps the choice, says why', async () => {
    const h = await setup({ before: (yt) => yt.addList('PLx', 'Theirs', ['a'], false), profile: { mode: 'playlist', listId: 'PLx', listName: 'Theirs' } });
    expect(h.ctl.decision).toBe('notEditable');
    expect((await h.profile())?.listId).toBe('PLx');
    h.ctl.onNativeAdd();
    expect(h.toasts[0]?.text).toBe(t('queue.notEditable', { name: 'Theirs' }));
  });

  it('list deleted elsewhere: forgets it for this identity (§24.5)', async () => {
    const h = await setup({ lists: {}, profile: { mode: 'playlist', listId: 'PLgone', listName: 'Old' } });
    expect(h.ctl.decision).toBe('noList');
    const p = await h.profile();
    expect(p?.listId).toBeUndefined();
    expect(p?.listName).toBeUndefined();
  });

  it('no playlists listed at all: protocol error, back to native, reported for the settings page (§26)', async () => {
    const h = await setup({ lists: LISTS, profile: PLAYLIST, before: (yt) => (yt.protocolBroken = true) });
    expect(h.ctl.decision).toBe('native');
    expect((await fakeBrowser.storage.local.get(PROTOCOL_ERROR_KEY))[PROTOCOL_ERROR_KEY]).toBeTruthy();
    expect(h.log.lines.some((l) => l.level === 'error')).toBe(true);
  });

  it('signed out: native, playlist tools off, no button', async () => {
    const h = await setup({ lists: LISTS, profile: PLAYLIST, before: (yt) => (yt.me = { loggedIn: false, brand: false }) });
    expect(h.ctl.decision).toBe('native');
    expect(h.tools.on).toBe(false);
    expect(h.button.visible).toBe(false);
  });

  it('queue feature turned off: native', async () => {
    const h = await setup({ lists: LISTS, profile: PLAYLIST, start: false });
    h.feature.on = false;
    await h.ctl.refresh();
    expect(h.ctl.decision).toBe('native');
    expect(h.tools.on).toBe(false);
  });

  it('list could not be checked (read failed): does not take over, keeps the choice', async () => {
    const h = await setup({ lists: LISTS, profile: PLAYLIST, before: (yt) => yt.fail('editablePlaylists') });
    expect(h.ctl.decision).toBe('native');
    expect((await h.profile())?.listId).toBe('PLq');
  });

  it('takes the list title from the server when it was renamed', async () => {
    const h = await setup({ lists: LISTS, profile: { ...PLAYLIST, listName: 'Old name' } });
    expect((await h.profile())?.listName).toBe('List PLq');
    expect(h.button.name).toBe('List PLq');
  });
});

describe('identities (§24.7)', () => {
  it('each identity keeps its own settings; switching reads the new one', async () => {
    const h = await setup({ lists: LISTS, profile: PLAYLIST });
    expect(h.ctl.decision).toBe('take');
    h.yt.me = { loggedIn: true, key: 'other', name: 'Other', brand: true };
    await h.ctl.refresh();
    await h.settle();
    expect(h.ctl.decision).toBe('native'); // the other identity has no settings yet
    expect(h.button.visible).toBe(false);
    // The first identity's settings are untouched.
    expect((await fakeBrowser.storage.sync.get(`${PROFILE_PREFIX}me`))[`${PROFILE_PREFIX}me`]).toMatchObject({ mode: 'playlist', listId: 'PLq' });
  });

  it('after switching identity, changes to the old identity no longer apply here', async () => {
    const h = await setup({ lists: LISTS, profile: PLAYLIST });
    h.yt.me = { loggedIn: true, key: 'other', brand: false };
    await h.ctl.refresh();
    await h.settle();
    await fakeBrowser.storage.sync.set({ [`${PROFILE_PREFIX}me`]: { mode: 'native', removeWatched: true } });
    await h.settle();
    expect(h.toasts).toHaveLength(0);
    expect(h.ctl.profile.mode).toBe('native'); // the other identity's default
  });
});

describe('Add (§24.2)', () => {
  it('adds a new video, says so, counts it', async () => {
    const h = await setup({ lists: LISTS, profile: PLAYLIST });
    await h.ctl.onAdd(['x']);
    await h.settle();
    expect(h.yt.truth('PLq')).toEqual(['a', 'b', 'c', 'x']);
    expect(h.toasts.at(-1)).toEqual({ text: t('queue.added', { name: 'List PLq' }), action: t('queue.view') });
    expect(h.button.count).toBe(4);
  });

  it('a video already in the list is not added again (the server would duplicate it)', async () => {
    const h = await setup({ lists: LISTS, profile: PLAYLIST });
    await h.ctl.onAdd(['b']);
    await h.settle();
    expect(h.yt.truth('PLq')).toEqual(['a', 'b', 'c']);
    expect(h.yt.callsOf('editPlaylist')).toHaveLength(0);
    expect(h.toasts.at(-1)?.text).toBe(t('queue.already', { name: 'List PLq' }));
  });

  it('several at once: only the new ones are added', async () => {
    const h = await setup({ lists: LISTS, profile: PLAYLIST });
    await h.ctl.onAdd(['b', 'x', 'y']);
    await h.settle();
    expect(h.yt.truth('PLq')).toEqual(['a', 'b', 'c', 'x', 'y']);
    expect(h.button.count).toBe(5);
  });

  it('nothing playing: no list is attached', async () => {
    const h = await setup({ lists: LISTS, profile: PLAYLIST });
    await h.ctl.onAdd(['x']);
    await h.settle();
    expect(h.yt.panel).toBeUndefined();
  });

  it('watching a video outside any list: the list shows next to it, this video on top', async () => {
    const h = await setup({ lists: LISTS, profile: PLAYLIST, before: (yt) => yt.load('v1') });
    await h.ctl.onAdd(['x']);
    await h.settle();
    expect(h.yt.panel).toMatchObject({ playlistId: 'PLq', top: 'v1' });
    expect(h.yt.panel?.rows.map((r) => r.videoId)).toEqual(['a', 'b', 'c', 'x']);
    expect(h.yt.navigations).toEqual([]); // no reload
  });

  it('same in the miniplayer', async () => {
    const h = await setup({ lists: LISTS, profile: PLAYLIST, before: (yt) => yt.load('v1', undefined, { mini: true }) });
    await h.ctl.onAdd(['x']);
    await h.settle();
    expect(h.yt.panel).toMatchObject({ playlistId: 'PLq', top: 'v1' });
    expect(h.yt.navigations).toEqual([]);
  });

  it('already in the list while watching outside it: still attaches', async () => {
    const h = await setup({ lists: LISTS, profile: PLAYLIST, before: (yt) => yt.load('v1') });
    await h.ctl.onAdd(['a']);
    await h.settle();
    expect(h.yt.panel).toMatchObject({ playlistId: 'PLq', top: 'v1' });
  });

  it('another list playing: leaves it, the toast is all', async () => {
    const h = await setup({ lists: { ...LISTS, PLo: ['o1', 'o2'] }, profile: PLAYLIST, before: (yt) => yt.load('o1', 'PLo') });
    await h.settle();
    await h.ctl.onAdd(['x']);
    await h.settle();
    expect(h.yt.panel?.playlistId).toBe('PLo');
    expect(h.yt.player.playlistId).toBe('PLo');
  });

  // F8: docs/queue-test-findings.md
  it.fails('the native queue playing in the miniplayer: leaves it', async () => {
    const h = await setup({ lists: LISTS, profile: PLAYLIST, before: (yt) => yt.playNativeQueue(['v1', 'q1', 'q2']) });
    await h.ctl.onAdd(['x']);
    await h.settle();
    expect(h.yt.panel?.playlistId).toBe('TLPQabc');
    expect(h.yt.panel?.rows.map((r) => r.videoId)).toEqual(['v1', 'q1', 'q2']);
  });

  it('during an ad: does not attach', async () => {
    const h = await setup({ lists: LISTS, profile: PLAYLIST, before: (yt) => { yt.load('v1'); yt.player.ad = true; } });
    await h.ctl.onAdd(['x']);
    await h.settle();
    expect(h.yt.panel).toBeUndefined();
  });

  it('the list itself playing: the panel shows the new video', async () => {
    const h = await setup({ lists: LISTS, profile: PLAYLIST, before: (yt) => yt.load('a', 'PLq') });
    await h.ctl.onAdd(['x']);
    await h.settle();
    expect(h.yt.panel?.rows.map((r) => r.videoId)).toEqual(['a', 'b', 'c', 'x']);
  });

  it('no playlist manager, on the watch page: reloads inside the list and plays the list after this video', async () => {
    const h = await setup({ lists: LISTS, profile: { ...PLAYLIST, removeWatched: false }, before: (yt) => { yt.playlistManager = false; yt.load('v1'); } });
    await h.ctl.onAdd(['x']);
    await h.settle();
    expect(h.yt.navigations).toEqual(['/watch?v=v1&list=PLq']);
    // The player sits on index 0 and its autoplay would skip 'a': we go there ourselves.
    h.ctl.onPlayer(h.yt.playerEvent('ended', { videoId: 'v1', playlistId: 'PLq', index: 0 }));
    await h.settle();
    expect(h.yt.navigations.at(-1)).toBe('/watch?v=a&list=PLq');
    expect(h.yt.truth('PLq')).toEqual(['a', 'b', 'c', 'x']); // nothing removed with remove-after-playing off
  });

  it('no playlist manager, in the miniplayer: does not reload (it would expand)', async () => {
    const h = await setup({ lists: LISTS, profile: PLAYLIST, before: (yt) => { yt.playlistManager = false; yt.load('v1', undefined, { mini: true }); } });
    await h.ctl.onAdd(['x']);
    await h.settle();
    expect(h.yt.navigations).toEqual([]);
  });

  it('add fails: says so, no retry', async () => {
    const h = await setup({ lists: LISTS, profile: PLAYLIST, before: (yt) => yt.fail('editPlaylist') });
    await h.ctl.onAdd(['x']);
    await h.settle();
    expect(h.toasts.at(-1)?.text).toBe(t('queue.addFailed'));
    expect(h.yt.callsOf('editPlaylist')).toHaveLength(1);
    expect(h.yt.truth('PLq')).toEqual(['a', 'b', 'c']);
  });

  it('list deleted meanwhile: forgets it, points to the settings', async () => {
    const h = await setup({ lists: LISTS, profile: PLAYLIST });
    h.yt.deleteList('PLq');
    // It reads again before believing the list is gone (findings F16).
    const add = h.ctl.onAdd(['x']);
    await h.settle();
    await add;
    expect(h.toasts.at(-1)).toEqual({ text: t('queue.listGone', { name: 'List PLq' }), action: t('queue.toSettings') });
    expect(h.ctl.decision).toBe('noList');
    expect((await h.profile())?.listId).toBeUndefined();
    expect(h.button.visible).toBe(false);
  });

  it('not taking over: Add is ignored here', async () => {
    const h = await setup({ lists: LISTS, profile: { mode: 'native', listId: 'PLq' } });
    await h.ctl.onAdd(['x']);
    await h.settle();
    expect(h.yt.truth('PLq')).toEqual(['a', 'b', 'c']);
  });

  it('"View" opens the list page', async () => {
    const h = await setup({ lists: LISTS, profile: PLAYLIST });
    await h.ctl.onAdd(['x']);
    expect(h.toasts.at(-1)?.action).toBe(t('queue.view'));
  });
});

describe('Play button (§24.4)', () => {
  it('plays the list from its first entry', async () => {
    const h = await setup({ lists: LISTS, profile: PLAYLIST });
    await h.ctl.play();
    await h.settle();
    expect(h.yt.navigations).toEqual(['/watch?v=a&list=PLq']);
  });

  it('an empty list: nothing to play, the count is 0', async () => {
    const h = await setup({ lists: { PLq: [] }, profile: PLAYLIST });
    expect(h.button.count).toBe(0);
    await h.ctl.play();
    expect(h.yt.navigations).toEqual([]);
  });
});
