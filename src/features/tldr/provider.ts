// GeminiWebProvider (design §9.1): prompt → answer → parse → delete the chat.

import type { Logger } from '@/core/log';
import { GeminiError, type GeminiWebClient } from './client';
import { buildBatchPrompt, buildPrompt, parseBatch, parseSummary } from './protocol';
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
    return parseSummary(parsed.text ?? '', 'und');
  }

  /**
   * Several videos in one request. Returns a result for every input; a video
   * the model left out gets a transient error (click to retry).
   */
  async summarizeMany(inputs: SummaryInput[]): Promise<Map<string, SummaryResult>> {
    const out = new Map<string, SummaryResult>();
    if (inputs.length === 1) {
      out.set(inputs[0]!.videoId, await this.summarize(inputs[0]!));
      return out;
    }
    let parsed;
    try {
      parsed = await this.client.generate(buildBatchPrompt(inputs));
    } catch (e) {
      const r: SummaryResult = e instanceof GeminiError
        ? { kind: 'error', error: e.error, detail: e.message }
        : { kind: 'error', error: { code: 'transient' }, detail: String(e) };
      for (const i of inputs) out.set(i.videoId, r);
      return out;
    }
    if (parsed.cid) await this.deleteOrQueue(parsed.cid);
    const got = parseBatch(parsed.text ?? '', inputs.map((i) => i.videoId), 'und');
    const missing = inputs.filter((i) => !got.has(i.videoId)).map((i) => i.videoId);
    if (missing.length) this.log.warn(`batch of ${inputs.length}: no answer for ${missing.join(', ')}`, (parsed.text ?? '').slice(0, 500));
    for (const i of inputs) {
      out.set(i.videoId, got.get(i.videoId) ?? { kind: 'error', error: { code: 'transient' }, detail: 'missing from the batch answer' });
    }
    return out;
  }

  /**
   * A free-form request (danmaku placement, plans P13): the answer's text. The
   * chat is deleted like a summary's. Throws GeminiError.
   */
  async ask(prompt: string): Promise<string> {
    const parsed = await this.client.generate(prompt);
    if (parsed.cid) await this.deleteOrQueue(parsed.cid);
    return parsed.text ?? '';
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
