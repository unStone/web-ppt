import { assertIdentityAllocation, MAX_COLLABORATION_VERSION } from '@web-ppt/edit-core';
import type { EditIdentity, Patch } from '@web-ppt/edit-core';
import type { CollabMessage, CollabStamp } from './types';

export function compareStamp(left: CollabStamp, right: CollabStamp): number {
  if (left.clock !== right.clock) return left.clock < right.clock ? -1 : 1;
  if (left.replicaId === right.replicaId) return 0;
  // localeCompare 的排序可能随运行环境改变；协议裁决只能依赖 JS 规定的 UTF-16 码元序。
  return left.replicaId < right.replicaId ? -1 : 1;
}

const positiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

const protocolId = (value: unknown): value is string => typeof value === 'string'
  && value.length >= 1 && value.length <= 128 && !/[\0-\x1f\x7f]/.test(value);

function assertIdentity(value: unknown): asserts value is EditIdentity {
  const identity = value as Partial<EditIdentity> | null;
  const optional = (counter: unknown, minimum = 1, maximum = Number.MAX_SAFE_INTEGER) =>
    counter === undefined || positiveInteger(counter) && counter >= minimum && counter <= maximum;
  if (!identity || typeof identity !== 'object' || typeof identity.prefix !== 'string' || !identity.prefix
    || !positiveInteger(identity.nextSlide) || !positiveInteger(identity.nextElement)
    || !identity.nextSpid || typeof identity.nextSpid !== 'object' || Array.isArray(identity.nextSpid)
    || Object.entries(identity.nextSpid).some(([part, counter]) => !part || !positiveInteger(counter))
    || !optional(identity.nextSlidePart) || !optional(identity.nextNotesPart)
    || !optional(identity.nextPresentationSlideId, 256, 0x8000_0000)
    || !optional(identity.nextPresentationRelationship)) {
    throw new Error('协同消息的身份水位无效');
  }
  const allocation = identity.allocation;
  if (allocation !== undefined) {
    if (!protocolId(allocation?.replicaId)) throw new Error('协同消息的身份分配命名空间无效');
    try {
      assertIdentityAllocation(allocation, '协同消息的身份分配命名空间', identity.prefix);
    } catch {
      throw new Error('协同消息的身份分配命名空间无效');
    }
  }
}

export function assertCollabMessage(value: unknown): asserts value is CollabMessage {
  const message = value as Partial<CollabMessage> | null;
  const stamp = message?.stamp as Partial<CollabStamp> | undefined;
  if (!message || typeof message !== 'object' || message.version !== 1
    || !protocolId(message.documentId) || !protocolId(message.replicaId)
    || !positiveInteger(message.sequence) || message.sequence > MAX_COLLABORATION_VERSION
    || !stamp || !positiveInteger(stamp.clock) || stamp.clock > MAX_COLLABORATION_VERSION
    || stamp.replicaId !== message.replicaId || !Array.isArray(message.patches)
    || !message.patches.length || message.patches.length > 10_000
    || message.patches.some((patch) => !patch || typeof patch !== 'object'
      || !Array.isArray(patch.path) || !patch.path.length
      || typeof patch.op !== 'string' || typeof patch.origin !== 'string')
    || typeof message.label !== 'string'
    || !Number.isFinite(message.time)) {
    throw new Error('协同消息结构无效');
  }
  assertIdentity(message.identity);
  const allocation = message.identity.allocation;
  if (!allocation || allocation.replicaId !== message.replicaId
    || allocation.clock !== stamp.clock || allocation.sequence !== message.sequence) {
    throw new Error('协同消息的身份版本与消息头不一致');
  }
}

export const pathKey = (patch: Patch): string => JSON.stringify(patch.path);
export const messageKey = (message: CollabMessage): string =>
  `${message.replicaId}\0${message.sequence}`;
