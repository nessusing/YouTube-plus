// @vitest-environment happy-dom
// F-22-AC5: which cards move.
import { beforeEach, describe, expect, it } from 'vitest';
import { thumbCards } from '@/features/thumbs/cards';
import { lockup, renderer } from './helpers';

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('which thumbnails move', () => {
  it('F-22-AC5 landscape video cards in every layout: lockups and the older renderers', () => {
    document.body.innerHTML = [
      lockup('aaaaaaaaaaa'),
      renderer('ytd-video-renderer', 'bbbbbbbbbbb'),
      renderer('ytd-compact-video-renderer', 'ccccccccccc'),
      renderer('ytd-grid-video-renderer', 'ddddddddddd'),
      renderer('ytd-playlist-video-renderer', 'eeeeeeeeeee'),
      // A video opened from within a list is still a video card.
      lockup('fffffffffff', { href: '/watch?v=fffffffffff&list=PLx&index=2' }),
    ].join('');
    expect(thumbCards().map((c) => c.videoId)).toEqual(
      ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc', 'ddddddddddd', 'eeeeeeeeeee', 'fffffffffff']);
  });

  it('F-22-AC5 no Shorts, live now, upcoming or premieres', () => {
    document.body.innerHTML = [
      lockup('ggggggggggg', { href: '/shorts/ggggggggggg' }),
      `<ytm-shorts-lockup-view-model>${lockup('hhhhhhhhhhh')}</ytm-shorts-lockup-view-model>`,
      lockup('iiiiiiiiiii', { badge: 'LIVE' }),
      lockup('jjjjjjjjjjj', { badge: 'UPCOMING' }),
      renderer('ytd-video-renderer', 'kkkkkkkkkkk', '首映'),
      lockup('lllllllllll', { badge: '2:00:00' }), // a recorded stream
    ].join('');
    expect(thumbCards().map((c) => c.videoId)).toEqual(['lllllllllll']);
  });

  it('F-22-AC5 no playlist or mix cards', () => {
    document.body.innerHTML = [
      lockup('mmmmmmmmmmm', { href: '/watch?v=mmmmmmmmmmm&list=RDmmmmmmmmmmm', collection: true }),
      `<ytd-radio-renderer>${renderer('ytd-compact-video-renderer', 'nnnnnnnnnnn')}</ytd-radio-renderer>`,
    ].join('');
    expect(thumbCards()).toEqual([]);
  });

  it('F-22-AC5 not the list panels of the watch page and miniplayer, nor the player or its hover preview', () => {
    document.body.innerHTML = [
      renderer('ytd-playlist-panel-video-renderer', 'ooooooooooo'),
      `<ytd-playlist-panel-renderer>${lockup('ppppppppppp')}</ytd-playlist-panel-renderer>`,
      `<ytd-miniplayer>${lockup('qqqqqqqqqqq')}</ytd-miniplayer>`,
      `<div id="movie_player">${lockup('rrrrrrrrrrr')}</div>`,
      `<ytd-video-preview>${lockup('sssssssssss')}</ytd-video-preview>`,
    ].join('');
    expect(thumbCards()).toEqual([]);
  });
});
