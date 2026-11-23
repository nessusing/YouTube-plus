// The caption-style card (F-12-AC12). Shared by the player overlay and
// the options page preview. Lives in its own shadow root so neither page's CSS
// reaches it. Drawing is a function of time (frame.ts): call draw() every frame.

import { t, type MsgKey } from '@/core/i18n';
import type { Comment } from './comments';
import { frameAt } from './frame';
import type { DisplayParams } from './params';
import type { Slot } from './schedule';

/** Font size relative to the player's height, about YouTube's own captions. */
const FONT_PER_HEIGHT = 0.034;
export const LINE_HEIGHT = 1.35;
/**
 * Side padding of the pill. The background is a full stadium at any height
 * (radius = half the height), so two lines need more room at the sides to keep
 * the text off the arcs. Lines are always measured with the wide padding: what
 * fits on one line there fits with the narrow one too.
 */
const PAD_ONE_LINE = '0.75em';
const PAD_LINES = '1.05em';

/** The card's font size in px for a player this tall. */
export const fontPx = (height: number, p: Pick<DisplayParams, 'fontScale'>): number =>
  Math.round(Math.min(64, Math.max(10, height * FONT_PER_HEIGHT * p.fontScale)) * 2) / 2;
/** The card is at most this share of the player's width. */
const MAX_WIDTH = 0.8;

const CSS = `
:host { all: initial; position: absolute; left: 0; right: 0; display: flex; justify-content: center; pointer-events: none; z-index: 40; }
.card {
  position: relative; box-sizing: border-box; color: #fff; text-align: center;
  font-family: "YouTube Noto", Roboto, "Arial Unicode Ms", Arial, Helvetica, Verdana, "PT Sans Caption", sans-serif;
  padding: 0.2em ${PAD_LINES}; border-radius: 999px;
}
.view { overflow: hidden; }
.text { white-space: pre-line; overflow-wrap: anywhere; transition: transform 300ms ease; }
.handle { opacity: 0.72; font-weight: 500; margin-right: 0.45em; }
.text img { height: 1em; width: auto; vertical-align: -0.15em; }
.corner {
  position: absolute; top: calc(100% + 3px); font-size: max(10px, 0.7em); line-height: 1.5; padding: 0 0.6em; border-radius: 1em;
  background: rgba(8, 8, 8, 0.8); color: #ddd; white-space: nowrap;
}
.badge { right: 0.6em; }
.label { left: 0.6em; }
.measure { position: absolute; visibility: hidden; left: 0; top: 0; }
`;

export interface DrawOptions {
  p: DisplayParams;
  /** The player's size in CSS pixels. */
  width: number;
  height: number;
  /** Distance of the card's top from the player's top. */
  top: number;
  /** Show the debug source label. */
  debug?: boolean;
}

/** The comment as nodes: "@handle" then the text, member emoji as inline images. */
export function commentNodes(doc: Document, c: Comment): Node[] {
  const out: Node[] = [];
  const handle = doc.createElement('span');
  handle.className = 'handle';
  handle.textContent = c.author;
  out.push(handle);
  let at = 0;
  for (const img of [...c.images].sort((a, b) => a.start - b.start)) {
    if (img.start < at) continue;
    out.push(doc.createTextNode(c.text.slice(at, img.start)));
    const el = doc.createElement('img');
    el.src = img.url;
    el.alt = img.alt;
    el.referrerPolicy = 'no-referrer';
    out.push(el);
    at = img.start + img.len;
  }
  out.push(doc.createTextNode(c.text.slice(at)));
  return out;
}

/** The debug label: where the card came from. */
export function sourceLabel(s: Pick<Slot, 'kind' | 'conf'>): string {
  if (s.kind === 'ai') return t('dm.src.ai', { c: (s.conf ?? 0).toFixed(2) });
  return t(`dm.src.${s.kind}` as MsgKey);
}

export class CardView {
  readonly host: HTMLElement;
  private readonly card: HTMLElement;
  private readonly view: HTMLElement;
  private readonly text: HTMLElement;
  private readonly badge: HTMLElement;
  private readonly label: HTMLElement;
  private readonly measurer: HTMLElement;
  private readonly lineCache = new Map<string, number>();
  private shown = '';

  constructor(private readonly doc: Document = document) {
    this.host = doc.createElement('div');
    const root = this.host.attachShadow({ mode: 'open' });
    const style = doc.createElement('style');
    style.textContent = CSS;
    const make = (cls: string, parent: Node) => parent.appendChild(Object.assign(doc.createElement('div'), { className: cls }));
    this.card = make('card', root);
    this.view = make('view', this.card);
    this.text = make('text', this.view);
    this.badge = make('corner badge', this.card);
    this.label = make('corner label', this.card);
    this.measurer = make('card measure', root);
    root.prepend(style);
    // Hide the card, not the host: :host's display beats the page's [hidden], and measuring needs layout.
    this.card.hidden = true;
  }

  /** Lines a comment takes at this size (measured, cached). */
  lines(c: Comment, o: DrawOptions): number {
    const font = this.fontPx(o);
    const key = `${c.id}|${c.text.length}|${font}|${Math.round(o.width)}`;
    let n = this.lineCache.get(key);
    if (n === undefined) {
      this.style(this.measurer, o);
      const text = Object.assign(this.doc.createElement('div'), { className: 'text' });
      text.append(...commentNodes(this.doc, c));
      this.measurer.replaceChildren(text);
      n = Math.max(1, Math.round(text.getBoundingClientRect().height / (font * LINE_HEIGHT)));
      if (this.lineCache.size > 500) this.lineCache.clear();
      this.lineCache.set(key, n);
    }
    return n;
  }

  /** Draw `slot` at `t` seconds into it; hide for no slot or outside it. */
  draw(slot: Slot | undefined, t: number, o: DrawOptions): void {
    const lines = (i: number) => this.lines(slot!.items[i]!, o);
    const frame = slot && frameAt(slot, t, (i) => Math.ceil(lines(i) / 2), o.p.fadeMs / 1000);
    if (!slot || !frame) {
      this.card.hidden = true;
      this.shown = '';
      return;
    }
    const c = slot.items[frame.item]!;
    const font = this.fontPx(o);
    const lh = font * LINE_HEIGHT;
    const key = `${c.id}|${font}|${Math.round(o.width)}`;
    if (key !== this.shown) {
      this.shown = key;
      this.text.replaceChildren(...commentNodes(this.doc, c));
      this.text.style.transition = 'none';
      this.text.style.transform = 'translateY(0)';
      void this.text.offsetHeight; // start the next screen's scroll from here
      this.text.style.transition = '';
    }
    this.style(this.card, o);
    const shown = Math.min(2, lines(frame.item));
    this.view.style.height = `${shown * lh}px`;
    this.card.style.paddingInline = shown === 1 ? PAD_ONE_LINE : PAD_LINES;
    this.text.style.transform = `translateY(${-frame.screen * 2 * lh}px)`;
    this.card.style.opacity = String(frame.opacity);
    const n = slot.items.length;
    this.badge.hidden = n < 2;
    this.badge.textContent = `${frame.item + 1}/${n}${slot.extra ? ` +${slot.extra}` : ''}`;
    this.label.hidden = !o.debug;
    this.label.textContent = sourceLabel(slot);
    this.host.style.top = `${o.top}px`;
    this.card.hidden = false;
  }

  private fontPx(o: DrawOptions): number {
    return fontPx(o.height, o.p);
  }

  private style(el: HTMLElement, o: DrawOptions): void {
    const font = this.fontPx(o);
    el.style.fontSize = `${font}px`;
    el.style.lineHeight = `${font * LINE_HEIGHT}px`;
    el.style.maxWidth = `${Math.floor(o.width * MAX_WIDTH)}px`;
    el.style.background = `rgba(8, 8, 8, ${o.p.bgOpacity})`;
  }
}
