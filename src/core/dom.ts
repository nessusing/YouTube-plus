// Small DOM helpers shared by content scripts.

/** Adds/removes a <style> element by id; returns a function that removes it. */
export function injectStyle(id: string, css: string): () => void {
  let el = document.getElementById(id) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = id;
    (document.head ?? document.documentElement).append(el);
  }
  el.textContent = css;
  return () => el?.remove();
}

/** Runs cb once the selector matches, now or later. Returns a cancel function. */
export function whenElement<T extends Element>(selector: string, cb: (el: T) => void): () => void {
  const now = document.querySelector<T>(selector);
  if (now) {
    cb(now);
    return () => {};
  }
  const mo = new MutationObserver(() => {
    const el = document.querySelector<T>(selector);
    if (el) {
      mo.disconnect();
      cb(el);
    }
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });
  return () => mo.disconnect();
}

/** A feature part that can be turned on and off at runtime. */
export interface Toggleable {
  enable(): void;
  disable(): void;
}
