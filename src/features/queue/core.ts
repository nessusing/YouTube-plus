// Queue sync core (design §24, §25). Pure: no DOM, no fetch, no storage.

export interface TlpqItem { videoId: string; setVideoId: string }
export interface ListItem { videoId: string; setVideoId: string; /** 0-100, from the resume overlay */ percent?: number }

export type ListAction =
  | { action: 'ACTION_ADD_VIDEO'; addedVideoId: string; dedupeOption?: 'DEDUPE_OPTION_SKIP' }
  | { action: 'ACTION_REMOVE_VIDEO'; setVideoId: string }
  | { action: 'ACTION_MOVE_VIDEO_AFTER'; setVideoId: string; movedSetVideoIdPredecessor?: string };

/** What the user did to the official queue, read from a captured request. */
export type LocalOp =
  | { kind: 'create'; videoIds: string[] }
  | { kind: 'add'; videoId: string }
  | { kind: 'remove'; tlpqSetId: string }
  | { kind: 'move'; tlpqSetId: string; afterTlpqSetId?: string };

export const WATCHED_PERCENT = 90;
export const WATCHED_REMAINING_S = 10;
export const BATCH = 100;

export function isTlpq(id: unknown): id is string {
  return typeof id === 'string' && id.startsWith('TLPQ');
}

/**
 * Turn a captured page request into queue ops. `endpoint` is the path after
 * /youtubei/v1/. Only requests for the official queue count.
 */
export function parseCaptured(endpoint: string, body: unknown): LocalOp[] {
  const b = (body ?? {}) as Record<string, unknown>;
  if (endpoint === 'playlist/create') {
    // The official queue is created with params CAQ%3D (design §21).
    if (b.params !== 'CAQ%3D' || !Array.isArray(b.videoIds)) return [];
    return [{ kind: 'create', videoIds: b.videoIds.filter((v): v is string => typeof v === 'string') }];
  }
  if (endpoint !== 'browse/edit_playlist' || !isTlpq(b.playlistId) || !Array.isArray(b.actions)) return [];
  const ops: LocalOp[] = [];
  for (const a of b.actions as Record<string, unknown>[]) {
    switch (a.action) {
      case 'ACTION_ADD_VIDEO':
        if (typeof a.addedVideoId === 'string') ops.push({ kind: 'add', videoId: a.addedVideoId });
        break;
      case 'ACTION_REMOVE_VIDEO':
        if (typeof a.setVideoId === 'string') ops.push({ kind: 'remove', tlpqSetId: a.setVideoId });
        break;
      case 'ACTION_MOVE_VIDEO_AFTER':
        if (typeof a.setVideoId === 'string') {
          ops.push({
            kind: 'move',
            tlpqSetId: a.setVideoId,
            afterTlpqSetId: typeof a.movedSetVideoIdPredecessor === 'string' ? a.movedSetVideoIdPredecessor : undefined,
          });
        }
        break;
    }
  }
  return ops;
}

export function opSignature(op: LocalOp): string {
  switch (op.kind) {
    case 'create': return `create:${op.videoIds.join(',')}`;
    case 'add': return `add:${op.videoId}`;
    case 'remove': return `remove:${op.tlpqSetId}`;
    case 'move': return `move:${op.tlpqSetId}:${op.afterTlpqSetId ?? ''}`;
  }
}

/**
 * Signatures we expect to see because we caused them (our own UI-path calls),
 * plus recently seen ones (the page sends some edits twice). Both are ignored.
 */
export class SignatureFilter {
  private expected = new Map<string, number[]>();
  private seen = new Map<string, number>();
  constructor(private ttlMs = 15000, private dupMs = 3000) {}

  expect(sig: string, now: number): void {
    const list = this.expected.get(sig) ?? [];
    list.push(now + this.ttlMs);
    this.expected.set(sig, list);
  }

  /** True if this op should be forwarded. */
  accept(sig: string, now: number): boolean {
    const list = (this.expected.get(sig) ?? []).filter((t) => t > now);
    if (list.length) {
      list.shift();
      this.expected.set(sig, list);
      this.seen.set(sig, now);
      return false;
    }
    this.expected.delete(sig);
    const last = this.seen.get(sig);
    this.seen.set(sig, now);
    return !(last !== undefined && now - last < this.dupMs);
  }
}

/** tlpqSetId → listSetId */
export type Mapping = Record<string, string>;

/**
 * Keep pairs that still exist on both sides; pair unmapped queue items with
 * unmapped list items of the same video, in order.
 */
export function reconcile(tlpq: TlpqItem[], list: ListItem[], map: Mapping): Mapping {
  const listIds = new Set(list.map((i) => i.setVideoId));
  const out: Mapping = {};
  const usedList = new Set<string>();
  for (const t of tlpq) {
    const l = map[t.setVideoId];
    if (l && listIds.has(l) && !usedList.has(l)) {
      out[t.setVideoId] = l;
      usedList.add(l);
    }
  }
  for (const t of tlpq) {
    if (out[t.setVideoId]) continue;
    const l = list.find((i) => i.videoId === t.videoId && !usedList.has(i.setVideoId));
    if (l) {
      out[t.setVideoId] = l.setVideoId;
      usedList.add(l.setVideoId);
    }
  }
  return out;
}

export type Translation = { actions: ListAction[] } | { drop: string };

/** One local op → actions on the list (design §24.3 table). */
export function translate(op: LocalOp, map: Mapping): Translation {
  switch (op.kind) {
    case 'create':
      return { actions: op.videoIds.map((v) => ({ action: 'ACTION_ADD_VIDEO', addedVideoId: v, dedupeOption: 'DEDUPE_OPTION_SKIP' })) };
    case 'add':
      return { actions: [{ action: 'ACTION_ADD_VIDEO', addedVideoId: op.videoId, dedupeOption: 'DEDUPE_OPTION_SKIP' }] };
    case 'remove': {
      const l = map[op.tlpqSetId];
      return l ? { actions: [{ action: 'ACTION_REMOVE_VIDEO', setVideoId: l }] } : { drop: `remove: ${op.tlpqSetId} has no list entry` };
    }
    case 'move': {
      const l = map[op.tlpqSetId];
      if (!l) return { drop: `move: ${op.tlpqSetId} has no list entry` };
      if (op.afterTlpqSetId === undefined) return { actions: [{ action: 'ACTION_MOVE_VIDEO_AFTER', setVideoId: l }] };
      const after = map[op.afterTlpqSetId];
      if (!after) return { drop: `move: predecessor ${op.afterTlpqSetId} has no list entry` };
      return { actions: [{ action: 'ACTION_MOVE_VIDEO_AFTER', setVideoId: l, movedSetVideoIdPredecessor: after }] };
    }
  }
}

export interface OverwritePlan {
  /** queue items to remove (their list entry is gone) */
  removeTlpq: string[];
  /** list items missing from the queue, in list order */
  add: ListItem[];
  /** queue moves to match list order, applied after removes and adds */
  moves: { tlpqSetId: string; afterTlpqSetId?: string }[];
}

/**
 * Make the queue match the list (design §24.4). The item playing now is never
 * removed. Moves are computed over the queue as it will be after removes and
 * adds, keeping the playing item where it is.
 */
export function planOverwrite(tlpq: TlpqItem[], list: ListItem[], map: Mapping, playingTlpqSetId?: string): OverwritePlan {
  const listIds = new Set(list.map((i) => i.setVideoId));
  const removeTlpq = tlpq
    .filter((t) => t.setVideoId !== playingTlpqSetId && !(map[t.setVideoId] && listIds.has(map[t.setVideoId]!)))
    .map((t) => t.setVideoId);
  const mappedList = new Set(Object.values(map));
  const add = list.filter((l) => !mappedList.has(l.setVideoId));

  // Desired order of the kept, mapped queue items = list order.
  const removed = new Set(removeTlpq);
  const kept = tlpq.filter((t) => !removed.has(t.setVideoId) && map[t.setVideoId] && listIds.has(map[t.setVideoId]!));
  const listIndex = new Map(list.map((l, i) => [l.setVideoId, i]));
  const desired = [...kept].sort((a, b) => listIndex.get(map[a.setVideoId]!)! - listIndex.get(map[b.setVideoId]!)!);
  const moves: OverwritePlan['moves'] = [];
  const current = kept.map((t) => t.setVideoId);
  for (let i = 0; i < desired.length; i++) {
    const want = desired[i]!.setVideoId;
    if (current[i] === want) continue;
    if (want === playingTlpqSetId) continue;
    const from = current.indexOf(want);
    current.splice(from, 1);
    current.splice(i, 0, want);
    moves.push({ tlpqSetId: want, afterTlpqSetId: i === 0 ? undefined : current[i - 1] });
  }
  return { removeTlpq, add, moves };
}

export function isWatchedElsewhere(item: ListItem): boolean {
  return (item.percent ?? 0) >= WATCHED_PERCENT;
}

export function isWatchedHere(currentTime: number, duration: number, ended: boolean): boolean {
  return ended || (duration > 0 && duration - currentTime < WATCHED_REMAINING_S);
}

/** Outbox retry delays: 5 s, 30 s, 2 min, 10 min, then every 30 min. */
export function retryDelayMs(attempts: number): number {
  const steps = [5_000, 30_000, 120_000, 600_000];
  return steps[attempts] ?? 1_800_000;
}

export function chunk<T>(xs: T[], n = BATCH): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

// ---- clear all / remove watched (§25) ----

export interface Snapshot {
  listId: string;
  listName: string;
  time: number;
  mode: 'all' | 'watched';
  /** removed videos with their original index in the list */
  removed: { videoId: string; index: number }[];
}

export function planClear(items: ListItem[], mode: 'all' | 'watched'): { remove: ListItem[]; removed: Snapshot['removed'] } {
  const picked = items.map((it, index) => ({ it, index })).filter(({ it }) => mode === 'all' || isWatchedElsewhere(it));
  return { remove: picked.map((p) => p.it), removed: picked.map((p) => ({ videoId: p.it.videoId, index: p.index })) };
}

/**
 * After re-adding (appended at the end), move each restored item back to its
 * original index. `after` = list as it is now (restored items at the end, in
 * snapshot order); returns moves to apply in order.
 */
export function planUndoMoves(after: ListItem[], restoredSetIds: string[], removed: Snapshot['removed']): { setVideoId: string; afterSetVideoId?: string }[] {
  const order = after.map((i) => i.setVideoId);
  const moves: { setVideoId: string; afterSetVideoId?: string }[] = [];
  const pairs = removed.map((r, k) => ({ index: r.index, setId: restoredSetIds[k]! })).filter((p) => p.setId).sort((a, b) => a.index - b.index);
  for (const p of pairs) {
    const target = Math.min(p.index, order.length - 1);
    const from = order.indexOf(p.setId);
    if (from === target) continue;
    order.splice(from, 1);
    order.splice(target, 0, p.setId);
    moves.push({ setVideoId: p.setId, afterSetVideoId: target === 0 ? undefined : order[target - 1] });
  }
  return moves;
}
