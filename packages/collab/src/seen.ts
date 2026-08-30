import type { CollabMessage, CollabSeenCheckpoint } from './types';

export const MAX_SEEN_REPLICAS = 4096;
export const MAX_SEEN_GAPS = 10_000;

export interface SeenState {
  contiguous: number;
  readonly sparse: Set<number>;
}

export type SeenMap = Map<string, SeenState>;

export function restoreSeen(entries: readonly CollabSeenCheckpoint[] = []): SeenMap {
  return new Map(entries.map((entry) => [entry.replicaId, {
    contiguous: entry.contiguous,
    sparse: new Set(entry.sparse),
  }]));
}

export function cloneSeen(seen: SeenMap): SeenMap {
  return new Map([...seen].map(([replicaId, state]) => [replicaId, {
    contiguous: state.contiguous, sparse: new Set(state.sparse),
  }]));
}

export function checkpointSeen(seen: SeenMap): CollabSeenCheckpoint[] {
  return [...seen].map(([replicaId, state]) => ({
    replicaId, contiguous: state.contiguous,
    sparse: [...state.sparse].sort((left, right) => left - right),
  }));
}

export function hasSeen(seen: SeenMap, message: CollabMessage): boolean {
  const state = seen.get(message.replicaId);
  return !!state && (message.sequence <= state.contiguous || state.sparse.has(message.sequence));
}

/** 高水位只代表连续收到；高于下一序号的消息必须先等缺口，不能越过同副本因果链落模。 */
export function hasSequenceGap(seen: SeenMap, message: CollabMessage): boolean {
  return message.sequence > (seen.get(message.replicaId)?.contiguous ?? 0) + 1;
}

export function markSeen(seen: SeenMap, message: CollabMessage): void {
  let state = seen.get(message.replicaId);
  if (!state) {
    if (seen.size >= MAX_SEEN_REPLICAS) throw new Error('协同消息副本数超过安全上限');
    state = { contiguous: 0, sparse: new Set() };
    seen.set(message.replicaId, state);
  }
  if (message.sequence <= state.contiguous || state.sparse.has(message.sequence)) return;
  if (message.sequence === state.contiguous + 1) {
    state.contiguous++;
    while (state.sparse.delete(state.contiguous + 1)) state.contiguous++;
    return;
  }
  const gapCount = [...seen.values()].reduce((total, current) => total + current.sparse.size, 0);
  if (gapCount >= MAX_SEEN_GAPS) throw new Error('协同消息乱序缺口超过安全上限');
  state.sparse.add(message.sequence);
}
