// F-22-AC1, page world: read a card's animation link ("an_webp") out of the
// data YouTube keeps on its elements. Where the link sits in that data differs
// between layouts, so every string is looked at instead of following a path.
// Only answers when asked, so it does nothing while the feature is off.

import { ANSWER_ATTR, ASK_ATTR, ASK_EVENT } from './consts';

interface Seen {
  /** videoId → animation link */
  links: Map<string, string>;
  /** Every string that could be a video ID: tells whether this data covers a card. */
  ids: Set<string>;
  at: number;
}

const LINK = /\/an_webp\/([\w-]{11})\//;
const ID = /^[\w-]{11}$/;
/** One list's data serves all its cards: reuse a walk this long. */
const REUSE_MS = 1000;
/** How far up from a card to look for the data that covers it. */
const LEVELS = 8;

function walk(data: object): Seen {
  const seen: Seen = { links: new Map(), ids: new Set(), at: Date.now() };
  const done = new Set<object>();
  const stack: unknown[] = [data];
  while (stack.length) {
    const v = stack.pop();
    if (typeof v === 'string') {
      const m = LINK.exec(v);
      if (m) seen.links.set(m[1]!, v);
      else if (ID.test(v)) seen.ids.add(v);
    } else if (v && typeof v === 'object' && !done.has(v)) {
      done.add(v);
      for (const child of Object.values(v)) stack.push(child);
    }
  }
  return seen;
}

export function startThumbsMain(): () => void {
  const memo = new WeakMap<object, Seen>();

  const find = (card: Element, id: string): string | undefined => {
    for (let el: Element | null = card, n = 0; el && n < LEVELS; el = el.parentElement, n++) {
      const data = (el as Element & { data?: unknown }).data;
      if (!data || typeof data !== 'object') continue;
      let seen = memo.get(data);
      // The data can grow (more entries loaded): walk again unless it answers.
      if (!seen || (!seen.links.has(id) && !(seen.ids.has(id) && Date.now() - seen.at < REUSE_MS))) {
        seen = walk(data);
        memo.set(data, seen);
      }
      const url = seen.links.get(id);
      // Data that covers this card and has no link: the card has none.
      if (url || seen.ids.has(id)) return url;
    }
    return undefined;
  };

  const onAsk = (e: Event) => {
    const card = e.target;
    if (!(card instanceof Element)) return;
    const id = card.getAttribute(ASK_ATTR);
    if (!id) return;
    const url = find(card, id);
    if (url) card.setAttribute(ANSWER_ATTR, url);
  };

  document.addEventListener(ASK_EVENT, onAsk, true);
  return () => document.removeEventListener(ASK_EVENT, onAsk, true);
}
