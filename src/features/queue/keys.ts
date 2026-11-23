// Storage keys used by the queue feature.

/** sync: QueueProfile per identity, queue/profile/<identity> (F-05-AC1). */
export const PROFILE_PREFIX = 'queue/profile/';
/** local: { time, detail } when responses stopped matching (F-05-AC15). */
export const PROTOCOL_ERROR_KEY = 'queue/protocol-error';

/** Left behind by the old TLPQ ↔ playlist sync (before 2026-11-20). */
export const LEGACY_KEYS = {
  sync: ['queue/list'],
  local: ['queue/outbox', 'queue/outbox-lock', 'queue/state', 'queue/snapshot'],
  /** Clear all / Remove watched snapshots, one per identity (before 2026-11-21, F-06). */
  localPrefixes: ['queue/snapshot/'],
};
