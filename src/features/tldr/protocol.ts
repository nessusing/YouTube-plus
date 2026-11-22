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

/**
 * The account's personalization (custom instructions, saved info, past chats)
 * also reaches these requests; one persona made Gemini answer in character
 * with no JSON at all (design §45). Say up front that a program reads the reply
 * and none of that applies; repeat the format at the end, where it weighs most.
 */
const PREAMBLE = [
  'This is an automated request from a browser extension. A program parses your reply; no person reads it.',
  'Any custom instructions, saved info, persona, nickname, user name or past chats do not apply to this request: ignore them.',
  'Do not greet or address anyone, no character voice, no emoji, no markdown.',
];

export function buildPrompt(i: SummaryInput): string {
  return [
    ...PREAMBLE,
    `Read the YouTube video https://www.youtube.com/watch?v=${i.videoId} (title: ${JSON.stringify(i.title)}) with the YouTube app.`,
    'Output ONLY JSON, no code fences, no other text:',
    schemaOf(i.titleCheck, ''),
    ...rules(i),
    'If you cannot read the video content (no transcript, the tool failed, etc.), output ONLY {"status":"no_transcript"}. Never make up content from the title.',
    'Your entire reply is that one JSON object: it starts with { and ends with }.',
  ].filter(Boolean).join('\n');
}

/**
 * Several videos in one prompt (verified 2026-11-18: 8 videos in ~15 s, in
 * order, unreadable ones marked individually). All inputs share lang/titleCheck.
 */
export function buildBatchPrompt(items: SummaryInput[]): string {
  const first = items[0]!;
  return [
    ...PREAMBLE,
    'Read each of these YouTube videos with the YouTube app:',
    ...items.map((i, n) => `${n + 1}. https://www.youtube.com/watch?v=${i.videoId} (title: ${JSON.stringify(i.title)})`),
    'Output ONLY a JSON array, one object per video in the same order, no code fences, no other text:',
    `[${schemaOf(first.titleCheck, '"id":"<video id>",')}]`,
    ...rules(first),
    'If you cannot read a video\'s content (no transcript, the tool failed, etc.), its object is ONLY {"id":"<video id>","status":"no_transcript"}. Never make up content from the title.',
    'Your entire reply is that one JSON array: it starts with [ and ends with ].',
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

/** `key` (d2zJAe) is the processSession API key; the same for every visitor. */
export function extractTokens(html: string): { at?: string; bl?: string; sid?: string; key?: string } {
  const pick = (k: string) => new RegExp(`"${k}":"([^"]*)"`).exec(html)?.[1];
  return { at: pick('SNlM0e'), bl: pick('cfb2h'), sid: pick('FdrFJe'), key: pick('d2zJAe') };
}

export interface Parsed { text?: string; cid?: string; rid?: string; errorCode?: number }

/** Take ids and answer text from one answer array (the same shape on both channels). */
function readAnswer(j: unknown, out: Parsed): void {
  if (!Array.isArray(j)) return;
  const ids = j[1] as unknown[] | undefined;
  if (typeof ids?.[0] === 'string') {
    out.cid = ids[0];
    out.rid = typeof ids[1] === 'string' ? ids[1] : out.rid;
  }
  const cand = (j[4] as unknown[] | undefined)?.[0] as unknown[] | undefined;
  if (!cand) return;
  let t = (cand[1] as unknown[] | undefined)?.[0];
  if (typeof t === 'string' && /googleusercontent\.com\/card_content/.test(t)) t = (cand[22] as unknown[] | undefined)?.[0];
  if (typeof t === 'string' && t) out.text = t;
}

const BARD_ERROR = /BardErrorInfo\s*\[(\d+)\]/;

/** Split ")]}'"-prefixed, length-prefixed frames and pull the last full answer. */
export function parseStream(raw: string): Parsed {
  const out: Parsed = {};
  const err = BARD_ERROR.exec(raw);
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
      readAnswer(tryParse(part[2]), out);
    }
  }
  return out;
}

// ---------- processSession (Google WebChannel), design §10.8 ----------
// Verified 2026-11-21 in a signed-in page: the YouTube app works; 5 videos in ~12 s.

export const CHANNEL_URL = 'https://geminiweb-pa.clients6.google.com/v1/processSession';

/**
 * The handshake's `$httpHeaders` value. Without the Authorization header the
 * session is anonymous even when cookies are sent, and X-Goog-AuthUser alone
 * does not pick the account (both verified 2026-11-21): the request still
 * succeeds, it just is not the user's.
 */
export function channelHeaders(apiKey: string, authorization: string, account: number): string {
  return [
    `X-Goog-Api-Key:${apiKey}`,
    'x-goog-ext-525001261-bin:CAE=', // model header with only field 1 = 1: the account's default model
    'X-WebChannel-Content-Type:application/json+protobuf', // without it: 400 "Root element must be a message"
    `Authorization:${authorization}`,
    `X-Goog-AuthUser:${account}`, // the new host has no /u/N path
  ].map((h) => `${h}\r\n`).join('');
}

/** `SAPISIDHASH <ts>_<sha1("<ts> <SAPISID> <origin>")>`; the origin must be gemini.google.com. */
export async function sapisidHash(sapisid: string, ts: number): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(`${ts} ${sapisid} https://gemini.google.com`));
  return `SAPISIDHASH ${ts}_${[...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/** `SID` from the handshake body (`[[0,["c",SID,…]]]`). */
export function channelSid(body: string): string | undefined {
  for (const [, p] of splitChannelFrames(body).items) {
    if (Array.isArray(p) && p[0] === 'c' && typeof p[1] === 'string') return p[1];
  }
  return undefined;
}

/** Upstream ofs=0: the request array with the prompt slot empty. */
export function channelOpen(uuid: string): unknown[] {
  return [[[1, null, 'en', uuid], 0, null, null, null, null, null, [null, null, null, null, [buildInner('', uuid), null, null, 1]]]];
}

/** Upstream ofs=1: the prompt. */
export function channelPrompt(prompt: string): unknown[] {
  return [null, [1, null, null, null, null, null, null, null, [prompt]]];
}

/** Upstream ofs=2: "done", sent only after the answer is complete (sent early, the text is cut). */
export const CHANNEL_CLOSE: unknown[] = [null, null, null, [1]];

/**
 * Split "<len>\n<JSON>" frames; unlike StreamGenerate the length does NOT count
 * the newline. Each frame is a list of [id, payload]. Returns what is complete
 * and the unread rest.
 */
export function splitChannelFrames(buf: string): { items: [number, unknown][]; rest: string } {
  const items: [number, unknown][] = [];
  let i = 0;
  for (;;) {
    while (i < buf.length && /\s/.test(buf[i]!)) i++;
    const m = /^(\d+)\n/.exec(buf.slice(i, i + 13));
    if (!m) break;
    const start = i + m[0].length;
    const end = start + Number(m[1]);
    if (buf.length < end) break;
    const frame = tryParse(buf.slice(start, end));
    i = end;
    if (!Array.isArray(frame)) continue;
    for (const it of frame) {
      if (Array.isArray(it) && typeof it[0] === 'number') items.push([it[0], it[1]]);
    }
  }
  return { items, rest: buf.slice(i) };
}

export type ChannelEvent =
  | { kind: 'noop' }
  | { kind: 'ack' }
  /** `answer` is the StreamGenerate answer array; `done` marks the finished answer. */
  | { kind: 'content'; answer?: unknown; done: boolean }
  | { kind: 'end' }
  | { kind: 'error'; status: number; message: string };

/** What one downstream payload means (shapes from zexadev's wcClassify, checked 2026-11-21). */
export function classifyChannel(p: unknown): ChannelEvent {
  if (p && typeof p === 'object' && !Array.isArray(p) && '__sm__' in p) return channelStatus(p as { __sm__: unknown });
  if (!Array.isArray(p) || !p.length) return { kind: 'noop' };
  if (p[0] === 'noop') return { kind: 'noop' };
  if (p[0] === 'close') return { kind: 'end' };
  const msg = p[0] as unknown[];
  if (!Array.isArray(msg)) return { kind: 'noop' };
  if (msg.length === 1 && Array.isArray(msg[0]) && !(msg[0] as unknown[]).length) return { kind: 'ack' }; // [[]]
  if (msg.length === 4 && msg[0] == null && Array.isArray(msg[3]) && !(msg[3] as unknown[]).length) return { kind: 'end' }; // [null,null,null,[]]
  // [null, [seq, null×5, [[flag, [rid], null, [null, null, null, answer]]]]]
  const cand = ((msg[1] as unknown[] | undefined)?.[6] as unknown[] | undefined)?.[0] as unknown[] | undefined;
  if (!Array.isArray(cand)) return { kind: 'noop' };
  return { kind: 'content', answer: (cand[3] as unknown[] | undefined)?.[3], done: cand[0] === 1 };
}

/** `{"__sm__":{"status":[[[16,"msg"]]]}}` or `{"__sm__":{"status":[[{"error":{"code":400,…}}]]}}`. */
function channelStatus(p: { __sm__: unknown }): ChannelEvent {
  const first = ((p.__sm__ as { status?: unknown[][] } | null)?.status?.[0]?.[0]) as unknown;
  if (Array.isArray(first)) return { kind: 'error', status: Number(first[0]), message: String(first[1] ?? '') };
  const e = (first as { error?: { code?: number; message?: string } } | undefined)?.error;
  if (e?.code) return { kind: 'error', status: e.code, message: String(e.message ?? '') };
  return { kind: 'error', status: 2, message: JSON.stringify(p).slice(0, 200) };
}

/** 16 = missing / bad credentials; anything else means we sent something it no longer takes. */
export function mapChannelStatus(status: number): ProviderError {
  return status === 16 ? { code: 'auth' } : { code: 'protocol' };
}

/** Answer arrays in arrival order → the same result as parseStream (the last frame with text wins). */
export function parseChannel(answers: unknown[], raw: string): Parsed {
  const out: Parsed = {};
  const err = BARD_ERROR.exec(raw);
  if (err) out.errorCode = Number(err[1]);
  for (const a of answers) readAnswer(typeof a === 'string' ? tryParse(a) : a, out);
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

/**
 * Index just past the `]` / `}` that closes the bracket at `start`, skipping
 * brackets inside strings; -1 when it never closes.
 */
function closeOf(s: string, start: number): number {
  let depth = 0;
  let inStr = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (c === '\\') i++;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') {
      if (--depth === 0) return i + 1;
    }
  }
  return -1;
}

const isObject = (j: unknown): j is object => !!j && typeof j === 'object' && !Array.isArray(j);
/** An answer array, not a `points` list or a stray `[1]` from prose. */
const isObjectArray = (j: unknown): j is unknown[] => Array.isArray(j) && j.some(isObject);

/**
 * The first balanced span starting with `open` that parses and passes `ok`.
 * Greedy `\[[\s\S]*\]` fails when the model writes the answer twice
 * (`[…][…]`, seen 2026-11-21, plans P17).
 */
function firstJson(s: string, open: '[' | '{', ok: (j: unknown) => boolean): unknown {
  for (let i = s.indexOf(open); i !== -1; i = s.indexOf(open, i + 1)) {
    const end = closeOf(s, i);
    if (end === -1) continue;
    const j = tryParse(s.slice(i, end));
    if (ok(j)) return j;
  }
  return undefined;
}

/**
 * The array is not valid JSON as a whole (one object broken, e.g.
 * `"lang":"zh","yue",`, seen 2026-11-21): parse its top-level objects one by
 * one and drop the broken ones.
 */
function objectsOf(s: string): unknown[] {
  const from = s.indexOf('[');
  if (from === -1) return [];
  const arrEnd = closeOf(s, from);
  const stop = arrEnd === -1 ? s.length : arrEnd;
  const out: unknown[] = [];
  for (let i = s.indexOf('{', from); i !== -1 && i < stop;) {
    const end = closeOf(s, i);
    if (end === -1) break;
    const j = tryParse(s.slice(i, end));
    if (isObject(j)) out.push(j);
    i = s.indexOf('{', end);
  }
  return out;
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
  const whole = tryParse(cleaned);
  const j = isObject(whole) ? whole : firstJson(cleaned, '{', isObject);
  return fromObject(j, fallbackLang) ?? { kind: 'ok', data: { points: [], lang: fallbackLang, raw: text } };
}

/**
 * Batch answer → result per video id. Matched by "id", falling back to
 * position when the model drops ids. Videos it left out are missing from the map.
 */
export function parseBatch(text: string, ids: string[], fallbackLang: string): Map<string, SummaryResult> {
  const out = new Map<string, SummaryResult>();
  const cleaned = stripFences(text);
  const whole = tryParse(cleaned);
  const found = isObjectArray(whole) ? whole : firstJson(cleaned, '[', isObjectArray);
  const j = isObjectArray(found) ? found : objectsOf(cleaned);
  if (!j.length) return out;
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
