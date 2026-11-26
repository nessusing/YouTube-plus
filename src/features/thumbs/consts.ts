// Shared by the isolated and the page-world scripts of F-22.

/** Dispatched on a card by the content script; the page script answers on the card. */
export const ASK_EVENT = 'ytpp-thumbs-ask';
/** On the card while asking: the video ID, and the page script's answer. */
export const ASK_ATTR = 'data-ytpp-ask';
export const ANSWER_ATTR = 'data-ytpp-moving';

/** How long each of the three frames shows (F-22-AC1). */
export const FRAME_MS = 1000;
