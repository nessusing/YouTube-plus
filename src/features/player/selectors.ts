// Every YouTube selector the player feature depends on (F-03-AC1 rule).

export const SEL = {
  app: 'ytd-app',
  appMiniActiveAttr: 'miniplayer-is-active',
  masthead: '#masthead-container',
  moviePlayer: '#movie_player',
  video: '#movie_player video',
  chromeBottom: '.ytp-chrome-bottom',
  sizeButton: '.ytp-size-button',
  watchFlexy: 'ytd-watch-flexy',
  /** Holds #movie_player on the watch page (normal and theater); floats as the small window (F-08). */
  floatBox: 'ytd-watch-flexy #player-container',
  /** Its parent, which keeps its place in the page (normal: #player-container-inner, theater: #player-full-bleed-container). */
  floatPlace: 'ytd-watch-flexy :has(> #player-container)',
  miniplayer: 'ytd-miniplayer',
  miniVideoArea: 'ytd-miniplayer-player-container',
  miniResizer: '[class*="ytdMiniplayerComponentResizer"]',
  miniUi: '.ytp-miniplayer-ui',
  miniControlsRow: '.ytp-miniplayer-controls',
  /** The ▶ in the bottom control bar; the loop button goes right after it (F-10). */
  barPlay: '.ytp-left-controls > .ytp-play-button',
  /** Holds the big ▶ in the middle of the miniplayer (shown without our miniplayer controls). */
  miniPlayHolder: '.ytp-miniplayer-play-button-container',
  /** The ✕ at the top right of the miniplayer; the minimize button goes left of it (F-07). */
  miniClose: '.ytp-miniplayer-scrim > .ytp-miniplayer-close-button',
  /** The miniplayer's top layer (Expand, ✕); the pop-out button goes right of Expand (F-11). */
  miniScrim: '.ytp-miniplayer-scrim',
  /** The miniplayer's Expand (to the watch page), top left (F-11 full screen). */
  miniExpand: '.ytp-miniplayer-scrim .ytp-miniplayer-expand-watch-page-button',
  /** The watch page's "Miniplayer (i)" button (F-11). Not there on 2026-11-22: pip.ts then sends an `i` keydown. */
  miniButton: '.ytp-miniplayer-button',
  /** Where #movie_player lives, inside ytd-player (F-11 puts it back there). */
  playerHome: 'ytd-player #container',
  /** Video title in the miniplayer's info bar. */
  miniTitle: 'ytd-miniplayer-info-bar [class*="ytdMiniplayerInfoBarTitle"]',
  /** Inside the miniplayer, pressing on these must not start a window drag. */
  noDrag: 'button, a, input, .ytp-chrome-bottom, .ytp-settings-menu, .ytp-popup, .ytp-miniplayer-controls, [class*="Resizer"]',
} as const;
