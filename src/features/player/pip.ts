// Pop the miniplayer out to the desktop (F-11). The whole #movie_player moves
// into a Document PiP window (approach A): the official control bar and our
// changes to it go along, and the window floats above other tabs and programs.
// It is a kind of miniplayer: the page stays in its miniplayer state, with the
// miniplayer hidden and a bar at the bottom left standing in for it (as in
// F-07); a card clicked on a browse page plays in the PiP window.
//
// Opens from a button right of the miniplayer's Expand, or the shortcut
// (Shift+I by default; on a watch page it first does what `i` does). Comes back
// in on the shortcut again (here or in the PiP window), the bar, ✕ (ours in the
// player, or the title bar's) and when the page leaves the miniplayer.
//
// Findings (prototype, 2026-11-21): moving the playing player to another
// document does not stop it, and YouTube never moved it back. A window resize
// does not refit it there; the page script's setInternalSize does, and YouTube
// resets the size on each new video (ads too), seen on the video's style.
// YouTube's drags (seek bar, volume) wait for mousemove / mouseup on the page's
// document: forward them from the PiP document. Back / forward to the watch
// page fire only popstate; YouTube expands then only if the URL's video is the
// one playing (otherwise it stays a miniplayer and loads that video).

import { injectStyle, whenElement, type Toggleable } from '@/core/dom';
import { t } from '@/core/i18n';
import type { Logger } from '@/core/log';
import { notify } from '@/core/notify';
import { pipSupported } from '@/core/pip-doc';
import { MINI_POS_KEY, PIP_ATTR, PIP_CHANGE_EVENT, PIP_CMD_ATTR, PIP_CMD_EVENT, PIP_SIZE_KEY, PIP_VID_ATTR } from './consts';
import { makeMiniBar, type MiniBarEl } from './mini-bar';
import { isFullscreenButton, isPictureDblClick, pipFull } from './pip-full';
import { SEL } from './selectors';
import { formatShortcut, isTyping, matches, parseShortcut, type Shortcut } from './shortcut';
import { playerTooltip, type PlayerTooltip } from './tooltip';

interface DocPip {
  requestWindow(o?: { width?: number; height?: number; disallowReturnToOpener?: boolean }): Promise<Window>;
}

const NS = 'http://www.w3.org/2000/svg';
/** Drawn like the official Expand: white 2 px lines, round ends, 24×24. */
const STROKE = { fill: 'none', stroke: '#fff', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
/** A big window, open at its bottom right where a small window sits; an arrow points into it. */
const ICON_POP = ['M21 10V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h5', 'M14 14h7v6h-7z', 'M7 8l5 5', 'M12 9v4H8'];
const ICON_CLOSE = ['M6 6l12 12', 'M18 6L6 18'];

/** The miniplayer's default width, when nothing better is known. */
const DEFAULT_W = 400;
const TIP_EDGE = 12;
/** On a watch page, how long `i` may take to make the miniplayer. */
const MINI_WAIT_MS = 4000;

/** The PiP window's keys (YouTube's own do not reach it), by KeyboardEvent.code. */
const PIP_KEYS: Record<string, string> = {
  Space: 'toggle',
  KeyK: 'toggle',
  ArrowLeft: 'seek:-5',
  ArrowRight: 'seek:5',
  KeyJ: 'seek:-10',
  KeyL: 'seek:10',
  ArrowUp: 'vol:5',
  ArrowDown: 'vol:-5',
  KeyM: 'mute',
};

/** YouTube's drags follow these on the page's document (see the findings above). */
const FORWARDED = ['mousemove', 'mouseup', 'pointermove', 'pointerup', 'pointercancel'];

const CSS = `
html[${PIP_ATTR}] ${SEL.miniplayer} {
  opacity: 0 !important;
  clip-path: inset(50%) !important;
  pointer-events: none !important;
}
#movie_player .ytpp-pip-open {
  position: absolute; top: 0; left: 40px; z-index: 67;
  box-sizing: border-box; width: 40px; height: 40px; padding: 8px; margin: 0;
  border: 0; outline: none; background: none; cursor: pointer;
}
#movie_player .ytpp-pip-open svg { display: block; width: 24px; height: 24px; }
#movie_player .ytpp-pip-open:focus-visible { box-shadow: inset 0 0 0 2px rgba(255,255,255,.6); }
`;

/** Only in the PiP window: fill it; the watch page's control bar, always; no miniplayer layer. */
const PIP_CSS = `
html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: #000; }
body > #movie_player { position: absolute !important; inset: 0 !important; width: 100% !important; height: 100% !important; }
#movie_player .ytp-miniplayer-ui, #movie_player .ytpp-pip-open, #movie_player .ytpp-pip-open-tip,
#movie_player .ytpp-mini-min, #movie_player .ytpp-float-expand { display: none !important; }
#movie_player.ytp-player-minimized .ytp-chrome-bottom,
#movie_player.ytp-player-minimized .ytp-gradient-bottom { display: block !important; }
#movie_player.ytp-player-minimized > .ytp-progress-bar-container { display: none !important; }
/* Still a "minimized" player, YouTube puts the bar's progress bar at its very
   bottom (bottom: -1px), half out of the window. Where the watch page has it:
   astride the top edge of the control row (2026-11-22). */
#movie_player.ytp-player-minimized .ytp-chrome-bottom .ytp-progress-bar-container { top: -3px !important; bottom: auto !important; }
#movie_player .ytpp-pip-in {
  position: absolute; top: 0; z-index: 60;
  box-sizing: border-box; width: 40px; height: 40px; padding: 8px; margin: 0;
  border: 0; outline: none; background: none; cursor: pointer;
  transition: opacity .1s cubic-bezier(.4,0,1,1);
}
#movie_player .ytpp-pip-close { right: 0; }
#movie_player.ytp-autohide .ytpp-pip-in { opacity: 0; }
#movie_player .ytpp-pip-in svg { display: block; width: 24px; height: 24px; filter: drop-shadow(0 0 2px rgba(0,0,0,.5)); }
#movie_player .ytpp-pip-in:focus-visible { box-shadow: inset 0 0 0 2px rgba(255,255,255,.6); }
`;

export interface Pip extends Toggleable {
  /** The UI language changed: update the labels. */
  relabel(): void;
  /** The shortcut from settings ("" = none). */
  setShortcut(s: string): void;
}

function icon(paths: string[]): SVGSVGElement {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of paths) {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d);
    for (const [k, v] of Object.entries(STROKE)) p.setAttribute(k, v);
    svg.append(p);
  }
  return svg;
}

function playerButton(cls: string, paths: string[], onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.append(icon(paths));
  b.addEventListener('click', (e) => {
    // Keep it from the player: a click on it plays / pauses (the miniplayer's scrim too).
    e.stopPropagation();
    e.preventDefault();
    onClick();
  });
  b.addEventListener('dblclick', (e) => e.stopPropagation());
  return b;
}

/** A tooltip right under `b`, kept inside its player, like the official Expand's. */
function tipUnder(b: HTMLElement, tip: PlayerTooltip, text: string): void {
  const player = b.closest<HTMLElement>(SEL.moviePlayer);
  if (!player) return;
  if (tip.el.parentElement !== player) player.append(tip.el);
  tip.text.textContent = text;
  tip.el.style.display = '';
  const p = player.getBoundingClientRect();
  const r = b.getBoundingClientRect();
  const w = tip.el.offsetWidth;
  const left = Math.max(TIP_EDGE, Math.min(r.left - p.left + r.width / 2 - w / 2, p.width - TIP_EDGE - w));
  tip.el.style.left = `${Math.round(left)}px`;
  tip.el.style.top = `${Math.round(r.bottom - p.top)}px`;
}

const api = () => (window as unknown as { documentPictureInPicture?: DocPip }).documentPictureInPicture;

export function pip(log: Logger): Pip {
  const html = document.documentElement;
  let enabled = false;
  let shortcut: Shortcut | undefined;
  let removeStyle: (() => void) | undefined;
  let cancelPlayer: (() => void) | undefined;
  let cancelApp: (() => void) | undefined;
  let queued = false;

  /** The button in the miniplayer, and its tooltip. */
  let openBtn: HTMLButtonElement | undefined;
  let openTip: PlayerTooltip | undefined;
  let bar: MiniBarEl | undefined;

  // ---- while popped out ----
  let opening = false;
  let win: Window | undefined;
  let player: HTMLElement | undefined;
  let home: { parent: Node; next: Node | null } | undefined;
  let inBtns: HTMLButtonElement[] = [];
  let inTip: PlayerTooltip | undefined;
  /** Undo what moveIn set up. */
  let undo: (() => void)[] = [];

  /**
   * The size asked for, the same every time: Chrome then puts the window back
   * where and as big as the user last left it; a new size each time and it
   * opened at its default place (2026-11-22). Fixed on the first pop-out from
   * the miniplayer's size (F-07-AC3).
   */
  let savedSize: { width: number; height: number } | undefined;
  let miniWidth: number | undefined;

  const miniActive = () => !!document.querySelector(SEL.app)?.hasAttribute(SEL.appMiniActiveAttr);
  const keyText = () => (shortcut ? ` (${formatShortcut(shortcut)})` : '');
  const cmd = (c: string) => {
    html.setAttribute(PIP_CMD_ATTR, c);
    document.dispatchEvent(new Event(PIP_CMD_EVENT));
  };
  const changed = () => document.dispatchEvent(new Event(PIP_CHANGE_EVENT));

  // ---- size ----
  const windowSize = () => {
    if (savedSize) return savedSize;
    const live = document.querySelector(`${SEL.miniplayer} ${SEL.moviePlayer}`)?.getBoundingClientRect().width;
    const width = Math.round(live || miniWidth || DEFAULT_W);
    savedSize = { width, height: Math.round((width * 9) / 16) };
    void browser.storage.local.set({ [PIP_SIZE_KEY]: savedSize });
    return savedSize;
  };
  const loadSizes = async () => {
    const got = await browser.storage.local.get([PIP_SIZE_KEY, MINI_POS_KEY]);
    const s = got[PIP_SIZE_KEY] as { width?: number; height?: number } | undefined;
    savedSize = s?.width && s.height ? { width: s.width, height: s.height } : undefined;
    miniWidth = (got[MINI_POS_KEY] as { width?: number } | undefined)?.width;
  };
  const onStorage = (changes: Record<string, unknown>, area: string) => {
    if (area === 'local' && (PIP_SIZE_KEY in changes || MINI_POS_KEY in changes)) void loadSizes();
  };

  // ---- the bar ----
  const renderBar = () => {
    const show = enabled && !!player && miniActive();
    if (show && !bar) bar = makeMiniBar(() => close('bar'));
    if (!bar) return;
    bar.text.textContent = t('player.pipBar');
    bar.button.setAttribute('aria-label', t('player.pipBar'));
    bar.host.style.display = show ? '' : 'none';
  };

  // ---- styles in the PiP window ----
  const copyStyles = (doc: Document) => {
    for (const a of html.attributes) if (!a.name.startsWith('data-ytpp')) doc.documentElement.setAttribute(a.name, a.value);
    const add = (css: string) => {
      const s = doc.createElement('style');
      s.textContent = css;
      doc.head.append(s);
    };
    for (const sheet of [...document.styleSheets, ...document.adoptedStyleSheets]) {
      if ((sheet.ownerNode as Element | null)?.id?.startsWith('ytpp-')) continue;
      try {
        add([...sheet.cssRules].map((r) => r.cssText).join('\n'));
      } catch {
        // A cross-origin sheet: link it instead.
        if (!sheet.href) continue;
        const l = doc.createElement('link');
        l.rel = 'stylesheet';
        l.href = sheet.href;
        doc.head.append(l);
      }
    }
    add(PIP_CSS);
  };
  /** Our own styles (also parts turned on / off while popped out) and the theme follow along. */
  const mirrorStyles = (doc: Document) => {
    const copies = new Map<string, HTMLStyleElement>();
    const last = doc.head.lastElementChild;
    const sync = () => {
      const live = new Set<string>();
      for (const s of document.querySelectorAll<HTMLStyleElement>('style[id^="ytpp-"]')) {
        if (s.id === 'ytpp-pip') continue;
        live.add(s.id);
        let c = copies.get(s.id);
        if (!c) {
          c = doc.createElement('style');
          copies.set(s.id, c);
          // Before PIP_CSS, which must win.
          last?.before(c);
        }
        if (c.textContent !== s.textContent) c.textContent = s.textContent;
      }
      for (const [id, c] of copies) {
        if (live.has(id)) continue;
        c.remove();
        copies.delete(id);
      }
      doc.documentElement.toggleAttribute('dark', html.hasAttribute('dark'));
    };
    sync();
    const mo = new MutationObserver(sync);
    mo.observe(document.head, { childList: true, subtree: true, characterData: true });
    mo.observe(html, { attributes: true, attributeFilter: ['dark'] });
    undo.push(() => mo.disconnect());
  };

  // ---- popping out ----
  /** On a watch page: what `i` does (back to the browse page, the player into the miniplayer). */
  const toMiniplayer = () => {
    const b = document.querySelector<HTMLElement>(`${SEL.moviePlayer} ${SEL.miniButton}`);
    if (b) b.click();
    else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'i', code: 'KeyI', keyCode: 73, bubbles: true }));
  };
  const waitFor = (ok: () => boolean, ms: number) =>
    new Promise<boolean>((resolve) => {
      const t0 = Date.now();
      const tick = () => {
        if (ok()) resolve(true);
        else if (Date.now() - t0 > ms) resolve(false);
        else setTimeout(tick, 50);
      };
      tick();
    });
  const inMiniplayer = () => miniActive() && !!document.querySelector(`${SEL.miniplayer} ${SEL.moviePlayer}`);

  const canOpen = () => enabled && pipSupported() && !win && !opening
    && (miniActive() || (location.pathname === '/watch' && !!document.querySelector(SEL.moviePlayer)));

  /** `orMini`: if the browser will not open the window (no click or key of the user's), the miniplayer instead. */
  const open = async (orMini = false) => {
    const dp = api();
    if (!dp || !canOpen()) return;
    // Popping out of our full screen (pip-full.ts): the window goes back as it was first.
    if (full.active) full.exit('popping out');
    const fromWatch = !miniActive();
    opening = true;
    let w: Window | undefined;
    try {
      // First, while the click or key still counts as the user's: that is what lets the window open.
      // No "back to tab" in its title bar: it did just what ✕ does (user, 2026-11-22).
      w = await dp.requestWindow({ ...windowSize(), disallowReturnToOpener: true });
      if (fromWatch) {
        toMiniplayer();
        if (!(await waitFor(inMiniplayer, MINI_WAIT_MS))) throw new Error('the miniplayer did not open');
      }
      if (w.closed || !enabled) return;
      moveIn(w);
    } catch (e) {
      log.warn('pop out failed', e);
      if (w && !w.closed && w !== win) w.close();
      if (!w && orMini) toMiniInstead();
    } finally {
      opening = false;
    }
  };

  let fitQueued = false;
  const fitSoon = () => {
    if (fitQueued || !win) return;
    fitQueued = true;
    win.requestAnimationFrame(() => {
      fitQueued = false;
      if (player) cmd('fit');
    });
  };

  const moveIn = (w: Window) => {
    const p = document.querySelector<HTMLElement>(SEL.moviePlayer);
    if (!p?.parentNode) throw new Error('no player');
    win = w;
    player = p;
    home = { parent: p.parentNode, next: p.nextSibling };
    undo = [];
    const doc = w.document;
    doc.title = document.title;
    copyStyles(doc);
    mirrorStyles(doc);
    hideOpenTip();
    doc.body.append(p);
    html.setAttribute(PIP_ATTR, '');
    addInPlayerButtons(p);
    cmd('fit');

    // Should YouTube take the player back, put it here again before the next paint.
    const bodyMo = new MutationObserver(() => {
      if (!player || player.parentNode === doc.body) return;
      log.warn('YouTube moved the player out of the PiP window; moving it back');
      doc.body.append(player);
      fitSoon();
    });
    bodyMo.observe(doc.body, { childList: true });
    undo.push(() => bodyMo.disconnect());

    // YouTube sets the video back to the miniplayer's size on every new video (ads too).
    let video: HTMLVideoElement | null = null;
    const videoMo = new MutationObserver(() => {
      const v = video;
      if (!v || !player) return;
      const r = player.getBoundingClientRect();
      const vw = parseFloat(v.style.width);
      const vh = parseFloat(v.style.height);
      if (Math.abs(vw - r.width) > 1 && Math.abs(vh - r.height) > 1) fitSoon();
    });
    const watchVideo = () => {
      const v = p.querySelector('video');
      if (v === video) return;
      videoMo.disconnect();
      video = v;
      if (v) videoMo.observe(v, { attributes: true, attributeFilter: ['style'] });
    };
    watchVideo();
    undo.push(() => videoMo.disconnect());

    const on = (target: EventTarget, type: string, fn: (e: Event) => void, capture = false) => {
      target.addEventListener(type, fn, capture);
      undo.push(() => target.removeEventListener(type, fn, capture));
    };
    on(doc, 'loadeddata', () => {
      watchVideo();
      fitSoon();
    }, true);
    on(w, 'resize', fitSoon);
    on(w, 'pagehide', () => close('window closed'));
    on(doc, 'keydown', (e) => onPipKey(e as KeyboardEvent), true);
    // Full screen is not allowed in here: the button and a double click on the picture go to the tab's (pip-full.ts).
    on(doc, 'click', (e) => {
      if (!isFullscreenButton(e)) return;
      e.preventDefault();
      e.stopPropagation();
      toFull();
    }, true);
    on(doc, 'dblclick', (e) => {
      if (!isPictureDblClick(e)) return;
      e.preventDefault();
      e.stopPropagation();
      toFull();
    }, true);
    for (const type of FORWARDED) {
      on(doc, type, (e) => {
        const Ctor = 'pointerId' in e ? PointerEvent : MouseEvent;
        document.dispatchEvent(new Ctor(type, e as PointerEventInit));
      }, true);
    }

    // Focus would stay on the miniplayer's button, now in the other window.
    (document.activeElement as HTMLElement | null)?.blur?.();
    renderBar();
    changed();
    log.info(`popped out (${w.innerWidth}×${w.innerHeight})`);
  };

  /** Back into the miniplayer, where it was; the PiP window closes. */
  const close = (why: string) => {
    if (!win) return;
    const w = win;
    const p = player;
    const h = home;
    win = player = home = undefined;
    for (const f of undo) f();
    undo = [];
    for (const el of [...inBtns, inTip?.el]) el?.remove();
    inBtns = [];
    inTip = undefined;
    if (p) {
      const parent = h?.parent.isConnected
        ? h.parent
        : (document.querySelector(`${SEL.miniplayer} ${SEL.playerHome}`) ?? document.querySelector(SEL.playerHome));
      if (parent) parent.insertBefore(p, h?.next && h.next.parentNode === parent ? h.next : null);
      else log.warn('nowhere to put the player back');
    }
    html.removeAttribute(PIP_ATTR);
    renderBar();
    if (!w.closed) w.close();
    changed();
    // YouTube lays the player out for the miniplayer's box again.
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
    log.info(`back in (${why})`);
  };

  // ---- full screen: in the tab (pip-full.ts) ----
  /**
   * Leaving full screen goes back to the PiP window. Esc and F11 do not count
   * as the user's (HTML spec: Esc is no activation), so the browser may refuse:
   * then the miniplayer, and a notice whose button (a click) pops out.
   */
  const backFromFull = (why: string) => {
    log.info(`full screen off (${why})`);
    if (canOpen()) {
      void open(true);
      return;
    }
    full.exit(why);
    toMiniInstead(false);
  };
  const toMiniInstead = (say = true) => {
    if (location.pathname === '/watch' && !miniActive()) toMiniplayer();
    if (say) notify(t('player.pipRefused'), { action: { label: t('player.pipReopen'), run: () => void open() } });
  };
  const full = pipFull(log, backFromFull);
  const toFull = () => {
    close('full screen');
    void full.enter();
  };

  // ---- the PiP window's buttons and keys ----
  const showInTip = (b: HTMLButtonElement) => {
    inTip ??= playerTooltip('ytpp-pip-in-tip');
    tipUnder(b, inTip, b.getAttribute('aria-label') ?? '');
  };
  const hideInTip = () => {
    if (inTip) inTip.el.style.display = 'none';
  };
  const relabelIn = () => {
    inBtns[0]?.setAttribute('aria-label', t('player.pipClose') + keyText());
  };
  /** ✕ at the top right, as in the title bar: back in. */
  const addInPlayerButtons = (p: HTMLElement) => {
    const x = playerButton('ytpp-pip-in ytpp-pip-close', ICON_CLOSE, () => close('close button'));
    x.addEventListener('mouseenter', () => showInTip(x));
    x.addEventListener('mouseleave', hideInTip);
    inBtns = [x];
    relabelIn();
    p.append(x);
  };

  const onPipKey = (e: KeyboardEvent) => {
    if (matches(shortcut, e)) {
      e.preventDefault();
      e.stopPropagation();
      close('shortcut');
      return;
    }
    if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
    if (e.code === 'KeyF') {
      e.preventDefault();
      e.stopPropagation();
      toFull();
      return;
    }
    const c = PIP_KEYS[e.code];
    if (!c) return;
    e.preventDefault();
    e.stopPropagation();
    cmd(c);
  };

  // ---- the page ----
  const onKey = (e: KeyboardEvent) => {
    if (!enabled || e.repeat || !matches(shortcut, e) || isTyping(e.composedPath()[0] ?? e.target)) return;
    if (win) close('shortcut');
    else if (canOpen()) void open();
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  /** A real navigation to a watch page: give the player back first, so YouTube can expand it. */
  const onNavigateStart = (e: Event) => {
    const url = (e as CustomEvent<{ url?: string }>).detail?.url;
    if (win && url?.startsWith('/watch')) close('to the watch page');
  };
  /**
   * Back / forward fire no yt-navigate-start. Captured, this runs before
   * YouTube's own handler. It expands only when the URL's video is the one
   * playing, and then so do we; otherwise it stays a miniplayer, and so does the PiP.
   */
  const onPopState = () => {
    if (!player || location.pathname !== '/watch') return;
    cmd('vid');
    const playing = html.getAttribute(PIP_VID_ATTR);
    if (playing && new URLSearchParams(location.search).get('v') === playing) close('back to the watch page');
  };
  /** The page left the miniplayer (closed with Esc, expanded): so does the PiP window. */
  const appMo = new MutationObserver(() => {
    if (player && !miniActive()) close('miniplayer gone');
    renderBar();
  });

  // ---- the button in the miniplayer ----
  const hideOpenTip = () => {
    if (openTip) openTip.el.style.display = 'none';
  };
  const showOpenTip = () => {
    if (!openBtn) return;
    openTip ??= playerTooltip('ytpp-pip-open-tip');
    tipUnder(openBtn, openTip, t('player.pip') + keyText());
  };
  const relabel = () => {
    openBtn?.setAttribute('aria-label', t('player.pip') + keyText());
    if (openTip && openTip.el.style.display !== 'none') showOpenTip();
    relabelIn();
    renderBar();
  };
  const ensure = () => {
    queued = false;
    if (!enabled) return;
    const scrim = document.querySelector(SEL.miniScrim);
    if (!scrim || openBtn?.parentElement === scrim) return;
    if (!openBtn) {
      openBtn = playerButton('ytpp-pip-open', ICON_POP, () => {
        hideOpenTip();
        void open();
      });
      openBtn.addEventListener('mouseenter', showOpenTip);
      openBtn.addEventListener('mouseleave', hideOpenTip);
      relabel();
    }
    scrim.append(openBtn);
  };
  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(ensure);
  };
  const playerMo = new MutationObserver(schedule);

  return {
    enable() {
      if (!pipSupported()) {
        log.info('no Document PiP in this browser: pop-out unavailable');
        return;
      }
      enabled = true;
      removeStyle = injectStyle('ytpp-pip', CSS);
      cancelPlayer = whenElement(SEL.moviePlayer, (p) => {
        playerMo.observe(p, { childList: true, subtree: true });
        ensure();
      });
      cancelApp = whenElement(SEL.app, (app) => appMo.observe(app, { attributes: true, attributeFilter: [SEL.appMiniActiveAttr] }));
      document.addEventListener('keydown', onKey, true);
      document.addEventListener('yt-navigate-start', onNavigateStart);
      window.addEventListener('popstate', onPopState, true);
      browser.storage.onChanged.addListener(onStorage);
      void loadSizes();
    },
    disable() {
      if (!enabled) return;
      close('turned off');
      full.exit('turned off');
      enabled = false;
      cancelPlayer?.();
      cancelApp?.();
      playerMo.disconnect();
      appMo.disconnect();
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('yt-navigate-start', onNavigateStart);
      window.removeEventListener('popstate', onPopState, true);
      browser.storage.onChanged.removeListener(onStorage);
      for (const el of [openBtn, openTip?.el, bar?.host]) el?.remove();
      openBtn = openTip = bar = undefined;
      removeStyle?.();
    },
    relabel,
    setShortcut(s) {
      shortcut = parseShortcut(s);
      relabel();
    },
  };
}
