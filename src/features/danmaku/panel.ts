// Comments panel (F-12), the drawing side: a scrollable list on the right of
// the player with the comments as the comments section shows them: avatar,
// @handle, age, text (timestamps seek), likes, replies to expand. Read only:
// no liking or replying from here. Scrolling near the end loads the next page.

import { getLang, t } from '@/core/i18n';
import type { Comment } from './comments';
import { ageText, countText, type CommentFeed } from './feed';

const CSS = `
:host { all: initial; position: absolute; top: 12px; right: 12px; bottom: 64px; z-index: 41; pointer-events: auto; }
/* button's all: unset would undo [hidden]. */
[hidden] { display: none !important; }
/* The look is on an inner box: the page's own CSS beats :host rules. */
.panel {
  position: absolute; inset: 0; display: flex; flex-direction: column; box-sizing: border-box;
  background: rgba(15, 15, 15, 0.88); color: #f1f1f1; border-radius: 12px; overflow: hidden;
  font-family: Roboto, "YouTube Noto", Arial, sans-serif; line-height: 1.45; user-select: text;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.4);
}
.head { flex: none; padding: 0.7em 1em; font-weight: 500; font-size: 1.1em; border-bottom: 1px solid rgba(255, 255, 255, 0.1); }
.head small { font-weight: 400; color: #aaa; margin-left: 0.5em; font-size: 0.85em; }
.list { flex: 1; overflow-y: auto; overscroll-behavior: contain; padding: 0.4em 0.8em 0.8em; scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.3) transparent; }
.c { display: flex; gap: 0.75em; padding: 0.6em 0; }
.avatar { flex: none; width: 2.5em; height: 2.5em; border-radius: 50%; background: #333; object-fit: cover; }
.replies .avatar { width: 1.8em; height: 1.8em; }
.body { min-width: 0; flex: 1; }
.meta { font-size: 0.88em; color: #aaa; }
.meta .who { color: #f1f1f1; font-weight: 500; margin-right: 0.4em; }
.text { white-space: pre-wrap; overflow-wrap: anywhere; margin-top: 0.15em; }
.text img { height: 1.25em; width: auto; vertical-align: -0.25em; }
.stamp { color: #3ea6ff; cursor: pointer; }
.stamp:hover { text-decoration: underline; }
.bar { display: flex; align-items: center; gap: 1em; margin-top: 0.3em; font-size: 0.88em; color: #aaa; }
.likes { display: inline-flex; align-items: center; gap: 0.35em; }
.likes svg { width: 1.15em; height: 1.15em; fill: currentColor; }
button {
  all: unset; cursor: pointer; color: #3ea6ff; font-weight: 500; font-size: 0.92em; padding: 0.25em 0.7em;
  border-radius: 1em; margin-left: -0.7em;
}
button:hover { background: rgba(62, 166, 255, 0.15); }
.replies { margin-top: 0.2em; }
.replies .c { padding: 0.4em 0; }
.note { color: #aaa; font-size: 0.88em; padding: 0.4em 0; }
.foot { text-align: center; padding: 0.8em 0; }
`;

const THUMB = 'M18.77 11h-4.23l1.52-4.94C16.38 5.03 15.54 4 14.38 4c-.58 0-1.14.24-1.52.65L7 11H3v10h4h1h9.43c1.06 0 1.98-.74 2.19-1.78l1.34-6.7C21.23 11.39 20.18 11 18.77 11zM7 20H4v-8h3V20zm12.98-6.83-1.34 6.7c-.12.47-.53.83-1.01.83H8v-8.61l5.6-6.06c.19-.21.46-.33.78-.33.6 0 1.04.57.89 1.15L13.65 12h5.12c.81 0 1.33.34 1.21 1.17z';

const locale = () => (getLang() === 'zh' ? 'zh-CN' : 'en');

export class CommentPanel {
  readonly host: HTMLElement;
  private readonly head: HTMLElement;
  private readonly list: HTMLElement;
  private readonly foot: HTMLElement;
  private feed?: CommentFeed;
  private shown = 0;
  /** Each shown comment with replies: its replies box and (top level) toggle. */
  private readonly rows = new Map<string, { box: HTMLElement; toggle?: HTMLButtonElement; c: Comment }>();
  private readonly open = new Set<string>();

  constructor(private readonly onSeek: (sec: number) => void, private readonly doc: Document = document) {
    this.host = doc.createElement('div');
    this.host.className = 'ytpp-dm-panel';
    const root = this.host.attachShadow({ mode: 'open' });
    const style = doc.createElement('style');
    style.textContent = CSS;
    this.head = this.make('div', 'head');
    this.list = this.make('div', 'list');
    this.foot = this.make('div', 'foot');
    this.list.append(this.foot);
    const box = this.make('div', 'panel');
    box.append(this.head, this.list);
    root.append(style, box);
    // The player toggles play on clicks and has its own context menu: keep both inside the panel.
    for (const type of ['click', 'dblclick', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'contextmenu', 'wheel', 'keydown']) {
      this.host.addEventListener(type, (e) => e.stopPropagation());
    }
    this.list.addEventListener('scroll', () => this.loadIfNearEnd(), { passive: true });
  }

  /** Size to the player: about a third of its width, text a little smaller than the page's. */
  layout(width: number, height: number): void {
    this.host.style.width = `${Math.round(Math.min(440, Math.max(260, width * 0.32)))}px`;
    this.host.style.fontSize = `${Math.round(Math.min(15, Math.max(12, height * 0.02)))}px`;
  }

  setFeed(feed: CommentFeed | undefined): void {
    if (feed === this.feed) return;
    this.feed = feed;
    this.shown = 0;
    this.rows.clear();
    this.open.clear();
    this.list.replaceChildren(this.foot);
    this.list.scrollTop = 0;
    this.update();
    if (feed && !feed.comments.length && !feed.done) void feed.more();
  }

  /** The feed changed: add new comments, redraw replies, header and footer. */
  update(): void {
    const feed = this.feed;
    this.head.replaceChildren(t('dm.panel.title'));
    if (feed?.total !== undefined) this.head.append(Object.assign(this.doc.createElement('small'), { textContent: countText(feed.total, locale()) }));
    if (!feed) {
      this.foot.replaceChildren();
      return;
    }
    for (; this.shown < feed.comments.length; this.shown++) {
      this.list.insertBefore(this.comment(feed.comments[this.shown]!), this.foot);
    }
    for (const c of feed.comments) if (this.open.has(c.id)) this.drawReplies(c.id);
    this.drawFoot();
    this.loadIfNearEnd();
  }

  /**
   * A comment's replies. A top-level comment's open and close with its toggle
   * and load when first opened; a reply's own replies (inline in the page's
   * reply threads) always show, with "Show more replies" when there are more.
   */
  private drawReplies(id: string): void {
    const row = this.rows.get(id);
    const feed = this.feed;
    if (!row || !feed) return;
    const open = !row.toggle || this.open.has(id);
    if (row.toggle) row.toggle.textContent = open ? t('dm.panel.hide') : t('dm.panel.replies', { n: countText(row.c.replies, locale()) });
    row.box.hidden = !open;
    if (!open) return;
    const r = feed.replyState(row.c);
    const kids: Node[] = r.items.map((x) => this.comment(x));
    if (r.loading) kids.push(this.note(t('dm.panel.loading')));
    else if (r.error) kids.push(this.note(t('dm.panel.error', { e: r.error })), this.button(t('dm.panel.retry'), () => void feed.moreReplies(row.c)));
    else if (r.next) kids.push(this.button(t('dm.panel.moreReplies'), () => void feed.moreReplies(row.c)));
    row.box.replaceChildren(...kids);
    // Replies of replies redraw with their parent.
    for (const x of r.items) if (this.rows.has(x.id)) this.drawReplies(x.id);
  }

  private drawFoot(): void {
    const feed = this.feed!;
    if (feed.loading) this.foot.replaceChildren(this.note(t('dm.panel.loading')));
    else if (feed.error) this.foot.replaceChildren(this.note(t('dm.panel.error', { e: feed.error })), this.button(t('dm.panel.retry'), () => void feed.more()));
    else if (feed.done) this.foot.replaceChildren(this.note(feed.comments.length ? t('dm.panel.end') : t('dm.panel.none')));
    else this.foot.replaceChildren();
  }

  private loadIfNearEnd(): void {
    const feed = this.feed;
    if (!feed || feed.loading || feed.done || feed.error || !this.host.isConnected) return;
    const l = this.list;
    if (l.scrollTop + l.clientHeight >= l.scrollHeight - 400) void feed.more();
  }

  private comment(c: Comment): HTMLElement {
    const el = this.make('div', 'c');
    const avatar = this.doc.createElement('img');
    avatar.className = 'avatar';
    avatar.alt = '';
    avatar.referrerPolicy = 'no-referrer';
    if (c.avatar) avatar.src = c.avatar;
    avatar.addEventListener('error', () => { avatar.removeAttribute('src'); });
    const body = this.make('div', 'body');
    const meta = this.make('div', 'meta');
    meta.append(Object.assign(this.doc.createElement('span'), { className: 'who', textContent: c.author }));
    if (c.published) {
      const { age, edited } = ageText(c.published, locale());
      meta.append(age + (edited ? t('dm.panel.edited') : ''));
    }
    const text = this.make('div', 'text');
    text.append(...this.richText(c));
    const bar = this.make('div', 'bar');
    const likes = this.make('span', 'likes');
    likes.append(this.thumb());
    if (c.likes) likes.append(countText(c.likes, locale()));
    likes.title = t('dm.panel.likes', { n: c.likes });
    bar.append(likes);
    body.append(meta, text, bar);
    el.append(avatar, body);
    const top = !c.level;
    if (top ? c.replies > 0 && !!c.replyToken : !!(c.subReplies?.length || c.replyToken)) {
      const box = this.make('div', 'replies');
      body.append(box);
      let toggle: HTMLButtonElement | undefined;
      if (top) {
        toggle = this.button('', () => {
          if (this.open.has(c.id)) this.open.delete(c.id);
          else {
            this.open.add(c.id);
            const r = this.feed?.replyState(c);
            if (r && !r.items.length) void this.feed!.moreReplies(c);
          }
          this.drawReplies(c.id);
        });
        bar.append(toggle);
      }
      this.rows.set(c.id, { box, toggle, c });
      this.drawReplies(c.id);
    }
    return el;
  }

  /** The text with member emoji as images and this video's timestamps as links that seek. */
  private richText(c: Comment): Node[] {
    const marks = [
      ...c.images.map((m) => ({ start: m.start, len: m.len, node: () => Object.assign(this.doc.createElement('img'), { src: m.url, alt: m.alt, referrerPolicy: 'no-referrer' }) as Node })),
      ...c.stamps.map((s) => ({
        start: s.start, len: s.len, node: () => {
          const a = this.make('span', 'stamp');
          a.textContent = c.text.slice(s.start, s.start + s.len);
          a.addEventListener('click', () => this.onSeek(s.sec));
          return a as Node;
        },
      })),
    ].sort((a, b) => a.start - b.start);
    const out: Node[] = [];
    let at = 0;
    for (const m of marks) {
      if (m.start < at) continue;
      out.push(this.doc.createTextNode(c.text.slice(at, m.start)), m.node());
      at = m.start + m.len;
    }
    out.push(this.doc.createTextNode(c.text.slice(at)));
    return out;
  }

  /** Built node by node: YouTube enforces Trusted Types, so no innerHTML. */
  private thumb(): SVGElement {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = this.doc.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const path = this.doc.createElementNS(NS, 'path');
    path.setAttribute('d', THUMB);
    svg.append(path);
    return svg;
  }

  private make(tag: string, cls: string): HTMLElement {
    return Object.assign(this.doc.createElement(tag), { className: cls });
  }

  private note(text: string): HTMLElement {
    return Object.assign(this.make('div', 'note'), { textContent: text });
  }

  private button(text: string, onClick: () => void): HTMLButtonElement {
    const b = this.doc.createElement('button');
    b.type = 'button';
    b.textContent = text;
    b.addEventListener('click', onClick);
    return b;
  }
}
