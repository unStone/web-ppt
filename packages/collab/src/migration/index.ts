import { canonicalExtensionPatch, canonicalExtensionPath, setExtensionMigrationResolver, refreshExtensionMigrations } from '@web-ppt/edit-core';
import type { EditDoc, Editor, Patch } from '@web-ppt/edit-core';
import { bindWithEvaluator as bind, collaborationSession } from '../binding';
import { compareStamp, pathKey } from '../message';
import type { CollaborationSession, Register } from '../state';
import type { CollabExtensionOperation, CollabRegisterCheckpoint, CollaborationBinding, CollaborationCheckpoint, CollaborationOptions } from '../types';
import { evidence } from './evidence';
import { resolveMigration } from './resolve';
import { evaluateMigrationMessage } from './evaluate';
import { recordReceiptWinners } from './receipt-registers';
import { captureCopiedInputs, recordCopiedInputs } from './copies';

export type { CollabExtensionOperation } from '../types';

const extensionPath = (path: readonly unknown[]): boolean =>
  path[0] === 'document' && path[1] === 'extensions'
    && path[2] !== 'edit-addresses' && path[2] !== 'edit-migrations' && path.length >= 4
  || (path[0] === 'elements' || path[0] === 'slides') && path[2] === 'ovr'
    && path[3] === 'extensions' && path.length >= 6;

function readOperation(value: unknown): CollabExtensionOperation {
  if (!value || typeof value !== 'object'
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new Error('协同扩展字段的原操作无效');
  }
  // 只读数据描述符，不执行 getter；随后使用同一份已验证快照，避免校验与复制读到不同值。
  const fields = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(fields);
  if (keys.some(key => key !== 'op' && key !== 'value')
    || Object.values(fields).some(field => !field.enumerable || !('value' in field))) {
    throw new Error('协同扩展字段的原操作无效');
  }
  const op = fields.op?.value, scalar = fields.value?.value;
  if (op === 'del' && keys.length === 1) return { op };
  if (op === 'set' && keys.length === 2 && (scalar === null || typeof scalar === 'boolean'
    || typeof scalar === 'number' && Number.isFinite(scalar)
    || typeof scalar === 'string' && scalar.length <= 1_000_000)) return { op, value: scalar };
  throw new Error('协同扩展字段的原操作无效');
}

function restoredOperations(checkpoint?: CollaborationCheckpoint): ReadonlyMap<string, CollabExtensionOperation> {
  const entries = checkpoint?.extensionOperations;
  if (entries === undefined) return new Map();
  if (!Array.isArray(entries) || entries.length > 100_000 || !Array.isArray(checkpoint!.registers)) {
    throw new Error('协同扩展字段的原操作列表无效');
  }
  const registers = new Map<string, CollabRegisterCheckpoint>(checkpoint!.registers), result = new Map<string, CollabExtensionOperation>();
  for (const entry of entries) {
    if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string'
      || result.has(entry[0]) || registers.get(entry[0])?.kind !== 'field') {
      throw new Error('协同扩展字段的原操作缺少唯一原寄存器');
    }
    let path: unknown;
    try { path = JSON.parse(entry[0]); } catch { throw new Error('协同扩展字段的原操作路径无效'); }
    if (!Array.isArray(path) || !extensionPath(path) || path.length > 21
      || path.some(key => typeof key !== 'string' || !key || key.length > 1024
        || ['__proto__', 'constructor', 'prototype'].includes(key))) {
      throw new Error('协同扩展字段的原操作路径无效');
    }
    result.set(entry[0], readOperation(entry[1]));
  }
  return result;
}

function capture(session: CollaborationSession, patches: readonly Patch[], stamp: Register['stamp']): void {
  for (const patch of patches) {
    if (!extensionPath(patch.path) || patch.op !== 'set' && patch.op !== 'del') continue;
    const key = pathKey(patch), current = session.registers.get(key);
    if (current?.kind !== 'field' || compareStamp(current.stamp, stamp) !== 0) continue;
    const operation = patch.op === 'del' ? { op: 'del' as const } : { op: 'set' as const, value: patch.value };
    evidence.set(current, readOperation(operation));
  }
}

function checkpointOperations(doc: EditDoc, registers: ReadonlyMap<string, Register>) {
  const canonical = new Map<string, { register: Register; operation?: CollabExtensionOperation }>();
  for (const [key, original] of registers) {
    let mapped = key, operation = evidence.get(original);
    if (key.startsWith('["elements",')) {
      try {
        const path = JSON.parse(key) as Patch['path'];
        mapped = JSON.stringify(canonicalExtensionPath(doc, path));
        if (operation) {
          const patch = canonicalExtensionPatch(doc, { ...operation, path, origin: 'collab' } as Patch);
          const next = patch.op === 'set' ? { op: 'set' as const, value: patch.value } : { op: 'del' as const };
          operation = readOperation(next);
        }
      } catch (error) {
        if (operation) throw error;
        // 无证据的旧协议键与基础 checkpoint 一样透明保留；已知证据的映射错误不能被吞掉。
        mapped = key;
      }
    }
    const current = canonical.get(mapped);
    if (!current || compareStamp(original.stamp, current.register.stamp) > 0) canonical.set(mapped, { register: original, operation });
    else if (compareStamp(original.stamp, current.register.stamp) === 0 && operation && current.operation
      && JSON.stringify(operation) !== JSON.stringify(current.operation)) {
      throw new Error('协同扩展字段的同版本原操作冲突');
    }
  }
  return [...canonical].flatMap(([key, value]) => value.operation
    ? [[key, value.operation] as const] : []).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
}

/** 可选迁移入口记录原操作；仍使用基础绑定的同一会话、时钟与原子接收批次。 */
export function bindCollaboration(editor: Editor, options: CollaborationOptions): CollaborationBinding {
  let existing: CollaborationSession | undefined;
  try { existing = collaborationSession(editor); } catch { /* 首次绑定才消费恢复 checkpoint。 */ }
  const operations = existing ? new Map<string, CollabExtensionOperation>() : restoredOperations(options.checkpoint);
  const binding = bind(editor, { ...options, provider: {
    send: message => options.provider.send(message),
    subscribe(listener) {
      const session = collaborationSession(editor), previous = session.onRecord;
      for (const [key, operation] of operations) {
        evidence.set(session.registers.get(key)!, operation);
      }
      session.onRecord = (patches, stamp) => {
        previous?.(patches, stamp); recordCopiedInputs(session.registers, patches);
        recordReceiptWinners(editor.doc, session.registers, patches); capture(session, patches, stamp);
      };
      const releaseResolver = setExtensionMigrationResolver(editor.doc, (doc, routes) => resolveMigration(doc, routes, session.registers),
        (doc, snapshot, previous) => captureCopiedInputs(doc, snapshot, previous, session.registers));
      // provider 可同步发出历史消息，必须在它订阅之前接好原操作记录。
      try {
        const unsubscribe = options.provider.subscribe(listener);
        if (typeof unsubscribe !== 'function') throw new Error('provider.subscribe 必须返回取消订阅函数');
        return () => { releaseResolver(); session.onRecord = previous; unsubscribe(); };
      } catch (error) { releaseResolver(); session.onRecord = previous; throw error; }
    },
  } }, evaluateMigrationMessage);
  try { refreshExtensionMigrations(editor.doc); }
  catch (error) { binding.dispose(); throw error; }
  return { ...binding, checkpoint() {
    const checkpoint = binding.checkpoint();
    const extensionOperations = checkpointOperations(editor.doc, collaborationSession(editor).registers);
    return { ...checkpoint, extensionOperations: structuredClone(extensionOperations) };
  } };
}
