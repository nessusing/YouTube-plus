// @vitest-environment happy-dom
// F-02 page notices (core/notify.ts) in a fake page: dragging sideways and the
// shared position, stepping past the miniplayer, the same text not stacking,
// and the settings (how many at once, how long, where).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { notify, NOTIFY_X_KEY } from '@/core/notify';
import { saveSettings, withDefaults, type NotifySettings } from '@/core/settings';
import { MINI_BAR_TAG } from '@/features/player/consts';

const realAttach = Element.prototype.attachShadow;
const INSTANCE = Symbol.for('ytpp.notify');

beforeEach(() => {
  fakeBrowser.reset();
  // The stack lives in a closed shadow root; open it so the test can look in.
  Element.prototype.attachShadow = function (this: Element, init: ShadowRootInit) {
    return realAttach.call(this, { ...init, mode: 'open' });
  };
  delete (globalThis as Record<symbol, unknown>)[INSTANCE];
  document.querySelectorAll('ytpp-notify').forEach((e) => e.remove());
  document.body.innerHTML = '<ytd-app></ytd-app>';
  document.documentElement.removeAttribute('data-ytpp-mini-min');
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  Element.prototype.attachShadow = realAttach;
});

const host = () => document.querySelector<HTMLElement>('ytpp-notify')!;
/** Texts of the notices showing, newest first. */
const shown = () => [...(document.querySelector('ytpp-notify')?.shadowRoot?.querySelectorAll('.toast:not(.leaving)') ?? [])]
  .map((e) => e.querySelector('.msg')!.textContent).reverse();
const flush = () => vi.advanceTimersByTimeAsync(0);
const px = (v: string) => Number(v.replace('px', ''));

async function setNotify(patch: Partial<NotifySettings>): Promise<void> {
  const s = withDefaults(undefined);
  s.notify = { ...s.notify, ...patch };
  await saveSettings(s);
}

async function show(text: string, opts?: Parameters<typeof notify>[1]): Promise<void> {
  notify(text, opts);
  await flush();
}

describe('page notices', () => {
  it('F-02-AC4 the same text again: no second notice, its time starts over', async () => {
    await show('Added to x');
    await vi.advanceTimersByTimeAsync(3000);
    await show('Added to x');
    expect(shown()).toEqual(['Added to x']);
    await vi.advanceTimersByTimeAsync(3500); // 6.5 s after the first: past 4 s, within 4 s of the second
    expect(shown()).toEqual(['Added to x']);
    await vi.advanceTimersByTimeAsync(1000);
    expect(shown()).toEqual([]);
  });

  it('F-02-AC5 at most maxVisible at once, the oldest going first', async () => {
    await setNotify({ maxVisible: 2 });
    await show('one');
    await show('two');
    await show('three');
    expect(shown()).toEqual(['three', 'two']);
  });

  it('F-02-AC5 how long each kind shows: plain, with a button, error', async () => {
    await setNotify({ plainSec: 2, actionSec: 5, errorSec: 9 });
    await show('plain');
    await show('action', { action: { label: 'View', run() {} } });
    await show('error', { error: true });
    await vi.advanceTimersByTimeAsync(2100);
    expect(shown()).toEqual(['error', 'action']);
    await vi.advanceTimersByTimeAsync(3000);
    expect(shown()).toEqual(['error']);
    await vi.advanceTimersByTimeAsync(4000);
    expect(shown()).toEqual([]);
  });

  it('F-02-AC5 position top: under the masthead instead of at the bottom', async () => {
    await setNotify({ position: 'top' });
    await show('hi');
    expect(host().style.top).not.toBe('auto');
    expect(host().style.bottom).toBe('auto');
    expect(host().shadowRoot!.querySelector('.stack')!.classList.contains('top')).toBe(true);
  });

  it('F-02-AC2 dragged: moves only sideways, and the place is saved for every tab', async () => {
    await show('drag me');
    const toast = host().shadowRoot!.querySelector<HTMLElement>('.toast')!;
    toast.setPointerCapture = () => {};
    const left0 = px(host().style.left);
    const bottom0 = host().style.bottom;
    const ev = (type: string, x: number, y: number) => toast.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0, pointerId: 1, clientX: x, clientY: y }));
    ev('pointerdown', left0, 700);
    ev('pointermove', left0 - 200, 100);
    ev('pointerup', left0 - 200, 100);
    await flush();
    expect(px(host().style.left)).toBe(left0 - 200);
    expect(host().style.bottom).toBe(bottom0);
    const saved = (await fakeBrowser.storage.local.get(NOTIFY_X_KEY))[NOTIFY_X_KEY] as number;
    expect(saved).toBeCloseTo((left0 - 200) / (document.documentElement.clientWidth || window.innerWidth), 3);
  });

  it('F-02-AC2 moved in another tab: this tab follows', async () => {
    await show('hi');
    await fakeBrowser.storage.local.set({ [NOTIFY_X_KEY]: 0.25 });
    await flush();
    const vw = document.documentElement.clientWidth || window.innerWidth;
    expect(px(host().style.left)).toBe(Math.round(vw * 0.25));
  });

  it('F-02-AC3 steps above the miniplayer, and above its minimized bar', async () => {
    const vh = window.innerHeight;
    const vw = document.documentElement.clientWidth || window.innerWidth;
    const box = (top: number) => ({ top, bottom: vh - 10, left: vw / 2 - 200, right: vw / 2 + 200, width: 400, height: vh - 10 - top, x: vw / 2 - 200, y: top, toJSON() {} }) as DOMRect;
    document.body.innerHTML = '<ytd-app miniplayer-is-active=""><ytd-miniplayer></ytd-miniplayer></ytd-app>';
    document.querySelector('ytd-miniplayer')!.getBoundingClientRect = () => box(vh - 300);
    await show('over the miniplayer');
    expect(px(host().style.bottom)).toBe(300 + 16);

    // Minimized: the miniplayer is hidden and the bar is what is in the way.
    document.documentElement.setAttribute('data-ytpp-mini-min', '');
    const bar = document.createElement(MINI_BAR_TAG);
    bar.getBoundingClientRect = () => box(vh - 60);
    document.body.append(bar);
    await vi.advanceTimersByTimeAsync(300); // it follows every 250 ms
    expect(px(host().style.bottom)).toBe(60 + 16);
  });
});
