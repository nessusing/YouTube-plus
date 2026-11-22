// AI placement through Gemini's YouTube app (§51.5): the
// prompt from the user-editable template, and the compact one-line-per-comment
// reply. Measured 2026-11-22: only confidence ≥ 0.9 is reliable (all within
// 5 s); 0.5–0.8 can be minutes off, so it becomes ambient.

import { PROMPT_PLACEHOLDERS } from './params';

export interface PromptInput {
  videoId: string;
  title: string;
  /** Seconds. */
  duration: number;
  /** Ids are small numbers local to this batch. */
  comments: { id: number; text: string }[];
}

/** Placeholders the template must keep for the request to make sense. */
export function missingPlaceholders(template: string): string[] {
  return ['{{url}}', '{{comments}}'].filter((p) => !template.includes(p));
}

/** One line, at most `maxChars` characters (code points). */
function oneLine(s: string, maxChars: number): string {
  const flat = s.replace(/\s+/g, ' ').trim();
  const cps = [...flat];
  return cps.length > maxChars ? `${cps.slice(0, maxChars).join('')}…` : flat;
}

export function buildPlacementPrompt(template: string, i: PromptInput, maxChars: number): string {
  const values: Record<(typeof PROMPT_PLACEHOLDERS)[number], string> = {
    '{{url}}': `https://www.youtube.com/watch?v=${i.videoId}`,
    '{{title}}': JSON.stringify(i.title),
    '{{duration}}': String(Math.round(i.duration)),
    '{{comments}}': i.comments.map((c) => `${c.id}|${oneLine(c.text, maxChars)}`).join('\n'),
  };
  // One pass, so a comment containing "{{url}}" stays as it is.
  return template.replace(/\{\{(url|title|duration|comments)\}\}/g, (m) => values[m as keyof typeof values]);
}

export type Placement =
  /** Shown at `sec`. */
  | { kind: 'at'; sec: number; conf: number }
  /** Fits no reliable moment: Gemini said a, the confidence is below highConf, or the time is outside the video. */
  | { kind: 'ambient'; why: 'a' | 'low' | 'range'; sec?: number; conf?: number }
  /** Not to be shown (x). */
  | { kind: 'hide' };

export type PlacementResult =
  | { status: 'ok'; items: Map<number, Placement> }
  | { status: 'no_transcript' }
  /** Nothing in the reply looked like a placement line. */
  | { status: 'unparsed' };

/** "83", "83.5", "1:23", "1:02:03" → seconds; NaN otherwise. */
function seconds(s: string): number {
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  if (!/^\d+(:\d{1,2}){1,2}$/.test(s)) return NaN;
  return s.split(':').reduce((t, part) => t * 60 + Number(part), 0);
}

const LINE = /^\s*(?:[-*•]\s*)?(\d+)\s*\|\s*([^|]*?)\s*(?:\|\s*([\d.]+)\s*)?$/;

/**
 * Parse the reply. Ids missing from the result are unknown (retried, never
 * shown). The first line for an id wins; stray lines (code fences, prose) are
 * skipped.
 */
export function parsePlacement(reply: string, o: { duration: number; highConf: number }): PlacementResult {
  const items = new Map<number, Placement>();
  for (const line of reply.split('\n')) {
    const m = line.match(LINE);
    if (!m) continue;
    const id = Number(m[1]);
    if (items.has(id)) continue;
    const what = m[2]!.toLowerCase();
    if (what === 'a') { items.set(id, { kind: 'ambient', why: 'a' }); continue; }
    if (what === 'x') { items.set(id, { kind: 'hide' }); continue; }
    const sec = seconds(what);
    if (!Number.isFinite(sec)) continue;
    const conf = m[3] !== undefined && Number.isFinite(Number(m[3])) ? Number(m[3]) : 0;
    if (sec < 0 || sec > o.duration) items.set(id, { kind: 'ambient', why: 'range', sec, conf });
    else if (conf >= o.highConf) items.set(id, { kind: 'at', sec, conf });
    else items.set(id, { kind: 'ambient', why: 'low', sec, conf });
  }
  if (items.size) return { status: 'ok', items };
  return /^\s*no_transcript\b/im.test(reply) ? { status: 'no_transcript' } : { status: 'unparsed' };
}

/**
 * A stored placement under the current confidence cut-off, so changing it
 * applies to cached results too. Times outside the video stay ambient.
 */
export function withCutoff(pl: Placement, highConf: number): Placement {
  if (pl.kind === 'at' && pl.conf < highConf) return { kind: 'ambient', why: 'low', sec: pl.sec, conf: pl.conf };
  if (pl.kind === 'ambient' && pl.why === 'low' && pl.sec !== undefined && pl.conf !== undefined && pl.conf >= highConf) return { kind: 'at', sec: pl.sec, conf: pl.conf };
  return pl;
}
