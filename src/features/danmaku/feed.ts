// Comments panel (F-12), the data side: the video's comments as YouTube lists
// them (Top order), nothing filtered, a page at a time as the panel scrolls
// down; each comment's replies on demand. Its own fetching, separate from
// the danmaku Session: nothing is cached and Gemini is never asked.

import type { Comment } from './comments';
import type { MainRpc } from './rpc';

export interface ReplyState {
  items: Comment[];
  next?: string;
  loading: boolean;
  error?: string;
}

export class CommentFeed {
  comments: Comment[] = [];
  /** From the first page's header. */
  total: number | undefined;
  loading = false;
  /** No more pages (or no comments section). */
  done = false;
  error = '';
  readonly replies = new Map<string, ReplyState>();
  private next: string | undefined;
  private started = false;
  private stopped = false;
  private readonly seen = new Set<string>();

  constructor(readonly videoId: string, private readonly rpc: MainRpc, private readonly changed: () => void) {}

  stop(): void {
    this.stopped = true;
  }

  /** Load the next page (the first one on the first call). */
  async more(): Promise<void> {
    if (this.loading || this.done || this.stopped) return;
    this.loading = true;
    this.error = '';
    this.changed();
    try {
      if (!this.started) {
        const w = await this.rpc.watch(this.videoId);
        this.started = true;
        this.next = w.token;
      }
      if (this.next && !this.stopped) {
        const page = await this.rpc.page(this.next, this.videoId);
        if (page.total !== undefined) this.total = page.total;
        for (const c of page.comments) {
          if (this.seen.has(c.id)) continue;
          this.seen.add(c.id);
          this.comments.push(c);
        }
        this.next = page.next;
      }
      if (!this.next) this.done = true;
    } catch (e) {
      this.error = String(e instanceof Error ? e.message : e);
    } finally {
      this.loading = false;
      if (!this.stopped) this.changed();
    }
  }

  /** A comment's replies so far: what came inline with it, then what was loaded. */
  replyState(c: Comment): ReplyState {
    let r = this.replies.get(c.id);
    if (!r) {
      r = { items: [...(c.subReplies ?? [])], next: c.replyToken, loading: false };
      this.replies.set(c.id, r);
    }
    return r;
  }

  /** Load the next page of a comment's replies (one level down). */
  async moreReplies(c: Comment): Promise<void> {
    const r = this.replyState(c);
    if (r.loading || !r.next || this.stopped) return;
    r.loading = true;
    r.error = undefined;
    this.changed();
    try {
      const page = await this.rpc.page(r.next, this.videoId, (c.level ?? 0) + 1);
      const have = new Set(r.items.map((x) => x.id));
      r.items.push(...page.comments.filter((x) => !have.has(x.id)));
      r.next = page.next;
    } catch (e) {
      r.error = String(e instanceof Error ? e.message : e);
    } finally {
      r.loading = false;
      if (!this.stopped) this.changed();
    }
  }
}

const UNITS = ['second', 'minute', 'hour', 'day', 'week', 'month', 'year'] as const;

/** "3 months ago (edited)" (always English, F-12-AC4) in the UI's language; edited is said separately. */
export function ageText(published: string, locale: string): { age: string; edited: boolean } {
  const edited = /\(edited\)/i.test(published);
  const m = published.match(/(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago/i);
  const unit = m && UNITS.find((u) => u === m[2]!.toLowerCase());
  if (!m || !unit) return { age: published.replace(/\s*\(edited\)/i, ''), edited };
  return { age: new Intl.RelativeTimeFormat(locale, { numeric: 'always' }).format(-Number(m[1]), unit), edited };
}

/** 571000 → "571K" / "57万". */
export const countText = (n: number, locale: string): string =>
  new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(n);
