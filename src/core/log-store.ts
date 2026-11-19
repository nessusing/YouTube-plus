// Service-worker side of the log: buffer incoming entries and write them in
// batches so a chatty page does not hammer storage.

import { appendCapped, LOG_KEY, type LogEntry } from './log';

const FLUSH_MS = 1000;

export class LogStore {
  private pending: LogEntry[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private writing: Promise<void> = Promise.resolve();

  add(entries: LogEntry[]): void {
    this.pending.push(...entries);
    this.timer ??= setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, FLUSH_MS);
  }

  /** Writes are chained so two flushes never read-modify-write at once. */
  flush(): Promise<void> {
    this.writing = this.writing.then(async () => {
      if (this.pending.length === 0) return;
      const batch = this.pending;
      this.pending = [];
      const got = await browser.storage.local.get(LOG_KEY);
      const existing = (got[LOG_KEY] as LogEntry[] | undefined) ?? [];
      await browser.storage.local.set({ [LOG_KEY]: appendCapped(existing, batch) });
    }).catch((e) => console.error('[yt++ core] log flush failed', e));
    return this.writing;
  }

  async clear(): Promise<void> {
    this.pending = [];
    await this.writing;
    await browser.storage.local.set({ [LOG_KEY]: [] });
  }
}
