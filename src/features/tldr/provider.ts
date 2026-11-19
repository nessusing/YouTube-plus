// GeminiWebProvider (design §9.1): prompt → answer → parse → delete the chat.

import type { Logger } from '@/core/log';
import { GeminiError, type GeminiWebClient } from './client';
import { buildPrompt, parseSummary } from './protocol';
import type { SummaryInput, SummaryProvider, SummaryResult } from './types';

export const PENDING_DELETES_KEY = 'tldr/pendingDeletes';

export class GeminiWebProvider implements SummaryProvider {
  constructor(private client: GeminiWebClient, private log: Logger) {}

  async summarize(input: SummaryInput): Promise<SummaryResult> {
    let parsed;
    try {
      parsed = await this.client.generate(buildPrompt(input));
    } catch (e) {
      if (e instanceof GeminiError) return { kind: 'error', error: e.error, detail: e.message };
      return { kind: 'error', error: { code: 'transient' }, detail: String(e) };
    }
    if (parsed.cid) await this.deleteOrQueue(parsed.cid);
    return parseSummary(parsed.text ?? '', input.lang === 'auto' ? 'und' : input.lang);
  }

  private async deleteOrQueue(cid: string): Promise<void> {
    try {
      await this.client.deleteConversation(cid);
    } catch (e) {
      this.log.warn(`could not delete conversation, will retry: ${String(e)}`);
      const got = (await browser.storage.local.get(PENDING_DELETES_KEY))[PENDING_DELETES_KEY] as string[] | undefined;
      await browser.storage.local.set({ [PENDING_DELETES_KEY]: [...(got ?? []), cid] });
    }
  }

  /** Retry failed deletes (§10.4); called when the queue is idle. */
  async retryDeletes(): Promise<void> {
    const got = ((await browser.storage.local.get(PENDING_DELETES_KEY))[PENDING_DELETES_KEY] as string[] | undefined) ?? [];
    if (!got.length) return;
    const left: string[] = [];
    for (const cid of got) {
      try {
        await this.client.deleteConversation(cid);
      } catch {
        left.push(cid);
      }
    }
    await browser.storage.local.set({ [PENDING_DELETES_KEY]: left });
    if (left.length < got.length) this.log.info(`deleted ${got.length - left.length} leftover conversation(s)`);
  }
}
