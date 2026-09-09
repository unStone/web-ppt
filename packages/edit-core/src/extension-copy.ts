import type { EditDoc } from './types';
import type { CommandPatches, Patch, SlideTreeSnapshot } from './commands/types';
import type { ExtensionMigrationInput } from './extension-migration-receipt';
import { assertExtensionLeaf, extensionCopyResolver } from './extension-runtime';
import { MAX_COLLABORATION_VERSION } from './identity-allocation';

export interface ExtensionCopyInput extends ExtensionMigrationInput {
  readonly source: string;
  readonly stamp: { readonly clock: number; readonly replicaId: string };
}
export type ExtensionCopyResolver = (doc: EditDoc, snapshot: SlideTreeSnapshot,
  previous: readonly Patch[]) => readonly ExtensionCopyInput[];

const key = (value: unknown): value is string => typeof value === 'string' && !!value && value.length <= 1024
  && !['__proto__', 'prototype', 'constructor'].includes(value);
const fail = (): never => { throw new Error('扩展复制的原操作证据无效'); };

export function extensionCopyMatches(snapshot: SlideTreeSnapshot, input: ExtensionCopyInput): boolean {
  let value: unknown = snapshot.records[input.path[1]].ovr.extensions;
  for (const part of input.path.slice(4)) value = value && typeof value === 'object'
    && Object.prototype.hasOwnProperty.call(value, part) ? (value as Record<string, unknown>)[part] : undefined;
  return input.op === 'set' ? value === input.value : value === undefined;
}

/** 只检查复制快照与原操作的一致性；原版本的产生和比较仍由可选协同适配器负责。 */
export function readExtensionCopies(snapshot: SlideTreeSnapshot): readonly ExtensionCopyInput[] {
  const sources = snapshot.copySources;
  if (sources !== undefined && (!sources || typeof sources !== 'object' || Array.isArray(sources)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(sources))
    || Reflect.ownKeys(sources).some(name => {
      const field = Object.getOwnPropertyDescriptor(sources, name)!;
      return !key(name) || !field.enumerable || !('value' in field) || !key(field.value)
        || name === field.value || !Object.prototype.hasOwnProperty.call(snapshot.records, name);
    }))) fail();
  if (snapshot.extensionCopies === undefined) return [];
  if (typeof snapshot.extensionCopies !== 'string' || snapshot.extensionCopies.length > 1_000_000) fail();
  const inputs = JSON.parse(snapshot.extensionCopies) as ExtensionCopyInput[], paths = new Set<string>();
  if (!Array.isArray(inputs) || inputs.length > 10_000) fail();
  for (const input of inputs) {
    if (!input || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).some(name => !['source', 'path', 'op', 'value', 'stamp'].includes(name))) fail();
    const path = input.path, stamp = input.stamp;
    if (!Array.isArray(path) || path.length < 6 || path.length > 21 || !path.every(key)
      || path[0] !== 'elements' || path[2] !== 'ovr' || path[3] !== 'extensions'
      || !/^[a-z][a-z0-9-]{0,63}$/.test(path[4]) || !key(input.source)
      || sources?.[path[1]] !== input.source && path[1] !== input.source
      || !Object.prototype.hasOwnProperty.call(snapshot.records, path[1])
      || paths.has(JSON.stringify(path)) || !stamp || typeof stamp !== 'object' || Array.isArray(stamp)
      || Object.keys(stamp).some(name => name !== 'clock' && name !== 'replicaId') || !Number.isSafeInteger(stamp.clock)
      || stamp.clock <= 0 || stamp.clock > MAX_COLLABORATION_VERSION
      || typeof stamp.replicaId !== 'string' || !stamp.replicaId || stamp.replicaId.length > 128
      || /[\0-\x1f\x7f]/.test(stamp.replicaId)) fail();
    paths.add(JSON.stringify(path));
    if (input.op === 'set') assertExtensionLeaf(input.value);
    else if (input.op !== 'del' || Object.prototype.hasOwnProperty.call(input, 'value')) fail();
    if (!extensionCopyMatches(snapshot, input)) fail();
  }
  return inputs;
}

/** 在命令落模前冻结证据；逆补丁和重做共用它，不能在重放时重新读取来源的新版本。 */
export function prepareExtensionCopies(doc: EditDoc, commands: CommandPatches, previous: readonly Patch[]): void {
  const snapshots = new Map<SlideTreeSnapshot, SlideTreeSnapshot>();
  for (const patch of commands.forward) {
    if (patch.op !== 'insert' || patch.path[0] !== 'slides' || patch.path.length !== 2) continue;
    const snapshot = patch.value as SlideTreeSnapshot;
    if (!snapshot.copySources || snapshot.extensionCopies !== undefined) continue;
    const inputs = extensionCopyResolver(doc)?.(doc, snapshot, previous);
    if (!inputs?.length) continue;
    const next = { ...snapshot, extensionCopies: JSON.stringify(inputs) };
    readExtensionCopies(next); snapshots.set(snapshot, next);
  }
  for (const patches of [commands.forward, commands.inverse]) {
    for (let index = 0; index < patches.length; index++) {
      const patch = patches[index];
      if (patch.path[0] !== 'slides' || patch.path.length !== 2 || patch.op !== 'insert' && patch.op !== 'remove') continue;
      const value = snapshots.get(patch.value as SlideTreeSnapshot);
      if (value) patches[index] = { ...patch, value } as Patch;
    }
  }
}
