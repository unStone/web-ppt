import { MAX_COLLABORATION_VERSION } from '@web-ppt/edit-core';
import type { EditIdentityAllocation } from '@web-ppt/edit-core';
import { assertCollabMessage } from './message';
import { MAX_SEEN_GAPS, MAX_SEEN_REPLICAS } from './seen';
import type {
  CollabSeenCheckpoint, CollabStamp, CollaborationCheckpoint,
} from './types';

const safeNonNegative = (value: unknown): value is number => typeof value === 'number'
  && Number.isSafeInteger(value) && value >= 0 && value <= MAX_COLLABORATION_VERSION;

function assertStamp(value: unknown, label: string): asserts value is CollabStamp {
  const stamp = value as Partial<CollabStamp> | null;
  if (!stamp || typeof stamp !== 'object' || !Number.isSafeInteger(stamp.clock)
    || stamp.clock! <= 0 || stamp.clock! > MAX_COLLABORATION_VERSION
    || typeof stamp.replicaId !== 'string' || !stamp.replicaId) {
    throw new Error(`${label} 的 LWW 时间戳无效`);
  }
}

function assertEntries(
  value: unknown,
  label: string,
  validate: (entry: unknown, entryLabel: string) => void,
): asserts value is readonly (readonly [string, unknown])[] {
  if (!Array.isArray(value) || value.length > 100_000) throw new Error(`${label} 无效`);
  const keys = new Set<string>();
  value.forEach((entry, index) => {
    if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' || !entry[0]
      || keys.has(entry[0])) throw new Error(`${label} 的键无效`);
    keys.add(entry[0]);
    validate(entry[1], `${label}[${index}]`);
  });
}

function assertRegister(value: unknown, label: string): void {
  const register = value as { stamp?: unknown; kind?: unknown } | null;
  if (!register || typeof register !== 'object'
    || register.kind !== 'field' && register.kind !== 'hierarchy') {
    throw new Error(`${label} 的 register 无效`);
  }
  assertStamp(register.stamp, label);
}

function assertLifecycle(value: unknown, label: string): void {
  const lifecycle = value as { stamp?: unknown; state?: unknown } | null;
  if (!lifecycle || typeof lifecycle !== 'object'
    || (lifecycle.state !== 'present' && lifecycle.state !== 'removed')) {
    throw new Error(`${label} 的生命周期无效`);
  }
  assertStamp(lifecycle.stamp, label);
}

function assertMove(value: unknown, label: string): void {
  const move = value as { stamp?: unknown; after?: unknown; ordinal?: unknown } | null;
  if (!move || typeof move !== 'object'
    || move.after !== null && (typeof move.after !== 'string' || !move.after)
    || typeof move.ordinal !== 'number' || !Number.isSafeInteger(move.ordinal) || move.ordinal < 0) {
    throw new Error(`${label} 的页序意图无效`);
  }
  assertStamp(move.stamp, label);
}

function assertSeen(value: unknown): asserts value is readonly CollabSeenCheckpoint[] {
  if (!Array.isArray(value) || value.length > MAX_SEEN_REPLICAS) {
    throw new Error('协同 checkpoint seen 无效');
  }
  const replicas = new Set<string>();
  let gaps = 0;
  for (const entry of value) {
    const seen = entry as Partial<CollabSeenCheckpoint> | null;
    if (!seen || typeof seen !== 'object' || typeof seen.replicaId !== 'string'
      || !seen.replicaId || seen.replicaId.length > 128 || /[\0-\x1f\x7f]/.test(seen.replicaId)
      || replicas.has(seen.replicaId) || !safeNonNegative(seen.contiguous)
      || !Array.isArray(seen.sparse)) throw new Error('协同 checkpoint seen 无效');
    replicas.add(seen.replicaId);
    let previous = seen.contiguous;
    for (const sequence of seen.sparse) {
      if (!Number.isSafeInteger(sequence) || sequence <= previous
        || sequence > MAX_COLLABORATION_VERSION) throw new Error('协同 checkpoint seen 无效');
      previous = sequence;
      gaps++;
    }
  }
  if (gaps > MAX_SEEN_GAPS) throw new Error('协同 checkpoint seen 无效');
}

export function assertCollaborationCheckpoint(
  value: unknown,
  expected: { documentId: string; replicaId: string; replicaSlot: number },
  allocation: EditIdentityAllocation,
): asserts value is CollaborationCheckpoint {
  const checkpoint = value as Partial<CollaborationCheckpoint> | null;
  if (!checkpoint || typeof checkpoint !== 'object' || checkpoint.version !== 1
    || checkpoint.documentId !== expected.documentId || checkpoint.replicaId !== expected.replicaId
    || checkpoint.replicaSlot !== expected.replicaSlot
    || !safeNonNegative(checkpoint.clock) || !safeNonNegative(checkpoint.sequence)
    || checkpoint.clock !== allocation.clock || checkpoint.sequence !== allocation.sequence
    || !Array.isArray(checkpoint.baseSlideOrder)
    || checkpoint.baseSlideOrder.some((id) => typeof id !== 'string' || !id)
    || new Set(checkpoint.baseSlideOrder).size !== checkpoint.baseSlideOrder.length
    || !Array.isArray(checkpoint.deferred) || checkpoint.deferred.length > 10_000) {
    throw new Error('协同 checkpoint 与恢复文档不匹配');
  }
  assertEntries(checkpoint.registers, '协同 checkpoint registers', assertRegister);
  assertEntries(checkpoint.elementLifecycles, '协同 checkpoint elementLifecycles', assertLifecycle);
  assertEntries(checkpoint.slideLifecycles, '协同 checkpoint slideLifecycles', assertLifecycle);
  assertEntries(checkpoint.slideMoves, '协同 checkpoint slideMoves', assertMove);
  assertSeen(checkpoint.seen);
  checkpoint.deferred.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object' || !Number.isSafeInteger(entry.ordinal)
      || entry.ordinal < 0) throw new Error(`协同 checkpoint deferred[${index}] 无效`);
    assertCollabMessage(entry.message);
    if (entry.message.documentId !== expected.documentId
      || entry.ordinal >= entry.message.patches.length
      || JSON.stringify(entry.patch) !== JSON.stringify(entry.message.patches[entry.ordinal])) {
      throw new Error(`协同 checkpoint deferred[${index}] 与消息不匹配`);
    }
  });
}
