// Parse InnerTube `next` responses into comments (§51). Shapes measured
// 2026-11-22 with context.client.hl = 'en', which we always send so counts
// read "9.3K" and ages "3 months ago" whatever the user's language.

/** A timestamp link to this video. start/len are UTF-16 offsets into the text. */
export interface Stamp {
  sec: number;
  start: number;
  len: number;
}

/** A custom (member) emoji drawn inline in place of text[start, start + len). */
export interface InlineImage {
  start: number;
  len: number;
  url: string;
  alt: string;
}

export interface Comment {
  id: string;
  text: string;
  /** "@handle" */
  author: string;
  likes: number;
  replies: number;
  /** From "3 months ago"; null when unreadable. */
  ageDays: number | null;
  /** Links to this video's moments, in text order. */
  stamps: Stamp[];
  images: InlineImage[];
  /** A web link or a link to another video. */
  hasLink: boolean;
}

/** One stretch of the "Most replayed" curve, in seconds; score 0–1. */
export interface HeatSegment {
  start: number;
  dur: number;
  score: number;
}

export interface WatchInfo {
  /** First comments page; undefined when comments are off or missing. */
  token?: string;
  heatmap: HeatSegment[];
}

export interface CommentPage {
  /** Top-level comments, in the order YouTube ranks them. */
  comments: Comment[];
  next?: string;
  /** Total comments from the header (first page only). */
  total?: number;
}

type J = Record<string, unknown>;
const obj = (v: unknown): J | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as J) : undefined);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
/** Follow a path of keys; undefined on any miss. */
function at(v: unknown, ...keys: string[]): unknown {
  let cur = v;
  for (const k of keys) cur = obj(cur)?.[k];
  return cur;
}

function find(o: unknown, key: string, out: unknown[] = []): unknown[] {
  if (o && typeof o === 'object') {
    const r = o as J;
    if (key in r) out.push(r[key]);
    for (const v of Object.values(r)) find(v, key, out);
  }
  return out;
}

/** "9.3K" → 9300, "1.2M", "283", "" or " " → 0, "1,234" → 1234. */
export function parseCount(s: string): number {
  const m = s.replace(/,/g, '').trim().match(/^(\d+(?:\.\d+)?)\s*([KMB])?/i);
  if (!m) return 0;
  const mul = { K: 1e3, M: 1e6, B: 1e9 }[(m[2] ?? '').toUpperCase() as 'K' | 'M' | 'B'] ?? 1;
  return Math.round(Number(m[1]) * mul);
}

const UNIT_DAYS: Record<string, number> = { second: 1 / 86400, minute: 1 / 1440, hour: 1 / 24, day: 1, week: 7, month: 30, year: 365 };

/** "3 months ago", "7 years ago (edited)", "17 hours ago" → days; null when unreadable. */
export function parseAge(s: string): number | null {
  const m = s.match(/(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago/i);
  if (!m) return null;
  return Number(m[1]) * (UNIT_DAYS[m[2]!.toLowerCase()] ?? 0);
}

/** Token and "Most replayed" curve from the first `next` call (with videoId). */
export function parseWatch(j: unknown): WatchInfo {
  const contents = arr(at(j, 'contents', 'twoColumnWatchNextResults', 'results', 'results', 'contents'));
  const section = contents.map((c) => obj(at(c, 'itemSectionRenderer'))).find((s) => s?.sectionIdentifier === 'comment-item-section');
  const token = str(at(arr(section?.contents)[0], 'continuationItemRenderer', 'continuationEndpoint', 'continuationCommand', 'token')) || undefined;
  const list = (find(at(j, 'frameworkUpdates'), 'macroMarkersListEntity') as unknown[])
    .map((e) => obj(at(e, 'markersList')))
    .find((m) => m?.markerType === 'MARKER_TYPE_HEATMAP');
  const heatmap = arr(list?.markers).map((m) => {
    const o = obj(m) ?? {};
    return { start: Number(o.startMillis) / 1000, dur: Number(o.durationMillis) / 1000, score: Number(o.intensityScoreNormalized) };
  }).filter((h) => Number.isFinite(h.start) && Number.isFinite(h.dur) && Number.isFinite(h.score));
  return { token, heatmap };
}

function parseEntity(e: J, videoId: string): Comment | undefined {
  const p = obj(e.properties);
  const content = obj(p?.content);
  const text = str(content?.content);
  if (!p || !text || Number(p.replyLevel ?? 0) !== 0) return undefined;
  const stamps: Stamp[] = [];
  let hasLink = /https?:\/\/|\bwww\./i.test(text);
  for (const run of arr(content?.commandRuns)) {
    const r = obj(run) ?? {};
    const cmd = obj(at(r, 'onTap', 'innertubeCommand'));
    const watch = obj(cmd?.watchEndpoint);
    if (watch) {
      // A link to this video's moment; 0:00 has no startTimeSeconds.
      if (watch.videoId === undefined || watch.videoId === videoId) stamps.push({ sec: Number(watch.startTimeSeconds ?? 0), start: Number(r.startIndex), len: Number(r.length) });
      else hasLink = true;
    } else if (cmd?.urlEndpoint) {
      hasLink = true;
    }
  }
  const images: InlineImage[] = arr(content?.attachmentRuns).flatMap((run) => {
    const r = obj(run) ?? {};
    const url = str(at(arr(at(r, 'element', 'type', 'imageType', 'image', 'sources'))[0], 'url'));
    if (!url) return [];
    return [{ start: Number(r.startIndex), len: Number(r.length), url, alt: str(at(r, 'element', 'properties', 'accessibilityProperties', 'label')) }];
  });
  const toolbar = obj(e.toolbar);
  return {
    id: str(p.commentId),
    text,
    author: str(at(e, 'author', 'displayName')),
    likes: parseCount(str(toolbar?.likeCountNotliked)),
    replies: parseCount(str(toolbar?.replyCount)),
    ageDays: parseAge(str(p.publishedTime)),
    stamps: stamps.sort((a, b) => a.start - b.start),
    images,
    hasLink,
  };
}

/** One page of comments (a `next` call with a continuation token). */
export function parsePage(j: unknown, videoId: string): CommentPage {
  const entities = new Map<string, J>();
  const order: string[] = [];
  for (const m of arr(at(j, 'frameworkUpdates', 'entityBatchUpdate', 'mutations'))) {
    const e = obj(at(m, 'payload', 'commentEntityPayload'));
    if (!e) continue;
    const key = str(e.key) || str(at(e, 'properties', 'commentId'));
    entities.set(key, e);
    order.push(key);
  }
  const items = arr(at(j, 'onResponseReceivedEndpoints')).flatMap((ep) => Object.values(obj(ep) ?? {})).flatMap((v) => arr(at(v, 'continuationItems')));
  // Ranking order = the thread list; the entity list is a fallback.
  const ranked = items.map((it) => str(at(it, 'commentThreadRenderer', 'commentViewModel', 'commentViewModel', 'commentKey'))).filter((k) => entities.has(k));
  const keys = ranked.length ? ranked : order;
  const comments = keys.flatMap((k) => parseEntity(entities.get(k)!, videoId) ?? []);

  const last = obj(at(items.at(-1), 'continuationItemRenderer'));
  const next = str(at(last, 'continuationEndpoint', 'continuationCommand', 'token')) || str(at(last, 'button', 'buttonRenderer', 'command', 'continuationCommand', 'token')) || undefined;

  const header = items.map((it) => obj(at(it, 'commentsHeaderRenderer'))).find(Boolean);
  const countText = arr(at(header, 'countText', 'runs')).map((r) => str(at(r, 'text'))).join('');
  const digits = countText.match(/[\d,]+/)?.[0]?.replace(/,/g, '');
  return { comments, next, total: digits ? Number(digits) : undefined };
}
