// The whole timeline for one video in one mode (plans P13). Pure: the
// comments, Gemini's placements and the parameters in, the cards out.

import type { Placement } from './ai';
import { durOf, stampCards } from './cards';
import type { Comment, HeatSegment } from './comments';
import { localCandidates } from './local';
import type { DanmakuParams } from './params';
import { type Candidate, fillIdle, pickBest, placeStamps, type Slot } from './schedule';

export type Mode = 'stamps' | 'local' | 'ai';

export interface TimelineInput {
  videoId: string;
  duration: number;
  /** Comment count from the header. */
  total: number;
  /** Filtered comments and their heat, same order. */
  comments: Comment[];
  heat: number[];
  heatmap: HeatSegment[];
  /** AI mode: Gemini's verdict per comment id; ids without one are not shown. */
  placements?: Map<string, Placement>;
}

const byStart = (a: Slot, b: Slot) => a.start - b.start;

/**
 * stamps: timestamped comments only (also the AI fallback "只显示带时间戳的").
 * local: plus the rest spread by heat. ai: plus Gemini's confident times,
 * scored relevanceWeight × confidence + heatWeight × heat × duration, then
 * idle stretches filled from the ambient ones, hottest first.
 */
export function buildTimeline(i: TimelineInput, mode: Mode, p: DanmakuParams): Slot[] {
  const gapSec = p.display.gapSec;
  const fixed = placeStamps(stampCards(i.comments.filter((c) => c.stamps.length), i.duration, p), { maxDelaySec: p.stamps.maxDelaySec, gapSec });
  if (mode === 'stamps') return fixed;

  const heatOf = new Map(i.comments.map((c, k) => [c, i.heat[k] ?? 0]));
  const rest = i.comments.filter((c) => !c.stamps.length);
  if (mode === 'local') {
    const cands = localCandidates({ ...i, comments: rest, heat: rest.map((c) => heatOf.get(c)!) }, p);
    return [...fixed, ...pickBest(cands, fixed, gapSec)].sort(byStart);
  }

  const cands: Candidate[] = [];
  const ambient: { c: Comment; heat: number }[] = [];
  for (const c of rest) {
    const pl = i.placements?.get(c.id);
    const heat = heatOf.get(c)!;
    if (pl?.kind === 'at') {
      const dur = durOf(c, p.display);
      cands.push({ slot: { start: pl.sec, kind: 'ai', items: [c], durs: [dur], extra: 0, conf: pl.conf }, score: p.ai.relevanceWeight * pl.conf + p.ai.heatWeight * heat * dur });
    } else if (pl?.kind === 'ambient') {
      ambient.push({ c, heat });
    }
  }
  const placed = [...fixed, ...pickBest(cands, fixed, gapSec)];
  if (!p.ai.ambient) return placed.sort(byStart);
  const pool: Slot[] = ambient.sort((a, b) => b.heat - a.heat).map(({ c }) => ({ start: 0, kind: 'ambient', items: [c], durs: [durOf(c, p.display)], extra: 0 }));
  return fillIdle(placed, pool, { from: p.local.leadInSec, duration: i.duration, idleSec: p.ai.idleSec, gapSec, heatmap: i.heatmap });
}
