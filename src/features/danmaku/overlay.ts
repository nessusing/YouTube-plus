// The layer over the player (§51.7): one caption-style card at a
// time, drawn from the video's time every frame, so pausing, seeking back and
// playback speed need nothing special. Hidden in the miniplayer, popped out
// (§50), during ads and off the watch page. At the top of the player (§51.7):
// below the title bar while it shows, below the captions when they sit in the
// upper half.

import { CardView } from './card-view';
import { slotAt } from './frame';
import type { DisplayParams } from './params';
import { type Slot, slotEnd } from './schedule';

/** Space between the card and what it stays below. */
const GAP_PX = 8;

export interface Overlay {
  enable(): void;
  disable(): void;
  /** The cards and whose video they are for; [] hides. */
  setSlots(videoId: string, slots: Slot[]): void;
  setDisplay(p: DisplayParams, debug: boolean): void;
}

/** The top-of-player chrome that shows with the controls: the title (fullscreen), its gradient. */
const TOP_CHROME = '.ytp-chrome-top, .ytp-fullscreen-metadata';

/** Where the card's top goes, in px from the player's top. */
function topOf(player: HTMLElement, pr: DOMRect): number {
  let top = Math.max(12, pr.height * 0.04);
  const below = (r: DOMRect) => { top = Math.max(top, r.bottom - pr.top + GAP_PX); };
  if (!player.classList.contains('ytp-autohide')) {
    for (const el of player.querySelectorAll<HTMLElement>(TOP_CHROME)) {
      const r = el.getBoundingClientRect();
      // Only what really shows, and only the top part (a tall overlay is not a title bar).
      if (!r.height || r.top - pr.top > pr.height / 4 || getComputedStyle(el).opacity === '0') continue;
      below(r);
    }
  }
  // Captions in the upper half; the user can drag them anywhere.
  for (const w of player.querySelectorAll('.ytp-caption-window-container .caption-window')) {
    const r = w.getBoundingClientRect();
    if (!r.height || r.top >= pr.top + pr.height / 2) continue;
    below(r);
  }
  return top;
}

/** Where cards may show: the watch page's player, not minimized, popped out or in an ad. */
function playerToShow(): HTMLElement | null {
  if (location.pathname !== '/watch') return null;
  if (document.documentElement.hasAttribute('data-ytpp-pip')) return null;
  if (document.querySelector('ytd-app')?.hasAttribute('miniplayer-is-active')) return null;
  const p = document.querySelector<HTMLElement>('#movie_player');
  if (!p || p.classList.contains('ytp-player-minimized') || p.classList.contains('ad-showing')) return null;
  return p;
}

export function overlay(): Overlay {
  const view = new CardView();
  view.host.classList.add('ytpp-dm-layer');
  view.host.style.transition = 'top 200ms ease';
  let display: DisplayParams | undefined;
  let debug = false;
  let videoId = '';
  let slots: Slot[] = [];
  let raf = 0;
  let lastT = -1;
  /** After a seek into a card with too little of it left: not shown (§51.7). */
  let skipped: Slot | undefined;

  const frame = () => {
    raf = requestAnimationFrame(frame);
    const player = playerToShow();
    const video = player?.querySelector('video');
    // The cards belong to one video; on the watch page the URL says which is on.
    const here = new URLSearchParams(location.search).get('v');
    if (!player || !video || !display || !slots.length || here !== videoId) {
      view.draw(undefined, 0, { p: display!, width: 0, height: 0, top: 0 });
      return;
    }
    if (view.host.parentElement !== player) player.append(view.host);
    const t = video.currentTime;
    const slot = slotAt(slots, t);
    if (Math.abs(t - lastT) > 1 && slot && slotEnd(slot) - t < display.resumeMinSec) skipped = slot;
    if (slot !== skipped) skipped = undefined;
    lastT = t;
    const pr = player.getBoundingClientRect();
    const shown = slot && slot !== skipped ? slot : undefined;
    view.draw(shown, shown ? t - shown.start : 0, { p: display, width: pr.width, height: pr.height, top: topOf(player, pr), debug });
  };

  return {
    enable() {
      if (!raf) raf = requestAnimationFrame(frame);
    },
    disable() {
      cancelAnimationFrame(raf);
      raf = 0;
      view.host.remove();
      slots = [];
    },
    setSlots(id, s) {
      videoId = id;
      slots = s;
      skipped = undefined;
    },
    setDisplay(p, d) {
      display = p;
      debug = d;
    },
  };
}
