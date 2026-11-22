// @vitest-environment happy-dom
// QueueController: after a video from the list is watched, play the next one
// and remove it (§24.4).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '@/core/i18n';
import { setup } from '../../../support/queue-harness';

vi.mock('@/core/notify', () => import('../../../support/toasts'));

beforeEach(() => vi.useFakeTimers({ now: 1_000_000 }));
afterEach(() => vi.useRealTimers());

const PLAYLIST = { mode: 'playlist' as const, listId: 'PLq', listName: 'List PLq', removeWatched: true };
const LISTS = { PLq: ['a', 'b', 'c'] };

describe('remove after playing on', () => {
  it('ended in the middle: plays the next entry, then removes the watched one', async () => {
    const h = await setup({ lists: LISTS, profile: PLAYLIST, before: (yt) => yt.load('b', 'PLq') });
    h.ctl.onPlayer(h.yt.playerEvent('ended'));
    await h.settle();
    expect(h.yt.navigations).toEqual(['/watch?v=c&list=PLq']);
    expect(h.yt.truth('PLq')).toEqual(['a', 'c']);
    expect(h.button.count).toBe(2);
    expect(h.yt.panel?.rows.map((r) => r.videoId)).toEqual(['a', 'c']);
  });

  it('ended in the miniplayer: the next entry plays there, no watch page (§24.4)', async () => {
    const h = await setup({ lists: LISTS, profile: PLAYLIST, before: (yt) => yt.load('b', 'PLq', { mini: true }) });
    h.ctl.onPlayer(h.yt.playerEvent('ended'));
    await h.settle();
    expect(h.yt.navigations).toEqual([]);
    expect(h.yt.player).toMatchObject({ videoId: 'c', mini: true });
    expect(h.yt.truth('PLq')).toEqual(['a', 'c']);
  });

  it('under 10 s left: arms the unload removal for the entry playing', async () => {
    const h = await setup({ lists: LISTS, profile: PLAYLIST, before: (yt) => yt.load('a', 'PLq') });
    h.ctl.onPlayer(h.yt.playerEvent('near'));
    await h.settle();
    const a = h.yt.entries('PLq')[0]!;
    expect(h.yt.armed).toEqual({ listId: 'PLq', setVideoId: a.setVideoId, videoId: 'a' });
    h.ctl.onPlayer(h.yt.playerEvent('ended'));
    await h.settle();
    expect(h.yt.armed).toBeUndefined();
    expect(h.yt.truth('PLq')).toEqual(['b', 'c']);
  });

  it('the last entry, with something added during its last seconds: plays that', async () => {
    const h = await setup({ lists: LISTS, profile: PLAYLIST, before: (yt) => yt.load('c', 'PLq') });
    h.ctl.onPlayer(h.yt.playerEvent('near'));
    await h.settle();
    h.yt.externalEdit('PLq', [{ action: 'ACTION_ADD_VIDEO', addedVideoId: 'x' }]);
    h.ctl.onPlayer(h.yt.playerEvent('ended'));
    await h.settle();
    expect(h.yt.navigations).toEqual(['/watch?v=x&list=PLq']);
    expect(h.yt.truth('PLq')).toEqual(['a', 'b', 'x']);
  });

  it('the last entry: removed, stays on the end screen', async () => {
    const h = await setup({ lists: { PLq: ['a'] }, profile: PLAYLIST, before: (yt) => yt.load('a', 'PLq') });
    h.ctl.onPlayer(h.yt.playerEvent('ended'));
    await h.settle();
    expect(h.yt.navigations).toEqual([]);
    expect(h.yt.truth('PLq')).toEqual([]);
    expect(h.button.count).toBe(0);
  });

  it('a whole list played through: every entry removed, in order', async () => {
    const h = await setup({ lists: LISTS, profile: PLAYLIST, before: (yt) => yt.load('a', 'PLq') });
    for (let i = 0; i < 3; i++) {
      h.ctl.onPlayer(h.yt.playerEvent('near'));
      await h.settle(1000);
      h.ctl.onPlayer(h.yt.playerEvent('ended'));
      await h.settle();
    }
    expect(h.yt.navigations).toEqual(['/watch?v=b&list=PLq', '/watch?v=c&list=PLq']);
    expect(h.yt.truth('PLq')).toEqual([]);
    expect(h.button.count).toBe(0);
  });

  it('left with under 10 s to go: removed, no jump', async () => {
    const h = await setup({ lists: LISTS, profile: PLAYLIST, before: (yt) => yt.load('a', 'PLq') });
    h.ctl.onPlayer(h.yt.playerEvent('left', { currentTime: 295, duration: 300 }));
    await h.settle();
    expect(h.yt.navigations).toEqual([]);
    expect(h.yt.truth('PLq')).toEqual(['b', 'c']);
  });

  it('left earlier: nothing', async () => {
    const h = await setup({ lists: LISTS, profile: PLAYLIST, before: (yt) => yt.load('a', 'PLq') });
    h.ctl.onPlayer(h.yt.playerEvent('left', { currentTime: 100, duration: 300 }));
    await h.settle();
    expect(h.yt.truth('PLq')).toEqual(['a', 'b', 'c']);
  });

  describe('on loop (§40.2)', () => {
    const left = (o: object) => ({ currentTime: 295, duration: 300, loop: true, ...o });

    it('looped, then another entry of the list: removed, no jump', async () => {
      const h = await setup({ lists: LISTS, profile: PLAYLIST, before: (yt) => yt.load('a', 'PLq') });
      h.ctl.onPlayer(h.yt.playerEvent('left', left({ currentTime: 3, looped: true, toPlaylistId: 'PLq' })));
      await h.settle();
      expect(h.yt.navigations).toEqual([]);
      expect(h.yt.truth('PLq')).toEqual(['b', 'c']);
    });

    it('looped, then a video outside the list or the tab closed: kept', async () => {
      const h = await setup({ lists: LISTS, profile: PLAYLIST, before: (yt) => yt.load('a', 'PLq') });
      h.ctl.onPlayer(h.yt.playerEvent('left', left({ looped: true, toPlaylistId: undefined })));
      await h.settle();
      expect(h.yt.truth('PLq')).toEqual(['a', 'b', 'c']);
    });

    it('not looped yet: kept even with under 10 s left', async () => {
      const h = await setup({ lists: LISTS, profile: PLAYLIST, before: (yt) => yt.load('a', 'PLq') });
      h.ctl.onPlayer(h.yt.playerEvent('left', left({ toPlaylistId: 'PLq' })));
      await h.settle();
      expect(h.yt.truth('PLq')).toEqual(['a', 'b', 'c']);
    });

    it('remove after playing off: kept', async () => {
      const h = await setup({ lists: LISTS, profile: { ...PLAYLIST, removeWatched: false }, before: (yt) => yt.load('a', 'PLq') });
      h.ctl.onPlayer(h.yt.playerEvent('left', left({ looped: true, toPlaylistId: 'PLq' })));
      await h.settle();
      expect(h.yt.truth('PLq')).toEqual(['a', 'b', 'c']);
    });
  });

  it('the user moved on before the end was handled: removes, does not drag them back', async () => {
    const h = await setup({ lists: { ...LISTS, PLo: ['o1'] }, profile: PLAYLIST, before: (yt) => yt.load('a', 'PLq') });
    const ended = h.yt.playerEvent('ended');
    h.yt.load('o1', 'PLo');
    h.ctl.onPlayer(ended);
    await h.settle();
    expect(h.yt.navigations).toEqual([]);
    expect(h.yt.player.videoId).toBe('o1');
    expect(h.yt.truth('PLq')).toEqual(['b', 'c']);
  });

  it('YouTube autoplay already went to the next entry: no second navigation', async () => {
    const h = await setup({ lists: LISTS, profile: PLAYLIST, before: (yt) => yt.load('a', 'PLq') });
    const ended = h.yt.playerEvent('ended');
    h.yt.load('b', 'PLq');
    h.ctl.onPlayer(ended);
    await h.settle();
    expect(h.yt.navigations).toEqual([]);
    expect(h.yt.truth('PLq')).toEqual(['b', 'c']);
  });

  it('the same video twice in the list: removes the one that played', async () => {
    const h = await setup({ lists: { PLq: ['a', 'b', 'a', 'c'] }, profile: PLAYLIST, before: (yt) => { yt.load('a', 'PLq'); yt.player.index = 2; } });
    const second = h.yt.entries('PLq')[2]!.setVideoId;
    h.ctl.onPlayer(h.yt.playerEvent('ended'));
    await h.settle();
    expect(h.yt.entries('PLq').map((e) => e.setVideoId)).not.toContain(second);
    expect(h.yt.truth('PLq')).toEqual(['a', 'b', 'c']);
    expect(h.yt.navigations).toEqual(['/watch?v=c&list=PLq']);
  });

  it('already removed elsewhere: plays what now sits at its place, quietly', async () => {
    const h = await setup({ lists: LISTS, profile: PLAYLIST, before: (yt) => yt.load('a', 'PLq') });
    const a = h.yt.entries('PLq')[0]!.setVideoId;
    h.yt.externalEdit('PLq', [{ action: 'ACTION_REMOVE_VIDEO', setVideoId: a }]);
    h.ctl.onPlayer(h.yt.playerEvent('ended'));
    await h.settle();
    expect(h.yt.navigations).toEqual(['/watch?v=b&list=PLq']);
    expect(h.toasts).toHaveLength(0);
  });

  it('removed elsewhere between our read and our removal (400): quiet', async () => {
    const h = await setup({ lists: LISTS, profile: PLAYLIST, before: (yt) => { yt.load('a', 'PLq'); yt.editStatus = 400; } });
    h.ctl.onPlayer(h.yt.playerEvent('ended'));
    await h.settle();
    expect(h.toasts).toHaveLength(0);
  });

  it('removal refused (500): says so', async () => {
    const h = await setup({ lists: LISTS, profile: PLAYLIST, before: (yt) => { yt.load('a', 'PLq'); yt.editStatus = 500; } });
    h.ctl.onPlayer(h.yt.playerEvent('ended'));
    await h.settle();
    expect(h.toasts.at(-1)?.text).toBe(t('queue.removeFailed'));
  });

  // Findings F6, fixed 2026-11-21.
  it('removal request lost (no answer / network error): says so', async () => {
    const h = await setup({ lists: LISTS, profile: PLAYLIST, before: (yt) => yt.load('a', 'PLq') });
    h.yt.fail('editPlaylist', new Error('a.editPlaylist: no answer from the page script'));
    h.ctl.onPlayer(h.yt.playerEvent('ended'));
    await h.settle();
    expect(h.yt.navigations).toEqual(['/watch?v=b&list=PLq']);
    expect(h.toasts.at(-1)?.text).toBe(t('queue.removeFailed'));
  });

  it('ended while reads still lag a previous removal: the next entry is not the one just removed', async () => {
    const h = await setup({ lists: LISTS, profile: PLAYLIST, before: (yt) => { yt.load('a', 'PLq'); yt.removalLagMs = 4000; } });
    h.ctl.onPlayer(h.yt.playerEvent('ended'));
    await h.settle(1000);
    expect(h.yt.navigations).toEqual(['/watch?v=b&list=PLq']);
    // 'b' is short: it ends while reads still show 'a'.
    h.ctl.onPlayer(h.yt.playerEvent('ended'));
    await h.settle();
    expect(h.yt.navigations).toEqual(['/watch?v=b&list=PLq', '/watch?v=c&list=PLq']);
    expect(h.yt.truth('PLq')).toEqual(['c']);
  });
});

describe('when nothing should happen', () => {
  it('remove after playing off: YouTube autoplay does it all', async () => {
    const h = await setup({ lists: LISTS, profile: { ...PLAYLIST, removeWatched: false }, before: (yt) => yt.load('a', 'PLq') });
    h.ctl.onPlayer(h.yt.playerEvent('near'));
    h.ctl.onPlayer(h.yt.playerEvent('ended'));
    await h.settle();
    expect(h.yt.navigations).toEqual([]);
    expect(h.yt.truth('PLq')).toEqual(['a', 'b', 'c']);
    expect(h.yt.armed).toBeUndefined();
  });

  it('the same video watched on its own (not in the list): not counted as watched', async () => {
    const h = await setup({ lists: LISTS, profile: PLAYLIST, before: (yt) => yt.load('a') });
    h.ctl.onPlayer(h.yt.playerEvent('ended'));
    await h.settle();
    expect(h.yt.truth('PLq')).toEqual(['a', 'b', 'c']);
  });

  it('another list playing: none of ours', async () => {
    const h = await setup({ lists: { ...LISTS, PLo: ['a', 'o2'] }, profile: PLAYLIST, before: (yt) => yt.load('a', 'PLo') });
    h.ctl.onPlayer(h.yt.playerEvent('ended'));
    await h.settle();
    expect(h.yt.truth('PLq')).toEqual(['a', 'b', 'c']);
    expect(h.yt.navigations).toEqual([]);
  });
});

describe('the video the list was attached to (§24.2)', () => {
  it('panel attach: when it ends, the list plays from its first entry and nothing is removed', async () => {
    const h = await setup({ lists: LISTS, profile: PLAYLIST, before: (yt) => yt.load('v1') });
    await h.ctl.onAdd(['x']);
    await h.settle();
    // YouTube's autoplay plays 'a' (the attach points it there); we must not remove anything for v1.
    h.ctl.onPlayer(h.yt.playerEvent('ended', { videoId: 'v1', playlistId: 'PLq', index: 0 }));
    await h.settle();
    expect(h.yt.truth('PLq')).toEqual(['a', 'b', 'c', 'x']);
    expect(h.yt.navigations.filter((n) => !n.includes('v=a&'))).toEqual([]);
  });

  it('panel attach: leaving it near its end removes nothing', async () => {
    const h = await setup({ lists: LISTS, profile: PLAYLIST, before: (yt) => yt.load('v1') });
    await h.ctl.onAdd(['x']);
    await h.settle();
    h.ctl.onPlayer(h.yt.playerEvent('left', { videoId: 'v1', playlistId: 'PLq', index: 0, currentTime: 295, duration: 300 }));
    await h.settle();
    expect(h.yt.truth('PLq')).toEqual(['a', 'b', 'c', 'x']);
  });
});
