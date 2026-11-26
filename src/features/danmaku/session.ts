// One video's danmaku (F-12): fetch the comments page by page (placing
// starts after the first batch and gets redone as more arrive), lay out the
// timeline in the chosen mode, ask Gemini in batches in AI mode, and cache it
// all. Leaving the video stops fetching and the batches not yet sent; a
// Gemini request already out finishes and its result is still cached.

import type { Logger } from '@/core/log';
import type { Settings } from '@/core/settings';
import type { AskResult } from '@/features/tldr/service';
import { buildPlacementPrompt, parsePlacement, type Placement } from './ai';
import type { VideoInfo } from './bridge';
import { type CacheEntry, type DanmakuCache, isFresh } from './cache';
import { type Comment, type HeatSegment, lean } from './comments';
import { promptOf } from './params';
import type { MainRpc } from './rpc';
import type { Slot } from './schedule';
import { fetchLimit, layoutOf, type Mode, mergeTimeline, modeOf, planVideo, prepareComments } from './timeline';

export interface SessionDeps {
  rpc: MainRpc;
  cache: DanmakuCache;
  log: Logger;
  settings(): Settings;
  ask(videoId: string, prompt: string): Promise<AskResult>;
  /** Something the button or the overlay shows changed. */
  changed(s: Session): void;
}

/** Why AI mode is not used for this video. */
export type AiFailure = 'no_transcript' | 'auth' | 'quota' | 'blocked' | 'failed';

export type Phase = 'fetching' | 'ready' | 'none' | 'error';

/** Wait before retrying a failed batch. */
const RETRY_MS = 15_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class Session {
  phase: Phase = 'fetching';
  error = '';
  comments: Comment[] = [];
  total = 0;
  heatmap: HeatSegment[] = [];
  complete = false;
  /** When the comments were fetched (kept when only Gemini's results are added). */
  private fetchedAt = Date.now();
  slots: Slot[] = [];
  /** The style `slots` were laid out for. */
  private style: 'card' | 'fly' = 'card';
  /** Gemini's verdicts, by comment id. */
  placements = new Map<string, Placement>();
  /** Sent to Gemini and given up on: neither shown nor sent again. */
  private unknown = new Set<string>();
  aiFailed: AiFailure | undefined;
  /** Comments waiting for, or out at, Gemini. */
  aiPending = 0;
  private aiRunning = false;
  private stopped = false;
  private readonly t0 = performance.now();
  readonly timing: { fetchMs?: number; pages: number; firstAiMs?: number; aiMs?: number; batches: number[]; cached: boolean } = { pages: 0, batches: [], cached: false };

  constructor(readonly info: VideoInfo, private deps: SessionDeps) {}

  get videoId(): string {
    return this.info.videoId;
  }

  private get p() {
    return this.deps.settings().danmaku.params;
  }

  /** Stop fetching and sending; what is in flight finishes. */
  stop(): void {
    this.stopped = true;
  }

  /** The mode in use, and why it is not the one chosen. */
  mode(): { mode: Mode; fallback?: AiFailure } {
    const d = this.deps.settings().danmaku;
    const mode = modeOf(d, !!this.aiFailed);
    return d.placement === 'ai' && this.aiFailed ? { mode, fallback: this.aiFailed } : { mode };
  }

  async run(): Promise<void> {
    const c = await this.deps.cache.get(this.videoId).catch(() => undefined);
    if (c) {
      this.placements = new Map(Object.entries(c.placements ?? {}));
      if (c.aiFailed?.reason === 'no_transcript' && isFresh({ t: c.aiFailed.t, complete: true }, Date.now(), this.p.cache.days)) this.aiFailed = 'no_transcript';
    }
    if (c && isFresh(c, Date.now(), this.p.cache.days)) {
      Object.assign(this, { comments: c.comments, total: c.total, heatmap: c.heatmap, complete: true, fetchedAt: c.t, phase: c.comments.length ? 'ready' : 'none' });
      this.timing.cached = true;
      this.rebuild();
      this.deps.log.debug(`${this.videoId}: ${c.comments.length} comments from the cache`);
      // An entry from before it kept these: add them for the preview (F-12-AC19).
      if (!c.title || !c.duration) await this.save();
      void this.placeWithAi();
      return;
    }
    await this.fetch();
  }

  private async fetch(): Promise<void> {
    const { rpc, log } = this.deps;
    try {
      const w = await rpc.watch(this.videoId);
      this.heatmap = w.heatmap;
      if (!w.token) {
        this.phase = 'none';
        this.complete = true;
        this.deps.changed(this);
        log.debug(`${this.videoId}: no comments section`);
        await this.save();
        return;
      }
      const limit = fetchLimit(this.info.duration, this.p.comments);
      const seen = new Set<string>();
      let token: string | undefined = w.token;
      let placed = false;
      while (token && this.comments.length < limit) {
        if (this.stopped) return;
        const page = await rpc.page(token, this.videoId);
        this.timing.pages++;
        if (page.total !== undefined) this.total = page.total;
        for (const c of page.comments) {
          if (seen.has(c.id)) continue;
          seen.add(c.id);
          this.comments.push(lean(c));
        }
        token = page.next;
        if (!placed && this.comments.length >= this.p.comments.firstBatch) {
          placed = true;
          this.phase = 'ready';
          this.rebuild();
          void this.placeWithAi();
        } else {
          this.deps.changed(this);
        }
      }
      this.complete = true;
    } catch (e) {
      log.warn(`${this.videoId}: fetching comments failed after ${this.comments.length}: ${String(e)}`);
      if (!this.comments.length) {
        this.phase = 'error';
        this.error = String(e instanceof Error ? e.message : e);
        this.deps.changed(this);
        return;
      }
    }
    if (this.stopped) return;
    this.timing.fetchMs = performance.now() - this.t0;
    this.phase = this.comments.length ? 'ready' : 'none';
    this.rebuild();
    if (this.complete) await this.save();
    this.logLine('fetched');
    void this.placeWithAi();
  }

  /** Where the player is in this video (0 when another one is on). */
  private now(): number {
    if (new URLSearchParams(location.search).get('v') !== this.videoId) return 0;
    return document.querySelector<HTMLVideoElement>('#movie_player video')?.currentTime ?? 0;
  }

  /** Lay out again (more comments, new results, changed settings); only the part not yet played changes. */
  rebuild(): void {
    const d = this.deps.settings().danmaku;
    const style = d.style === 'fly' ? 'fly' : 'card';
    // The two styles share the screen differently: nothing carries over.
    if (style !== this.style) this.slots = [];
    this.style = style;
    const next = planVideo({
      videoId: this.videoId, duration: this.info.duration, total: this.total, comments: this.comments,
      heatmap: this.heatmap, placements: this.placements, aiFailed: !!this.aiFailed,
    }, d).slots;
    this.slots = mergeTimeline(this.slots, next, this.now(), layoutOf(d.params.display, style));
    this.deps.changed(this);
  }

  /** Settings changed: lay out again, and start Gemini if AI mode now applies. */
  settingsChanged(): void {
    if (this.phase !== 'ready') return;
    this.rebuild();
    void this.placeWithAi();
  }

  /** Comments Gemini has not seen yet (timestamped ones are placed by their timestamps). */
  private unplaced(): Comment[] {
    return prepareComments(this.comments, this.p).comments.filter((c) => !c.stamps.length && !this.placements.has(c.id) && !this.unknown.has(c.id));
  }

  /** AI mode: send what Gemini has not placed, a batch at a time, until done or stopped. */
  private async placeWithAi(): Promise<void> {
    if (this.aiRunning) return;
    this.aiRunning = true;
    try {
      for (;;) {
        if (this.stopped || this.mode().mode !== 'ai') return;
        const todo = this.unplaced();
        const size = Math.max(1, Math.round(this.p.ai.batchSize));
        // A short batch only once nothing more is coming.
        if (!todo.length || (todo.length < size && !this.complete)) return;
        this.aiPending = todo.length;
        this.deps.changed(this);
        const failure = await this.placeBatch(todo.slice(0, size));
        if (failure) {
          this.aiFailed = failure;
          this.deps.log.info(`${this.videoId}: AI placement unavailable (${failure}); using ${this.p.ai.fallback}`);
          if (failure === 'no_transcript') await this.save();
          this.rebuild();
          return;
        }
        this.timing.firstAiMs ??= performance.now() - this.t0;
        this.rebuild();
        await this.save();
        if (!this.unplaced().length && this.complete) {
          this.timing.aiMs = performance.now() - this.t0;
          this.logLine('AI done');
        }
      }
    } finally {
      this.aiPending = 0;
      this.aiRunning = false;
      this.deps.changed(this);
    }
  }

  /**
   * One batch: retried once after a pause, then each half once (F-12);
   * what still fails is unknown and not shown. A failure that
   * concerns the whole video (no transcript, signed out, quota, blocked) ends
   * AI mode for it.
   */
  private async placeBatch(batch: Comment[]): Promise<AiFailure | undefined> {
    let left = await this.ask(batch);
    if (typeof left === 'string') return left;
    if (left.length) {
      await sleep(RETRY_MS);
      left = await this.ask(left);
      if (typeof left === 'string') return left;
    }
    if (left.length > 1) {
      const half = Math.ceil(left.length / 2);
      const rest: Comment[] = [];
      for (const part of [left.slice(0, half), left.slice(half)]) {
        if (this.stopped) return undefined;
        const r = await this.ask(part);
        if (typeof r === 'string') return r;
        rest.push(...r);
      }
      left = rest;
    } else if (left.length === 1) {
      const r = await this.ask(left);
      if (typeof r === 'string') return r;
      left = r;
    }
    for (const c of left) this.unknown.add(c.id);
    if (left.length) this.deps.log.warn(`${this.videoId}: Gemini placed no answer for ${left.length} comments; not shown`);
    return undefined;
  }

  /** One request: the comments it did not place, or a failure for the whole video. */
  private async ask(batch: Comment[]): Promise<Comment[] | AiFailure> {
    const p = this.p;
    const prompt = buildPlacementPrompt(promptOf(p.ai), {
      videoId: this.videoId, title: this.info.title, duration: this.info.duration,
      comments: batch.map((c, k) => ({ id: k + 1, text: c.text })),
    }, p.ai.commentMaxChars);
    const started = performance.now();
    const r = await this.deps.ask(this.videoId, prompt).catch((e): AskResult => ({ ok: false, code: 'transient', detail: String(e) }));
    this.timing.batches.push(performance.now() - started);
    if (!r.ok) return r.code === 'auth' || r.code === 'quota' || r.code === 'blocked' ? r.code : batch;
    const parsed = parsePlacement(r.text, { duration: this.info.duration, highConf: p.ai.highConf });
    if (parsed.status === 'no_transcript') return 'no_transcript';
    if (parsed.status === 'unparsed') return batch;
    const left: Comment[] = [];
    batch.forEach((c, k) => {
      const pl = parsed.items.get(k + 1);
      if (pl) this.placements.set(c.id, pl);
      else left.push(c);
    });
    return left;
  }

  private async save(): Promise<void> {
    const e: CacheEntry = {
      t: this.fetchedAt, used: Date.now(), total: this.total, heatmap: this.heatmap, comments: this.comments, complete: this.complete,
      title: this.info.title, duration: this.info.duration,
      placements: Object.fromEntries(this.placements),
      aiFailed: this.aiFailed === 'no_transcript' ? { reason: 'no_transcript', t: Date.now() } : undefined,
    };
    await this.deps.cache.set(this.videoId, e).catch((err) => this.deps.log.warn(`${this.videoId}: caching failed: ${String(err)}`));
  }

  /** One log line per video with the timings (F-12-AC15). */
  private logLine(what: string): void {
    const s = (ms?: number) => (ms === undefined ? '–' : `${(ms / 1000).toFixed(1)} s`);
    const t = this.timing;
    const m = this.mode();
    this.deps.log.info(`${this.videoId} ${what}: ${this.comments.length} comments, ${t.pages} pages in ${s(t.fetchMs)}${t.cached ? ' (cache)' : ''}; mode ${m.mode}${m.fallback ? ` (fallback: ${m.fallback})` : ''}; ${this.slots.length} cards; Gemini first ${s(t.firstAiMs)}, all ${s(t.aiMs)}, batches ${t.batches.map((b) => s(b)).join(' / ') || '–'}`);
  }
}
