import { describe, expect, it } from 'vitest';
import { parseAge, parseCount, parsePage, parseWatch } from '@/features/danmaku/comments';

const VID = 'vid12345678';

describe('parseCount', () => {
  it.each([
    ['9.3K', 9300], ['283K', 283000], ['1.2M', 1200000], ['2B', 2e9], ['451', 451], ['1', 1],
    ['', 0], [' ', 0], ['1,234', 1234], ['9.3k', 9300],
  ])('%j → %d', (s, n) => expect(parseCount(s)).toBe(n));
});

describe('parseAge', () => {
  it.each([
    ['3 months ago', 90], ['7 years ago (edited)', 7 * 365], ['1 day ago', 1], ['2 weeks ago', 14], ['12 hours ago', 0.5],
  ])('%j → %d days', (s, d) => expect(parseAge(s)).toBeCloseTo(d));
  it('is null when unreadable', () => expect(parseAge('Streamed live')).toBeNull());
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
  it('finds the first comments token and the Most replayed curve', () => {
    expect(parseWatch(watch())).toEqual({ token: 'TOKEN1', heatmap: [{ start: 0, dur: 2.14, score: 1 }, { start: 2.14, dur: 2.14, score: 0.42 }] });
  });
  it('copes with comments off and no heat map', () => {
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
  it('reads comments in ranking order, with counts, age and author', () => {
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

  it('falls back to entity order without threads, skips replies, takes the button token', () => {
    const p = parsePage(page({
      entities: [entity({ key: 'A', text: 'top' }), entity({ key: 'R', text: 'a reply', level: 1 })],
      threads: [],
      last: 'button',
    }), VID);
    expect(p.comments.map((c) => c.text)).toEqual(['top']);
    expect(p.next).toBe('NEXT');
    expect(p.total).toBeUndefined();
  });

  it('has no next token on the last page', () => {
    expect(parsePage(page({ entities: [], threads: [], last: 'none' }), VID).next).toBeUndefined();
  });

  it('takes timestamps to this video only; 0:00 has no startTimeSeconds', () => {
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

  it('marks web links, from runs or from the text', () => {
    const viaRun = entity({ key: 'A', text: 'my channel here', commandRuns: [{ startIndex: 3, length: 7, onTap: { innertubeCommand: { urlEndpoint: { url: 'https://x.test' } } } }] });
    const viaText = entity({ key: 'B', text: 'go to www.example.com now' });
    const plain = entity({ key: 'C', text: 'Node.js is fine' });
    const p = parsePage(page({ entities: [viaRun, viaText, plain], threads: ['A', 'B', 'C'] }), VID);
    expect(p.comments.map((c) => c.hasLink)).toEqual([true, true, false]);
  });

  it('keeps inline member emoji with their place in the text', () => {
    const img = (start: number) => ({ startIndex: start, length: 1, element: { type: { imageType: { image: { sources: [{ url: 'https://e.test/heart.png', width: 16, height: 16 }] } } }, properties: { accessibilityProperties: { label: '❤' } } } });
    const p = parsePage(page({ entities: [entity({ key: 'A', text: 'Freddy..❤❤', attachmentRuns: [img(8), img(9)] })], threads: ['A'] }), VID);
    expect(p.comments[0]!.images).toEqual([{ start: 8, len: 1, url: 'https://e.test/heart.png', alt: '❤' }, { start: 9, len: 1, url: 'https://e.test/heart.png', alt: '❤' }]);
  });
});
