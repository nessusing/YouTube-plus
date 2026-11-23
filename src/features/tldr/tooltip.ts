// The summary tooltip (F-03-AC3): one at a time, next to the thumbnail,
// flips side when there is no room, closes on outside click or Esc.

import { t } from '@/core/i18n';
import type { BadgeState, Summary } from './types';

const CSS = `
  :host { all: initial; }
  .tip { position: fixed; z-index: 2300; width: min(380px, calc(100vw - 24px)); max-height: min(70vh, 520px); overflow: auto;
    background: var(--bg); color: var(--fg); border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px 12px;
    box-shadow: 0 8px 28px rgba(0,0,0,.35); font: 14px/1.55 Roboto, "Noto Sans CJK SC", Arial, sans-serif; }
  .tip.dark { --bg: #212121; --fg: #f1f1f1; --muted: #aaa; --line: #3a3a3a; --btn: rgba(255,255,255,.1); --btnh: rgba(255,255,255,.2); --accent: #3ea6ff; --onaccent: #0f0f0f; }
  .tip.light { --bg: #fff; --fg: #0f0f0f; --muted: #606060; --line: #e5e5e5; --btn: rgba(0,0,0,.05); --btnh: rgba(0,0,0,.1); --accent: #065fd4; --onaccent: #fff; }
  h4 { margin: 0 0 8px; font-size: 13px; font-weight: 500; color: var(--muted); }
  ul { margin: 0; padding-left: 18px; }
  li { margin: 4px 0; }
  .match { margin: 0 0 10px; padding: 8px 10px; border-radius: 8px; font-size: 13px; }
  .match b { margin-right: 6px; }
  .match.match { background: rgba(30,142,62,.15); }
  .match.partial { background: rgba(249,171,0,.18); }
  .match.mismatch { background: rgba(217,48,37,.16); }
  pre { white-space: pre-wrap; margin: 0; font: inherit; }
  .muted { color: var(--muted); }
  .row { display: flex; gap: 8px; justify-content: flex-end; margin-top: 12px; }
  button { all: unset; cursor: pointer; padding: 6px 12px; border-radius: 16px; background: var(--btn); font-size: 13px; }
  button:hover { background: var(--btnh); }
  button:focus-visible { outline: 2px solid #8ab4f8; }
  button.primary { background: var(--accent); color: var(--onaccent); font-weight: 500; }
  button.primary:hover { filter: brightness(1.08); }
  button[disabled] { opacity: .6; cursor: default; }
  .signin p { margin: 0 0 6px; }
`;

function isDark(): boolean {
  return document.documentElement.hasAttribute('dark');
}

export class Tooltip {
  private host: HTMLElement | undefined;
  private tip: HTMLElement | undefined;
  private anchor: HTMLElement | undefined;
  videoId: string | undefined;

  constructor(private actions: { regenerate(videoId: string): void; signin(): void; recheck(): void }) {
    document.addEventListener('pointerdown', (e) => {
      if (this.host && !e.composedPath().includes(this.host) && !e.composedPath().some((n) => (n as Element).tagName === 'YTPP-TLDR-ICON')) this.close();
    }, true);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close();
    });
    window.addEventListener('scroll', () => this.place(), { passive: true });
    document.addEventListener('yt-navigate-start', () => this.close());
  }

  open(anchor: HTMLElement, videoId: string, s: BadgeState): void {
    if (!this.host) {
      this.host = document.createElement('ytpp-tldr-tooltip');
      const root = this.host.attachShadow({ mode: 'open' });
      root.innerHTML = `<style>${CSS}</style><div class="tip" role="dialog" aria-label="TL;DR"></div>`;
      this.tip = root.querySelector('.tip')!;
      document.documentElement.append(this.host);
    }
    this.anchor = anchor;
    this.videoId = videoId;
    this.update(videoId, s);
  }

  /** New state for a video; re-render if it is the open one. */
  update(videoId: string, s: BadgeState): void {
    if (!this.tip || videoId !== this.videoId) return;
    this.tip.className = `tip ${isDark() ? 'dark' : 'light'}`;
    this.tip.replaceChildren(...this.render(videoId, s));
    this.place();
  }

  private render(videoId: string, s: BadgeState): Node[] {
    const h = (tag: string, cls = '', text = '') => {
      const e = document.createElement(tag);
      if (cls) e.className = cls;
      if (text) e.textContent = text;
      return e;
    };
    switch (s.state) {
      case 'idle':
      case 'queued':
        return [h('p', 'muted', t('tip.queued'))];
      case 'running':
        return [h('p', 'muted', t('tip.running'))];
      case 'error':
        return [h('p', 'muted', s.reason)];
      case 'paused':
        return [h('p', 'muted', s.reason)];
      case 'unreadable':
        return [h('p', 'muted', s.reason)];
      case 'ready':
        return this.renderSummary(videoId, s.summary, h);
      case 'signin':
        return this.renderSignin(h);
    }
  }

  /** Not signed in to Gemini: say why and offer the way out (F-03-AC12). */
  private renderSignin(h: (t: string, c?: string, x?: string) => HTMLElement): Node[] {
    const box = h('div', 'signin');
    box.append(h('h4', '', t('tip.signinTitle')), h('p', '', t('tip.signin')), h('p', 'muted', t('tip.signinHint')));
    const row = h('div', 'row');
    const recheck = h('button', '', t('tip.recheck'));
    recheck.addEventListener('click', () => {
      recheck.textContent = t('tip.checking');
      recheck.setAttribute('disabled', '');
      this.actions.recheck();
    });
    const signin = h('button', 'primary', t('tip.signinBtn'));
    signin.addEventListener('click', () => this.actions.signin());
    row.append(recheck, signin);
    return [box, row];
  }

  private renderSummary(videoId: string, sum: Summary, h: (t: string, c?: string, x?: string) => HTMLElement): Node[] {
    const out: Node[] = [];
    let copyText = '';
    // The title verdict comes first: it is what decides whether to click.
    if (sum.titleMatch) {
      const verdict = t(`verdict.${sum.titleMatch.verdict}`);
      const m = h('div', `match ${sum.titleMatch.verdict}`);
      m.append(h('b', '', verdict), sum.titleMatch.reason);
      out.push(m);
      copyText = `${verdict}${t('sep')}${sum.titleMatch.reason}\n\n`;
    }
    out.push(h('h4', '', 'TL;DR'));
    if (sum.points.length) {
      const ul = h('ul');
      for (const p of sum.points) ul.append(h('li', '', p));
      out.push(ul);
      copyText += sum.points.map((p) => `- ${p}`).join('\n');
    } else {
      out.push(h('pre', '', sum.raw ?? ''));
      copyText += sum.raw ?? '';
    }
    const row = h('div', 'row');
    const regen = h('button', '', t('tip.regenerate'));
    regen.addEventListener('click', () => this.actions.regenerate(videoId));
    const copy = h('button', '', t('tip.copy'));
    copy.addEventListener('click', async () => {
      await navigator.clipboard.writeText(copyText);
      copy.textContent = t('tip.copied');
      setTimeout(() => (copy.textContent = t('tip.copy')), 1500);
    });
    row.append(regen, copy);
    out.push(row);
    return out;
  }

  private place(): void {
    if (!this.tip || !this.anchor) return;
    if (!this.anchor.isConnected) return this.close();
    const a = this.anchor.getBoundingClientRect();
    const w = this.tip.offsetWidth;
    const hgt = this.tip.offsetHeight;
    const gap = 8;
    let left = a.right + gap;
    if (left + w > innerWidth - 8) left = a.left - gap - w; // flip to the left
    if (left < 8) left = Math.max(8, Math.min(a.left, innerWidth - w - 8)); // below instead
    let top = left === a.right + gap || left === a.left - gap - w ? a.top : a.bottom + gap;
    top = Math.max(8, Math.min(top, innerHeight - hgt - 8));
    this.tip.style.left = `${Math.round(left)}px`;
    this.tip.style.top = `${Math.round(top)}px`;
  }

  close(): void {
    this.host?.remove();
    this.host = this.tip = this.anchor = undefined;
    this.videoId = undefined;
  }
}
