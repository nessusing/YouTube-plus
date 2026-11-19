// Gemini web protocol, pure parts (design §10, §11). Verified 2026-11-18:
// StreamGenerate still answers; frames are length-prefixed in UTF-16 units
// (= JS string length); the last frame has the full text; GzXR5e deletes.

import { t } from '@/core/i18n';
import type { Lang } from '@/core/settings';
import type { ProviderError, Summary, SummaryInput, SummaryResult } from './types';

const LANG_NAME: Record<Lang, string> = { zh: 'Simplified Chinese', en: 'English' };

function schemaOf(titleCheck: boolean, id: string): string {
  return titleCheck
    ? `{${id}"status":"ok","lang":"<language code>","points":["..."],"titleMatch":{"verdict":"match|partial|mismatch","reason":"..."}}`
    : `{${id}"status":"ok","lang":"<language code>","points":["..."]}`;
}

function rules(i: Pick<SummaryInput, 'lang' | 'titleCheck'>): string[] {
  const lang = LANG_NAME[i.lang];
  return [
    `points: 3 to 7 key points depending on the video's length, written in ${lang} whatever language the video is in.`,
    i.titleCheck ? `titleMatch: does the content deliver what the title promises? Give a one-sentence reason in ${lang}.` : '',
  ];
}

export function buildPrompt(i: SummaryInput): string {
  return [
    `Read the YouTube video https://www.youtube.com/watch?v=${i.videoId} (title: ${JSON.stringify(i.title)}) with the YouTube app.`,
    'Output ONLY JSON, no code fences, no other text:',
    schemaOf(i.titleCheck, ''),
    ...rules(i),
    'If you cannot read the video content (no transcript, the tool failed, etc.), output ONLY {"status":"no_transcript"}. Never make up content from the title.',
  ].filter(Boolean).join('\n');
}

/**
 * Several videos in one prompt (verified 2026-11-18: 8 videos in ~15 s, in
 * order, unreadable ones marked individually). All inputs share lang/titleCheck.
 */
export function buildBatchPrompt(items: SummaryInput[]): string {
  const first = items[0]!;
  return [
    'Read each of these YouTube videos with the YouTube app:',
    ...items.map((i, n) => `${n + 1}. https://www.youtube.com/watch?v=${i.videoId} (title: ${JSON.stringify(i.title)})`),
    'Output ONLY a JSON array, one object per video in the same order, no code fences, no other text:',
    `[${schemaOf(first.titleCheck, '"id":"<video id>",')}]`,
    ...rules(first),
    'If you cannot read a video\'s content (no transcript, the tool failed, etc.), its object is ONLY {"id":"<video id>","status":"no_transcript"}. Never make up content from the title.',
  ].filter(Boolean).join('\n');
}

/** The ~80-slot request array; slots follow the web client (design §10.2). */
export function buildInner(prompt: string, uuid: string): unknown[] {
  const inner: unknown[] = new Array(80).fill(null);
  inner[0] = [prompt, 0, null, null, null, null, 0];
  inner[1] = ['en'];
  inner[2] = ['', '', '', null, null, null, null, null, null, ''];
  inner[6] = [0];
  inner[7] = 1;
  inner[10] = 1;
  inner[11] = 0;
  inner[17] = [[4]];
  inner[18] = 0;
  inner[27] = 1;
  inner[30] = [4];
  inner[41] = [2];
  inner[53] = 0;
  inner[59] = uuid;
  inner[61] = [];
  inner[68] = 1;
  // [45] (temporary chat) stays unset: the YouTube app needs a normal chat.
  // [79] (model) stays unset: use the account default.
  return inner;
}

export function extractTokens(html: string): { at?: string; bl?: string; sid?: string } {
  const pick = (k: string) => new RegExp(`"${k}":"([^"]*)"`).exec(html)?.[1];
  return { at: pick('SNlM0e'), bl: pick('cfb2h'), sid: pick('FdrFJe') };
}

export interface Parsed { text?: string; cid?: string; rid?: string; errorCode?: number }

/** Split ")]}'"-prefixed, length-prefixed frames and pull the last full answer. */
export function parseStream(raw: string): Parsed {
  const out: Parsed = {};
  const err = /BardErrorInfo\s*\[(\d+)\]/.exec(raw);
  if (err) out.errorCode = Number(err[1]);
  const s = raw.replace(/^\)\]\}'\s*/, '');
  let i = 0;
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i]!)) i++;
    const m = /^\d+/.exec(s.slice(i, i + 12));
    if (!m) break;
    const start = i + m[0].length;
    const frame = s.slice(start, start + Number(m[0]));
    i = start + Number(m[0]);
    let arr: unknown;
    try {
      arr = JSON.parse(frame);
    } catch {
      continue;
    }
    if (!Array.isArray(arr)) continue;
    for (const part of arr) {
      if (!Array.isArray(part) || part[0] !== 'wrb.fr' || typeof part[2] !== 'string') continue;
      let j: unknown;
      try {
        j = JSON.parse(part[2]);
      } catch {
        continue;
      }
      const jj = j as unknown[][];
      const ids = jj?.[1] as unknown[] | undefined;
      if (typeof ids?.[0] === 'string') {
        out.cid = ids[0];
        out.rid = typeof ids[1] === 'string' ? ids[1] : out.rid;
      }
      const cand = (jj?.[4] as unknown[] | undefined)?.[0] as unknown[] | undefined;
      if (!cand) continue;
      let t = (cand[1] as unknown[] | undefined)?.[0];
      if (typeof t === 'string' && /googleusercontent\.com\/card_content/.test(t)) t = (cand[22] as unknown[] | undefined)?.[0];
      if (typeof t === 'string' && t) out.text = t;
    }
  }
  return out;
}

export function mapErrorCode(code: number): ProviderError {
  if (code === 1037) return { code: 'quota' };
  if (code === 1060 || code === 1152) return { code: 'blocked' };
  if (code === 1050 || code === 1052) return { code: 'protocol' };
  return { code: 'transient' };
}

export function mapHttpStatus(status: number): ProviderError {
  if (status === 429) return { code: 'blocked' };
  if (status === 400 || status === 401 || status === 403) return { code: 'auth' };
  if (status === 404 || status === 405) return { code: 'protocol' };
  return { code: 'transient' };
}

function tryParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

function stripFences(text: string): string {
  return text.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
}

/** One parsed object → result, or undefined when it is not a usable summary. */
function fromObject(j: unknown, fallbackLang: string): SummaryResult | undefined {
  if (!j || typeof j !== 'object') return undefined;
  const o = j as Record<string, unknown>;
  if (o.status === 'no_transcript') return { kind: 'unreadable', reason: t('tldr.unreadable') };
  if (!Array.isArray(o.points) || !o.points.length) return undefined;
  const data: Summary = {
    points: o.points.map(String).filter(Boolean),
    lang: typeof o.lang === 'string' ? o.lang : fallbackLang,
  };
  const tm = o.titleMatch as { verdict?: string; reason?: string } | undefined;
  if (tm && (tm.verdict === 'match' || tm.verdict === 'partial' || tm.verdict === 'mismatch')) {
    data.titleMatch = { verdict: tm.verdict, reason: String(tm.reason ?? '') };
  }
  return { kind: 'ok', data };
}

/** Model text → result (design §11 parse order). */
export function parseSummary(text: string, fallbackLang: string): SummaryResult {
  const cleaned = stripFences(text);
  let j = tryParse(cleaned);
  if (j === undefined) {
    const m = /\{[\s\S]*\}/.exec(cleaned);
    if (m) j = tryParse(m[0]);
  }
  return fromObject(j, fallbackLang) ?? { kind: 'ok', data: { points: [], lang: fallbackLang, raw: text } };
}

/**
 * Batch answer → result per video id. Matched by "id", falling back to
 * position when the model drops ids. Videos it left out are missing from the map.
 */
export function parseBatch(text: string, ids: string[], fallbackLang: string): Map<string, SummaryResult> {
  const out = new Map<string, SummaryResult>();
  const cleaned = stripFences(text);
  let j = tryParse(cleaned);
  if (!Array.isArray(j)) {
    const m = /\[[\s\S]*\]/.exec(cleaned);
    j = m ? tryParse(m[0]) : undefined;
  }
  if (!Array.isArray(j)) return out;
  const want = new Set(ids);
  j.forEach((o, n) => {
    const own = (o as { id?: unknown } | null)?.id;
    const id = typeof own === 'string' && want.has(own) ? own : own === undefined && j.length === ids.length ? ids[n] : undefined;
    if (!id || out.has(id)) return;
    const r = fromObject(o, fallbackLang);
    if (r) out.set(id, r);
  });
  return out;
}
