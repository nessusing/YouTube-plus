// Storage keys used by the queue feature.
export const LIST_KEY = 'queue/list'; // sync: { name, id }
export const OUTBOX_KEY = 'queue/outbox'; // local
export const LOCK_KEY = 'queue/outbox-lock'; // local
export const STATE_KEY = 'queue/state'; // local: { listId, listName, count, updatedAt }
export { QUEUE_SNAPSHOT_KEY as SNAPSHOT_KEY } from '@/core/storage-usage';
/** Per tab (sessionStorage): tlpqSetId → listSetId */
export const MAP_SESSION_KEY = 'ytpp-queue-map';
