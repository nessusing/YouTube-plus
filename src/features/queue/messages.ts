// Settings page → queue content script in a YouTube tab (design §23: the
// settings page reads lists, creates one and reads the identity through a tab).

export type QueueOp =
  | { op: 'whoami' }
  | { op: 'lists' }
  | { op: 'create'; title: string };

export type QueueRequest = { type: 'YouTube+/queue' } & QueueOp;

export type QueueResponse<T = unknown> = { ok: true; result: T } | { ok: false; error: string };

export function isQueueRequest(m: unknown): m is QueueRequest {
  return !!m && typeof m === 'object' && (m as { type?: unknown }).type === 'YouTube+/queue';
}
