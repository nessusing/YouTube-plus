// Player feature, page side (MAIN world). When we draw the miniplayer bigger
// than YouTube's own size (mini-drag.ts), the player box grows but the video
// keeps the size YouTube last gave it; only the page's player API can fix
// that. Acts only while the isolated side sets html[data-ytpp-mini-sized] and
// the player is minimized, so YouTube's own sizing is untouched otherwise.
// Also turns loop on / off for the loop button (loop-button.ts, §40.2): the
// player API keeps the right-click "Loop" in step, setting video.loop does not.

import { LOOP_OFF_EVENT, LOOP_ON_EVENT } from './consts';

interface PlayerApi extends HTMLElement {
  getPlayerSize?: () => { width: number; height: number };
  setInternalSize?: (w: number, h: number) => void;
  setLoopVideo?: (on: boolean) => void;
}

function setLoop(on: boolean): void {
  const p = document.querySelector<PlayerApi>('#movie_player');
  if (p?.setLoopVideo) {
    p.setLoopVideo(on);
    return;
  }
  const v = p?.querySelector('video');
  if (v) v.loop = on;
}

export function startPlayerMain(): void {
  document.addEventListener(LOOP_ON_EVENT, () => setLoop(true));
  document.addEventListener(LOOP_OFF_EVENT, () => setLoop(false));

  let queued = false;

  const fit = () => {
    queued = false;
    if (!document.documentElement.hasAttribute('data-ytpp-mini-sized')) return;
    const p = document.querySelector<PlayerApi>('#movie_player');
    if (!p?.classList.contains('ytp-player-minimized') || !p.getPlayerSize || !p.setInternalSize) return;
    const r = p.getBoundingClientRect();
    const s = p.getPlayerSize();
    if (!r.width || (Math.abs(s.width - r.width) < 1 && Math.abs(s.height - r.height) < 1)) return;
    p.setInternalSize(Math.round(r.width), Math.round(r.height));
  };
  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(fit);
  };

  // The box changes size (our CSS) → refit; YouTube re-applies its own size on
  // re-renders without the box changing → the video's style changes → refit.
  const ro = new ResizeObserver(schedule);
  const mo = new MutationObserver(schedule);
  let player: Element | null = null;
  const attach = () => {
    const p = document.querySelector('#movie_player');
    if (!p || p === player) return;
    player = p;
    ro.disconnect();
    mo.disconnect();
    ro.observe(p);
    mo.observe(p, { attributes: true, attributeFilter: ['class'] });
    const v = p.querySelector('video');
    if (v) mo.observe(v, { attributes: true, attributeFilter: ['style'] });
  };
  new MutationObserver(() => {
    attach();
    schedule();
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-ytpp-mini-sized'] });
  document.addEventListener('yt-navigate-finish', attach);
  attach();
  const poll = setInterval(() => {
    attach();
    if (player) clearInterval(poll);
  }, 1000);
}
