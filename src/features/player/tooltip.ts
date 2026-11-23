// The player's own tooltip markup, so its styles apply; the player never shows
// tooltips for our buttons (F-10, F-07).

export interface PlayerTooltip {
  el: HTMLElement;
  text: HTMLElement;
}

export function playerTooltip(cls: string): PlayerTooltip {
  const el = document.createElement('div');
  el.className = `ytp-tooltip ytp-bottom ${cls}`;
  el.style.maxWidth = '300px';
  el.style.display = 'none';
  const wrap = document.createElement('div');
  wrap.className = 'ytp-tooltip-text-wrapper';
  wrap.setAttribute('aria-hidden', 'true');
  const bottom = document.createElement('div');
  bottom.className = 'ytp-tooltip-bottom-text';
  const text = document.createElement('span');
  text.className = 'ytp-tooltip-text';
  bottom.append(text);
  wrap.append(bottom);
  el.append(wrap);
  return { el, text };
}
