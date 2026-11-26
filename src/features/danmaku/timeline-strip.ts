// The settings page's view of a whole video's timeline (F-12-AC19): a lane per
// row with a block per comment, over the "Most replayed" curve, and the
// preview's playhead. Hovering reads a block out; clicking seeks.

import type { HeatSegment } from './comments';
import type { Slot } from './schedule';
import { timelineBlocks } from './preview';

const NS = 'http://www.w3.org/2000/svg';
/** Into a card far enough that it has faded in. */
const SEEK_INTO_SEC = 0.5;

export class TimelineStrip {
  readonly el: HTMLElement;
  private readonly bars: HTMLElement;
  private readonly head: HTMLElement;
  private readonly readout: HTMLElement;
  private duration = 1;

  constructor(onSeek: (t: number) => void) {
    this.el = div('dm-strip');
    this.bars = div('dm-strip-bars');
    this.head = div('dm-strip-head');
    this.readout = div('dm-strip-read');
    this.el.append(this.bars, this.readout);
    this.bars.addEventListener('click', (e) => {
      const block = (e.target as HTMLElement).closest<HTMLElement>('.dm-block');
      const r = this.bars.getBoundingClientRect();
      onSeek(block ? Number(block.dataset.start) + SEEK_INTO_SEC : ((e.clientX - r.left) / r.width) * this.duration);
    });
    this.bars.addEventListener('mousemove', (e) => {
      this.readout.textContent = (e.target as HTMLElement).closest<HTMLElement>('.dm-block')?.dataset.text ?? '';
    });
    this.bars.addEventListener('mouseleave', () => { this.readout.textContent = ''; });
  }

  set(slots: Slot[], duration: number, rows: number, heatmap: HeatSegment[]): void {
    this.duration = duration;
    const rowPx = Math.max(5, Math.min(14, Math.floor(112 / rows)));
    this.bars.style.height = `${rows * rowPx}px`;
    const blocks = timelineBlocks(slots, duration).map((b) => {
      const el = div(`dm-block ${b.kind}`);
      Object.assign(el.style, { left: `${b.left * 100}%`, width: `${b.width * 100}%`, top: `${b.row * rowPx + 0.5}px`, height: `${rowPx - 1}px` });
      el.dataset.start = String(b.start);
      el.dataset.text = b.title;
      return el;
    });
    this.bars.replaceChildren(...(heatmap.length ? [curve(heatmap, duration)] : []), ...blocks, this.head);
  }

  /** The preview is at `t`. */
  at(t: number): void {
    this.head.style.left = `${Math.min(100, (t / this.duration) * 100)}%`;
  }
}

const div = (className: string): HTMLDivElement => Object.assign(document.createElement('div'), { className });

/** The "Most replayed" curve as an area behind the lanes. */
function curve(heatmap: HeatSegment[], duration: number): SVGSVGElement {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 1000 100');
  svg.setAttribute('preserveAspectRatio', 'none');
  const path = document.createElementNS(NS, 'path');
  const points = heatmap.map((h) => `L${(((h.start + h.dur / 2) / duration) * 1000).toFixed(1)} ${(100 - 100 * h.score).toFixed(1)}`);
  path.setAttribute('d', `M0 100${points.join('')}L1000 100Z`);
  svg.append(path);
  return svg;
}
