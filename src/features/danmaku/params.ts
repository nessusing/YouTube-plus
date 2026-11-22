// Comment danmaku (plans P13): every tunable number in one place. During
// development the options page exposes most of these; which ones stay for
// normal users is decided after real use (plans P13 「开发期间的可调参数」).

export interface DisplayParams {
  /** Seconds per screen (two lines) of a long comment. */
  screenSec: number;
  /** Reading time per character: Latin and other scripts / Chinese, Japanese, Korean. */
  latinCharSec: number;
  cjkCharSec: number;
  /** A one-line comment still stays this long. */
  minSec: number;
  /** Gap between two cards. */
  gapSec: number;
  fadeMs: number;
  /** Font size relative to the player's caption size. */
  fontScale: number;
  bgOpacity: number;
  /** Reference line width for estimating lines, in Latin characters (a CJK character is `cjkWidth`). */
  refLineWidth: number;
  cjkWidth: number;
  /** After a seek into a card, show it only if at least this much of it is left. */
  resumeMinSec: number;
}

export interface CommentParams {
  /** Start placing after this many comments; keep fetching in the background. */
  firstBatch: number;
  /** Fetch limit = max(minCount, perMinute × minutes), capped at maxCount. */
  minCount: number;
  perMinute: number;
  maxCount: number;
  /** Shorter than this (in Latin characters; a CJK character counts `cjkWeight`) is dropped. */
  minLength: number;
  cjkWeight: number;
}

export interface StampParams {
  /** A timestamped comment may be pushed back at most this much when its moment is taken. */
  maxDelaySec: number;
  /** Comments within ± this many seconds are one moment (one card, rotating). */
  clusterSec: number;
  rotateMax: number;
  /** Table of contents: starts at 0:00, at least this many timestamps, short titles. */
  tocMinStamps: number;
  /** Longest title on a table-of-contents line, in Latin characters (CJK = `cjkWidth`). */
  tocTitleMax: number;
}

export interface HeatParams {
  likeWeight: number;
  replyWeight: number;
  /** Positive: newer first; negative: older first. */
  recencyWeight: number;
}

export interface LocalParams {
  /** Comments per minute = 1 + log10(total comments), clamped to [perMinuteMin, perMinuteMax]. */
  perMinuteMin: number;
  perMinuteMax: number;
  windowSec: number;
  /** Weight of the "Most replayed" heat; 0 = spread evenly. */
  replayWeight: number;
  leadInSec: number;
  spoilerWords: string[];
  /** Spoiler comments go only into the last this-fraction of the video. */
  spoilerTail: number;
}

export type AiFallback = 'local' | 'stamps';

export interface AiParams {
  /**
   * The whole prompt (see PROMPT_PLACEHOLDERS); the user reviews and tunes it.
   * '' = DEFAULT_PROMPT: settings sit in one storage.sync item (8 KB), so the
   * default is not stored. Read it with promptOf().
   */
  prompt: string;
  batchSize: number;
  /** Characters of one comment sent to Gemini. */
  commentMaxChars: number;
  /** Only times at or above this confidence are used; the rest become ambient (measured 2026-11-22). */
  highConf: number;
  relevanceWeight: number;
  heatWeight: number;
  ambient: boolean;
  /** Fill a gap longer than this with an ambient comment. */
  idleSec: number;
  fallback: AiFallback;
}

export interface CacheParams {
  days: number;
  mb: number;
}

export interface DanmakuParams {
  display: DisplayParams;
  comments: CommentParams;
  stamps: StampParams;
  heat: HeatParams;
  local: LocalParams;
  ai: AiParams;
  cache: CacheParams;
}

/** Filled in by buildPlacementPrompt (ai.ts). {{url}} and {{comments}} are required. */
export const PROMPT_PLACEHOLDERS = ['{{url}}', '{{title}}', '{{duration}}', '{{comments}}'] as const;

/**
 * Version 2 of the placement prompt plus the video length (plans P13 「实测结果」):
 * each confidence band is defined, "when unsure, use a", x only for junk.
 * The preamble is the TL;DR one (design §45): personalization reaches these
 * requests too.
 */
export const DEFAULT_PROMPT = [
  'This is an automated request from a browser extension. A program parses your reply; no person reads it.',
  'Any custom instructions, saved info, persona, nickname, user name or past chats do not apply to this request: ignore them.',
  'Do not greet or address anyone, no character voice, no emoji, no markdown.',
  'Read the YouTube video {{url}} (title: {{title}}) with the YouTube app, including its transcript with timestamps.',
  'Below are viewer comments, one per line as <id>|<text>. For each comment decide where in the video it belongs, using what is said in the video.',
  'The video is {{duration}} seconds long; every time you give is between 0 and {{duration}}.',
  'Output exactly one line per comment, in the same order, and nothing else:',
  '<id>|<seconds>|<confidence>  only when the comment clearly reacts to something said or shown at one specific moment (jokes and reactions about that moment count); seconds = whole seconds from the start of the video where that moment begins',
  '<id>|a  when the comment is about the video, its topic or the creator in general, or you cannot tell which moment it means. When unsure, use a.',
  '<id>|x  only for ads, self-promotion, spam, insults, or text unrelated to the video',
  'confidence (0.0 to 1.0): 0.9 or higher only when the transcript at that time says what the comment quotes or describes; 0.5 to 0.8 when it is the right part of the video but the exact second is a guess; below 0.5 when you are guessing the part too.',
  'If you cannot read the video content (no transcript, the tool failed), output ONLY the line: no_transcript',
  'Comments:',
  '{{comments}}',
  'Your entire reply is those lines only: no code fences, no explanations.',
].join('\n');

export const DEFAULT_PARAMS: DanmakuParams = {
  display: {
    screenSec: 5, latinCharSec: 0.068, cjkCharSec: 0.2, minSec: 1.5, gapSec: 0.5, fadeMs: 250,
    fontScale: 1, bgOpacity: 0.75, refLineWidth: 50, cjkWidth: 2, resumeMinSec: 1.5,
  },
  comments: { firstBatch: 100, minCount: 200, perMinute: 15, maxCount: 300, minLength: 12, cjkWeight: 3 },
  stamps: { maxDelaySec: 5, clusterSec: 2, rotateMax: 3, tocMinStamps: 5, tocTitleMax: 60 },
  heat: { likeWeight: 1, replyWeight: 0.5, recencyWeight: 0.1 },
  local: {
    perMinuteMin: 1, perMinuteMax: 6, windowSec: 30, replayWeight: 1, leadInSec: 5,
    spoilerWords: ['结尾', '結尾', '最后', '最後', '结局', '結局', '反转', '反轉', 'ending', 'twist', 'the end'],
    spoilerTail: 0.2,
  },
  ai: {
    prompt: '', batchSize: 100, commentMaxChars: 400, highConf: 0.9,
    relevanceWeight: 2, heatWeight: 1, ambient: true, idleSec: 20, fallback: 'local',
  },
  cache: { days: 7, mb: 2 },
};

/** The prompt in use. */
export const promptOf = (ai: Pick<AiParams, 'prompt'>): string => ai.prompt || DEFAULT_PROMPT;

/**
 * Stored params over the defaults, group by group, so new params get their
 * default after an upgrade. Values of the wrong type fall back to the default.
 */
export function paramsWithDefaults(stored: unknown): DanmakuParams {
  const out = structuredClone(DEFAULT_PARAMS);
  for (const g of Object.keys(out) as (keyof DanmakuParams)[]) {
    const from = (stored as Record<string, unknown> | undefined)?.[g] as Record<string, unknown> | undefined;
    const to = out[g] as unknown as Record<string, unknown>;
    if (!from || typeof from !== 'object') continue;
    for (const k of Object.keys(to)) {
      const v = from[k];
      const d = to[k];
      if (Array.isArray(d) ? Array.isArray(v) && v.every((x) => typeof x === 'string') : typeof v === typeof d && (typeof v !== 'number' || Number.isFinite(v))) to[k] = v;
    }
  }
  if (!(['local', 'stamps'] as const).includes(out.ai.fallback)) out.ai.fallback = DEFAULT_PARAMS.ai.fallback;
  return out;
}
