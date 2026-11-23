// Miniplayer controls (F-07-AC1): on hover, show the official bottom
// control bar (volume, seek bar, time, gear) and hide the miniplayer's own
// duplicates, keeping expand and close. The miniplayer has no previous / next
// since YouTube's 2026-11 redesign (also with this feature off); not added back.

import { injectStyle, type Toggleable } from '@/core/dom';

const CSS = `
ytd-miniplayer:hover .ytp-player-minimized .ytp-chrome-bottom,
ytd-miniplayer:hover .ytp-player-minimized .ytp-gradient-bottom {
  display: block !important;
  opacity: 1 !important;
}
/* The miniplayer's own layer (.ytp-miniplayer-ui, z-index 67, whose scrim
   pauses on click) covers the bottom bar (59): lift the bar and its popups
   (gear menu) above it, or every click lands on the scrim. Measured 2026-11-18. */
ytd-miniplayer:hover .ytp-player-minimized .ytp-chrome-bottom { z-index: 68 !important; }
ytd-miniplayer .ytp-player-minimized .ytp-popup { z-index: 69 !important; }
ytd-miniplayer:hover .ytp-player-minimized .ytp-miniplayer-controls,
ytd-miniplayer:hover .ytp-player-minimized .ytp-miniplayer-ui .ytp-time-display,
ytd-miniplayer:hover .ytp-player-minimized .ytp-miniplayer-ui .ytp-progress-bar-container,
/* Since 2026-11 the thin bar is a direct child of #movie_player, not inside the UI. */
ytd-miniplayer:hover .ytp-player-minimized > .ytp-progress-bar-container {
  display: none !important;
}
`;

export function miniControls(): Toggleable {
  let removeStyle: (() => void) | undefined;
  return {
    enable() {
      removeStyle = injectStyle('ytpp-mini-controls', CSS);
    },
    disable() {
      removeStyle?.();
    },
  };
}
