// F-22-AC1, content script side: YouTube's own animation link for a card.
// The link is only in the data the page keeps on its elements, which the page
// script (main-world.ts) reads. DOM events cross the two worlds and dispatch
// synchronously, so the answer is there when dispatchEvent returns.

import { ANSWER_ATTR, ASK_ATTR, ASK_EVENT } from './consts';

export function askMoving(card: Element, videoId: string): string | undefined {
  card.setAttribute(ASK_ATTR, videoId);
  card.dispatchEvent(new Event(ASK_EVENT, { bubbles: true, composed: true }));
  const url = card.getAttribute(ANSWER_ATTR);
  card.removeAttribute(ASK_ATTR);
  card.removeAttribute(ANSWER_ATTR);
  // From the page: only an animation of this video on YouTube's image host.
  return url?.startsWith(`https://i.ytimg.com/an_webp/${videoId}/`) ? url : undefined;
}
