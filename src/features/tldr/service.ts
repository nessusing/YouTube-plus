// TL;DR service in the service worker (design §9, §12): one global job queue
// for all tabs, the cache, the breaker, and pushing icon states to tabs.

import { t } from '@/core/i18n';
import type { Logger } from '@/core/log';
import type { Settings } from '@/core/settings';
import { SummaryCache } from './cache';
import type { CacheEntry } from './cache-rules';
import { GeminiWebClient } from './client';
import { BLOCK_MS, breakerOpen, count, demote, freshCounters, nextSpacing, pickBatch, upsert, type Breaker, type Counters, type Job } from './jobs';
import { PORT_NAME, STATE_KEY, type ToService, type ToTab, type VideoRef } from './messages';
import { GeminiWebProvider } from './provider';
import type { BadgeState, SummaryResult } from './types';

const AUTH_PAUSE_MS = 10 * 60 * 1000;

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
  /** After an auth error, prefetch waits this long (clicks still run). */
  private authPauseUntil = 0;
  readonly client: GeminiWebClient;
  readonly provider: GeminiWebProvider;
  readonly cache: SummaryCache;

  constructor(private settings: () => Settings, private log: Logger) {
    this.client = new GeminiWebClient(() => this.settings().tldr.account);
    this.provider = new GeminiWebProvider(this.client, log);
    this.cache = new SummaryCache(async () => this.settings().storage.tldrCacheMB * 1024 * 1024, () => this.settings().lang);
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
          port.postMessage({ type: 'state', videoId: it.videoId, badge: this.pausedBadge() ?? { state: 'queued' } } satisfies ToTab);
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
        this.send(m.item.videoId, this.pausedBadge() ?? { state: 'queued' });
        this.kick(true);
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
    const s = this.settings();
    const batch = pickBatch(this.jobs, {
      counters: this.state.counters,
      limits: { perHour: s.tldr.perHour, perDay: s.tldr.perDay, prefetch: s.tldr.prefetch && now >= this.authPauseUntil },
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
      results = await this.provider.summarizeMany(batch.map((j) => ({ videoId: j.videoId, title: j.title, lang: s.lang, titleCheck: s.tldr.titleCheck })));
    } catch (e) {
      results = new Map(batch.map((j) => [j.videoId, { kind: 'error', error: { code: 'transient' }, detail: String(e) } as SummaryResult]));
    } finally {
      this.running = new Set();
    }
    if (batch.length > 1) this.log.debug(`batch of ${batch.length} done`);
    for (const job of batch) {
      const result = results.get(job.videoId)!;
      if (s.lang !== this.settings().lang) {
        // Language switched mid-run: keep the result for the old language, redo it in the new one.
        if (result.kind === 'ok') await this.cache.set(job.videoId, { kind: 'ok', data: result.data, t: now, used: now }, s.lang);
        this.jobs = upsert(this.jobs, { ...job, priority: 1 }, Date.now());
        this.send(job.videoId, { state: 'queued' });
      } else await this.handle(job, result);
    }
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
    switch (r.error.code) {
      case 'quota':
        this.state.breaker = { state: 'quota' };
        this.log.warn(`quota used up (1037); paused until resumed: ${detail}`);
        break;
      case 'blocked':
        this.state.breaker = { state: 'blocked', until: now + BLOCK_MS };
        this.log.warn(`blocked; pausing 30 min: ${detail}`);
        break;
      case 'auth':
        // Not signed in: don't keep hitting Gemini for every thumbnail.
        if (now >= this.authPauseUntil) this.log.warn(`auth error, prefetch paused 10 min: ${detail}`);
        this.authPauseUntil = now + AUTH_PAUSE_MS;
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

  async status(): Promise<{ counters: Counters; breaker: Breaker; queued: number; running: number }> {
    await this.loaded;
    return { counters: freshCounters(this.state.counters, Date.now()), breaker: this.state.breaker, queued: this.jobs.length, running: this.running.size };
  }

  isPaused(): boolean {
    return breakerOpen(this.state.breaker, Date.now());
  }
}

function errorText(code: string): string {
  switch (code) {
    case 'auth': return t('tldr.errAuth');
    case 'protocol': return t('tldr.errProtocol');
    default: return t('tldr.errTransient');
  }
}
