// @vitest-environment happy-dom
// The TL;DR icon and its tooltip in a fake page: what a click shows.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setLang } from '@/core/i18n';
import { Icon } from '@/features/tldr/icon';
import { Tooltip } from '@/features/tldr/tooltip';
import type { BadgeState } from '@/features/tldr/types';

const READY: BadgeState = {
  state: 'ready',
  summary: { lang: 'en', points: ['First point', 'Second point', 'Third point'], titleMatch: { verdict: 'partial', reason: 'Only half of it is about cats.' } },
};

const tip = () => document.querySelector('ytpp-tldr-tooltip')!.shadowRoot!.querySelector<HTMLElement>('.tip')!;
const button = (name: string) => [...tip().querySelectorAll('button')].find((b) => b.textContent === name);

beforeEach(() => {
  setLang('en');
  document.body.innerHTML = '<div id="thumb" style="position:relative"></div>';
  document.querySelector('ytpp-tldr-tooltip')?.remove();
});

describe('TL;DR icon and tooltip', () => {
  it('F-03-AC2 the icon color says the state; a click on it does not reach the thumbnail link', () => {
    const clicks = vi.fn();
    const icon = new Icon('abcdefghijk', clicks);
    const link = document.createElement('a');
    link.href = '/watch?v=abcdefghijk';
    const onLink = vi.fn();
    link.addEventListener('click', onLink);
    document.body.append(link);
    icon.attach(link);
    const btn = icon.host.shadowRoot!.querySelector('button')!;
    expect(btn.className).toBe('idle');
    icon.set(READY);
    expect(btn.className).toBe('ready partial');
    icon.set({ state: 'signin' });
    expect(btn.className).toBe('signin');
    icon.host.click();
    expect(clicks).toHaveBeenCalledOnce();
    expect(onLink).not.toHaveBeenCalled();
  });

  it('F-03-AC3 a summary: the title verdict first, the points, Regenerate and Copy', async () => {
    const regenerate = vi.fn();
    const t = new Tooltip({ regenerate, signin: vi.fn(), recheck: vi.fn() });
    t.open(document.getElementById('thumb')!, 'abcdefghijk', READY);
    expect(tip().firstElementChild!.textContent).toContain('Only half of it is about cats.');
    expect([...tip().querySelectorAll('li')].map((l) => l.textContent)).toEqual(['First point', 'Second point', 'Third point']);
    button('Regenerate')!.click();
    expect(regenerate).toHaveBeenCalledWith('abcdefghijk');
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    button('Copy')!.click();
    await vi.waitFor(() => expect(button('Copied')).toBeDefined());
    expect(writeText.mock.calls[0]![0]).toMatch(/Only half of it is about cats\.\n\n- First point\n- Second point\n- Third point$/);
  });

  it('F-03-AC12 signed out: says so and offers "Sign in to Gemini" and "I\'ve signed in"', () => {
    const signin = vi.fn();
    const recheck = vi.fn();
    const t = new Tooltip({ regenerate: vi.fn(), signin, recheck });
    t.open(document.getElementById('thumb')!, 'abcdefghijk', { state: 'signin' });
    expect(tip().textContent).toContain('Sign in to Gemini');
    button('Sign in to Gemini')!.click();
    expect(signin).toHaveBeenCalledOnce();
    button("I've signed in")!.click();
    expect(recheck).toHaveBeenCalledOnce();
    expect(button('Checking…')).toBeDefined();
  });
});
