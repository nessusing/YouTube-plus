// F-03-AC13: the TL;DR self-check — get tokens, one real summary (says which
// channel answered), the chat deleted; a protocol change shows as `protocol`.
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { runChecks } from '@/core/selfcheck';
import { tldrChecks } from '@/features/tldr/checks';
import { GeminiError } from '@/features/tldr/client';
import { PENDING_DELETES_KEY } from '@/features/tldr/provider';
import type { TldrService } from '@/features/tldr/service';
import type { ProviderError, SummaryResult } from '@/features/tldr/types';

const log = { debug() {}, info() {}, warn() {}, error() {} };

/** A service whose Gemini side is a stub. `deleteFails` leaves the chat on the pending-deletes list. */
function svc(o: { tokens?: ProviderError['code']; result?: SummaryResult; deleteFails?: boolean; paused?: boolean } = {}) {
  return {
    client: {
      lastChannel: 'processSession',
      async tokens() {
        if (o.tokens) throw new GeminiError({ code: o.tokens } as ProviderError, o.tokens);
        return { at: 'a', bl: 'b', sid: 's', key: 'k' };
      },
    },
    provider: {
      async summarize() {
        if (o.deleteFails) await fakeBrowser.storage.local.set({ [PENDING_DELETES_KEY]: ['c_1'] });
        return o.result ?? { kind: 'ok', data: { points: ['A man at the zoo talks about elephants'], lang: 'en' } };
      },
    },
    isPaused: () => !!o.paused,
  } as unknown as TldrService;
}

/** The four checks' outcomes, in their order. */
async function run(s: TldrService) {
  const [login, tokens, summarize, del] = await runChecks(tldrChecks(s), () => true, log);
  return { login, tokens, summarize, delete: del };
}

describe('TL;DR self-check', () => {
  beforeEach(() => fakeBrowser.reset());

  it('F-03-AC13 all well: tokens, a real summary naming the channel that answered, the chat deleted', async () => {
    const r = await run(svc());
    expect(r.login!.status).toBe('pass');
    expect(r.tokens!.status).toBe('pass');
    expect(r.summarize!.status).toBe('pass');
    expect(r.summarize!.detail).toMatch(/^\[processSession\] en · /);
    expect(r.delete!.status).toBe('pass');
  });

  it('F-03-AC13 the chat could not be deleted: the delete check fails', async () => {
    const r = await run(svc({ deleteFails: true }));
    expect(r.summarize!.status).toBe('pass');
    expect(r.delete!.status).toBe('fail');
  });

  it('F-03-AC13 both channels changed: the summary reports protocol', async () => {
    const r = await run(svc({ result: { kind: 'error', error: { code: 'protocol' }, detail: 'both channels failed' } }));
    expect(r.summarize!.status).toBe('fail');
    expect(r.summarize!.detail).toMatch(/^protocol: /);
  });

  it('F-03-AC12 F-03-AC13 not signed in: login fails and the rest is skipped, nothing is sent', async () => {
    const r = await run(svc({ tokens: 'auth' }));
    expect(r.login!.status).toBe('fail');
    expect(r.tokens!.status).toBe('skip');
    expect(r.summarize!.status).toBe('skip');
    expect(r.delete!.status).toBe('skip');
  });
});
