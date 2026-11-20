import { describe, expect, it } from 'vitest';
import {
  chunk, decideTakeover, DEFAULT_PROFILE, isQueueCommand, countWith, isWatchedHere, listSignature, panelSnapshot, meetsExpect, mergeExpect, nextAfter, nextRows, notInList, panelView, parseEdit, parseQueueAction, queueView, planClear,
  planUndoMoves, profileWithDefaults, type ListItem, type TakeoverInput,
} from './core';

const L = (v: string, s: string, percent?: number): ListItem => ({ videoId: v, setVideoId: s, percent });

// Shapes recorded in the browser on 2026-11-20 (design §21.2).
const queueCommand = {
  addToPlaylistCommand: {
    openMiniplayer: true,
    videoId: 'dQw4w9WgXcQ',
    listType: 'PLAYLIST_EDIT_LIST_TYPE_QUEUE',
    onCreateListCommand: {
      commandMetadata: { webCommandMetadata: { sendPost: true, apiUrl: '/youtubei/v1/playlist/create' } },
      createPlaylistServiceEndpoint: { videoIds: ['dQw4w9WgXcQ'], params: 'CAQ%3D' },
    },
    videoIds: ['dQw4w9WgXcQ'],
  },
};
const newMenuItem = {
  title: { content: 'Add to queue' },
  leadingImage: { sources: [{ clientResource: { imageName: 'ADD_TO_QUEUE_TAIL' } }] },
  rendererContext: {
    commandContext: {
      onTap: {
        innertubeCommand: {
          clickTrackingParams: 'x',
          signalServiceEndpoint: { signal: 'CLIENT_SIGNAL', actions: [{ clickTrackingParams: 'y', ...queueCommand }] },
        },
      },
    },
  },
};
const oldMenuItem = {
  text: { runs: [{ text: 'Add to queue' }] },
  icon: { iconType: 'ADD_TO_QUEUE_TAIL' },
  serviceEndpoint: { signalServiceEndpoint: { signal: 'CLIENT_SIGNAL', actions: [queueCommand] } },
};

describe('parseQueueAction', () => {
  it('reads the recorded Add to queue action', () => {
    expect(parseQueueAction({ actionName: 'yt-add-to-playlist-command', args: [queueCommand, {}] }))
      .toEqual({ kind: 'queue', videoIds: ['dQw4w9WgXcQ'] });
  });
  it('falls back to videoId and dedupes', () => {
    const c = { addToPlaylistCommand: { listType: 'PLAYLIST_EDIT_LIST_TYPE_QUEUE', videoId: 'a', videoIds: ['b', 'b'] } };
    expect(parseQueueAction({ actionName: 'yt-add-to-playlist-command', args: [c] })).toEqual({ kind: 'queue', videoIds: ['b'] });
    const d = { addToPlaylistCommand: { listType: 'PLAYLIST_EDIT_LIST_TYPE_QUEUE', videoId: 'a' } };
    expect(parseQueueAction({ actionName: 'yt-add-to-playlist-command', args: [d] })).toEqual({ kind: 'queue', videoIds: ['a'] });
  });
  it('leaves other actions and other lists alone', () => {
    expect(parseQueueAction({ actionName: 'yt-open-popup-action', args: [] }).kind).toBe('other');
    expect(parseQueueAction({ actionName: 'yt-add-to-playlist-command', args: [{ addToPlaylistCommand: { listType: 'X', videoId: 'a' } }] }).kind).toBe('other');
    expect(parseQueueAction(null).kind).toBe('other');
  });
  it('flags an Add to queue without videos as malformed', () => {
    expect(parseQueueAction({ actionName: 'yt-add-to-playlist-command', args: [{ addToPlaylistCommand: { listType: 'PLAYLIST_EDIT_LIST_TYPE_QUEUE' } }] }).kind)
      .toBe('malformed');
  });
});

describe('isQueueCommand', () => {
  it('finds the command in both menu shapes (§21.3)', () => {
    expect(isQueueCommand(newMenuItem.rendererContext.commandContext.onTap.innertubeCommand)).toBe(true);
    expect(isQueueCommand(oldMenuItem.serviceEndpoint)).toBe(true);
  });
  it('ignores other menu items', () => {
    expect(isQueueCommand({ signalServiceEndpoint: { actions: [{ addToPlaylistCommand: { listType: 'PLAYLIST_EDIT_LIST_TYPE_WATCH_LATER' } }] } })).toBe(false);
    expect(isQueueCommand(undefined)).toBe(false);
  });
});

describe('profileWithDefaults', () => {
  it('defaults to the native queue with remove-after-playing on', () => {
    expect(profileWithDefaults(undefined)).toEqual(DEFAULT_PROFILE);
  });
  it('keeps a chosen list; drops a bad one', () => {
    expect(profileWithDefaults({ mode: 'playlist', listId: 'PLabc', listName: 'Mine', removeWatched: false }))
      .toEqual({ mode: 'playlist', listId: 'PLabc', listName: 'Mine', removeWatched: false });
    expect(profileWithDefaults({ mode: 'playlist', listId: '' })).toEqual({ mode: 'playlist', removeWatched: true });
  });
});

describe('decideTakeover (§24.1)', () => {
  const base: TakeoverInput = {
    featureOn: true, profile: { mode: 'playlist', listId: 'PL1', removeWatched: true }, loggedIn: true, editable: true, protocolError: false,
  };
  it('takes over only when everything holds', () => {
    expect(decideTakeover(base)).toBe('take');
    expect(decideTakeover({ ...base, featureOn: false })).toBe('native');
    expect(decideTakeover({ ...base, profile: { ...base.profile, mode: 'native' } })).toBe('native');
    expect(decideTakeover({ ...base, loggedIn: false })).toBe('native');
    expect(decideTakeover({ ...base, protocolError: true })).toBe('native');
  });
  it('explains a missing or read-only list', () => {
    expect(decideTakeover({ ...base, profile: { mode: 'playlist', removeWatched: true } })).toBe('noList');
    expect(decideTakeover({ ...base, editable: false })).toBe('notEditable');
  });
  it('stays native while the check is still running', () => {
    expect(decideTakeover({ ...base, editable: undefined })).toBe('native');
  });
});

describe('notInList (§24.2)', () => {
  const items = [{ videoId: 'a', setVideoId: '1' }, { videoId: 'b', setVideoId: '2' }];
  it('drops videos already in the list, keeps order', () => {
    expect(notInList(items, ['c', 'a', 'd'])).toEqual(['c', 'd']);
    expect(notInList(items, ['b'])).toEqual([]);
    expect(notInList([], ['a'])).toEqual(['a']);
  });
});

describe('queueView (§24.2)', () => {
  const nav = (v: string, i: number) => ({ watchEndpoint: { videoId: v, playlistId: 'PL1', index: i } });
  const next = {
    contents: { twoColumnWatchNextResults: {
      playlist: { playlist: { playlistId: 'PL1', totalVideos: 2, currentIndex: 0, contents: [
        { playlistPanelVideoRenderer: { videoId: 'a', selected: true, navigationEndpoint: nav('a', 0) } },
        { playlistPanelVideoRenderer: { videoId: 'b', selected: false, navigationEndpoint: nav('b', 1) } },
      ] } },
      autoplay: { autoplay: { sets: [{ mode: 'NORMAL', autoplayVideo: nav('b', 1), nextButtonVideo: nav('b', 1) }], modifiedSets: [{}] } },
    } },
  };
  const now = { videoId: 'x', title: 'X', author: 'Me', duration: 125 };

  it('puts the playing video on top and points autoplay at the first entry', () => {
    const v = queueView(next, now)!;
    const rows = (v.list.contents as { playlistPanelVideoRenderer: Record<string, unknown> }[]).map((c) => c.playlistPanelVideoRenderer);
    expect(rows.map((r) => r.videoId)).toEqual(['x', 'a', 'b']);
    expect(rows.map((r) => r.selected)).toEqual([true, false, false]);
    expect(rows[0]!.lengthText).toEqual({ simpleText: '2:05' });
    expect(v.list.currentIndex).toBe(0);
    expect(v.list.totalVideos).toBe(3);
    expect(v.autoplay.sets).toEqual([{ mode: 'NORMAL', autoplayVideo: nav('a', 0), nextButtonVideo: nav('a', 0) }]);
    expect(v.autoplay.modifiedSets).toBeUndefined();
  });

  it('does not touch the response', () => {
    queueView(next, now);
    expect(next.contents.twoColumnWatchNextResults.playlist.playlist.contents[0]!.playlistPanelVideoRenderer.selected).toBe(true);
  });

  it('gives up on an unexpected shape or an empty list', () => {
    expect(queueView({}, now)).toBeUndefined();
    expect(queueView({ contents: { twoColumnWatchNextResults: { playlist: { playlist: { contents: [] } }, autoplay: { autoplay: { sets: [] } } } } }, now)).toBeUndefined();
  });
});

describe('keeping the UI in step (§24.8)', () => {
  const row = (v: string, s: string) => ({ playlistPanelVideoRenderer: { videoId: v, playlistSetVideoId: s, navigationEndpoint: { watchEndpoint: { videoId: v } } } });
  const next = (rows: unknown[]) => ({
    contents: { twoColumnWatchNextResults: {
      playlist: { playlist: { playlistId: 'PL1', totalVideos: rows.length, contents: rows } },
      autoplay: { autoplay: { sets: [{ autoplayVideo: { watchEndpoint: { videoId: 'srv' } } }] } },
    } },
  });

  it('reads the page\'s and our edit_playlist bodies', () => {
    expect(parseEdit({ context: {}, playlistId: 'PL1', actions: [
      { action: 'ACTION_ADD_VIDEO', addedVideoId: 'a' },
      { setVideoId: 'S1', action: 'ACTION_REMOVE_VIDEO' },
      { action: 'ACTION_REMOVE_VIDEO_BY_VIDEO_ID', removedVideoId: 'b' },
      { action: 'ACTION_MOVE_VIDEO_AFTER', setVideoId: 'S2' },
    ] })).toEqual({ playlistId: 'PL1', has: ['a'], gone: ['S1'], goneVideos: ['b'] });
    expect(parseEdit({ playlistId: 'PL1' })).toBeUndefined();
    expect(parseEdit('nope')).toBeUndefined();
  });

  it('knows when reads have caught up', () => {
    const items = [L('a', 'S1'), L('b', 'S2')];
    expect(meetsExpect(items, undefined)).toBe(true);
    expect(meetsExpect(items, { has: ['a'], gone: ['S9'], goneVideos: ['z'] })).toBe(true);
    expect(meetsExpect(items, { has: ['c'] })).toBe(false);
    expect(meetsExpect(items, { gone: ['S2'] })).toBe(false);
    expect(meetsExpect(items, { goneVideos: ['b'] })).toBe(false);
  });

  it('merges a burst of edits; the last word on a video wins', () => {
    expect(mergeExpect({ has: ['a'] }, { has: ['b'], gone: ['S1'] })).toEqual({ has: ['a', 'b'], gone: ['S1'], goneVideos: [] });
    expect(mergeExpect({ has: ['a'] }, { goneVideos: ['a'] })).toEqual({ has: [], gone: [], goneVideos: ['a'] });
    expect(mergeExpect({ goneVideos: ['a'] }, { has: ['a'] })).toEqual({ has: ['a'], gone: [], goneVideos: [] });
  });

  it('counts the latest snapshot with known edits on top', () => {
    const snap = { rows: [L('a', 'S1'), L('b', 'S2'), L('c', 'S3')], total: 3, at: 0 };
    expect(countWith(undefined, undefined)).toBeUndefined();
    expect(countWith(snap, undefined)).toBe(3);
    // A read that has not caught up with a removal, or an add.
    expect(countWith(snap, { gone: ['S2'] })).toBe(2);
    expect(countWith(snap, { goneVideos: ['c'], has: ['d'] })).toBe(3);
    // Already caught up: nothing counted twice.
    expect(countWith({ ...snap, rows: [L('a', 'S1')], total: 1 }, { gone: ['S2'], has: ['a'] })).toBe(1);
    // A window of a longer list.
    expect(countWith({ rows: [L('a', 'S1')], total: 250, at: 0 }, { gone: ['S1'] })).toBe(249);
  });

  it('reads what the page put in the panel, leaving out our local top row', () => {
    const data = { playlistId: 'PL1', totalVideos: 3, contents: [
      { playlistPanelVideoRenderer: { videoId: 'x' } },
      { playlistPanelVideoRenderer: { videoId: 'a', playlistSetVideoId: 'S1' } },
      { playlistPanelVideoRenderer: { videoId: 'b', playlistSetVideoId: 'S2' } },
    ] };
    expect(panelSnapshot(data, 5)).toEqual({ playlistId: 'PL1', snap: { rows: [L('a', 'S1'), L('b', 'S2')].map(({ videoId, setVideoId }) => ({ videoId, setVideoId })), total: 2, at: 5 } });
    expect(panelSnapshot({}, 0)).toBeUndefined();
  });

  it('fingerprints the order', () => {
    expect(listSignature([L('a', 'S1'), L('b', 'S2')])).not.toBe(listSignature([L('b', 'S2'), L('a', 'S1')]));
  });

  it('reads the list out of next', () => {
    expect(nextRows(next([row('a', 'S1'), row('b', 'S2')]))).toEqual([L('a', 'S1'), L('b', 'S2')].map(({ videoId, setVideoId }) => ({ videoId, setVideoId })));
    expect(nextRows({})).toEqual([]);
  });

  it('keeps the server view when the video playing is in the list', () => {
    const n = next([row('a', 'S1'), row('b', 'S2')]);
    const v = panelView(n, { videoId: 'b', title: '', author: '', duration: 0 })!;
    expect((v.list.contents as unknown[]).length).toBe(2);
    expect(v.autoplay.sets).toEqual([{ autoplayVideo: { watchEndpoint: { videoId: 'srv' } } }]);
  });

  it('puts a video from outside the list on top', () => {
    const v = panelView(next([row('a', 'S1')]), { videoId: 'x', title: 'X', author: '', duration: 0 })!;
    expect((v.list.contents as { playlistPanelVideoRenderer: { videoId: string } }[]).map((c) => c.playlistPanelVideoRenderer.videoId)).toEqual(['x', 'a']);
  });
});

describe('nextAfter (§24.4)', () => {
  const items = [L('a', 's1'), L('b', 's2'), L('c', 's3')];
  it('returns the watched entry and the one after it', () => {
    expect(nextAfter(items, 'b', 1)).toEqual({ watched: items[1], next: items[2] });
  });
  it('has no next after the last one', () => {
    expect(nextAfter(items, 'c', 2)).toEqual({ watched: items[2], next: undefined });
  });
  it('picks the duplicate nearest the player index', () => {
    const dup = [L('a', 's1'), L('b', 's2'), L('a', 's3'), L('d', 's4')];
    expect(nextAfter(dup, 'a', 2)).toEqual({ watched: dup[2], next: dup[3] });
    expect(nextAfter(dup, 'a')).toEqual({ watched: dup[0], next: dup[1] });
  });
  it('carries on from the old place when the entry was removed elsewhere', () => {
    const now = [L('a', 's1'), L('c', 's3')];
    expect(nextAfter(now, 'b', 1)).toEqual({ next: now[1] });
    expect(nextAfter([], 'b', 0)).toEqual({ next: undefined });
  });
});

describe('watched', () => {
  it('counts ended or under 10 s left as watched', () => {
    expect(isWatchedHere(100, 100, true)).toBe(true);
    expect(isWatchedHere(95, 100, false)).toBe(true);
    expect(isWatchedHere(80, 100, false)).toBe(false);
    expect(isWatchedHere(0, 0, false)).toBe(false);
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
