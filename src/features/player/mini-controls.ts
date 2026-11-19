// Miniplayer controls (design §35.1): on hover, show the official bottom
// control bar (volume, seek bar, time, gear) and hide the miniplayer's own
// duplicates, keeping expand and close.

import { injectStyle, type Toggleable } from '@/core/dom';
import { SEL } from './selectors';

// data-ytpp-keep-mid is set when we are in a playlist but the bottom bar has no
// prev/next, so the miniplayer's middle row (prev / play / next) must stay.
const CSS = `
ytd-miniplayer:hover .ytp-player-minimized .ytp-chrome-bottom,
ytd-miniplayer:hover .ytp-player-minimized .ytp-gradient-bottom {
  display: block !important;
  opacity: 1 !important;
}
ytd-miniplayer:hover .ytp-player-minimized:not([data-ytpp-keep-mid]) .ytp-miniplayer-controls,
ytd-miniplayer:hover .ytp-player-minimized .ytp-miniplayer-ui .ytp-time-display,
ytd-miniplayer:hover .ytp-player-minimized .ytp-miniplayer-ui .ytp-progress-bar-container {
  display: none !important;
}
`;

function visible(el: Element | null): boolean {
  return !!el && getComputedStyle(el).display !== 'none';
}

export function miniControls(): Toggleable {
  let removeStyle: (() => void) | undefined;

  // Decide on each hover; the playlist state can change at any time.
  const onEnter = (e: Event) => {
    const mini = (e.target as Element).closest?.(SEL.miniplayer);
    if (!mini) return;
    const player = document.querySelector<HTMLElement>(SEL.moviePlayer);
    if (!player) return;
    // In a playlist/queue the miniplayer's own row shows prev/next.
    const inList = visible(player.querySelector(SEL.miniPrev)) || visible(player.querySelector(SEL.miniNext));
    const barHasPrevNext = visible(document.querySelector(SEL.prevButton)) || visible(document.querySelector(SEL.nextButton));
    player.toggleAttribute('data-ytpp-keep-mid', inList && !barHasPrevNext);
  };

  return {
    enable() {
      removeStyle = injectStyle('ytpp-mini-controls', CSS);
      document.addEventListener('mouseover', onEnter, true);
    },
    disable() {
      removeStyle?.();
      document.removeEventListener('mouseover', onEnter, true);
      document.querySelector(SEL.moviePlayer)?.removeAttribute('data-ytpp-keep-mid');
    },
  };
}
