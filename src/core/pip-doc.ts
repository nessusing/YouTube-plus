// The YouTube player may live in a Document PiP window (§50): the whole
// #movie_player moves there while popped out. Code that looks the player up, or
// listens for its media events on `document`, must also look in that window.
// Works in both the isolated and the page (MAIN) world: documentPictureInPicture
// is one object, so either world sees the window the other opened.

interface DocPip extends EventTarget {
  window: Window | null;
}

function api(): DocPip | undefined {
  return (globalThis as unknown as { documentPictureInPicture?: DocPip }).documentPictureInPicture;
}

/** The browser can open Document PiP windows (desktop Chrome / Edge 116+). */
export function pipSupported(): boolean {
  return !!api();
}

/** The open Document PiP window's document, if any. */
export function pipDocument(): Document | undefined {
  try {
    return api()?.window?.document ?? undefined;
  } catch {
    return undefined;
  }
}

/** querySelector on the page, then in the PiP window. */
export function queryPlayerDom<T extends Element>(selector: string): T | null {
  return document.querySelector<T>(selector) ?? pipDocument()?.querySelector<T>(selector) ?? null;
}

/**
 * Listen for `type` on the page's document and on every PiP document, now and
 * as each one opens. Media events (timeupdate, ended, loadeddata) do not
 * bubble: a capture listener on the document the video is in is what sees them.
 */
export function listenWithPip(type: string, handler: (e: Event) => void, capture = true): () => void {
  document.addEventListener(type, handler, capture);
  const docs = new Set<Document>();
  const attach = (d: Document | undefined) => {
    if (!d || docs.has(d)) return;
    docs.add(d);
    d.addEventListener(type, handler, capture);
  };
  attach(pipDocument());
  const onEnter = (e: Event) => attach((e as Event & { window?: Window }).window?.document);
  api()?.addEventListener('enter', onEnter);
  return () => {
    document.removeEventListener(type, handler, capture);
    api()?.removeEventListener('enter', onEnter);
    for (const d of docs) d.removeEventListener(type, handler, capture);
    docs.clear();
  };
}
