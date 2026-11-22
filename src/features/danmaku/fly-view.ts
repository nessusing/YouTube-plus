// Flying style (§52), the drawing side: single-line pills crossing the
// player from right to left in lanes from the top. Shared by the player
// overlay and the options page preview; drawn from video time every frame.

import { commentNodes, fontPx, LINE_HEIGHT, sourceLabel } from './card-view';
import { assignLanes, type FlyItem, flySec, xAt } from './fly';
import type { DisplayParams } from './params';
import { displayWidth } from './text';

const CSS = `
:host { all: initial; position: absolute; inset: 0; overflow: hidden; pointer-events: none; z-index: 40; }
.lanes { position: absolute; left: 0; right: 0; top: 0; transition: transform 200ms ease; }
.strip {
  position: absolute; left: 0; top: 0; box-sizing: border-box; white-space: nowrap; color: #fff;
  font-family: "YouTube Noto", Roboto, "Arial Unicode Ms", Arial, Helvetica, Verdana, "PT Sans Caption", sans-serif;
  padding: 0.2em 0.75em; border-radius: 999px; will-change: transform;
}
.handle { opacity: 0.72; font-weight: 500; margin-right: 0.45em; }
.strip img { height: 1em; width: auto; vertical-align: -0.15em; }
.src { margin-left: 0.6em; font-size: 0.7em; opacity: 0.8; }
`;

/** Space between lanes and between comments in a lane, in em. */
const LANE_GAP = 0.3;
const ITEM_GAP = 1.5;
/** Average width of a Latin character, in em (for lane planning; drawing measures). */
const CHAR_EM = 0.52;

export interface FlyDrawOptions {
  p: DisplayParams;
  width: number;
  height: number;
  /** Top of the first lane. */
  top: number;
  debug?: boolean;
}

export class FlyView {
  readonly host: HTMLElement;
  private readonly lanesEl: HTMLElement;
  private readonly els = new Map<string, HTMLElement>();
  private readonly widths = new Map<string, number>();
  private plan?: { items: FlyItem[]; key: string; lanes: number[]; maxSec: number };

  constructor(private readonly doc: Document = document) {
    this.host = doc.createElement('div');
    const root = this.host.attachShadow({ mode: 'open' });
    const style = doc.createElement('style');
    style.textContent = CSS;
    this.lanesEl = doc.createElement('div');
    this.lanesEl.className = 'lanes';
    root.append(style, this.lanesEl);
  }

  /** Remove every comment (nothing to show). */
  clear(): void {
    for (const el of this.els.values()) el.remove();
    this.els.clear();
  }

  draw(items: FlyItem[], t: number, o: FlyDrawOptions): void {
    if (!items.length || !o.width) {
      this.clear();
      return;
    }
    const font = fontPx(o.height, o.p);
    const laneH = font * (LINE_HEIGHT + 0.4 + LANE_GAP);
    const lanes = Math.max(1, Math.floor((o.height * o.p.flyArea) / laneH));
    const plan = this.planFor(items, o.width, font, lanes, !!o.debug);
    this.lanesEl.style.transform = `translateY(${o.top}px)`;

    // Items are sorted by start; the ones on screen started within maxSec.
    let hi = items.length;
    let lo = 0;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (items[mid]!.start <= t) lo = mid + 1;
      else hi = mid;
    }
    const live = new Set<string>();
    for (let i = lo - 1; i >= 0 && items[i]!.start >= t - plan.maxSec; i--) {
      const it = items[i]!;
      const id = `${it.c.id}@${it.start}`;
      let el = this.els.get(id);
      if (!el) {
        el = this.doc.createElement('div');
        el.className = 'strip';
        el.append(...commentNodes(this.doc, it.c));
        if (o.debug) el.append(Object.assign(this.doc.createElement('span'), { className: 'src', textContent: sourceLabel(it) }));
        this.lanesEl.append(el);
        this.els.set(id, el);
      }
      el.style.fontSize = `${font}px`;
      el.style.lineHeight = `${font * LINE_HEIGHT}px`;
      el.style.background = `rgba(8, 8, 8, ${o.p.bgOpacity})`;
      const wKey = `${id}|${font}|${o.debug ? 1 : 0}`; // what changes an element's width
      let w = this.widths.get(wKey);
      if (w === undefined) {
        w = el.offsetWidth;
        if (this.widths.size > 2000) this.widths.clear();
        this.widths.set(wKey, w);
      }
      const x = xAt(it, t, o.width);
      if (x + w <= 0 || x >= o.width) continue;
      live.add(id);
      el.style.transform = `translate(${x.toFixed(1)}px, ${plan.lanes[i]! * laneH}px)`;
    }
    for (const [id, el] of this.els) {
      if (live.has(id)) continue;
      el.remove();
      this.els.delete(id);
    }
  }

  /** Lanes are planned from estimated widths, once per timeline, size and lane count. */
  private planFor(items: FlyItem[], width: number, font: number, lanes: number, debug: boolean) {
    const key = `${Math.round(width)}|${font}|${lanes}|${debug}`;
    if (this.plan?.items === items && this.plan.key === key) return this.plan;
    const est = items.map((it) => font * (CHAR_EM * displayWidth(`${it.c.author} ${it.c.text}`, 2) + 1.5 + it.c.images.length));
    const laneOf = assignLanes(items, est, width, lanes, font * ITEM_GAP);
    // Generous: drawing uses real widths, which may be wider than estimated.
    const maxSec = items.reduce((m, it, i) => Math.max(m, flySec(it, est[i]! * 1.5 + font * 4, width)), 0);
    this.clear();
    this.plan = { items, key, lanes: laneOf, maxSec };
    return this.plan;
  }
}
