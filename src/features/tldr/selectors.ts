// Every YouTube selector TL;DR depends on (F-03-AC1). Measured 2026-11-18:
// yt-lockup-view-model > a.ytLockupViewModelContentImage > yt-thumbnail-view-model
// (position: relative) with the duration in yt-thumbnail-badge-view-model.

export const ITEM = [
  'yt-lockup-view-model',
  'ytd-video-renderer',
  'ytd-compact-video-renderer',
  'ytd-rich-grid-media',
  'ytd-grid-video-renderer',
  'ytd-playlist-video-renderer',
  'ytd-playlist-panel-video-renderer',
].join(', ');

/** Inside an item: the element the icon is positioned in. */
export const THUMB = 'yt-thumbnail-view-model, ytd-thumbnail #thumbnail, ytd-thumbnail';
export const LINK = 'a[href*="/watch?v="]';
export const TITLE = 'h3, #video-title, a#video-title-link, .yt-lockup-metadata-view-model__title, [class*="ytLockupMetadataViewModelTitle"]';
export const BADGES = 'yt-thumbnail-badge-view-model, badge-shape, ytd-thumbnail-overlay-time-status-renderer, .badge-style-type-live-now-alternate';
/** Live now, upcoming, premiere: skipped (F-03-AC1). Recorded streams are kept. */
export const LIVEISH = /\b(LIVE|UPCOMING|PREMIERE|PREMIERING)\b|直播中|正在直播|即将开始|首映|即將/i;
export const SHORTS = 'ytm-shorts-lockup-view-model, ytm-shorts-lockup-view-model-v2, ytd-reel-item-renderer';
