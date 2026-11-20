// Storage keys used by the queue feature.

export { QUEUE_SNAPSHOT_PREFIX as SNAPSHOT_PREFIX } from '@/core/storage-usage';
/** sync: QueueProfile per identity, queue/profile/<identity> (design §24.7). */
export const PROFILE_PREFIX = 'queue/profile/';
/** local: { time, detail } when responses stopped matching (design §26). */
export const PROTOCOL_ERROR_KEY = 'queue/protocol-error';

/** Left behind by the old TLPQ ↔ playlist sync (before 2026-11-20). */
export const LEGACY_KEYS = {
  sync: ['queue/list'],
  local: ['queue/outbox', 'queue/outbox-lock', 'queue/state', 'queue/snapshot'],
};
