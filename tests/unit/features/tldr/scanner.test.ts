// @vitest-environment happy-dom
// F-03-AC1: which thumbnails get a TL;DR icon. Every video thumbnail does, in
// each layout YouTube uses; Shorts, live now, upcoming and premieres do not.
import { beforeEach, describe, expect, it } from 'vitest';
import { scan } from '@/features/tldr/scanner';

/** The 2026 lockup: link + thumbnail with a badge, and a title. */
const lockup = (id: string, badge: string, opts: { href?: string; badgeClass?: string } = {}) => `
  <yt-lockup-view-model>
    <a class="ytLockupViewModelContentImage" href="${opts.href ?? `/watch?v=${id}`}">
      <yt-thumbnail-view-model><yt-thumbnail-badge-view-model class="${opts.badgeClass ?? ''}"><badge-shape>${badge}</badge-shape></yt-thumbnail-badge-view-model></yt-thumbnail-view-model>
    </a>
    <h3 title="Video ${id}">Video ${id}</h3>
  </yt-lockup-view-model>`;

/** The older renderers (search results, playlist panel). */
const renderer = (tag: string, id: string, badge: string) => `
  <${tag}>
    <ytd-thumbnail><a id="thumbnail" href="/watch?v=${id}&list=PLx">
      <ytd-thumbnail-overlay-time-status-renderer><span id="time-status">${badge}</span></ytd-thumbnail-overlay-time-status-renderer>
    </a></ytd-thumbnail>
    <a id="video-title" title="Video ${id}">Video ${id}</a>
  </${tag}>`;

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('which thumbnails get an icon', () => {
  it('F-03-AC1 every video thumbnail, in the new lockups and the older renderers', () => {
    document.body.innerHTML = [
      lockup('aaaaaaaaaaa', '3:33'),
      renderer('ytd-video-renderer', 'bbbbbbbbbbb', '10:02'),
      renderer('ytd-playlist-panel-video-renderer', 'ccccccccccc', '0:19'),
      renderer('ytd-compact-video-renderer', 'ddddddddddd', '1:02:03'),
    ].join('');
    const found = scan();
    expect(found.map((f) => f.videoId)).toEqual(['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc', 'ddddddddddd']);
    expect(found[0]!.title).toBe('Video aaaaaaaaaaa');
    expect(found.every((f) => f.thumb)).toBe(true);
  });

  it('F-03-AC1 no Shorts, live now, upcoming or premieres', () => {
    document.body.innerHTML = [
      lockup('eeeeeeeeeee', '0:45', { href: '/shorts/eeeeeeeeeee' }),
      '<ytm-shorts-lockup-view-model>' + lockup('fffffffffff', '0:30') + '</ytm-shorts-lockup-view-model>',
      lockup('ggggggggggg', 'LIVE'),
      lockup('hhhhhhhhhhh', '直播中'),
      lockup('iiiiiiiiiii', 'UPCOMING'),
      lockup('jjjjjjjjjjj', 'PREMIERE'),
      lockup('kkkkkkkkkkk', '', { badgeClass: 'badge-live' }),
      lockup('lllllllllll', '12:00'), // a recorded stream keeps its icon
    ].join('');
    expect(scan().map((f) => f.videoId)).toEqual(['lllllllllll']);
  });

  it('F-03-AC1 a lockup nested in a renderer counts once', () => {
    document.body.innerHTML = `<ytd-rich-grid-media>${lockup('mmmmmmmmmmm', '4:00')}</ytd-rich-grid-media>`;
    expect(scan().map((f) => f.videoId)).toEqual(['mmmmmmmmmmm']);
  });
});
