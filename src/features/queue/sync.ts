// Queue sync controller (design §24): the list is the durable store, this
// tab's official queue (TLPQ) is a working copy. Forward operations, not
// state; on pull the list wins.

import { t } from '@/core/i18n';
import type { Logger } from '@/core/log';
import type { PlayerEvent } from './bridge';
import {
  chunk, isTlpq, isWatchedElsewhere, isWatchedHere, opSignature, parseCaptured, planOverwrite, reconcile,
  SignatureFilter, translate, type ListItem, type LocalOp, type Mapping, type TlpqItem,
} from './core';
import { LIST_KEY, MAP_SESSION_KEY, STATE_KEY } from './keys';
import { Outbox } from './outbox';
import type { Rpc } from './rpc';
import type { StatusBadge } from './status-badge';

const PULL_MIN_INTERVAL = 10_000;
const FAILURES_FOR_BADGE = 3;

export class QueueSync {
  private filter = new SignatureFilter();
  private map: Mapping = {};
  private listId: string | undefined;
  private tlpq: string | undefined;
  private tlpqItems: TlpqItem[] = [];
  private listItems: ListItem[] = [];
  /** remove/move ops waiting for an add to be mapped first */
  private waiting: LocalOp[] = [];
  private lastPull = 0;
  private busy: Promise<unknown> = Promise.resolve();
  private resyncTimer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;
  /** The page sent playlist/create since the last createQueue() try (seen by the fetch tap). */
  private sawCreate = false;
  readonly outbox: Outbox;

  constructor(private rpc: Rpc, private log: Logger, private badge: StatusBadge, private listName: () => string) {
    this.outbox = new Outbox(
      rpc,
      log,
      (n) => {
        if (n >= FAILURES_FOR_BADGE) badge.show(t('queue.syncFailed'));
      },
      () => {
        badge.hide();
        this.scheduleResync();
      },
    );
    try {
      this.map = JSON.parse(sessionStorage.getItem(MAP_SESSION_KEY) ?? '{}') as Mapping;
    } catch {
      this.map = {};
    }
  }

  /** Serialize the big steps so a pull never overlaps a restore. */
  private run<T>(name: string, fn: () => Promise<T>): Promise<T | undefined> {
    const next = this.busy.then(fn).catch((e) => {
      this.log.error(`${name} failed`, e);
      return undefined;
    });
    this.busy = next;
    return next;
  }

  private saveMap(): void {
    try {
      sessionStorage.setItem(MAP_SESSION_KEY, JSON.stringify(this.map));
    } catch {
      // ignore
    }
  }

  stop(): void {
    this.stopped = true;
  }

  // ---------- §24.1 find the list ----------

  async ensureList(): Promise<string> {
    const name = this.listName();
    const cached = (await browser.storage.sync.get(LIST_KEY))[LIST_KEY] as { name: string; id: string } | undefined;
    if (cached?.name === name) {
      const data = await this.rpc.readPlaylist(cached.id);
      if (data.exists && data.editable) {
        this.listId = cached.id;
        this.listItems = data.items;
        return cached.id;
      }
      this.log.info(`cached list ${cached.id} is gone or not editable; looking up "${name}" again`);
    }
    const mine = await this.rpc.editablePlaylists();
    let id = mine.find((p) => p.title === name)?.id;
    if (!id) {
      id = await this.rpc.createPrivatePlaylist(name);
      this.log.info(`created private list "${name}" (${id})`);
    } else {
      this.log.info(`using list "${name}" (${id})`);
    }
    await browser.storage.sync.set({ [LIST_KEY]: { name, id } });
    this.listId = id;
    this.listItems = (await this.rpc.readPlaylist(id)).items;
    return id;
  }

  private async saveState(): Promise<void> {
    await browser.storage.local.set({
      [STATE_KEY]: { listId: this.listId, listName: this.listName(), count: this.listItems.length, updatedAt: Date.now() },
    });
  }

  /** Re-read the list, drop what other devices finished (§24.5), return the rest. */
  private async readListDroppingWatched(): Promise<ListItem[]> {
    const data = await this.rpc.readPlaylist(this.listId!);
    const watched = data.items.filter(isWatchedElsewhere);
    if (watched.length) {
      for (const part of chunk(watched)) {
        await this.outbox.add(this.listId!, part.map((w) => ({ action: 'ACTION_REMOVE_VIDEO', setVideoId: w.setVideoId })), `remove ${part.length} watched elsewhere`);
      }
      this.log.info(`${watched.length} item(s) watched on another device (≥ 90 %), removing from the list`);
    }
    this.listItems = data.items.filter((i) => !isWatchedElsewhere(i));
    return this.listItems;
  }

  // ---------- §24.2 restore ----------

  start(): Promise<unknown> {
    return this.run('start', async () => {
      await this.ensureList();
      await this.outbox.flush();
      this.tlpq = await this.rpc.currentTlpq();
      if (this.tlpq) {
        this.log.debug('tab already has a queue; pulling');
        await this.pullNow();
        return;
      }
      const items = await this.readListDroppingWatched();
      await this.saveState();
      if (!items.length) return;
      const ids = items.map((i) => i.videoId);
      this.tlpq = await this.createQueue(ids);
      if (!this.tlpq) {
        this.log.warn('restore: the page did not create a queue (3 tries)');
        return;
      }
      this.tlpqItems = await this.rpc.readQueue(this.tlpq);
      // Same order on both sides: pair by position, then fix anything left by video.
      const byPos: Mapping = {};
      this.tlpqItems.forEach((t, i) => {
        if (items[i]?.videoId === t.videoId) byPos[t.setVideoId] = items[i]!.setVideoId;
      });
      this.map = reconcile(this.tlpqItems, this.listItems, byPos);
      this.saveMap();
      this.log.info(`restored ${this.tlpqItems.length} video(s) into the queue`);
    });
  }

  /**
   * Ask the page to build the official queue. Right after the page loads, YouTube
   * sometimes ignores the command (seen 2026-11-18), so try again, but only
   * when the page never sent playlist/create: a slow create must not be doubled.
   */
  private async createQueue(ids: string[]): Promise<string | undefined> {
    for (let attempt = 1; attempt <= 3; attempt++) {
      this.sawCreate = false;
      this.filter.expect(opSignature({ kind: 'create', videoIds: ids }), Date.now());
      await this.rpc.addToQueue(ids, false);
      let tlpq = await this.waitForTlpq();
      if (!tlpq && this.sawCreate) tlpq = await this.waitForTlpq();
      if (tlpq || this.sawCreate) return tlpq;
      this.log.debug(`restore: no queue after try ${attempt}, retrying`);
    }
    return undefined;
  }

  private async waitForTlpq(): Promise<string | undefined> {
    for (let i = 0; i < 40; i++) {
      const t = await this.rpc.currentTlpq();
      if (t) return t;
      await new Promise((r) => setTimeout(r, 250));
    }
    return undefined;
  }

  // ---------- §24.3 local → list ----------

  onTap(endpoint: string, body: unknown): void {
    if (endpoint === 'playlist/create') this.sawCreate = true;
    if (this.stopped || !this.listId) return;
    const b = body as { playlistId?: unknown };
    if (endpoint === 'browse/edit_playlist' && isTlpq(b.playlistId)) this.tlpq = b.playlistId;
    const now = Date.now();
    for (const op of parseCaptured(endpoint, body)) {
      if (!this.filter.accept(opSignature(op), now)) continue;
      this.forward(op);
    }
  }

  private forward(op: LocalOp): void {
    const t = translate(op, this.map);
    if ('drop' in t) {
      if (op.kind === 'remove' || op.kind === 'move') {
        // Probably an add we have not mapped yet: try again after a resync.
        this.waiting.push(op);
        this.scheduleResync(500);
      } else {
        this.log.info(`dropped: ${t.drop}`);
      }
      return;
    }
    if (op.kind === 'remove') delete this.map[op.tlpqSetId];
    this.saveMap();
    void this.outbox.add(this.listId!, t.actions, describe(op));
  }

  /** Re-read both sides and re-pair; then retry ops that were waiting on a pairing. */
  private scheduleResync(ms = 1500): void {
    if (this.resyncTimer) clearTimeout(this.resyncTimer);
    this.resyncTimer = setTimeout(() => {
      this.resyncTimer = undefined;
      void this.run('resync', async () => {
        if (!this.listId) return;
        this.tlpq ??= await this.rpc.currentTlpq();
        if (!this.tlpq) return;
        [this.tlpqItems, this.listItems] = await Promise.all([this.rpc.readQueue(this.tlpq), this.rpc.readPlaylist(this.listId).then((d) => d.items)]);
        this.map = reconcile(this.tlpqItems, this.listItems, this.map);
        this.saveMap();
        await this.saveState();
        const waiting = this.waiting;
        this.waiting = [];
        for (const op of waiting) {
          const t = translate(op, this.map);
          if ('drop' in t) this.log.info(`dropped: ${t.drop}`);
          else {
            if (op.kind === 'remove') delete this.map[op.tlpqSetId];
            await this.outbox.add(this.listId, t.actions, describe(op));
          }
        }
        this.saveMap();
      });
    }, ms);
  }

  // ---------- §24.4 list → local ----------

  onVisible(): void {
    if (this.stopped || Date.now() - this.lastPull < PULL_MIN_INTERVAL) return;
    void this.run('pull', () => this.pullNow());
  }

  private async pullNow(): Promise<void> {
    this.lastPull = Date.now();
    if (!this.listId) return;
    // Send first, so stale data never overwrites our own unsent operations.
    await this.outbox.flush();
    if (!(await this.outbox.isEmpty())) {
      this.log.debug('pull skipped: outbox not empty');
      return;
    }
    this.tlpq = await this.rpc.currentTlpq();
    const list = await this.readListDroppingWatched();
    await this.saveState();
    if (!this.tlpq) {
      if (list.length) {
        const ids = list.map((i) => i.videoId);
        this.filter.expect(opSignature({ kind: 'create', videoIds: ids }), Date.now());
        await this.rpc.addToQueue(ids, false);
      }
      return;
    }
    let tlpqItems: TlpqItem[];
    try {
      tlpqItems = await this.rpc.readQueue(this.tlpq);
    } catch (e) {
      this.log.warn('could not read the queue; treating as none', e);
      return;
    }
    this.map = reconcile(tlpqItems, list, this.map);
    const playing = await this.rpc.playing();
    const playingSet = playing.playlistId === this.tlpq ? tlpqItems.find((t) => t.videoId === playing.videoId)?.setVideoId : undefined;
    const plan = planOverwrite(tlpqItems, list, this.map, playingSet);
    if (!plan.removeTlpq.length && !plan.add.length && !plan.moves.length) return;
    const now = Date.now();
    for (const s of plan.removeTlpq) {
      this.filter.expect(opSignature({ kind: 'remove', tlpqSetId: s }), now);
      await this.rpc.removeFromQueue(this.tlpq, s);
      delete this.map[s];
    }
    for (const m of plan.moves) await this.rpc.moveInQueue(this.tlpq, m.tlpqSetId, m.afterTlpqSetId);
    if (plan.add.length) {
      for (const a of plan.add) this.filter.expect(opSignature({ kind: 'add', videoId: a.videoId }), now);
      await this.rpc.addToQueue(plan.add.map((a) => a.videoId), false);
      await new Promise((r) => setTimeout(r, 1500));
    }
    this.tlpqItems = await this.rpc.readQueue(this.tlpq);
    this.map = reconcile(this.tlpqItems, list, this.map);
    this.saveMap();
    this.log.info(`pulled: -${plan.removeTlpq.length} +${plan.add.length} moved ${plan.moves.length}`);
  }

  // ---------- §24.5 watched here ----------

  onPlayer(e: PlayerEvent): void {
    if (this.stopped || !this.listId || !this.tlpq || e.playlistId !== this.tlpq) return;
    if (!isWatchedHere(e.currentTime, e.duration, e.type === 'ended')) return;
    const item = this.tlpqItems.find((t) => t.videoId === e.videoId && this.map[t.setVideoId]);
    const listSet = item && this.map[item.setVideoId];
    if (!item || !listSet) return;
    delete this.map[item.setVideoId];
    this.saveMap();
    void this.outbox.add(this.listId, [{ action: 'ACTION_REMOVE_VIDEO', setVideoId: listSet }], `watched ${e.videoId}`);
  }
}

function describe(op: LocalOp): string {
  switch (op.kind) {
    case 'create': return `add ${op.videoIds.length} (new queue)`;
    case 'add': return `add ${op.videoId}`;
    case 'remove': return `remove ${op.tlpqSetId}`;
    case 'move': return `move ${op.tlpqSetId} after ${op.afterTlpqSetId ?? '(top)'}`;
  }
}
