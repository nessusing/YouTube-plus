// Every YouTube selector the player feature depends on (design §14.3 rule).

export const SEL = {
  app: 'ytd-app',
  appMiniActiveAttr: 'miniplayer-is-active',
  masthead: '#masthead-container',
  moviePlayer: '#movie_player',
  video: '#movie_player video',
  chromeBottom: '.ytp-chrome-bottom',
  sizeButton: '.ytp-size-button',
  watchFlexy: 'ytd-watch-flexy',
  stickyTarget: '#primary-inner > #player',
  miniplayer: 'ytd-miniplayer',
  miniVideoArea: 'ytd-miniplayer-player-container',
  miniResizer: '[class*="ytdMiniplayerComponentResizer"]',
  miniUi: '.ytp-miniplayer-ui',
  miniControlsRow: '.ytp-miniplayer-controls',
  miniPrev: '.ytp-miniplayer-controls .ytp-prev-button',
  miniNext: '.ytp-miniplayer-controls .ytp-next-button',
  prevButton: '.ytp-chrome-bottom .ytp-prev-button',
  nextButton: '.ytp-chrome-bottom .ytp-next-button',
  /** Inside the miniplayer, pressing on these must not start a window drag. */
  noDrag: 'button, a, input, .ytp-chrome-bottom, .ytp-settings-menu, .ytp-popup, .ytp-miniplayer-controls, [class*="Resizer"]',
} as const;

export const THEATER_COOKIE = 'wide';
