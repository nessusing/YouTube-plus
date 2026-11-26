// Thumbnail markup as YouTube builds it (measured 2026-11-25), for the F-22 tests.

/** The 2026 lockup: link > view-model thumbnail (image layer, then overlays). */
export const lockup = (id: string, opts: { badge?: string; href?: string; collection?: boolean } = {}) => {
  const thumb = `<yt-thumbnail-view-model>
      <div class="ytThumbnailViewModelImage"><img src="https://i.ytimg.com/vi/${id}/hq720.jpg"></div>
      <yt-thumbnail-bottom-overlay-view-model><badge-shape>${opts.badge ?? '3:33'}</badge-shape></yt-thumbnail-bottom-overlay-view-model>
    </yt-thumbnail-view-model>`;
  return `<yt-lockup-view-model data-id="${id}">
    <a href="${opts.href ?? `/watch?v=${id}`}">${opts.collection ? `<yt-collection-thumbnail-view-model>${thumb}</yt-collection-thumbnail-view-model>` : thumb}</a>
    <h3 title="Video ${id}">Video ${id}</h3>
  </yt-lockup-view-model>`;
};

/** The older renderer (search results, playlist panel). */
export const renderer = (tag: string, id: string, badge = '10:02') => `
  <${tag} data-id="${id}">
    <ytd-thumbnail><a id="thumbnail" href="/watch?v=${id}">
      <yt-image><img src="https://i.ytimg.com/vi/${id}/hq720.jpg"></yt-image>
      <div id="overlays"><ytd-thumbnail-overlay-time-status-renderer><span id="time-status">${badge}</span></ytd-thumbnail-overlay-time-status-renderer></div>
    </a></ytd-thumbnail>
    <a id="video-title" title="Video ${id}">Video ${id}</a>
  </${tag}>`;

export const movingUrl = (id: string) => `https://i.ytimg.com/an_webp/${id}/mqdefault_6s.webp?du=3000&sqp=x&rs=y`;
export const frameUrl = (id: string, n: number) => `https://i.ytimg.com/vi/${id}/mq${n}.jpg`;

/** The two shapes the link comes in: search results, and the lockups elsewhere. */
export const searchData = (id: string, url = movingUrl(id)) => ({
  videoId: id,
  richThumbnail: { movingThumbnailRenderer: { movingThumbnailDetails: { thumbnails: [{ url, width: 320, height: 180 }] } } },
});
export const lockupData = (id: string, url?: string) => ({
  lockupViewModel: {
    contentId: id,
    contentImage: { thumbnailViewModel: {
      image: { sources: [{ url: `https://i.ytimg.com/vi/${id}/hq720.jpg` }] },
      overlays: url ? [{ animatedThumbnailOverlayViewModel: { thumbnail: { sources: [{ url }] } } }] : [],
    } },
  },
});
