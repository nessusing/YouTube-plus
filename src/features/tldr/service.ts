// TL;DR service in the service worker (design §9, §12): one global job queue
// for all tabs, the cache, the breaker, and pushing icon states to tabs.

import { t } from '@/core/i18n';
import type { Logger } from '@/core/log';
import type { Settings } from '@/core/settings';
import { SummaryCache } from './cache';
import type { CacheEntry } from './cache-rules';
import { GeminiError, GeminiWebClient } from './client';
import { BLOCK_MS, breakerOpen, count, demote, freshCounters, nextSpacing, pickBatch, upsert, type Breaker, type Counters, type Job } from './jobs';
import { PORT_NAME, STATE_KEY, type ToService, type ToTab, type VideoRef } from './messages';
import { GeminiWebProvider } from './provider';
import type { BadgeState, GeminiState, SummaryResult } from './types';

/** While signed out, look again this often (sign-in is normally noticed sooner, see onGeminiPage). */
const SIGNIN_RECHECK_MS = 10 * 60 * 1000;
const SIGNIN: BadgeState = { state: 'signin' };

interface PersistedState { counters: Counters; breaker: Breaker }
type Port = Browser.runtime.Port;

export class TldrService {
  private ports = new Map<Port, { visible: boolean; videos: Set<string> }>();
  private jobs: Job[] = [];
  /** Videos in the request now in flight (one request at a time). */
  private running = new Set<string>();
  private state: PersistedState = { counters: { hour: [], day: '', dayCount: 0 }, breaker: { state: 'closed' } };
  private loaded: Promise<void>;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private nextAllowed = 0;
  /** Signed in to Gemini? Nothing runs while 'signedOut'. */
  private gemini: GeminiState = 'unknown';
  private probing: Promise<GeminiState> | undefined;
  private probeTimer: ReturnType<typeof setTimeout> | undefined;
  readonly client: GeminiWebClient;
  readonly provider: GeminiWebProvider;
  readonly cache: SummaryCache;

  constructor(private settings: () => Settings, private log: Logger) {
    this.client = new GeminiWebClient(() => this.settings().tldr.account, log);
    this.provider = new GeminiWebProvider(this.client, log);
    this.cache = new SummaryCache(async () => this.settings().storage.tldrCacheMB * 1024 * 1024);
    this.loaded = browser.storage.local.get(STATE_KEY).then((g) => {
      const s = g[STATE_KEY] as PersistedState | undefined;
      if (s) this.state = s;
    });
  }

  private async persist(): Promise<void> {
    await browser.storage.local.set({ [STATE_KEY]: this.state });
  }

  attach(port: Port): void {
    if (port.name !== PORT_NAME) return;
    this.ports.set(port, { visible: false, videos: new Set() });
    port.onMessage.addListener((m: ToService) => void this.onMessage(port, m).catch((e) => this.log.error('message failed', e)));
    port.onDisconnect.addListener(() => {
      this.ports.delete(port);
      this.kick();
    });
  }

  private send(videoId: string, badge: BadgeState): void {
    const msg: ToTab = { type: 'state', videoId, badge };
    for (const [p, info] of this.ports) if (info.videos.has(videoId)) p.postMessage(msg);
  }

  private pausedBadge(): BadgeState | undefined {
    const b = this.state.breaker;
    if (b.state === 'quota') return { state: 'paused', reason: t('tldr.pausedQuota') };
    if (b.state === 'blocked' && Date.now() < b.until) return { state: 'paused', reason: t('tldr.pausedBlocked'), until: b.until };
    return undefined;
  }

  /** What a job that cannot run yet shows. */
  private waitingBadge(): BadgeState {
    return this.gemini === 'signedOut' ? SIGNIN : this.pausedBadge() ?? { state: 'queued' };
  }

  private fromCache(e: CacheEntry): BadgeState {
    return e.kind === 'ok' ? { state: 'ready', summary: e.data } : { state: 'unreadable', reason: e.reason };
  }

  private async onMessage(port: Port, m: ToService): Promise<void> {
    await this.loaded;
    const info = this.ports.get(port);
    if (!info) return;
    const now = Date.now();
    switch (m.type) {
      case 'ping':
        return;
      case 'foreground':
        info.visible = m.visible;
        this.kick();
        return;
      case 'want': {
        for (const it of m.items) info.videos.add(it.videoId);
        const cached = await this.cache.getMany(m.items.map((i) => i.videoId));
        for (const it of m.items) {
          const c = cached[it.videoId];
          if (c) {
            port.postMessage({ type: 'state', videoId: it.videoId, badge: this.fromCache(c) } satisfies ToTab);
            continue;
          }
          if (this.running.has(it.videoId)) {
            port.postMessage({ type: 'state', videoId: it.videoId, badge: { state: 'running' } } satisfies ToTab);
            continue;
          }
          this.jobs = upsert(this.jobs, { videoId: it.videoId, title: it.title, priority: it.visible ? 1 : 0, manual: false }, now);
          port.postMessage({ type: 'state', videoId: it.videoId, badge: this.waitingBadge() } satisfies ToTab);
        }
        this.kick();
        return;
      }
      case 'visible':
        for (const id of m.shown) {
          const j = this.jobs.find((x) => x.videoId === id);
          if (j) this.jobs = upsert(this.jobs, { videoId: id, title: j.title, priority: 1, manual: false }, now);
        }
        this.jobs = demote(this.jobs, new Set(m.hidden));
        return;
      case 'click':
      case 'regenerate':
        info.videos.add(m.item.videoId);
        if (m.type === 'regenerate') await this.cache.remove(m.item.videoId);
        else {
          const c = await this.cache.get(m.item.videoId);
          if (c) return port.postMessage({ type: 'state', videoId: m.item.videoId, badge: this.fromCache(c) } satisfies ToTab);
        }
        if (this.running.has(m.item.videoId)) return;
        this.jobs = upsert(this.jobs, { ...m.item, priority: 2, manual: true }, now);
        this.send(m.item.videoId, this.waitingBadge());
        this.kick(true);
        return;
      case 'signin':
        await this.openSignin();
        return;
      case 'recheck':
        if ((await this.probe()) !== 'ok') {
          // Still signed out: re-send so the tooltip leaves its "checking" state.
          for (const v of info.videos) if (this.jobs.some((j) => j.videoId === v)) port.postMessage({ type: 'state', videoId: v, badge: SIGNIN } satisfies ToTab);
        }
        return;
    }
  }

  private foreground(): boolean {
    for (const info of this.ports.values()) if (info.visible) return true;
    return false;
  }

  /** Run the next job when allowed. `urgent` skips the spacing for a click. */
  private kick(urgent = false): void {
    if (this.running.size) return;
    const wait = urgent ? 0 : Math.max(0, this.nextAllowed - Date.now());
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.step();
    }, wait);
  }

  private async step(): Promise<void> {
    await this.loaded;
    if (this.running.size) return;
    const now = Date.now();
    this.state.counters = freshCounters(this.state.counters, now);
    // Drop jobs no tab cares about any more.
    const wanted = new Set<string>();
    for (const info of this.ports.values()) info.videos.forEach((v) => wanted.add(v));
    this.jobs = this.jobs.filter((j) => wanted.has(j.videoId));
    if (this.gemini === 'signedOut') return this.scheduleProbe();
    const s = this.settings();
    const batch = pickBatch(this.jobs, {
      counters: this.state.counters,
      limits: { perHour: s.tldr.perHour, perDay: s.tldr.perDay, prefetch: s.tldr.prefetch },
      breaker: this.state.breaker,
      foreground: this.foreground(),
      now,
    }, Math.min(10, Math.max(1, Math.round(s.tldr.batchSize))));
    if (!batch.length) {
      await this.provider.retryDeletes().catch(() => {});
      const b = this.state.breaker;
      if (b.state === 'blocked' && now < b.until) this.retryAt(b.until);
      else if (this.jobs.length && this.state.counters.hour.length) this.retryAt(this.state.counters.hour[0]! + 3_600_000);
      return;
    }
    const ids = new Set(batch.map((j) => j.videoId));
    this.jobs = this.jobs.filter((j) => !ids.has(j.videoId));
    this.running = ids;
    for (const j of batch) this.send(j.videoId, { state: 'running' });
    let results: Map<string, SummaryResult>;
    try {
      this.state.counters = count(this.state.counters, now);
      await this.persist();
      results = await this.provider.summarizeMany(batch.map((j) => ({ videoId: j.videoId, title: j.title, titleCheck: s.tldr.titleCheck })));
    } catch (e) {
      results = new Map(batch.map((j) => [j.videoId, { kind: 'error', error: { code: 'transient' }, detail: String(e) } as SummaryResult]));
    } finally {
      this.running = new Set();
    }
    if (batch.length > 1) this.log.debug(`batch of ${batch.length} done`);
    for (const job of batch) await this.handle(job, results.get(job.videoId)!);
    this.nextAllowed = Date.now() + nextSpacing();
    this.kick();
  }

  private retryAt(t: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.step();
    }, Math.max(1000, Math.min(t - Date.now(), 2_147_000_000)));
  }

  private async handle(job: VideoRef, r: SummaryResult): Promise<void> {
    const now = Date.now();
    if (r.kind === 'ok') {
      this.setGemini('ok');
      await this.cache.set(job.videoId, { kind: 'ok', data: r.data, t: now, used: now });
      this.send(job.videoId, { state: 'ready', summary: r.data });
      this.log.debug(`summary ready: ${job.videoId}${r.data.raw ? ' (raw text)' : ''}`);
      return;
    }
    if (r.kind === 'unreadable') {
      await this.cache.set(job.videoId, { kind: 'unreadable', reason: r.reason, t: now, used: now });
      this.send(job.videoId, { state: 'unreadable', reason: r.reason });
      this.log.info(`unreadable: ${job.videoId}`);
      return;
    }
    const detail = r.detail ?? r.error.code;
    if (r.error.code === 'auth') {
      // Not signed in: park every job until the user signs in (design §15.1).
      this.log.debug(`auth error for ${job.videoId}: ${detail}`);
      this.jobs = upsert(this.jobs, { ...job, priority: 0, manual: false }, now);
      this.setGemini('signedOut');
      this.send(job.videoId, SIGNIN);
      return;
    }
    switch (r.error.code) {
      case 'quota':
        this.state.breaker = { state: 'quota' };
        this.log.warn(`quota used up (1037); paused until resumed: ${detail}`);
        break;
      case 'blocked':
        this.state.breaker = { state: 'blocked', until: now + BLOCK_MS };
        this.log.warn(`blocked; pausing 30 min: ${detail}`);
        break;
      default:
        this.log.warn(`${r.error.code} error for ${job.videoId}: ${detail}`);
    }
    await this.persist();
    const paused = this.pausedBadge();
    if (paused) {
      for (const j of this.jobs) this.send(j.videoId, paused);
      this.send(job.videoId, paused);
      this.jobs = upsert(this.jobs, { ...job, priority: 0, manual: false }, now);
    } else {
      this.send(job.videoId, { state: 'error', reason: errorText(r.error.code) });
    }
  }

  async resume(): Promise<void> {
    await this.loaded;
    this.state.breaker = { state: 'closed' };
    await this.persist();
    this.log.info('resumed by user');
    for (const j of this.jobs) this.send(j.videoId, { state: 'queued' });
    this.kick(true);
  }

  async status(): Promise<TldrStatus> {
    await this.loaded;
    return {
      counters: freshCounters(this.state.counters, Date.now()), breaker: this.state.breaker, queued: this.jobs.length, running: this.running.size,
      gemini: this.gemini, account: this.settings().tldr.account,
    };
  }

  // ---------- Gemini sign-in (design §15.1) ----------

  /** Check sign-in with one GET of the app page. Concurrent calls share it. */
  probe(): Promise<GeminiState> {
    this.probing ??= (async () => {
      try {
        await this.client.tokens();
        this.setGemini('ok');
      } catch (e) {
        if (e instanceof GeminiError && e.error.code === 'auth') this.setGemini('signedOut');
        // Signed in, but the page changed: jobs will report the protocol error.
        else if (e instanceof GeminiError && e.error.code === 'protocol') this.setGemini('ok');
        else this.log.warn(`sign-in check failed: ${String(e)}`);
      }
      return this.gemini;
    })().finally(() => { this.probing = undefined; });
    return this.probing;
  }

  private setGemini(next: GeminiState): void {
    const was = this.gemini;
    this.gemini = next;
    if (next === was) return;
    if (next === 'signedOut') {
      this.log.warn(`not signed in to Gemini (gemini.google.com/u/${this.settings().tldr.account}); waiting for sign-in`);
      for (const j of this.jobs) this.send(j.videoId, SIGNIN);
      this.scheduleProbe();
    } else if (next === 'ok' && was === 'signedOut') {
      this.log.info('signed in to Gemini; resuming');
      if (this.probeTimer) clearTimeout(this.probeTimer);
      this.probeTimer = undefined;
      for (const j of this.jobs) this.send(j.videoId, this.waitingBadge());
      this.kick(true);
    }
  }

  private scheduleProbe(): void {
    if (this.probeTimer) return;
    this.probeTimer = setTimeout(() => {
      this.probeTimer = undefined;
      if (this.gemini !== 'signedOut') return;
      if (this.jobs.length) void this.probe();
      else this.scheduleProbe();
    }, SIGNIN_RECHECK_MS);
  }

  /** Open Gemini in a new tab: it shows the sign-in or first-run screen as needed. */
  async openSignin(): Promise<void> {
    await browser.tabs.create({ url: `https://gemini.google.com/u/${this.settings().tldr.account}/app` });
  }

  /** A Gemini or Google sign-in page finished loading: the user may have just signed in. */
  onGeminiPage(): void {
    if (this.gemini !== 'ok') void this.probe();
  }

  /** The account number changed: what we knew is stale. */
  accountChanged(): void {
    this.gemini = 'unknown';
    void this.probe();
  }

  isPaused(): boolean {
    return breakerOpen(this.state.breaker, Date.now());
  }
}

export interface TldrStatus {
  counters: Counters;
  breaker: Breaker;
  queued: number;
  running: number;
  gemini: GeminiState;
  account: number;
}

function errorText(code: string): string {
  switch (code) {
    case 'protocol': return t('tldr.errProtocol');
    default: return t('tldr.errTransient');
  }
}
