// Player feature, page side (MAIN world). When we draw the miniplayer bigger
// than YouTube's own size (mini-drag.ts), the player box grows but the video
// keeps the size YouTube last gave it; only the page's player API can fix
// that. Acts only while the isolated side sets html[data-ytpp-mini-sized] and
// the player is minimized, so YouTube's own sizing is untouched otherwise.
// Also turns loop on / off for the loop button (loop-button.ts, §40.2): the
// player API keeps the right-click "Loop" in step, setting video.loop does not.
// And runs the popped-out player's commands (§50; pipCommand below).

import { pipDocument, queryPlayerDom } from '@/core/pip-doc';
import { LOOP_OFF_EVENT, LOOP_ON_EVENT, PIP_CMD_ATTR, PIP_CMD_EVENT, PIP_VID_ATTR } from './consts';

interface PlayerApi extends HTMLElement {
  getPlayerSize?: () => { width: number; height: number };
  setInternalSize?: (w: number, h: number) => void;
  setLoopVideo?: (on: boolean) => void;
  getPlayerState?: () => number;
  playVideo?: () => void;
  pauseVideo?: () => void;
  getCurrentTime?: () => number;
  getDuration?: () => number;
  seekTo?: (s: number, allowSeekAhead: boolean) => void;
  getVolume?: () => number;
  setVolume?: (v: number) => void;
  isMuted?: () => boolean;
  mute?: () => void;
  unMute?: () => void;
  getVideoData?: () => { video_id?: string } | undefined;
}

/**
 * The popped-out player (§50), on a command from the isolated side:
 * fit: lay the video and the control bar out for the PiP window's size (a
 * window resize does not reach the player there); vid: write the playing
 * video's id to html[data-ytpp-pip-vid]; the PiP window's keys: toggle,
 * seek:±n (seconds), vol:±n (percent), mute.
 */
function pipCommand(cmd: string): void {
  const html = document.documentElement;
  const p = pipDocument()?.querySelector<PlayerApi>('#movie_player') ?? document.querySelector<PlayerApi>('#movie_player');
  if (!p) return;
  const [name, arg] = cmd.split(':');
  const n = Number(arg);
  switch (name) {
    case 'fit': {
      const r = p.getBoundingClientRect();
      if (r.width && p.setInternalSize) p.setInternalSize(Math.round(r.width), Math.round(r.height));
      return;
    }
    case 'vid':
      html.setAttribute(PIP_VID_ATTR, p.getVideoData?.()?.video_id ?? '');
      return;
    case 'toggle':
      // 1 playing, 3 buffering.
      if (p.getPlayerState?.() === 1 || p.getPlayerState?.() === 3) p.pauseVideo?.();
      else p.playVideo?.();
      return;
    case 'seek': {
      const now = p.getCurrentTime?.() ?? 0;
      const end = p.getDuration?.() || Infinity;
      p.seekTo?.(Math.min(Math.max(0, now + n), end), true);
      return;
    }
    case 'vol': {
      if (p.isMuted?.() && n > 0) p.unMute?.();
      p.setVolume?.(Math.min(100, Math.max(0, (p.getVolume?.() ?? 0) + n)));
      return;
    }
    case 'mute':
      if (p.isMuted?.()) p.unMute?.();
      else p.mute?.();
      return;
  }
}

function setLoop(on: boolean): void {
  // Popped out (§50), the player is in the PiP window.
  const p = queryPlayerDom<PlayerApi>('#movie_player');
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
  document.addEventListener(PIP_CMD_EVENT, () => {
    try {
      pipCommand(document.documentElement.getAttribute(PIP_CMD_ATTR) ?? '');
    } catch {
      // never break the page
    }
  });

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
