// TL;DR service (background) with a fake browser and a stubbed Gemini client:
// what each tab's icons are told.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { withDefaults } from '@/core/settings';
import { GeminiError } from '@/features/tldr/client';
import { TldrService } from '@/features/tldr/service';

const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

/** A tab's port: what it was sent, and a way to send to the service. */
function port() {
  const out: { videoId: string; badge: { state: string } }[] = [];
  let onMsg: (m: unknown) => void = () => {};
  const p = {
    name: 'tldr',
    onMessage: { addListener: (f: (m: unknown) => void) => { onMsg = f; } },
    onDisconnect: { addListener: () => {} },
    postMessage: (m: never) => out.push(m),
  };
  return { p, out, send: (m: unknown) => onMsg(m), last: (id: string) => out.filter((m) => m.videoId === id).at(-1)?.badge.state };
}

function service() {
  const s = withDefaults(undefined);
  s.tldr.prefetch = false;
  const svc = new TldrService(() => s, log);
  const summarize = vi.spyOn(svc.provider, 'summarizeMany').mockResolvedValue(new Map());
  const tab = port();
  svc.attach(tab.p as never);
  return { svc, tab, summarize };
}

const want = (id: string) => ({ type: 'want', items: [{ videoId: id, title: 'x', visible: true }] });
const auth = () => new GeminiError({ code: 'auth' }, 'no SAPISID');

describe('TL;DR service', () => {
  beforeEach(() => fakeBrowser.reset());
  afterEach(() => vi.useRealTimers());

  it('F-03-AC11 a cached summary is shown at once, without queueing', async () => {
    const now = Date.now();
    await fakeBrowser.storage.local.set({ 'tldr/cache/orig:jNQXAC9IVRw': { kind: 'ok', t: now, used: now, data: { lang: 'en', points: ['p1'] } } });
    const { tab } = service();
    tab.send(want('jNQXAC9IVRw'));
    await vi.waitFor(() => expect(tab.last('jNQXAC9IVRw')).toBe('ready'));
  });

  it('F-03-AC12 signed out: icons say "sign in", nothing is sent to Gemini, even on a click', async () => {
    const { svc, tab, summarize } = service();
    vi.spyOn(svc.client, 'tokens').mockRejectedValue(auth());
    await svc.probe();
    tab.send(want('aaaaaaaaaaa'));
    await vi.waitFor(() => expect(tab.last('aaaaaaaaaaa')).toBe('signin'));
    tab.send({ type: 'click', item: { videoId: 'aaaaaaaaaaa', title: 'x' } });
    await vi.waitFor(() => expect(tab.out.length).toBeGreaterThanOrEqual(2));
    await new Promise((r) => setTimeout(r, 50));
    expect(tab.last('aaaaaaaaaaa')).toBe('signin');
    expect(summarize).not.toHaveBeenCalled();
  });

  it('F-03-AC12 a Gemini or Google page loading checks again; signed in, the waiting icons start', async () => {
    const { svc, tab } = service();
    const tokens = vi.spyOn(svc.client, 'tokens').mockRejectedValue(auth());
    await svc.probe();
    tab.send(want('aaaaaaaaaaa'));
    await vi.waitFor(() => expect(tab.last('aaaaaaaaaaa')).toBe('signin'));
    tokens.mockResolvedValue({ at: 'a', bl: 'b', sid: 's', key: 'k' });
    svc.onGeminiPage();
    await vi.waitFor(() => expect(tab.last('aaaaaaaaaaa')).toBe('queued'));
  });

  it('F-03-AC12 still signed out: checked again every 10 minutes while something waits', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { svc, tab } = service();
    const tokens = vi.spyOn(svc.client, 'tokens').mockRejectedValue(auth());
    await svc.probe();
    tab.send(want('aaaaaaaaaaa'));
    await vi.advanceTimersByTimeAsync(0);
    const calls = tokens.mock.calls.length;
    await vi.advanceTimersByTimeAsync(9 * 60 * 1000);
    expect(tokens.mock.calls.length).toBe(calls);
    await vi.advanceTimersByTimeAsync(60 * 1000 + 10);
    expect(tokens.mock.calls.length).toBe(calls + 1);
  });
});
