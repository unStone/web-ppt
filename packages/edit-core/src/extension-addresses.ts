import type { EditDoc } from './types';
import type { DocumentExtensionPatch, Patch } from './commands/types';
import { assertIdentityRemap, mergeExtensionValue, remapExtensionField } from './extension-address-remap';
import type { ExtensionIdentityRemap } from './extension-address-remap';

export const EXTENSION_ADDRESSES = 'edit-addresses';
export interface ExtensionAddress {
  readonly target: readonly ['document', 'extensions', string, ...string[]];
  readonly identities: Readonly<Record<string, string>>;
  readonly remap?: ExtensionIdentityRemap;
  readonly merge?: 'equal';
}

const validKey = (key: unknown): key is string => typeof key === 'string' && !!key && key.length <= 1024
  && !['__proto__', 'prototype', 'constructor'].includes(key);
const namespacePattern = /^[a-z][a-z0-9-]{0,63}$/;
const table = (doc: EditDoc) => doc.extensions?.[EXTENSION_ADDRESSES] as
  Record<string, Record<string, string>> | undefined;

export const isExtensionAddressPatch = (patch: Patch): patch is DocumentExtensionPatch =>
  patch.path[0] === 'document' && patch.path[1] === 'extensions' && patch.path[2] === EXTENSION_ADDRESSES;

export function readExtensionAddress(value: unknown): ExtensionAddress {
  if (typeof value !== 'string') throw new Error('扩展地址必须是序列化的纯数据');
  const address = JSON.parse(value) as ExtensionAddress;
  if (!address || typeof address !== 'object' || Array.isArray(address)
    || Object.keys(address).some(key => !['target', 'identities', 'remap', 'merge'].includes(key))
    || !Array.isArray(address.target) || address.target.length < 4 || address.target.length > 12
    || address.target[0] !== 'document' || address.target[1] !== 'extensions'
    || address.target[2] === EXTENSION_ADDRESSES || address.target[2] === 'edit-migrations'
    || !namespacePattern.test(address.target[2])
    || address.target.some(key => !validKey(key))
    || !address.identities || typeof address.identities !== 'object' || Array.isArray(address.identities)
    || Object.entries(address.identities).some(([key, id]) => !validKey(key) || !validKey(id))
    || address.merge !== undefined && address.merge !== 'equal') {
    throw new Error('扩展地址映射无效');
  }
  assertIdentityRemap(address.remap);
  return address;
}

export function extensionAddressPatches(doc: EditDoc, origin: string): DocumentExtensionPatch[] {
  return Object.entries(table(doc) ?? {}).flatMap(([id, namespaces]) => {
    if (!namespaces || typeof namespaces !== 'object' || Array.isArray(namespaces)) {
      throw new Error('扩展地址来源必须是命名空间容器');
    }
    return Object.entries(namespaces).map(([namespace, value]) => ({ op: 'set' as const, origin,
      path: ['document', 'extensions', EXTENSION_ADDRESSES, id, namespace] as const, value }));
  });
}

export function canonicalExtensionPath(doc: EditDoc, path: Patch['path']): Patch['path'] {
  if (path[0] !== 'elements' || path[2] !== 'ovr' || path[3] !== 'extensions') return path;
  const encoded = table(doc)?.[path[1]]?.[path[4] as string];
  if (encoded === undefined) return path;
  const address = readExtensionAddress(encoded);
  return [...address.target, ...remapExtensionField(address.remap, path.slice(5)).path] as DocumentExtensionPatch['path'];
}

export function canonicalExtensionPatch(doc: EditDoc, patch: Patch): Patch {
  const path = canonicalExtensionPath(doc, patch.path);
  if (path === patch.path) return patch;
  const address = readExtensionAddress(table(doc)![patch.path[1]][patch.path[4] as string]);
  const mapped = remapExtensionField(address.remap, patch.path.slice(5) as string[], patch.op === 'set' ? patch.value : undefined);
  return { ...patch, path, ...(patch.op === 'set' ? { value: mapped.value } : {}) } as Patch;
}

function canShare(left: ExtensionAddress, right: ExtensionAddress): boolean {
  return (left.merge === 'equal' || right.merge === 'equal')
    && left.target.length === right.target.length && left.target.every((key, index) => key === right.target[index])
    && (left.remap?.prefix ?? '') === (right.remap?.prefix ?? '')
    && Object.keys(left.identities).length === Object.keys(right.identities).length
    && Object.entries(left.identities).every(([key, id]) => right.identities[key] === id);
}

function targetValue(doc: EditDoc, address: ExtensionAddress): unknown {
  let value: unknown = doc.extensions;
  for (const key of address.target.slice(2)) {
    if (value === undefined) return undefined;
    if (!value || typeof value !== 'object') throw new Error('扩展迁移目标的父路径不是容器');
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

export function validateExtensionAddress(doc: EditDoc, patch: DocumentExtensionPatch): void {
  if (patch.op !== 'set' || patch.path.length !== 5 || !namespacePattern.test(patch.path[4])) {
    throw new Error('扩展地址只接受不可变的映射声明');
  }
  const address = readExtensionAddress(patch.value);
  const previous = table(doc)?.[patch.path[3]]?.[patch.path[4]];
  if (previous !== undefined && previous !== patch.value) throw new Error('扩展地址不能重新指向其他数据');
  if (previous !== undefined) return;
  // 目标重叠由完整暂存模型的一次前缀树校验负责，逐声明扫描会让复制文稿出现平方开销。
  if (address.merge === 'equal') {
    mergeExtensionValue(targetValue(doc, address), doc.elements[patch.path[3]]?.ovr.extensions?.[patch.path[4]], address.remap);
  } else if (targetValue(doc, address) !== undefined) {
    throw new Error('扩展迁移目标已存在，不能覆盖其字段与时钟');
  }
}

export function validateExtensionAddresses(doc: EditDoc): void {
  interface Node { terminal?: ExtensionAddress; children: Map<string, Node> }
  const root: Node = { children: new Map() };
  for (const patch of extensionAddressPatches(doc, 'validate')) {
    validateExtensionAddress(doc, patch);
    const address = readExtensionAddress(patch.op === 'set' ? patch.value : undefined);
    let node = root;
    for (const key of address.target) {
      if (node.terminal) throw new Error('扩展迁移目标不能重叠');
      let child = node.children.get(key);
      if (!child) node.children.set(key, child = { children: new Map() });
      node = child;
    }
    if (node.terminal && !canShare(node.terminal, address) || node.children.size) throw new Error('扩展迁移目标不能重叠');
    node.terminal = address;
  }
}

export function moveExtensionAddress(doc: EditDoc, patch: DocumentExtensionPatch): void {
  if (patch.op !== 'set') return;
  if (table(doc)?.[patch.path[3]]?.[patch.path[4]] !== undefined) return;
  const record = doc.elements[patch.path[3]], namespace = patch.path[4];
  const value = record?.ovr.extensions?.[namespace];
  if (value === undefined) return;
  const address = readExtensionAddress(patch.value);
  let target = doc.extensions ??= Object.create(null) as Record<string, unknown>;
  for (const key of address.target.slice(2, -1)) {
    target[key] ??= Object.create(null);
    target = target[key] as Record<string, unknown>;
  }
  const key = address.target[address.target.length - 1];
  target[key] = address.merge === 'equal' || address.remap
    ? mergeExtensionValue(target[key], value, address.remap) : structuredClone(value);
  delete record.ovr.extensions![namespace];
  if (!Object.keys(record.ovr.extensions!).length) delete record.ovr.extensions;
}

/** 旧结构快照可复活框架，但不能用其中的旧覆盖重置已经独立存在的数据。 */
export function clearRelocatedExtensions(doc: EditDoc): void {
  for (const [id, namespaces] of Object.entries(table(doc) ?? {})) {
    const record = doc.elements[id];
    if (!record?.ovr.extensions) continue;
    for (const namespace of Object.keys(namespaces)) delete record.ovr.extensions[namespace];
    if (!Object.keys(record.ovr.extensions).length) delete record.ovr.extensions;
  }
}
