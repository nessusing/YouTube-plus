// Which thumbnails move (F-22-AC5): the video cards TL;DR also marks (so no
// Shorts, live, upcoming or premieres), minus playlist / mix cards, the list
// panels, and anything inside the player or YouTube's hover preview.

import { type Found, scan } from '@/features/tldr/scanner';

export type ThumbCard = Pick<Found, 'el' | 'thumb' | 'videoId'>;

const ELSEWHERE = [
  'ytd-playlist-panel-renderer', 'ytd-playlist-panel-video-renderer', 'ytd-miniplayer', '#movie_player', 'ytd-video-preview',
].join(', ');
/** Wrappers of a playlist's or mix's cover, which links to its first video. */
const COLLECTION = 'yt-collection-thumbnail-view-model, ytd-radio-renderer, ytd-compact-radio-renderer, ytd-playlist-renderer, ytd-compact-playlist-renderer';

export function thumbCards(root: ParentNode = document): ThumbCard[] {
  return scan(root).filter(({ el }) => !el.closest(ELSEWHERE) && !el.closest(COLLECTION) && !el.querySelector(COLLECTION));
}
