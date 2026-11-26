// The caption-style cards (F-12-AC12). Shared by the player overlay and
// the options page preview. Lives in its own shadow root so neither page's CSS
// reaches it. What a card shows is a function of time (frame.ts): call draw()
// every frame with the cards on screen. A card takes the topmost free spot
// when it appears and stays there.

import { t, type MsgKey } from '@/core/i18n';
import type { Comment } from './comments';
import { frameAt } from './frame';
import type { DisplayParams } from './params';
import type { Slot } from './schedule';
import { FONT_PER_HEIGHT } from './timing';

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
/** Above and below the text, and between stacked cards, in em. */
const PAD_Y = 0.2;
const STACK_GAP = 0.35;

/** Lines a card shows at once (F-12-AC17): the long-comment limit; two without one. */
export const screenLines = (p: Pick<DisplayParams, 'longLines'>): number => (p.longLines > 0 ? p.longLines : 2);

/**
 * The avatar before the handle (F-19-AC1): round, about as tall as a line of
 * text, top-aligned in the line box so it never makes the line taller. Width
 * and margin add up to AVATAR_EM (timing.ts).
 */
export const AVATAR_CSS = `.avatar { display: inline-block; width: 1.2em; height: 1.2em; margin-right: 0.35em; border-radius: 50%; object-fit: cover; vertical-align: top; position: relative; top: ${(LINE_HEIGHT - 1.2) / 2}em; background: rgba(255, 255, 255, 0.15); }`;

const CSS = `
:host { all: initial; position: absolute; left: 0; right: 0; pointer-events: none; z-index: 40; }
.row { position: absolute; left: 0; right: 0; display: flex; justify-content: center; }
.card {
  position: relative; box-sizing: border-box; color: #fff; text-align: center;
  font-family: "YouTube Noto", Roboto, "Arial Unicode Ms", Arial, Helvetica, Verdana, "PT Sans Caption", sans-serif;
  padding: ${PAD_Y}em ${PAD_LINES}; border-radius: 999px;
}
.view { overflow: hidden; }
.text { white-space: pre-line; overflow-wrap: anywhere; transition: transform 300ms ease; }
.text.clamp { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: var(--lines); overflow: hidden; }
.handle { opacity: 0.72; font-weight: 500; margin-right: 0.45em; }
${AVATAR_CSS}
.text img:not(.avatar) { height: 1em; width: auto; vertical-align: -0.15em; }
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
  /** Distance of the first card's top from the player's top. */
  top: number;
  /** Show the debug source label. */
  debug?: boolean;
}

/** A card on screen: the slot and the seconds into it. */
export interface Shown {
  slot: Slot;
  t: number;
}

/**
 * The comment as nodes: the avatar (F-19-AC1; none without an address, removed
 * if it fails to load), "@handle", then the text, member emoji as inline
 * images. `measure`: for sizing only, so no image is loaded.
 */
export function commentNodes(doc: Document, c: Comment, measure = false): Node[] {
  const out: Node[] = [];
  if (c.avatar) {
    const av = doc.createElement('img');
    av.className = 'avatar';
    av.alt = '';
    av.referrerPolicy = 'no-referrer';
    av.addEventListener('error', () => av.remove());
    if (!measure) av.src = c.avatar;
    out.push(av);
  }
  const handle = doc.createElement('span');
  handle.className = 'handle';
  handle.textContent = c.author;
  out.push(handle);
  let at = 0;
  for (const img of [...c.images].sort((a, b) => a.start - b.start)) {
    if (img.start < at) continue;
    out.push(doc.createTextNode(c.text.slice(at, img.start)));
    const el = doc.createElement('img');
    if (measure) el.style.width = '1.2em';
    else {
      el.src = img.url;
      el.alt = img.alt;
    }
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

interface Card {
  /** Missing: the player has no room for it, so it is not drawn while on screen. */
  els?: { row: HTMLElement; card: HTMLElement; view: HTMLElement; text: HTMLElement; badge: HTMLElement; label: HTMLElement };
  y: number;
  height: number;
  /** The comment drawn, to know when a rotating card moves on. */
  shown: string;
}

export class CardView {
  readonly host: HTMLElement;
  private readonly root: ShadowRoot;
  private readonly measurer: HTMLElement;
  private readonly lineCache = new Map<string, number>();
  private readonly cards = new Map<Slot, Card>();
  /** What the cards' sizes and positions depend on. */
  private sizes = '';

  constructor(private readonly doc: Document = document) {
    this.host = doc.createElement('div');
    this.root = this.host.attachShadow({ mode: 'open' });
    const style = doc.createElement('style');
    style.textContent = CSS;
    this.measurer = this.make('card measure', this.root);
    this.root.prepend(style);
  }

  /** Lines a comment takes at this size (measured, cached). */
  lines(c: Comment, o: DrawOptions): number {
    const font = this.fontPx(o);
    const key = `${c.id}|${c.text.length}|${font}|${Math.round(o.width)}`;
    let n = this.lineCache.get(key);
    if (n === undefined) {
      this.style(this.measurer, o);
      const text = Object.assign(this.doc.createElement('div'), { className: 'text' });
      text.append(...commentNodes(this.doc, c, true));
      this.measurer.replaceChildren(text);
      n = Math.max(1, Math.round(text.getBoundingClientRect().height / (font * LINE_HEIGHT)));
      if (this.lineCache.size > 2000) this.lineCache.clear();
      this.lineCache.set(key, n);
    }
    return n;
  }

  /** Draw the cards on screen now, earliest first; any other goes away. */
  draw(shown: Shown[], o: DrawOptions): void {
    const sizes = `${this.fontPx(o)}|${Math.round(o.width)}|${Math.round(o.height)}|${screenLines(o.p)}|${!!o.debug}`;
    const live = new Set(shown.map((s) => s.slot));
    for (const [slot, c] of this.cards) {
      if (sizes === this.sizes && live.has(slot)) continue;
      c.els?.row.remove();
      this.cards.delete(slot);
    }
    this.sizes = sizes;
    if (!shown.length) return;
    this.host.style.top = `${o.top}px`;
    for (const { slot, t } of shown) {
      let c = this.cards.get(slot);
      if (!c) this.cards.set(slot, (c = this.place(slot, o)));
      if (c.els) this.paint(slot, c, t, o);
    }
  }

  /** A new card: the topmost spot clear of the others, if the player has one. */
  private place(slot: Slot, o: DrawOptions): Card {
    const font = this.fontPx(o);
    const corner = o.debug || slot.items.length > 1 || slot.extra > 0 ? 3 + Math.max(10, 0.7 * font) * 1.5 : 0;
    const most = Math.max(...slot.items.map((c) => Math.min(screenLines(o.p), this.lines(c, o))));
    const height = most * font * LINE_HEIGHT + 2 * PAD_Y * font + corner;
    const gap = STACK_GAP * font;
    const taken = [...this.cards.values()].filter((c) => c.els);
    const y = [0, ...taken.map((c) => c.y + c.height + gap)]
      .sort((a, b) => a - b)
      .find((at) => taken.every((c) => at + height + gap <= c.y + 0.5 || at >= c.y + c.height + gap - 0.5));
    if (y === undefined || o.top + y + height > o.height) return { y: 0, height: 0, shown: '' };
    const row = this.make('row', this.root);
    row.style.top = `${y}px`;
    const card = this.make('card', row);
    const view = this.make('view', card);
    const text = this.make('text', view);
    const badge = this.make('corner badge', card);
    const label = this.make('corner label', card);
    return { els: { row, card, view, text, badge, label }, y, height, shown: '' };
  }

  private paint(slot: Slot, c: Card, t: number, o: DrawOptions): void {
    const { card, view, text, badge, label } = c.els!;
    const per = screenLines(o.p);
    const clamped = (i: number) => !!slot.items[i]!.cut && o.p.longLines > 0;
    const frame = frameAt(slot, t, (i) => (clamped(i) ? 1 : Math.ceil(this.lines(slot.items[i]!, o) / per)), o.p.fadeMs / 1000);
    card.hidden = !frame;
    if (!frame) return;
    const comment = slot.items[frame.item]!;
    const font = this.fontPx(o);
    const lh = font * LINE_HEIGHT;
    if (c.shown !== comment.id) {
      c.shown = comment.id;
      text.replaceChildren(...commentNodes(this.doc, comment));
      text.classList.toggle('clamp', clamped(frame.item));
      text.style.setProperty('--lines', String(per));
      text.style.transition = 'none';
      text.style.transform = 'translateY(0px)';
      void text.offsetHeight; // start the next screen's scroll from here
      text.style.transition = '';
    }
    this.style(card, o);
    const lines = Math.min(per, this.lines(comment, o));
    view.style.height = `${lines * lh}px`;
    card.style.paddingInline = lines === 1 ? PAD_ONE_LINE : PAD_LINES;
    // A stadium up to two lines; taller cards keep the two-line corners.
    card.style.borderRadius = lines > 2 ? `${lh + PAD_Y * font}px` : '999px';
    text.style.transform = `translateY(${-frame.screen * per * lh}px)`;
    card.style.opacity = String(frame.opacity);
    const n = slot.items.length;
    badge.hidden = n < 2 && !slot.extra;
    badge.textContent = n < 2 ? `+${slot.extra}` : `${frame.item + 1}/${n}${slot.extra ? ` +${slot.extra}` : ''}`;
    label.hidden = !o.debug;
    label.textContent = sourceLabel(slot);
  }

  private make(cls: string, parent: Node): HTMLElement {
    return parent.appendChild(Object.assign(this.doc.createElement('div'), { className: cls }));
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
