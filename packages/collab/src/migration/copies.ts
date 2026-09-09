import { canonicalExtensionPatch, readExtensionCopies, rebaseExtensionCopySnapshot } from '@web-ppt/edit-core';
import type { EditDoc, ExtensionCopyInput, Patch, SlideTreeSnapshot } from '@web-ppt/edit-core';
import type { Register } from '../state';
import { compareStamp } from '../message';
import { evidence } from './evidence';

export function copiedInputs(patches: readonly Patch[]): readonly ExtensionCopyInput[] {
  return patches.flatMap(patch => patch.op === 'insert' && patch.path[0] === 'slides' && patch.path.length === 2
    ? readExtensionCopies(patch.value as SlideTreeSnapshot) : []);
}

/** 来源版本只在没有更新目标版本时继承；撤销复活不能重置目标已有的寄存器。 */
export function recordCopiedInputs(registers: Map<string, Register>, patches: readonly Patch[]): void {
  for (const input of copiedInputs(patches)) {
    const key = JSON.stringify(input.path), previous = registers.get(key);
    if (previous && compareStamp(previous.stamp, input.stamp) >= 0) continue;
    const register: Register = { kind: 'field', stamp: { clock: input.stamp.clock, replicaId: input.stamp.replicaId } };
    registers.set(key, register);
    evidence.set(register, input.op === 'del' ? { op: 'del' } : { op: 'set', value: input.value! });
  }
}

/** 复活元素不构成字段写入；接收端已获胜的原操作不能被另一端的旧结构快照重置。 */
export function rebaseCopiedPatches(doc: EditDoc, patches: readonly Patch[], registers: ReadonlyMap<string, Register>): Patch[] {
  return patches.map(patch => {
    if (patch.op !== 'insert' || patch.path[0] !== 'slides' || patch.path.length !== 2) return patch;
    const snapshot = patch.value as SlideTreeSnapshot;
    const copied = new Map(readExtensionCopies(snapshot).map(input => [JSON.stringify(input.path), input]));
    const updates: Patch[] = [];
    for (const [key, register] of registers) {
      const operation = evidence.get(register);
      if (register.kind !== 'field' || !operation) continue;
      let path: string[]; try { path = JSON.parse(key); } catch { continue; }
      if (!Array.isArray(path) || path[0] !== 'elements' || path[2] !== 'ovr' || path[3] !== 'extensions'
        || !Object.prototype.hasOwnProperty.call(snapshot.records, path[1])) continue;
      const previous = copied.get(key);
      if (previous && compareStamp(register.stamp, previous.stamp) <= 0) continue;
      const field: Patch = { ...operation, path: ['elements', path[1], 'ovr', 'extensions', path[4], ...path.slice(5)], origin: 'migration' };
      // 已有路由的字段持续从文档数据读取，复活不应把它们重新塞回旧局部覆盖。
      if (canonicalExtensionPatch(doc, field).path[0] !== 'elements') continue;
      updates.push(field);
    }
    const value = rebaseExtensionCopySnapshot(doc, snapshot, updates,
      (current, tree, previous) => captureCopiedInputs(current, tree, previous, registers));
    return value === snapshot ? patch : { ...patch, value } as Patch;
  });
}

/** 按事务原顺序读取已执行命令；同批较早的真实写入可以提供版本，复制动作自身不能。 */
export function captureCopiedInputs(doc: EditDoc, snapshot: SlideTreeSnapshot,
  previous: readonly Patch[], current: ReadonlyMap<string, Register>): readonly ExtensionCopyInput[] {
  const registers = new Map(current), allocation = doc.identity.allocation!;
  const stamp = { clock: allocation.clock + 1, replicaId: allocation.replicaId };
  for (const patch of previous) {
    recordCopiedInputs(registers, [patch]);
    const mapped = canonicalExtensionPatch(doc, patch), path = mapped.path;
    if (path[0] !== 'elements' || path[2] !== 'ovr' || path[3] !== 'extensions'
      || path.length < 6 || mapped.op !== 'set' && mapped.op !== 'del') continue;
    const register: Register = { kind: 'field', stamp };
    registers.set(JSON.stringify(path), register);
    evidence.set(register, mapped.op === 'del' ? { op: 'del' }
      : { op: 'set', value: mapped.value as string | number | boolean | null });
  }
  const origins = new Map<string, Array<{ path: string[]; register: Register }>>();
  for (const [key, register] of registers) {
    if (register.kind !== 'field' || !evidence.has(register)) continue;
    let path: unknown; try { path = JSON.parse(key); } catch { continue; }
    if (!Array.isArray(path) || path[0] !== 'elements' || path[2] !== 'ovr'
      || path[3] !== 'extensions' || path.length < 6) continue;
    const entries = origins.get(path[1]) ?? []; entries.push({ path, register }); origins.set(path[1], entries);
  }
  const result: ExtensionCopyInput[] = [];
  for (const [target, source] of Object.entries(snapshot.copySources ?? {})) {
    for (const { path, register } of origins.get(source) ?? []) {
      const operation = evidence.get(register)!;
      let value: unknown = snapshot.records[target].ovr.extensions;
      for (const part of path.slice(4)) value = value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, part)
        ? (value as Record<string, unknown>)[part] : undefined;
      if (operation.op === 'set' ? operation.value !== value : value !== undefined) continue;
      result.push({ source, path: ['elements', target, ...path.slice(2)], ...operation, stamp: register.stamp });
    }
  }
  return result;
}
