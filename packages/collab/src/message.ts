import {
  assertEditIdentityWatermark, MAX_COLLABORATION_VERSION, MAX_PATCHES_PER_TRANSACTION, isExtensionMigrationPatch,
} from '@web-ppt/edit-core';
import type { Patch } from '@web-ppt/edit-core';
import type { CollabMessage, CollabStamp } from './types';
export { isExtensionMigrationPatch };

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

export function assertCollabMessage(value: unknown): asserts value is CollabMessage {
  const message = value as Partial<CollabMessage> | null;
  const stamp = message?.stamp as Partial<CollabStamp> | undefined;
  if (!message || typeof message !== 'object' || message.version !== 1
    || !protocolId(message.documentId) || !protocolId(message.replicaId)
    || !positiveInteger(message.sequence) || message.sequence > MAX_COLLABORATION_VERSION
    || !stamp || !positiveInteger(stamp.clock) || stamp.clock > MAX_COLLABORATION_VERSION
    || stamp.replicaId !== message.replicaId || !Array.isArray(message.patches)
    || !message.patches.length || message.patches.length > MAX_PATCHES_PER_TRANSACTION
    || message.patches.some((patch) => !patch || typeof patch !== 'object'
      || !Array.isArray(patch.path) || !patch.path.length
      || typeof patch.op !== 'string' || typeof patch.origin !== 'string')
    || typeof message.label !== 'string'
    || !Number.isFinite(message.time)) {
    throw new Error('协同消息结构无效');
  }
  try { assertEditIdentityWatermark(message.identity); }
  catch { throw new Error('协同消息的身份水位或身份分配命名空间无效'); }
  const allocation = message.identity.allocation;
  if (!allocation || allocation.replicaId !== message.replicaId
    || allocation.clock !== stamp.clock || allocation.sequence !== message.sequence) {
    throw new Error('协同消息的身份版本与消息头不一致');
  }
}

export const pathKey = (patch: Patch): string => JSON.stringify(patch.path);
export const messageKey = (message: CollabMessage): string =>
  `${message.replicaId}\0${message.sequence}`;
