// @vitest-environment happy-dom
// Loop button (§40.2): placement, state follows video.loop, on / off go to the
// page script as events, turning the setting off stops a loop.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { t } from '@/core/i18n';
import { LOOP_OFF_EVENT, LOOP_ON_EVENT } from '@/features/player/consts';
import { loopButton, type LoopButton } from '@/features/player/loop-button';

const frame = () => new Promise((r) => requestAnimationFrame(() => r(undefined)));
const tick = () => new Promise((r) => setTimeout(r, 0));

let sent: string[];
let part: LoopButton | undefined;
const video = () => document.querySelector('video')!;
const bar = () => document.querySelector<HTMLButtonElement>('.ytpp-loop-bar');
const mini = () => document.querySelector<HTMLButtonElement>('.ytpp-loop-mini');

// Stands in for player-main.ts: the player API sets the video's loop.
const onEvent = (e: Event) => {
  sent.push(e.type);
  video().loop = e.type === LOOP_ON_EVENT;
};

beforeEach(() => {
  sent = [];
  document.body.innerHTML = `
    <div id="movie_player">
      <video></video>
      <div class="ytp-miniplayer-controls">
        <div class="ytp-miniplayer-button-container"></div>
        <div class="ytp-miniplayer-play-button-container"><button class="ytp-play-button"></button></div>
        <div class="ytp-miniplayer-button-container"></div>
      </div>
      <div class="ytp-chrome-bottom"><div class="ytp-left-controls">
        <button class="ytp-play-button ytp-button"></button>
        <a class="ytp-next-button ytp-button"></a>
        <span class="ytp-volume-area"></span>
      </div></div>
    </div>`;
  document.addEventListener(LOOP_ON_EVENT, onEvent);
  document.addEventListener(LOOP_OFF_EVENT, onEvent);
});

afterEach(() => {
  part?.disable();
  part = undefined;
  document.removeEventListener(LOOP_ON_EVENT, onEvent);
  document.removeEventListener(LOOP_OFF_EVENT, onEvent);
});

function start(): LoopButton {
  part = loopButton();
  part.enable();
  return part;
}

describe('loop button', () => {
  it('F-10-AC1 sits right of ▶ in the bar and in the middle of the miniplayer, off', () => {
    start();
    expect(bar()?.previousElementSibling?.matches('.ytp-play-button')).toBe(true);
    expect(bar()?.nextElementSibling?.matches('.ytp-next-button')).toBe(true);
    expect(mini()?.parentElement?.matches('.ytp-miniplayer-play-button-container')).toBe(true);
    for (const b of [bar()!, mini()!]) {
      expect(b.getAttribute('aria-pressed')).toBe('false');
      expect(b.getAttribute('aria-label')).toBe(t('player.loopOn'));
    }
  });

  it('F-10-AC2 a click turns loop on through the page, and both buttons show it', async () => {
    start();
    bar()!.click();
    await tick();
    expect(sent).toEqual([LOOP_ON_EVENT]);
    for (const b of [bar()!, mini()!]) {
      expect(b.getAttribute('aria-pressed')).toBe('true');
      expect(b.getAttribute('aria-label')).toBe(t('player.loopOff'));
    }
    mini()!.click();
    await tick();
    expect(sent).toEqual([LOOP_ON_EVENT, LOOP_OFF_EVENT]);
    expect(bar()!.getAttribute('aria-pressed')).toBe('false');
  });

  it('F-10-AC2 follows loop set elsewhere (right-click menu, a new video)', async () => {
    start();
    video().loop = true;
    await tick();
    expect(bar()!.getAttribute('aria-pressed')).toBe('true');
    video().loop = false;
    await tick();
    expect(bar()!.getAttribute('aria-pressed')).toBe('false');
  });

  it('F-10-AC1 a click does not reach the player (the miniplayer scrim pauses on click)', () => {
    start();
    let reached = 0;
    document.querySelector('#movie_player')!.addEventListener('click', () => reached++);
    mini()!.click();
    expect(reached).toBe(0);
  });

  it('F-10-AC1 comes back when YouTube re-renders the bar', async () => {
    start();
    const controls = document.querySelector('.ytp-left-controls')!;
    const play = document.createElement('button');
    play.className = 'ytp-play-button ytp-button';
    controls.replaceChildren(play);
    await frame();
    await frame();
    expect(bar()?.previousElementSibling).toBe(play);
  });

  it('F-10-AC1 waits for a player that is not there yet', async () => {
    const html = document.body.innerHTML;
    document.body.innerHTML = '';
    start();
    expect(bar()).toBeNull();
    document.body.innerHTML = html;
    await tick();
    await frame();
    expect(bar()).not.toBeNull();
    expect(mini()).not.toBeNull();
  });

  it('F-10-AC3 turned off: buttons go, and a running loop stops', async () => {
    const p = start();
    bar()!.click();
    await tick();
    p.disable();
    part = undefined;
    expect(sent).toEqual([LOOP_ON_EVENT, LOOP_OFF_EVENT]);
    expect(video().loop).toBe(false);
    expect(document.querySelector('.ytpp-loop')).toBeNull();
    expect(document.getElementById('ytpp-loop-button')).toBeNull();
  });

  it('F-10-AC3 turned off while not looping: leaves loop alone', () => {
    const p = start();
    p.disable();
    part = undefined;
    expect(sent).toEqual([]);
  });

  it('F-10-AC1 shows the player-style tooltip on hover, with the current label', async () => {
    start();
    bar()!.dispatchEvent(new MouseEvent('mouseenter'));
    const tip = document.querySelector<HTMLElement>('#movie_player > .ytp-tooltip.ytpp-loop-tip')!;
    expect(tip.style.display).toBe('');
    expect(tip.textContent).toBe(t('player.loopOn'));
    bar()!.click();
    await tick();
    expect(tip.textContent).toBe(t('player.loopOff'));
    bar()!.dispatchEvent(new MouseEvent('mouseleave'));
    expect(tip.style.display).toBe('none');
  });
});
