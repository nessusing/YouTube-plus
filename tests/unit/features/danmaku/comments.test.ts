import { describe, expect, it } from 'vitest';
import { lean, parseAge, parseCount, parsePage, parseWatch } from '@/features/danmaku/comments';

const VID = 'vid12345678';

describe('parseCount', () => {
  it.each([
    ['9.3K', 9300], ['283K', 283000], ['1.2M', 1200000], ['2B', 2e9], ['451', 451], ['1', 1],
    ['', 0], [' ', 0], ['1,234', 1234], ['9.3k', 9300],
  ])('F-12-AC5 %j → %d', (s, n) => expect(parseCount(s)).toBe(n));
});

describe('parseAge', () => {
  it.each([
    ['3 months ago', 90], ['7 years ago (edited)', 7 * 365], ['1 day ago', 1], ['2 weeks ago', 14], ['12 hours ago', 0.5],
  ])('F-12-AC5 %j → %d days', (s, d) => expect(parseAge(s)).toBeCloseTo(d));
  it('F-12-AC5 is null when unreadable', () => expect(parseAge('Streamed live')).toBeNull());
});

/** First `next` response: the comments section and the heat map. */
function watch(opts: { comments?: boolean; heat?: boolean } = {}) {
  const contents: unknown[] = [{ videoPrimaryInfoRenderer: {} }];
  if (opts.comments !== false) {
    contents.push({ itemSectionRenderer: { sectionIdentifier: 'comment-item-section', targetId: 'comments-section', contents: [{ continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: 'TOKEN1', request: 'CONTINUATION_REQUEST_TYPE_WATCH_NEXT' } } } }] } });
  }
  const mutations: unknown[] = [{ payload: { somethingElse: {} } }];
  if (opts.heat !== false) {
    mutations.push({ payload: { macroMarkersListEntity: { markersList: { markerType: 'MARKER_TYPE_HEATMAP', markers: [
      { startMillis: '0', durationMillis: '2140', intensityScoreNormalized: 1 },
      { startMillis: '2140', durationMillis: '2140', intensityScoreNormalized: 0.42 },
    ] } } } });
  }
  return { contents: { twoColumnWatchNextResults: { results: { results: { contents } } } }, frameworkUpdates: { entityBatchUpdate: { mutations } } };
}

describe('parseWatch', () => {
  it('F-12-AC4 F-12-AC8 finds the first comments token and the Most replayed curve', () => {
    expect(parseWatch(watch())).toEqual({ token: 'TOKEN1', heatmap: [{ start: 0, dur: 2.14, score: 1 }, { start: 2.14, dur: 2.14, score: 0.42 }] });
  });
  it('F-12-AC2 F-12-AC4 copes with comments off and no heat map', () => {
    expect(parseWatch(watch({ comments: false, heat: false }))).toEqual({ token: undefined, heatmap: [] });
  });
});

interface EntityOpts {
  key: string; text: string; likes?: string; replies?: string; age?: string; level?: number;
  commandRuns?: unknown[]; attachmentRuns?: unknown[];
}
function entity(o: EntityOpts) {
  return { payload: { commentEntityPayload: {
    key: o.key,
    properties: { commentId: `id-${o.key}`, content: { content: o.text, commandRuns: o.commandRuns, attachmentRuns: o.attachmentRuns }, publishedTime: o.age ?? '3 months ago', replyLevel: o.level ?? 0 },
    author: { displayName: `@user${o.key}` },
    toolbar: { likeCountNotliked: o.likes ?? ' ', replyCount: o.replies ?? '' },
  } } };
}
const watchRun = (start: number, len: number, videoId: string, sec?: number) => ({ startIndex: start, length: len, onTap: { innertubeCommand: { watchEndpoint: sec === undefined ? { videoId } : { videoId, startTimeSeconds: sec } } } });
const thread = (key: string) => ({ commentThreadRenderer: { commentViewModel: { commentViewModel: { commentKey: key } } } });

function page(o: { entities: unknown[]; threads: string[]; header?: string; last?: 'endpoint' | 'button' | 'none' }) {
  const items: unknown[] = o.threads.map(thread);
  if (o.last !== 'none') {
    const cmd = { continuationCommand: { token: 'NEXT' } };
    items.push({ continuationItemRenderer: o.last === 'button' ? { button: { buttonRenderer: { command: cmd } } } : { continuationEndpoint: cmd } });
  }
  const endpoints: unknown[] = [{ appendContinuationItemsAction: { continuationItems: items, targetId: 'comments-section' } }];
  if (o.header) endpoints.unshift({ reloadContinuationItemsCommand: { continuationItems: [{ commentsHeaderRenderer: { countText: { runs: [{ text: o.header }, { text: ' Comments' }] } } }] } });
  return { onResponseReceivedEndpoints: endpoints, frameworkUpdates: { entityBatchUpdate: { mutations: o.entities } } };
}

describe('parsePage', () => {
  it('F-12-AC4 reads comments in ranking order, with counts, age and author', () => {
    const p = parsePage(page({
      entities: [entity({ key: 'A', text: 'first entity', likes: '9.3K', replies: '66' }), entity({ key: 'B', text: 'second entity', likes: '12', age: '2 days ago' })],
      threads: ['B', 'A'],
      header: '2,462,497',
    }), VID);
    expect(p.comments.map((c) => c.id)).toEqual(['id-B', 'id-A']);
    expect(p.comments[1]).toMatchObject({ text: 'first entity', author: '@userA', likes: 9300, replies: 66, ageDays: 90, stamps: [], images: [], hasLink: false });
    expect(p.comments[0]).toMatchObject({ likes: 12, replies: 0, ageDays: 2 });
    expect(p.total).toBe(2462497);
    expect(p.next).toBe('NEXT');
  });

  it('F-12-AC4 falls back to entity order without threads, skips replies, takes the button token', () => {
    const p = parsePage(page({
      entities: [entity({ key: 'A', text: 'top' }), entity({ key: 'R', text: 'a reply', level: 1 })],
      threads: [],
      last: 'button',
    }), VID);
    expect(p.comments.map((c) => c.text)).toEqual(['top']);
    expect(p.next).toBe('NEXT');
    expect(p.total).toBeUndefined();
  });

  it('F-12-AC4 has no next token on the last page', () => {
    expect(parsePage(page({ entities: [], threads: [], last: 'none' }), VID).next).toBeUndefined();
  });

  it('F-12-AC6 takes timestamps to this video only; 0:00 has no startTimeSeconds', () => {
    const text = '0:00 intro\n2:35 the jump\nsee also 1:00';
    const p = parsePage(page({
      entities: [entity({ key: 'A', text, commandRuns: [watchRun(11, 4, VID, 155), watchRun(0, 4, VID), watchRun(33, 4, 'otherVideo1', 60)] })],
      threads: ['A'],
    }), VID);
    const c = p.comments[0]!;
    expect(c.stamps).toEqual([{ sec: 0, start: 0, len: 4 }, { sec: 155, start: 11, len: 4 }]);
    expect(text.slice(c.stamps[1]!.start, c.stamps[1]!.start + c.stamps[1]!.len)).toBe('2:35');
    expect(c.hasLink).toBe(true);
  });

  it('F-12-AC5 marks web links, from runs or from the text', () => {
    const viaRun = entity({ key: 'A', text: 'my channel here', commandRuns: [{ startIndex: 3, length: 7, onTap: { innertubeCommand: { urlEndpoint: { url: 'https://x.test' } } } }] });
    const viaText = entity({ key: 'B', text: 'go to www.example.com now' });
    const plain = entity({ key: 'C', text: 'Node.js is fine' });
    const p = parsePage(page({ entities: [viaRun, viaText, plain], threads: ['A', 'B', 'C'] }), VID);
    expect(p.comments.map((c) => c.hasLink)).toEqual([true, true, false]);
  });

  it('F-12-AC5 keeps inline member emoji with their place in the text', () => {
    const img = (start: number) => ({ startIndex: start, length: 1, element: { type: { imageType: { image: { sources: [{ url: 'https://e.test/heart.png', width: 16, height: 16 }] } } }, properties: { accessibilityProperties: { label: '❤' } } } });
    const p = parsePage(page({ entities: [entity({ key: 'A', text: 'Freddy..❤❤', attachmentRuns: [img(8), img(9)] })], threads: ['A'] }), VID);
    expect(p.comments[0]!.images).toEqual([{ start: 8, len: 1, url: 'https://e.test/heart.png', alt: '❤' }, { start: 9, len: 1, url: 'https://e.test/heart.png', alt: '❤' }]);
  });
});

describe('fields for the comments panel (F-12)', () => {
  const withAvatar = (key: string, level = 0) => {
    const e = entity({ key, text: `text ${key}`, age: '7 years ago (edited)', level });
    (e.payload.commentEntityPayload.author as Record<string, unknown>).avatarThumbnailUrl = `https://yt3.test/${key}=s88`;
    return e;
  };

  it('F-12-AC14 gives each comment its avatar, publish text and replies token', () => {
    const replies = { commentRepliesRenderer: { contents: [{ continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: 'REPLIES-A' } } } }] } };
    const j = page({ entities: [withAvatar('A'), withAvatar('B')], threads: ['A', 'B'] });
    const items = (j.onResponseReceivedEndpoints[0] as { appendContinuationItemsAction: { continuationItems: Record<string, Record<string, unknown>>[] } }).appendContinuationItemsAction.continuationItems;
    items[0]!.commentThreadRenderer!.replies = replies;
    const p = parsePage(j, VID);
    expect(p.comments[0]).toMatchObject({ avatar: 'https://yt3.test/A=s88', published: '7 years ago (edited)', replyToken: 'REPLIES-A' });
    expect(p.comments[1]!.replyToken).toBeUndefined();
  });

  it('F-12-AC14 finds the replies token under subThreads too (what the page itself gets)', () => {
    const j = page({ entities: [withAvatar('A')], threads: ['A'] });
    const items = (j.onResponseReceivedEndpoints[0] as { appendContinuationItemsAction: { continuationItems: Record<string, Record<string, unknown>>[] } }).appendContinuationItemsAction.continuationItems;
    items[0]!.commentThreadRenderer!.replies = { commentRepliesRenderer: { subThreads: [{ continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: 'SUB-A' } } } }] } };
    expect(parsePage(j, VID).comments[0]!.replyToken).toBe('SUB-A');
  });

  it('F-12-AC14 reads a page of replies: bare comment view models, level 1, a "Show more replies" button', () => {
    const items: unknown[] = [
      { commentViewModel: { commentKey: 'R2' } }, { commentViewModel: { commentKey: 'R1' } },
      { continuationItemRenderer: { button: { buttonRenderer: { command: { continuationCommand: { token: 'MORE' } } } } } },
    ];
    const j = { onResponseReceivedEndpoints: [{ appendContinuationItemsAction: { continuationItems: items } }], frameworkUpdates: { entityBatchUpdate: { mutations: [withAvatar('R1', 1), withAvatar('R2', 1)] } } };
    const p = parsePage(j, VID, 1);
    expect(p.comments.map((c) => c.id)).toEqual(['id-R2', 'id-R1']);
    expect(p.next).toBe('MORE');
    // The same page read as top-level comments has none.
    expect(parsePage(j, VID).comments).toEqual([]);
  });

  it('F-12-AC14 reads the page client\'s nested reply threads: replies with their own replies inline and a token for more', () => {
    const thread = (key: string, subThreads?: unknown[]) => ({ commentThreadRenderer: { commentViewModel: { commentViewModel: { commentKey: key } }, ...(subThreads ? { replies: { commentRepliesRenderer: { subThreads } } } : {}) } });
    const more = (token: string) => ({ continuationItemRenderer: { button: { buttonRenderer: { command: { continuationCommand: { token } } } } } });
    const items = [
      thread('R1', [thread('S1'), thread('S2')]),
      thread('R2', [more('MORE-R2')]),
      thread('R3'),
      more('NEXT-REPLIES'),
    ];
    const ents = [withAvatar('R1', 1), withAvatar('S1', 2), withAvatar('S2', 2), withAvatar('R2', 1), withAvatar('R3', 1)];
    const p = parsePage({ onResponseReceivedEndpoints: [{ appendContinuationItemsAction: { continuationItems: items } }], frameworkUpdates: { entityBatchUpdate: { mutations: ents } } }, VID, 1);
    expect(p.comments.map((c) => c.id)).toEqual(['id-R1', 'id-R2', 'id-R3']);
    expect(p.comments[0]!.subReplies!.map((c) => [c.id, c.level])).toEqual([['id-S1', 2], ['id-S2', 2]]);
    expect(p.comments[0]!.replyToken).toBeUndefined();
    expect(p.comments[1]).toMatchObject({ level: 1, replyToken: 'MORE-R2' });
    expect(p.comments[1]!.subReplies).toBeUndefined();
    expect(p.next).toBe('NEXT-REPLIES');
  });

  it('F-12-AC15 F-19-AC4 lean() drops the panel-only fields for the danmaku cache, keeps the avatar', () => {
    const c = parsePage(page({ entities: [withAvatar('A')], threads: ['A'] }), VID).comments[0]!;
    const l = lean({ ...c, replyToken: 'T', level: 1, subReplies: [c] });
    expect(l).toHaveProperty('avatar', 'https://yt3.test/A=s88');
    expect(l).not.toHaveProperty('published');
    expect(l).not.toHaveProperty('replyToken');
    expect(l).not.toHaveProperty('level');
    expect(l).not.toHaveProperty('subReplies');
    expect(l).toMatchObject({ id: 'id-A', text: 'text A', author: '@userA' });
  });
});
