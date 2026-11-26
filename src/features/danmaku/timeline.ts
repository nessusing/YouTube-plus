// The whole timeline for one video in one mode and style (F-12). Pure: the
// comments, Gemini's placements and the settings in, the cards out. The player
// and the settings page preview both come through here.

import type { DanmakuSettings } from '@/core/settings';
import { type Placement, withCutoff } from './ai';
import { durOf, stampCards } from './cards';
import type { Comment, HeatSegment } from './comments';
import { filterComments } from './filter';
import { flyLayout, flyMetrics } from './fly';
import { heatOf } from './heat';
import { localCandidates, localTarget, placeLocal } from './local';
import { fitLong, type TimelineStyle } from './long';
import type { CommentParams, DanmakuParams } from './params';
import { type Candidate, cardLayout, fillIdle, type Layout, pickBest, placeStamps, type Slot, type SlotKind, Tracks } from './schedule';
import { isToc } from './stamps';

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

/** What became of the filtered comments (F-12-AC19); all but `kept` add up to it. */
export interface PlanStats {
  kept: number;
  /** On the timeline. */
  placed: number;
  /** Hidden by the long-comment rule. */
  tooLong: number;
  /** Their moment, or the whole video, had no free row. */
  noRoom: number;
  /** Left out by the per-minute limit. */
  overLimit: number;
  /** The mode does not use them (no timestamp in "stamps"; Gemini hid them, gave nothing yet, or no gap needed them). */
  notUsed: number;
}

export interface Plan {
  slots: Slot[];
  stats: PlanStats;
}

const byStart = (a: Slot, b: Slot) => a.start - b.start;

/** How many comments to fetch: max(minCount, perMinute × minutes), capped at maxCount. */
export function fetchLimit(duration: number, p: Pick<CommentParams, 'minCount' | 'perMinute' | 'maxCount'>): number {
  return Math.min(p.maxCount, Math.max(p.minCount, Math.round((p.perMinute * duration) / 60)));
}

/** Fetched comments → what buildTimeline takes: filtered, with their heat. */
export function prepareComments(raw: Comment[], p: DanmakuParams): { comments: Comment[]; heat: number[] } {
  const { kept } = filterComments(raw, p.comments);
  return { comments: kept, heat: heatOf(kept, p.heat) };
}

/** How the style shares the screen. */
export const layoutOf = (p: DanmakuParams['display'], style: TimelineStyle): Layout =>
  style === 'fly' ? flyLayout(p.flyRows, p) : cardLayout(p.cardRows, p.gapSec);

/** Kinds where a comment appears once: shown already, it is not placed again. */
const ONCE: ReadonlySet<SlotKind> = new Set(['local', 'ai', 'ambient']);
/**
 * A comment's cards for moments this close are the same appearance (twice
 * clusterSec by default: a moment's start moves as more comments arrive).
 */
const SAME_MOMENT_SEC = 4;

/** Is one of `s`'s timestamped comments already on a card for that moment? */
const repeats = (s: Slot, kept: Slot[]): boolean => s.moment !== undefined && kept.some((k) =>
  k.moment !== undefined && Math.abs(k.moment - s.moment!) <= SAME_MOMENT_SEC && k.items.some((a) => s.items.some((b) => a.id === b.id)));

/**
 * A new timeline replaces only what has not started by `now` (F-12-AC10):
 * cards that started stay, so seeking back replays them. The new timeline
 * fills the free rows everywhere else, before `now` too (a first layout
 * mid-video, or a part skipped by seeking), and never repeats a comment a kept
 * card showed (a timestamped one: not for the same moment).
 */
export function mergeTimeline(old: Slot[], next: Slot[], now: number, layout: Layout): Slot[] {
  const kept = old.filter((s) => s.start <= now);
  const shown = new Set(kept.filter((s) => ONCE.has(s.kind)).flatMap((s) => s.items.map((c) => c.id)));
  const tracks = new Tracks(layout);
  for (const s of kept) tracks.add(s);
  const fresh: Slot[] = [];
  for (const s of [...next].sort(byStart)) {
    if (ONCE.has(s.kind) ? s.items.some((c) => shown.has(c.id)) : repeats(s, kept)) continue;
    const row = tracks.rowAt(s);
    if (row === undefined) continue;
    const placed = row === (s.row ?? 0) ? s : { ...s, row };
    tracks.add(placed);
    fresh.push(placed);
  }
  return [...kept, ...fresh].sort(byStart);
}

/**
 * AI mode's confident times into the free rows. Cards: each row in turn takes
 * its best-scoring set. Flying lanes are not simple intervals: best score first.
 */
function placeScored(tracks: Tracks, cands: Candidate[], style: TimelineStyle, taken: Slot[], gapSec: number): Slot[] {
  const out: Slot[] = [];
  const add = (s: Slot, row: number) => {
    const placed = { ...s, row };
    tracks.add(placed);
    out.push(placed);
  };
  if (style === 'fly') {
    for (const c of [...cands].sort((a, b) => b.score - a.score)) {
      const row = tracks.rowAt(c.slot);
      if (row !== undefined) add(c.slot, row);
    }
    return out;
  }
  let left = cands;
  for (let r = 0; r < tracks.layout.rows && left.length; r++) {
    const picked = new Set(pickBest(left, taken.filter((s) => s.row === r), gapSec));
    for (const s of picked) add(s, r);
    left = left.filter((c) => !picked.has(c.slot));
  }
  return out;
}

/**
 * stamps: timestamped comments only (also the AI fallback "只显示带时间戳的").
 * local: plus the rest by heat, as many as fit or the limit allows. ai: plus
 * Gemini's confident times, scored relevanceWeight × confidence + heatWeight ×
 * heat × duration, then empty stretches filled from the ambient ones, hottest
 * first. Long comments are hidden or cut first (F-12-AC17).
 */
export function planTimeline(i: TimelineInput, mode: Mode, p: DanmakuParams, style: TimelineStyle = 'card'): Plan {
  const d = p.display;
  const tracks = new Tracks(layoutOf(d, style));
  const stats: PlanStats = { kept: i.comments.length, placed: 0, tooLong: 0, noRoom: 0, overLimit: 0, notUsed: 0 };
  const done = (slots: Slot[]): Plan => {
    stats.placed = new Set(slots.flatMap((s) => s.items.map((c) => c.id))).size;
    stats.notUsed = stats.kept - stats.placed - stats.tooLong - stats.noRoom - stats.overLimit;
    return { slots: slots.sort(byStart), stats };
  };

  // As shown: long ones hidden or cut. Heat goes by id, cut copies included.
  const heat = new Map(i.comments.map((c, k) => [c.id, i.heat[k] ?? 0]));
  const shown = new Map<string, Comment>();
  for (const c of i.comments) {
    const fit = fitLong(c, d, style, c.stamps.length > 0 && isToc(c, p.stamps, d.cjkWidth));
    if (fit) shown.set(c.id, fit);
    else stats.tooLong++;
  }

  /** A slot for one comment, shaped for the style. */
  const single = (c: Comment, kind: SlotKind, start = 0, more: Partial<Slot> = {}): Slot => {
    if (style === 'card') return { start, kind, items: [c], durs: [durOf(c, d)], extra: 0, ...more };
    const fly = flyMetrics(c, d);
    return { start, kind, items: [c], durs: [(1 + fly.w) * fly.cross], extra: 0, fly, ...more };
  };

  const stamped = i.comments.filter((c) => c.stamps.length && shown.has(c.id));
  // Grouped from the whole comments (a cut one must still count as contents), then shown cut.
  let moments = stampCards(stamped, i.duration, p).map((s) => {
    const items = s.items.map((c) => shown.get(c.id)!);
    return { ...s, items, durs: items.map((c) => durOf(c, d)) };
  });
  // Flying has no rotation: each comment of a moment is a strip of its own.
  if (style === 'fly') moments = moments.flatMap((s) => s.items.map((c, k) => single(c, s.kind, s.start, { extra: k === s.items.length - 1 ? s.extra : 0 })));
  const fixed = placeStamps(moments, tracks, p.stamps.maxDelaySec);
  const fixedIds = new Set(fixed.flatMap((s) => s.items.map((c) => c.id)));
  // Timestamped ones that were to show but found no row (those beyond rotateMax are "not used").
  stats.noRoom += new Set(moments.flatMap((s) => s.items.map((c) => c.id)).filter((id) => !fixedIds.has(id))).size;
  if (mode === 'stamps') return done(fixed);

  const rest = i.comments.filter((c) => !c.stamps.length && shown.has(c.id)).map((c) => shown.get(c.id)!);
  if (mode === 'local') {
    const cands = localCandidates({ ...i, comments: rest, heat: rest.map((c) => heat.get(c.id)!) }, p, (c) => single(c, 'local'));
    const r = placeLocal(tracks, cands, { from: p.local.leadInSec, duration: i.duration, tailFrom: i.duration * (1 - p.local.spoilerTail), target: localTarget(i.duration, p.local) });
    stats.noRoom += r.noRoom;
    stats.overLimit += r.overLimit;
    return done([...fixed, ...r.slots]);
  }

  const cands: Candidate[] = [];
  const ambient: { c: Comment; heat: number }[] = [];
  for (const c of rest) {
    const pl = i.placements?.get(c.id);
    const h = heat.get(c.id)!;
    if (pl?.kind === 'at') {
      const slot = single(c, 'ai', pl.sec, { conf: pl.conf });
      cands.push({ slot, score: p.ai.relevanceWeight * pl.conf + p.ai.heatWeight * h * slot.durs[0]! });
    } else if (pl?.kind === 'ambient') {
      ambient.push({ c, heat: h });
    }
  }
  const ai = placeScored(tracks, cands, style, fixed, d.gapSec);
  stats.noRoom += cands.length - ai.length;
  const placed = [...fixed, ...ai];
  if (!p.ai.ambient) return done(placed);
  const pool = ambient.sort((a, b) => b.heat - a.heat).map(({ c }) => single(c, 'ambient'));
  return done(fillIdle(placed, pool, { from: p.local.leadInSec, duration: i.duration, idleSec: p.ai.idleSec, gapSec: d.gapSec, heatmap: i.heatmap }));
}

export const buildTimeline = (i: TimelineInput, mode: Mode, p: DanmakuParams, style: TimelineStyle = 'card'): Slot[] =>
  planTimeline(i, mode, p, style).slots;

/** A video as fetched, with what Gemini has said about it. */
export interface Video {
  videoId: string;
  duration: number;
  total: number;
  /** As fetched, unfiltered. */
  comments: Comment[];
  heatmap: HeatSegment[];
  placements?: Map<string, Placement>;
  /** AI mode could not run for it. */
  aiFailed?: boolean;
}

/** The mode the settings ask for, or its fallback when Gemini cannot be used. */
export function modeOf(s: Pick<DanmakuSettings, 'placement' | 'params'>, aiFailed: boolean): Mode {
  if (s.placement === 'local') return 'local';
  return aiFailed ? s.params.ai.fallback : 'ai';
}

/** The timeline of a video with these settings, from its raw comments. */
export function planVideo(v: Video, s: Pick<DanmakuSettings, 'placement' | 'style' | 'params'>): Plan & { mode: Mode } {
  const p = s.params;
  const mode = modeOf(s, !!v.aiFailed);
  const placements = mode === 'ai' ? new Map([...(v.placements ?? [])].map(([id, pl]) => [id, withCutoff(pl, p.ai.highConf)])) : undefined;
  const plan = planTimeline({
    videoId: v.videoId, duration: v.duration, total: v.total || v.comments.length,
    ...prepareComments(v.comments, p), heatmap: v.heatmap, placements,
  }, mode, p, s.style === 'fly' ? 'fly' : 'card');
  return { ...plan, mode };
}
