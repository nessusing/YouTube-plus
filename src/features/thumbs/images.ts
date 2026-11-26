// The pictures F-22 shows (see research/2026-11-22-列表页缩略图动起来.md).

/** The small (320x180) frames YouTube cuts from the start, middle and end: unsigned, by ID alone. */
export const frameUrls = (videoId: string): string[] => [1, 2, 3].map((n) => `https://i.ytimg.com/vi/${videoId}/mq${n}.jpg`);

/** A frame YouTube does not have answers with a grey picture this wide. */
const PLACEHOLDER_WIDTH = 120;

export type Loader = (url: string) => Promise<HTMLImageElement | undefined>;

/** The downloaded picture, or undefined when YouTube has none. */
export const loadImage: Loader = (url) => new Promise((resolve) => {
  const img = document.createElement('img');
  img.addEventListener('load', () => resolve(img.naturalWidth > PLACEHOLDER_WIDTH ? img : undefined));
  img.addEventListener('error', () => resolve(undefined));
  img.alt = '';
  img.src = url;
});
