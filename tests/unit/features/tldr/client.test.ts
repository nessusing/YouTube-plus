import { describe, expect, it, vi } from 'vitest';
import { GeminiError, GeminiWebClient } from '@/features/tldr/client';
import type { Parsed } from '@/features/tldr/protocol';
import type { ProviderError } from '@/features/tldr/types';

const ok = (text: string): Parsed => ({ text, cid: 'c_1' });
const err = (code: ProviderError['code']) => new GeminiError({ code } as ProviderError, code);

/** A client whose two channels are stubs. */
function setup() {
  const c = new GeminiWebClient(() => 0);
  vi.spyOn(c, 'tokens').mockResolvedValue({ at: 'a', bl: 'b', sid: 's', key: 'k' });
  const session = vi.fn<() => Promise<Parsed>>();
  const stream = vi.fn<() => Promise<Parsed>>();
  Object.assign(c, { viaSession: session, viaStream: stream });
  return { c, session, stream };
}

describe('GeminiWebClient channels', () => {
  it('tries processSession first', async () => {
    const { c, session, stream } = setup();
    session.mockResolvedValue(ok('new'));
    expect((await c.generate('p')).text).toBe('new');
    expect(stream).not.toHaveBeenCalled();
    expect(c.lastChannel).toBe('processSession');
  });

  it('falls back on protocol errors and keeps using the channel that answered', async () => {
    const { c, session, stream } = setup();
    session.mockRejectedValue(err('protocol'));
    stream.mockResolvedValue(ok('old'));
    expect((await c.generate('p')).text).toBe('old');
    expect(c.lastChannel).toBe('StreamGenerate');
    session.mockClear();
    await c.generate('p');
    expect(session).not.toHaveBeenCalled();

    // The old channel goes away later: back to processSession, which then goes first.
    stream.mockRejectedValue(err('protocol'));
    session.mockResolvedValue(ok('new'));
    expect((await c.generate('p')).text).toBe('new');
    stream.mockClear();
    await c.generate('p');
    expect(stream).not.toHaveBeenCalled();
  });

  it('falls back on auth errors (e.g. no SAPISID) too', async () => {
    const { c, session, stream } = setup();
    session.mockRejectedValue(err('auth'));
    stream.mockResolvedValue(ok('old'));
    expect((await c.generate('p')).text).toBe('old');
  });

  it('does not try the other channel for quota, blocks or network errors', async () => {
    for (const code of ['quota', 'blocked', 'transient'] as const) {
      const { c, session, stream } = setup();
      session.mockRejectedValue(err(code));
      await expect(c.generate('p')).rejects.toMatchObject({ error: { code } });
      expect(stream).not.toHaveBeenCalled();
    }
  });

  it('reports auth when both fail and one of them was auth', async () => {
    const { c, session, stream } = setup();
    session.mockRejectedValue(err('auth'));
    stream.mockRejectedValue(err('protocol'));
    await expect(c.generate('p')).rejects.toMatchObject({ error: { code: 'auth' } });
    session.mockRejectedValue(err('protocol'));
    await expect(c.generate('p')).rejects.toMatchObject({ error: { code: 'protocol' } });
  });
});
