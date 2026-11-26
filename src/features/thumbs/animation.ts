// One card moving (F-22-AC1): YouTube's own animation, or the three frames in
// turn. The pictures go in a layer between the static thumbnail and YouTube's
// overlays (F-22-AC6), added only once they are downloaded.

import { askMoving } from './ask';
import type { ThumbCard } from './cards';
import { FRAME_MS } from './consts';
import { frameUrls, type Loader } from './images';

const LAYER = 'ytpp-thumb-anim';
/** The static picture's box: the lockups', then the older renderers'. */
const PICTURE = [':scope > [class*="ThumbnailViewModelImage"]', 'yt-image'];

export interface Animation {
  /** Put the layer back if YouTube redrew the thumbnail. */
  keep(): void;
  stop(): void;
}

export function animate(card: ThumbCard, load: Loader): Animation {
  let stopped = false;
  let layer: HTMLElement | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;

  const keep = () => {
    if (!layer || layer.isConnected) return;
    const picture = PICTURE.map((s) => card.thumb.querySelector(s)).find((e) => e) ?? card.thumb.firstElementChild;
    picture?.after(layer);
  };

  const show = (pictures: HTMLImageElement[]) => {
    layer = document.createElement(LAYER);
    // No z-index: YouTube's badges and buttons come later in the DOM and stay on top.
    layer.style.cssText = 'position:absolute;inset:0;display:block;overflow:hidden;border-radius:inherit;pointer-events:none;';
    for (const [i, img] of pictures.entries()) {
      img.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;';
      img.style.visibility = i ? 'hidden' : 'visible';
      layer.append(img);
    }
    keep();
    if (pictures.length < 2) return;
    let at = 0;
    timer = setInterval(() => {
      pictures[at]!.style.visibility = 'hidden';
      at = (at + 1) % pictures.length;
      pictures[at]!.style.visibility = 'visible';
    }, FRAME_MS);
  };

  const start = async () => {
    const url = askMoving(card.el, card.videoId);
    const moving = url ? await load(url) : undefined;
    if (stopped) return;
    if (moving) return show([moving]);
    const frames = (await Promise.all(frameUrls(card.videoId).map(load))).filter((i): i is HTMLImageElement => !!i);
    // A single still would only replace the thumbnail: leave the card alone.
    if (!stopped && frames.length > 1) show(frames);
  };
  void start();

  return {
    keep,
    stop() {
      stopped = true;
      if (timer) clearInterval(timer);
      layer?.remove();
      layer = undefined;
    },
  };
}
