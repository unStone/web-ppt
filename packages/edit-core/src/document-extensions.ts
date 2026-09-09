import type { EditDoc } from './types';
import type { DocumentExtensionPatch } from './commands/types';
import { assertExtensionLeaf, assertNamespace, observeDocumentExtension, registeredEditExtensions } from './extension-runtime';
import { assertDataObject } from './data-validation';
import { EXTENSION_ADDRESSES, moveExtensionAddress, validateExtensionAddress } from './extension-addresses';
import { EXTENSION_MIGRATIONS, validateExtensionMigration, applyExtensionMigration } from './extension-migration-receipt';

const validKey = (key: string): boolean => !!key && key.length <= 1024
  && key !== '__proto__' && key !== 'prototype' && key !== 'constructor';

/** 会话与保存入口只校验存储协议；未加载扩展的领域数据仍须能冷恢复。 */
export function assertDocumentExtensions(value: unknown): void {
  if (value === undefined) return;
  const seen = new WeakSet<object>();
  const dictionary = (record: unknown): Record<string, unknown> => {
    assertDataObject(record, new Set(record && typeof record === 'object' ? Reflect.ownKeys(record) : []), '文档扩展容器');
    if (seen.has(record)) throw new Error('文档扩展不能包含循环或共用可变容器');
    seen.add(record);
    return record as Record<string, unknown>;
  };
  const visit = (record: unknown, depth: number): void => {
    for (const [key, child] of Object.entries(dictionary(record))) {
      if (depth >= 16 || !validKey(key)) throw new Error('文档扩展路径无效');
      if (child && typeof child === 'object') visit(child, depth + 1);
      else {
        try { assertExtensionLeaf(child); }
        catch { throw new Error('文档扩展值必须是有界的纯数据标量'); }
      }
    }
  };
  for (const [namespace, state] of Object.entries(dictionary(value))) {
    if (!validKey(namespace)) throw new Error('文档扩展命名空间无效');
    try { assertNamespace(namespace); }
    catch { throw new Error('文档扩展命名空间无效'); }
    visit(state, 0);
  }
}

export function isDocumentExtensionPatch(patch: { path: readonly unknown[] }): patch is DocumentExtensionPatch {
  return patch.path.length >= 3 && patch.path[0] === 'document' && patch.path[1] === 'extensions'
    && typeof patch.path[2] === 'string';
}

export function validateDocumentExtensionPatch(doc: EditDoc, patch: DocumentExtensionPatch, index: number): void {
  if (patch.op !== 'set' && patch.op !== 'del') throw new Error(`Patch ${index} 的文档扩展操作无效`);
  assertNamespace(patch.path[2]);
  if (!validKey(patch.path[2])) throw new Error('文档扩展命名空间无效');
  const path = patch.path.slice(3);
  if (!path.length || path.length > 16 || path.some(key => typeof key !== 'string' || !validKey(key))) throw new Error('文档扩展路径无效');
  if (patch.op === 'set') assertExtensionLeaf(patch.value);
  if (patch.path[2] === EXTENSION_ADDRESSES) return validateExtensionAddress(doc, patch);
  if (patch.path[2] === EXTENSION_MIGRATIONS) return validateExtensionMigration(doc, patch,
    validateDocumentExtensionPatch, applyDocumentExtensionPatch);
  const state = doc.extensions?.[patch.path[2]];
  if (state !== undefined && (!state || typeof state !== 'object' || Array.isArray(state))) throw new Error('文档扩展覆盖无效');
  const runtime = registeredEditExtensions().get(patch.path[2]);
  if (runtime && !runtime.validateDocumentPatch) throw new Error('此扩展不支持文档级状态');
  runtime?.validateDocumentPatch?.(doc, patch, index);
}

export function applyDocumentExtensionPatch(doc: EditDoc, patch: DocumentExtensionPatch): void {
  if (patch.path[2] === EXTENSION_ADDRESSES) moveExtensionAddress(doc, patch);
  if (patch.path[2] === EXTENSION_MIGRATIONS) applyExtensionMigration(doc, patch, applyDocumentExtensionPatch);
  if (patch.op === 'del' && !doc.extensions) return;
  doc.extensions ??= Object.create(null) as Record<string, unknown>;
  let target = doc.extensions;
  const parents: Array<{ target: Record<string, unknown>; key: string }> = [];
  for (const key of patch.path.slice(2, -1)) {
    const next = target[key];
    if (next === undefined) {
      if (patch.op === 'del') return;
      target[key] = Object.create(null) as Record<string, unknown>;
    } else if (!next || typeof next !== 'object' || Array.isArray(next)) return;
    parents.push({ target, key });
    target = target[key] as Record<string, unknown>;
  }
  const key = patch.path[patch.path.length - 1];
  if (patch.op === 'set') target[key] = patch.value;
  else if (!target[key] || typeof target[key] !== 'object') delete target[key];
  for (const parent of parents.reverse()) {
    if (Object.keys(target).length) break;
    delete parent.target[parent.key]; target = parent.target;
  }
  if (!Object.keys(doc.extensions).length) delete doc.extensions;
  else observeDocumentExtension(doc, patch.path[2]);
}
