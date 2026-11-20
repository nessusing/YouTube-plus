// Settings page → queue content script in a YouTube tab (design §23: the
// settings page reads lists, creates one and reads the identity through a tab).

import type { Snapshot } from './core';

export type QueueOp =
  | { op: 'whoami' }
  | { op: 'lists' }
  | { op: 'create'; title: string }
  | { op: 'restore'; key: string; snapshot: Snapshot };

export type QueueRequest = { type: 'YouTube+/queue' } & QueueOp;

export type QueueResponse<T = unknown> = { ok: true; result: T } | { ok: false; error: string };

export function isQueueRequest(m: unknown): m is QueueRequest {
  return !!m && typeof m === 'object' && (m as { type?: unknown }).type === 'YouTube+/queue';
}
