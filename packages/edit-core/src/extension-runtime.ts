import type { Slide, SlideElement } from '@web-ppt/core';
import type { CommandPatches, DocumentExtensionPatch, ExtensionCommand, ExtensionPatch, Patch } from './commands/types';
import type { EditDoc, ElementId, ElementInsertionResource, SlideId } from './types';
import type { OpcPartChanges } from './opc/types';
import { invalidateElement, invalidateSlide } from './projection';
import { isLegacyExtensionReplay } from './extension-recovery-context';
import type { ExtensionCopyResolver } from './extension-copy';

export interface EditExtensionSavePlan {
  readonly changes: OpcPartChanges;
  readonly baselines: Readonly<Record<string, Uint8Array>>;
}

/** undefined 允许无版本的等值回退；空数组明确否决整组迁移。 */
export type ExtensionMigrationResolver = (doc: EditDoc, routes: readonly DocumentExtensionPatch[]) =>
  readonly DocumentExtensionPatch[] | undefined;

export interface EditExtensionRuntime {
  readonly migrate?: (doc: EditDoc, pending?: readonly Patch[], resolve?: ExtensionMigrationResolver) => readonly Patch[];
  readonly validateDocumentPatch?: (doc: EditDoc, patch: DocumentExtensionPatch, index: number) => void;
  readonly documentElements?: (doc: EditDoc, patch?: DocumentExtensionPatch) => readonly ElementId[];
  readonly projectDocument?: (doc: EditDoc, id: ElementId, element: SlideElement) => SlideElement;
  /** 来源状态可能由别处的覆盖决定；此投影在局部覆盖前执行，不要求本元素已有扩展字段。 */
  readonly projectSource?: (doc: EditDoc, id: ElementId, element: SlideElement) => SlideElement;
  readonly generateParts?: (doc: EditDoc, parts: Record<string, Uint8Array>) => void;
  readonly copyParts?: (doc: EditDoc, parts: Record<string, Uint8Array>) => void;
  readonly scope?: 'element' | 'slide';
  readonly materializePackage?: (doc: EditDoc, baselines: Record<string, Uint8Array>, created: Set<string>, changes: Record<string, Uint8Array | null>) => void;
  readonly projectSlide?: (doc: EditDoc, id: SlideId, slide: Slide) => Slide;
  readonly materialize?: (
    document: import('./xml/types').XmlDocument, record: import('./types').ElementRecord, generated: boolean,
    xml: import('./save/extension-elements').EditElementXml,
  ) => void;
  readonly supportsGenerated?: (element: SlideElement) => boolean;
  readonly validateResource?: (resource: ElementInsertionResource, bytes: Uint8Array) => boolean;
  readonly command: (
    doc: EditDoc, command: ExtensionCommand, origin: string,
  ) => CommandPatches;
  readonly validatePatch?: (doc: EditDoc, patch: ExtensionPatch, index: number) => void;
  readonly validatePatches?: (
    doc: EditDoc,
    patches: readonly { readonly patch: ExtensionPatch; readonly index: number }[],
  ) => void;
  readonly prune?: (doc: EditDoc, id: ElementId, state: unknown) => boolean;
  readonly project?: (doc: EditDoc, id: ElementId, element: SlideElement) => SlideElement;
  readonly beforeSave?: (
    doc: EditDoc,
  ) => EditExtensionSavePlan | void | Promise<EditExtensionSavePlan | void>;
}

const KEY = Symbol.for('@web-ppt/edit-core/extensions/v1');
const GENERATION_KEY = Symbol.for('@web-ppt/edit-core/extensions-generation/v1');
const LISTENER_KEY = Symbol.for('@web-ppt/edit-core/extensions-listeners/v1');
const NAMESPACE = /^[a-z][a-z0-9-]{0,63}$/;
const MAX_VALUE_TEXT = 1_000_000;
type ExtensionRegistrationListener = (namespace: string) => void;
interface ExtensionListenerStore {
  readonly documents: WeakMap<EditDoc, Set<ExtensionRegistrationListener>>;
  readonly pending: Map<string, Set<ExtensionRegistrationListener>>;
  readonly active: Set<ExtensionRegistrationListener>;
  readonly resolvers: WeakMap<EditDoc, { resolver: ExtensionMigrationResolver; copy?: ExtensionCopyResolver }[]>;
}

function listenerStore(): ExtensionListenerStore {
  const root = globalThis as typeof globalThis & { [LISTENER_KEY]?: ExtensionListenerStore };
  return root[LISTENER_KEY] ??= { documents: new WeakMap(), pending: new Map(), active: new Set(), resolvers: new WeakMap() };
}

/** 版本策略属于可选会话；模型和恢复日志中只保留其产生的纯数据结果。 */
export function setExtensionMigrationResolver(doc: EditDoc, resolver: ExtensionMigrationResolver,
  copy?: ExtensionCopyResolver): () => void {
  const resolvers = listenerStore().resolvers, entries = resolvers.get(doc) ?? [], entry = { resolver, copy };
  entries.push(entry); resolvers.set(doc, entries);
  return () => {
    const index = entries.indexOf(entry);
    if (index < 0) return;
    entries.splice(index, 1);
    if (!entries.length) resolvers.delete(doc);
  };
}

function migrationResolver(doc: EditDoc): ExtensionMigrationResolver | undefined {
  const entries = listenerStore().resolvers.get(doc);
  return entries?.[entries.length - 1]?.resolver;
}

export function extensionCopyResolver(doc: EditDoc): ExtensionCopyResolver | undefined {
  const entries = listenerStore().resolvers.get(doc);
  return entries?.[entries.length - 1]?.copy;
}

export function refreshExtensionMigrations(doc: EditDoc): void {
  for (const listener of listenerStore().documents.get(doc) ?? []) {
    for (const [namespace, extension] of runtimes()) if (extension.migrate) listener(namespace);
  }
}

export function assertNamespace(namespace: string): void {
  if (!namespace || !NAMESPACE.test(namespace)) {
    throw new Error(`编辑扩展命名空间无效：${namespace}`);
  }
}

/** 扩展补丁只能持久化标量叶；对象和数组无须遍历，本身就是无效输入。 */
export function assertExtensionLeaf(value: unknown): void {
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (typeof value === 'string' && value.length <= MAX_VALUE_TEXT) return;
  throw new Error('编辑扩展值必须是有界的纯数据标量');
}

function runtimes(): Map<string, EditExtensionRuntime> {
  const root = globalThis as typeof globalThis & { [KEY]?: Map<string, EditExtensionRuntime> };
  return root[KEY] ??= new Map();
}

export function registerEditExtension(namespace: string, runtime: EditExtensionRuntime): void {
  assertNamespace(namespace);
  runtimes().set(namespace, runtime);
  const root = globalThis as typeof globalThis & { [GENERATION_KEY]?: number };
  root[GENERATION_KEY] = (root[GENERATION_KEY] ?? 0) + 1;
  const listeners = new Set(listenerStore().pending.get(namespace));
  if (runtime.migrate) for (const listener of listenerStore().active) listeners.add(listener);
  listenerStore().pending.delete(namespace);
  for (const listener of listeners ?? []) {
    try { listener(namespace); } catch (error) { globalThis.reportError?.(error); }
  }
}

export function editExtensionGeneration(): number {
  return (globalThis as typeof globalThis & { [GENERATION_KEY]?: number })[GENERATION_KEY] ?? 0;
}

const runtime = (namespace: string): EditExtensionRuntime | undefined => runtimes().get(namespace);

/** 迟到的旧地址可能在扩展加载之后首次出现；只为这类字段请求迁移计划。 */
export function extensionMigrationPatches(doc: EditDoc, patches: readonly Patch[],
  resolve = migrationResolver(doc)): readonly Patch[] {
  if (!patches.some(isExtensionPatch)) return [];
  return [...runtimes().values()].flatMap(extension => [...extension.migrate?.(doc, patches, resolve) ?? []]);
}

function queueRegistrationListener(namespace: string, listener: ExtensionRegistrationListener): void {
  if (runtime(namespace)) return;
  const listeners = listenerStore().pending.get(namespace) ?? new Set<ExtensionRegistrationListener>();
  listeners.add(listener);
  listenerStore().pending.set(namespace, listeners);
}

export function observeEditExtensionRegistration(
  doc: EditDoc, refresh: (elements: Set<ElementId>, slides: Set<SlideId>) => void,
  migrate?: (patches: readonly Patch[]) => void,
): () => void {
  const listener: ExtensionRegistrationListener = (namespace) => {
    const patches = runtime(namespace)?.migrate?.(doc, undefined, migrationResolver(doc));
    if (patches?.length) migrate?.(patches);
    const elements = new Set<ElementId>();
    const slides = new Set<SlideId>();
    if (doc.extensions?.[namespace] !== undefined || runtime(namespace)?.projectSource) {
      for (const id of runtime(namespace)?.documentElements?.(doc) ?? Object.keys(doc.elements)) {
        const dirty = invalidateElement(doc, id);
        for (const element of dirty.dirtyElements) elements.add(element);
        for (const slide of dirty.dirtySlides) slides.add(slide);
      }
    }
    for (const record of [...Object.values(doc.elements), ...Object.values(doc.slides)]) {
      if (record.ovr.extensions?.[namespace] === undefined) continue;
      // 延迟注册与普通编辑必须沿同一父链传播；只有元素集时，挂载视图会跳过整页更新。
      const dirty = doc.slides[record.id] ? invalidateSlide(doc, record.id) : invalidateElement(doc, record.id);
      for (const id of dirty.dirtyElements) elements.add(id);
      for (const id of dirty.dirtySlides) slides.add(id);
    }
    if (elements.size || slides.size) refresh(elements, slides);
  };
  const listeners = listenerStore().documents.get(doc) ?? new Set<ExtensionRegistrationListener>();
  listeners.add(listener);
  listenerStore().active.add(listener);
  listenerStore().documents.set(doc, listeners);
  for (const namespace of Object.keys(doc.extensions ?? {})) queueRegistrationListener(namespace, listener);
  for (const record of [...Object.values(doc.elements), ...Object.values(doc.slides)]) {
    for (const namespace of Object.keys(record.ovr.extensions ?? {})) {
      queueRegistrationListener(namespace, listener);
    }
  }
  const unsubscribe = () => {
    listeners.delete(listener);
    listenerStore().active.delete(listener);
    for (const [namespace, pending] of listenerStore().pending) {
      pending.delete(listener);
      if (!pending.size) listenerStore().pending.delete(namespace);
    }
  };
  try {
    for (const [namespace, extension] of runtimes()) if (extension.migrate) listener(namespace);
  } catch (error) { unsubscribe(); throw error; }
  return unsubscribe;
}

export function extensionCommandPatches(
  doc: EditDoc, command: ExtensionCommand, origin: string,
): CommandPatches {
  const found = runtime(command.namespace);
  if (!found) throw new Error(`编辑扩展尚未加载：${command.namespace}`);
  if ((found.scope ?? 'element') !== (command.scope === undefined ? 'element' : command.scope)) throw new Error('编辑扩展 scope 与注册不符');
  return found.command(doc, command, origin);
}

export function isExtensionPatch(patch: { path: readonly unknown[] }): patch is ExtensionPatch {
  return patch.path.length >= 5 && (patch.path[0] === 'elements' || patch.path[0] === 'slides')
    && typeof patch.path[1] === 'string' && patch.path[2] === 'ovr'
    && patch.path[3] === 'extensions' && typeof patch.path[4] === 'string';
}

export function validateExtensionPatch(
  doc: EditDoc, patch: ExtensionPatch, index: number, runtimeAlreadyValidated = false,
): void {
  const record = doc[patch.path[0]][patch.path[1]];
  if (!record) throw new Error(`Patch 指向不存在的元素：${patch.path[1]}`);
  if (patch.op !== 'set' && patch.op !== 'del') throw new Error(`Patch ${index} 的扩展操作无效`);
  assertNamespace(patch.path[4]);
  const found = runtime(patch.path[4]);
  if (found && (found.scope === 'slide' ? 'slides' : 'elements') !== patch.path[0]) throw new Error('扩展补丁 scope 与注册不符');
  const extensionPath = patch.path.slice(5);
  if (extensionPath.length > 16 || extensionPath.some((key) => typeof key !== 'string' || !key
    || key.length > 1_024
    || key === '__proto__' || key === 'prototype' || key === 'constructor')) {
    throw new Error(`Patch ${index} 的扩展路径无效`);
  }
  if (patch.op === 'set') {
    try { assertExtensionLeaf(patch.value); } catch (error) {
      throw new Error(`Patch ${index} 的扩展值无效：${error instanceof Error ? error.message : '不是纯数据'}`);
    }
  }
  if (patch.path.length === 5) throw new Error(`Patch ${index} 不能替换扩展根`);
  // 恢复与协同必须能先持久化按需扩展的稀疏补丁；扩展加载后再执行领域校验与投影。
  if (!runtimeAlreadyValidated) runtime(patch.path[4])?.validatePatch?.(doc, patch, index);
}

export function validateExtensionPatchBatches(
  doc: EditDoc,
  patches: readonly { readonly patch: ExtensionPatch; readonly index: number }[],
): ReadonlySet<number> {
  const grouped = new Map<string, Array<{ patch: ExtensionPatch; index: number }>>();
  for (const entry of patches) {
    const found = runtime(entry.patch.path[4]);
    if (!found?.validatePatches) continue;
    const group = grouped.get(entry.patch.path[4]) ?? [];
    group.push(entry);
    grouped.set(entry.patch.path[4], group);
  }
  const validated = new Set<number>();
  for (const [namespace, group] of grouped) {
    runtime(namespace)!.validatePatches!(doc, group);
    group.forEach((entry) => validated.add(entry.index));
  }
  return validated;
}

export function applyExtensionPatch(doc: EditDoc, patch: ExtensionPatch): void {
  const record = doc[patch.path[0]][patch.path[1]];
  const namespace = patch.path[4];
  if (patch.op === 'del' && !record.ovr.extensions) return;
  record.ovr.extensions ??= Object.create(null) as Record<string, unknown>;
  // 整批预检已禁止根替换；这里仅应用标量叶，批次结束后统一清理空容器。
  let state = record.ovr.extensions[namespace];
  if (state === undefined) {
    if (patch.op === 'del') return;
    state = Object.create(null) as Record<string, unknown>;
    record.ovr.extensions[namespace] = state;
  }
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new Error(`扩展 ${namespace} 的稀疏覆盖无效`);
  }
  let target = state as Record<string, unknown>;
  const parents: Record<string, unknown>[] = [];
  const keys: string[] = [];
  for (const key of patch.path.slice(5, -1)) {
    const next = target[key];
    if (!next || typeof next !== 'object' || Array.isArray(next)) {
      if (patch.op === 'del') {
        const root = record.ovr.extensions[namespace];
        if (root && !Reflect.ownKeys(root as object).length) delete record.ovr.extensions[namespace];
        if (!Reflect.ownKeys(record.ovr.extensions).length) delete record.ovr.extensions;
        return;
      }
      // 父路径标量一旦存在就确定性支配后代；反向到达时父 set 也会覆盖已建容器。
      if (next !== undefined) return;
      target[key] = Object.create(null) as Record<string, unknown>;
    }
    parents.push(target);
    keys.push(key);
    target = target[key] as Record<string, unknown>;
  }
  const leaf = patch.path[patch.path.length - 1];
  if (patch.op === 'set') target[leaf] = patch.value;
  else {
    // del 永远只作用于标量叶；缺失或容器目标统一 no-op，结果不依赖补丁到达先后。
    if (target[leaf] && typeof target[leaf] === 'object') return;
    delete target[leaf];
    for (let index = parents.length - 1; index >= 0; index--) {
      if (Reflect.ownKeys(target).length) break;
      target = parents[index];
      delete target[keys[index]];
    }
  }
}

export function finalizeExtensionPatch(doc: EditDoc, id: ElementId, namespace: string, scope: 'elements' | 'slides'): void {
  const record = doc[scope][id];
  if (!record?.ovr.extensions) return;
  const next = record.ovr.extensions[namespace];
  if (next !== undefined && (!Reflect.ownKeys(next as object).length
    || scope === 'elements' && !isLegacyExtensionReplay(doc, id, namespace) && runtime(namespace)?.prune?.(doc, id, next))) {
    delete record.ovr.extensions[namespace];
  }
  if (record.ovr.extensions && !Reflect.ownKeys(record.ovr.extensions).length) {
    delete record.ovr.extensions;
  }
  if (record.ovr.extensions?.[namespace] !== undefined && !runtime(namespace)) {
    for (const listener of listenerStore().documents.get(doc) ?? []) queueRegistrationListener(namespace, listener);
  }
}

export function projectEditExtensions(
  doc: EditDoc, id: ElementId, element: SlideElement,
): SlideElement {
  let projected = element;
  for (const extension of runtimes().values()) {
    projected = extension.projectSource?.(doc, id, projected) ?? projected;
  }
  for (const namespace of Object.keys(doc.elements[id]?.ovr.extensions ?? {}).sort()) {
    projected = runtime(namespace)?.project?.(doc, id, projected) ?? projected;
  }
  for (const namespace of Object.keys(doc.extensions ?? {}).sort()) {
    projected = runtime(namespace)?.projectDocument?.(doc, id, projected) ?? projected;
  }
  return projected;
}

export function observeDocumentExtension(doc: EditDoc, namespace: string): void {
  if (runtime(namespace)) return;
  for (const listener of listenerStore().documents.get(doc) ?? []) queueRegistrationListener(namespace, listener);
}

/** 保存实现位于动态入口；这里只暴露同一全局注册表的只读视图。 */
export function registeredEditExtensions(): ReadonlyMap<string, EditExtensionRuntime> {
  return runtimes();
}

export function projectSlideExtensions(doc: EditDoc, id: SlideId, slide: Slide): Slide {
  for (const namespace of Object.keys(doc.slides[id].ovr.extensions ?? {})) {
    slide = runtime(namespace)?.projectSlide?.(doc, id, slide) ?? slide;
  }
  return slide;
}
