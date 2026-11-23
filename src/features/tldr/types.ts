// TL;DR types (F-03).

/** The output language is the video's own (F-04), so there is no language here. */
export interface SummaryInput { videoId: string; title: string; titleCheck: boolean }

export interface Summary {
  points: string[];
  titleMatch?: { verdict: 'match' | 'partial' | 'mismatch'; reason: string };
  /** The video's language as Gemini judged it ("und" when it gave none); informational only. */
  lang: string;
  /** model text when JSON parsing failed; shown as markdown */
  raw?: string;
}

export type ProviderError =
  | { code: 'quota' }
  | { code: 'blocked' }
  | { code: 'auth' }
  | { code: 'protocol' }
  | { code: 'transient' };

export type SummaryResult =
  | { kind: 'ok'; data: Summary }
  | { kind: 'unreadable'; reason: string }
  | { kind: 'error'; error: ProviderError; detail?: string };

export interface SummaryProvider {
  summarize(input: SummaryInput): Promise<SummaryResult>;
}

/** What a thumbnail icon shows (F-03-AC2). */
export type BadgeState =
  | { state: 'idle' }
  | { state: 'queued' }
  | { state: 'running' }
  | { state: 'ready'; summary: Summary }
  | { state: 'unreadable'; reason: string }
  | { state: 'error'; reason: string }
  | { state: 'paused'; reason: string; until?: number }
  /** Not signed in to Gemini: the tooltip offers a sign-in button. */
  | { state: 'signin' };

/** Whether the browser can reach Gemini as a signed-in user. */
export type GeminiState = 'unknown' | 'ok' | 'signedOut';
