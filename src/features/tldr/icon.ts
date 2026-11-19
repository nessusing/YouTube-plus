// The thumbnail icon (design §14.1): inserted into the thumbnail's DOM,
// absolutely positioned above the duration badge, always shown.

import { t, type MsgKey } from '@/core/i18n';
import type { BadgeState } from './types';

// A small "summary" glyph: a speech-bubble with three lines.
const GLYPH = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H10l-4 3.5V17H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" fill="currentColor" opacity=".22"/><path d="M6.5 8h11M6.5 11h11M6.5 14h7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/></svg>';

const CSS = `
  :host { all: initial; position: absolute; right: 4px; bottom: 30px; z-index: 1000; }
  button { all: unset; box-sizing: border-box; width: 28px; height: 28px; border-radius: 8px; display: grid; place-items: center;
    cursor: pointer; background: rgba(0,0,0,.72); color: #e8eaed; position: relative; transition: background .15s, color .15s, opacity .15s; }
  button:hover { background: rgba(0,0,0,.9); }
  button:focus-visible { outline: 2px solid #8ab4f8; outline-offset: 1px; }
  svg { width: 18px; height: 18px; }
  .idle { opacity: .55; }
  .idle:hover { opacity: 1; }
  .ready { background: #1a73e8; color: #fff; }
  .ready:hover { background: #1765cc; }
  /* Title verdict at a glance: green / amber / red (plain blue = no verdict). */
  .ready.match { background: #1e8e3e; }
  .ready.match:hover { background: #188038; }
  .ready.partial { background: #f9ab00; color: #202124; }
  .ready.partial:hover { background: #f29900; }
  .ready.mismatch { background: #d93025; }
  .ready.mismatch:hover { background: #c5221f; }
  .unreadable { color: #9aa0a6; opacity: .6; cursor: not-allowed; }
  .error { color: #f28b82; }
  .paused { color: #fdd663; cursor: default; }
  .dot { position: absolute; right: 2px; bottom: 2px; width: 7px; height: 7px; border-radius: 50%; background: #fdd663; }
  .spin { position: absolute; inset: 3px; border: 2px solid rgba(255,255,255,.25); border-top-color: #8ab4f8; border-radius: 50%; animation: r .9s linear infinite; }
  .pause { position: absolute; right: 1px; bottom: 1px; font: 700 9px/1 Roboto, Arial, sans-serif; }
  @keyframes r { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .spin { animation-duration: 3s; } }
`;

const LABEL: Record<BadgeState['state'], MsgKey> = {
  idle: 'icon.idle',
  queued: 'icon.queued',
  running: 'icon.running',
  ready: 'icon.ready',
  unreadable: 'icon.unreadable',
  error: 'icon.error',
  paused: 'icon.paused',
};

export class Icon {
  readonly host: HTMLElement;
  private btn: HTMLButtonElement;
  state: BadgeState = { state: 'idle' };

  constructor(public videoId: string, onClick: (icon: Icon) => void) {
    this.host = document.createElement('ytpp-tldr-icon');
    const root = this.host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${CSS}</style><button type="button">${GLYPH}</button>`;
    this.btn = root.querySelector('button')!;
    // The icon sits inside the thumbnail link: keep clicks from navigating.
    const stop = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
    };
    for (const t of ['mousedown', 'pointerdown', 'touchstart']) this.host.addEventListener(t, (e) => e.stopPropagation());
    this.host.addEventListener('click', (e) => {
      stop(e);
      if (this.state.state === 'unreadable' || this.state.state === 'paused') return;
      onClick(this);
    });
    this.set({ state: 'idle' });
  }

  set(s: BadgeState): void {
    this.state = s;
    const verdict = s.state === 'ready' ? s.summary.titleMatch?.verdict : undefined;
    this.btn.className = verdict ? `${s.state} ${verdict}` : s.state;
    this.btn.querySelector('.dot, .spin, .pause')?.remove();
    const extra = s.state === 'queued' ? 'dot' : s.state === 'running' ? 'spin' : s.state === 'paused' ? 'pause' : '';
    if (extra) {
      const d = document.createElement('span');
      d.className = extra;
      if (extra === 'pause') d.textContent = 'Ⅱ';
      this.btn.append(d);
    }
    let label = t(LABEL[s.state]);
    if (verdict) label += `${t('sep')}${t(`verdict.${verdict}`)}`;
    if (s.state === 'unreadable' || s.state === 'error') label += `${t('sep')}${s.reason}`;
    if (s.state === 'paused') label += `${t('sep')}${s.reason}${s.until ? t('icon.resumeIn', { n: Math.ceil((s.until - Date.now()) / 60000) }) : ''}`;
    this.btn.title = label;
    this.btn.setAttribute('aria-label', label);
    this.btn.setAttribute('aria-disabled', String(s.state === 'unreadable' || s.state === 'paused'));
  }

  attach(thumb: HTMLElement): void {
    if (this.host.parentElement !== thumb) thumb.append(this.host);
  }
}
