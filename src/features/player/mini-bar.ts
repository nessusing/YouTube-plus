// The bar at the bottom left that stands in for a hidden miniplayer: §44
// (minimized, shows the title) and §50 (popped out to a PiP window). One look,
// one element per part; notifications rise above whichever is showing (§46).

import { MINI_BAR_TAG } from './consts';

/** The bar lives in a shadow root, away from YouTube's styles; its theme variables still reach it. */
const BAR_CSS = `
button {
  all: unset; position: relative; box-sizing: border-box;
  display: flex; align-items: center; height: 48px; padding: 0 16px;
  max-width: min(400px, calc(100vw - 32px));
  border-radius: 12px; cursor: pointer;
  background: var(--yt-spec-base-background, #fff);
  color: var(--yt-spec-text-primary, #0f0f0f);
  box-shadow: 0 4px 32px rgba(0,0,0,.1), 0 1px 4px rgba(0,0,0,.2);
  font: 500 14px/20px Roboto, Arial, sans-serif;
}
button::after {
  content: ""; position: absolute; inset: 0; border-radius: inherit;
  background: currentColor; opacity: 0; transition: opacity .15s; pointer-events: none;
}
button:hover::after { opacity: .06; }
button:focus-visible { outline: 2px solid #3ea6ff; outline-offset: 2px; }
span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
`;

/** Same 16 px inset as the miniplayer's own corners (geometry.ts EDGE_GAP). */
const BAR_GAP = 16;

export interface MiniBarEl {
  host: HTMLElement;
  button: HTMLButtonElement;
  text: HTMLElement;
}

/** A hidden bar appended to <html>; clicks (and Enter / Space) call onClick. */
export function makeMiniBar(onClick: () => void): MiniBarEl {
  const host = document.createElement(MINI_BAR_TAG);
  // Same layer as ytd-miniplayer (2030), which it stands in for.
  host.style.cssText = `position:fixed;left:${BAR_GAP}px;bottom:${BAR_GAP}px;z-index:2030;display:none;`;
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = BAR_CSS;
  const button = document.createElement('button');
  button.type = 'button';
  const text = document.createElement('span');
  button.append(text);
  root.append(style, button);
  // Clicks on the button bubble out of the shadow root.
  host.addEventListener('click', onClick);
  document.documentElement.append(host);
  return { host, button, text };
}
