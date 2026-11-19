// Messages between content scripts / options page and the service worker.

import type { LogEntry } from './log';
import type { CheckResult } from './selfcheck';

export type Message =
  | { type: 'yt+/log'; entries: LogEntry[] }
  | { type: 'yt+/log-clear' }
  | { type: 'yt+/selfcheck' }
  | { type: 'yt+/open-options'; hash?: string }
  | { type: 'yt+/tldr-status' }
  | { type: 'yt+/tldr-resume' }
  | { type: 'yt+/tldr-signin' }
  | { type: 'yt+/tldr-recheck' };

export type SelfCheckResponse = { results: CheckResult[] };

export function isMessage(m: unknown): m is Message {
  return typeof m === 'object' && m !== null && typeof (m as { type?: unknown }).type === 'string'
    && (m as { type: string }).type.startsWith('yt+/');
}
