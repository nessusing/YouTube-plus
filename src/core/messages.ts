// Messages between content scripts / options page and the service worker.

import type { LogEntry } from './log';
import type { CheckResult } from './selfcheck';

export type Message =
  | { type: 'YouTube+/log'; entries: LogEntry[] }
  | { type: 'YouTube+/log-clear' }
  | { type: 'YouTube+/selfcheck' }
  | { type: 'YouTube+/open-options'; hash?: string }
  | { type: 'YouTube+/tldr-status' }
  | { type: 'YouTube+/tldr-resume' }
  | { type: 'YouTube+/tldr-signin' }
  | { type: 'YouTube+/tldr-recheck' };

export type SelfCheckResponse = { results: CheckResult[] };

export function isMessage(m: unknown): m is Message {
  return typeof m === 'object' && m !== null && typeof (m as { type?: unknown }).type === 'string'
    && (m as { type: string }).type.startsWith('YouTube+/');
}
