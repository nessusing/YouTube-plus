// Bottom toast in YouTube's style, with an optional action ("View", "Undo",
// "Settings"). One at a time; a new one replaces the old.

const STYLE = `
  :host { all: initial; }
  .toast { position: fixed; left: 24px; bottom: 24px; z-index: 2300; background: #f1f1f1; color: #0f0f0f;
    border-radius: 8px; padding: 10px 8px 10px 16px; display: flex; align-items: center; gap: 12px;
    font: 14px/1.4 Roboto, Arial, sans-serif; box-shadow: 0 4px 16px rgba(0,0,0,.3); max-width: calc(100vw - 48px); }
  .toast.plain { padding-right: 16px; }
  .link { all: unset; cursor: pointer; color: #065fd4; font-weight: 500; padding: 6px 10px; border-radius: 16px; white-space: nowrap; }
  .link:hover { background: rgba(6,95,212,.1); }
  .link:focus-visible { outline: 2px solid #065fd4; outline-offset: 1px; }
`;

let host: HTMLElement | undefined;
let root: ShadowRoot | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;

export function toast(text: string, action?: { label: string; run: () => void }, ms = 6000): void {
  if (!host?.isConnected) {
    host = document.createElement('ytpp-toast');
    root = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = STYLE;
    root.append(style);
    document.documentElement.append(host);
  }
  root!.querySelector('.toast')?.remove();
  if (timer) clearTimeout(timer);
  const t = document.createElement('div');
  t.className = action ? 'toast' : 'toast plain';
  t.setAttribute('role', 'status');
  t.append(text);
  if (action) {
    const b = document.createElement('button');
    b.className = 'link';
    b.type = 'button';
    b.textContent = action.label;
    b.addEventListener('click', () => {
      t.remove();
      action.run();
    });
    t.append(b);
  }
  root!.append(t);
  timer = setTimeout(() => t.remove(), ms);
}
