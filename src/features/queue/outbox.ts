// Pending writes to the list (design §24.3): persisted, retried with backoff,
// shared by all tabs (one flusher at a time via a short lease).

import type { Logger } from '@/core/log';
import { retryDelayMs, type ListAction } from './core';
import { LOCK_KEY, OUTBOX_KEY } from './keys';
import type { Rpc } from './rpc';

export interface OutboxEntry {
  id: string;
  listId: string;
  actions: ListAction[];
  desc: string;
  attempts: number;
  nextAt: number;
}

const LEASE_MS = 30000;
const tabId = Math.random().toString(36).slice(2);

async function read(): Promise<OutboxEntry[]> {
  return ((await browser.storage.local.get(OUTBOX_KEY))[OUTBOX_KEY] as OutboxEntry[] | undefined) ?? [];
}

async function write(entries: OutboxEntry[]): Promise<void> {
  await browser.storage.local.set({ [OUTBOX_KEY]: entries });
}

export async function outboxSize(): Promise<number> {
  return (await read()).length;
}

export class Outbox {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private flushing: Promise<void> | undefined;
  consecutiveFailures = 0;

  constructor(private rpc: Rpc, private log: Logger, private onFailures: (n: number) => void, private onSent: () => void) {}

  async add(listId: string, actions: ListAction[], desc: string): Promise<void> {
    if (!actions.length) return;
    const entries = await read();
    entries.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, listId, actions, desc, attempts: 0, nextAt: 0 });
    await write(entries);
    void this.flush();
  }

  private async lease(): Promise<boolean> {
    const now = Date.now();
    const got = (await browser.storage.local.get(LOCK_KEY))[LOCK_KEY] as { owner: string; until: number } | undefined;
    if (got && got.owner !== tabId && got.until > now) return false;
    await browser.storage.local.set({ [LOCK_KEY]: { owner: tabId, until: now + LEASE_MS } });
    return true;
  }

  private async release(): Promise<void> {
    const got = (await browser.storage.local.get(LOCK_KEY))[LOCK_KEY] as { owner: string } | undefined;
    if (got?.owner === tabId) await browser.storage.local.remove(LOCK_KEY);
  }

  /** Send everything that is due. Resolves when this pass is done. */
  flush(): Promise<void> {
    this.flushing ??= this.run().finally(() => (this.flushing = undefined));
    return this.flushing;
  }

  private async run(): Promise<void> {
    if (!(await this.lease())) {
      this.schedule(LEASE_MS);
      return;
    }
    try {
      for (;;) {
        const entries = await read();
        const now = Date.now();
        const e = entries.find((x) => x.nextAt <= now);
        if (!e) {
          const soonest = Math.min(...entries.map((x) => x.nextAt));
          if (Number.isFinite(soonest)) this.schedule(soonest - now);
          return;
        }
        const res = await this.rpc.editPlaylist(e.listId, e.actions).catch((err) => ({ ok: false, status: 0, error: String(err), added: [] }));
        const fresh = await read();
        const idx = fresh.findIndex((x) => x.id === e.id);
        if (idx < 0) continue;
        if (res.ok) {
          fresh.splice(idx, 1);
          this.consecutiveFailures = 0;
          this.log.debug(`sent: ${e.desc}`);
          await write(fresh);
          this.onSent();
        } else if (res.status === 400) {
          // Stale setVideoId (§28.1 item 4). One bad action fails the batch, so split.
          if (e.actions.length > 1) {
            fresh.splice(idx, 1, ...e.actions.map((a, k) => ({ ...e, id: `${e.id}-${k}`, actions: [a], desc: `${e.desc} [${k + 1}/${e.actions.length}]` })));
            this.log.info(`batch rejected (400), retrying one by one: ${e.desc}`);
          } else {
            fresh.splice(idx, 1);
            this.log.info(`dropped, entry no longer exists (400): ${e.desc}`);
          }
          await write(fresh);
        } else {
          const attempts = e.attempts + 1;
          fresh[idx] = { ...e, attempts, nextAt: Date.now() + retryDelayMs(e.attempts) };
          await write(fresh);
          this.consecutiveFailures++;
          this.log.warn(`send failed (${res.status} ${res.error ?? ''}), attempt ${attempts}: ${e.desc}`);
          this.onFailures(this.consecutiveFailures);
        }
      }
    } finally {
      await this.release();
    }
  }

  private schedule(ms: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, Math.max(1000, ms));
  }

  async isEmpty(): Promise<boolean> {
    return (await read()).length === 0;
  }
}
