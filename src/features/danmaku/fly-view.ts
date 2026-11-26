// Flying style (F-12), the drawing side: single-line pills crossing the
// player from right to left in lanes from the top. Shared by the player
// overlay and the options page preview; drawn from video time every frame.

import { AVATAR_CSS, commentNodes, fontPx, LINE_HEIGHT, sourceLabel } from './card-view';
import { assignLanes, estimateFlyWidth, type FlyItem, flySec, ITEM_GAP, xAt } from './fly';
import type { DisplayParams } from './params';

const CSS = `
:host { all: initial; position: absolute; inset: 0; overflow: hidden; pointer-events: none; z-index: 40; }
.lanes { position: absolute; left: 0; right: 0; top: 0; transition: transform 200ms ease; }
.strip {
  position: absolute; left: 0; top: 0; box-sizing: border-box; white-space: nowrap; color: #fff;
  font-family: "YouTube Noto", Roboto, "Arial Unicode Ms", Arial, Helvetica, Verdana, "PT Sans Caption", sans-serif;
  padding: 0.2em 0.75em; border-radius: 999px; will-change: transform;
}
.handle { opacity: 0.72; font-weight: 500; margin-right: 0.45em; }
${AVATAR_CSS}
.strip img:not(.avatar) { height: 1em; width: auto; vertical-align: -0.15em; }
.src { margin-left: 0.6em; font-size: 0.7em; opacity: 0.8; }
`;

/** Space between lanes, in em. */
const LANE_GAP = 0.3;
/** Share of the player's height the lanes may take, from the top. */
const MAX_AREA = 0.85;

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
  private plan?: { items: FlyItem[]; key: string; lanes: number[]; widths: number[]; maxSec: number };

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
    // As many lanes as asked for (F-12-AC13), as far as the player has room.
    const lanes = Math.max(1, Math.min(Math.round(o.p.flyRows), Math.floor((o.height * MAX_AREA) / laneH)));
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
      const lane = plan.lanes[i]!;
      const x = xAt(it, t, o.width);
      if (lane < 0 || x + plan.widths[i]! <= 0 || x >= o.width) continue;
      const id = `${it.c.id}@${it.start}`;
      let el = this.els.get(id);
      if (!el) {
        el = this.strip(it, !!o.debug);
        this.lanesEl.append(el);
        this.els.set(id, el);
      }
      this.style(el, font);
      el.style.background = `rgba(8, 8, 8, ${o.p.bgOpacity})`;
      live.add(id);
      el.style.transform = `translate(${x.toFixed(1)}px, ${lane * laneH}px)`;
    }
    for (const [id, el] of this.els) {
      if (live.has(id)) continue;
      el.remove();
      this.els.delete(id);
    }
  }

  private strip(it: FlyItem, debug: boolean, measure = false): HTMLElement {
    const el = this.doc.createElement('div');
    el.className = 'strip';
    el.append(...commentNodes(this.doc, it.c, measure));
    if (debug) el.append(Object.assign(this.doc.createElement('span'), { className: 'src', textContent: sourceLabel(it) }));
    return el;
  }

  private style(el: HTMLElement, font: number): void {
    el.style.fontSize = `${font}px`;
    el.style.lineHeight = `${font * LINE_HEIGHT}px`;
  }

  /** Widths and lanes, once per timeline, size and lane count. */
  private planFor(items: FlyItem[], width: number, font: number, lanes: number, debug: boolean) {
    const key = `${Math.round(width)}|${font}|${lanes}|${debug}`;
    if (this.plan?.items === items && this.plan.key === key) return this.plan;
    // All in one go, hidden: one layout for the lot. The estimate stands in where nothing is laid out.
    const probes = items.map((it) => {
      const el = this.strip(it, debug, true);
      this.style(el, font);
      el.style.visibility = 'hidden';
      return el;
    });
    this.lanesEl.append(...probes);
    const widths = probes.map((el, i) => el.offsetWidth || estimateFlyWidth(items[i]!.c, font));
    for (const el of probes) el.remove();
    const laneOf = assignLanes(items, widths, width, lanes, font * ITEM_GAP);
    const maxSec = items.reduce((m, it, i) => Math.max(m, flySec(it, widths[i]!, width)), 0);
    this.clear();
    this.plan = { items, key, lanes: laneOf, widths, maxSec };
    return this.plan;
  }
}
