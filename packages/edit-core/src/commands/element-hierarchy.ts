import { slideOfElement } from '../projection';
import { hasDynamicSlideLink, hasDynamicSlideNumber } from '../dynamic-slide-fields';
import type { EditDoc, ElementId, ElementRecord, RemovedElementRecord } from '../types';
import type { ElementHierarchyPatch, ElementHierarchyState, Patch } from './types';

const cloneRecord = <T>(value: T): T => structuredClone(value);

export function isElementHierarchyPatch(patch: Patch): patch is ElementHierarchyPatch {
  return patch.path.length === 3 && patch.path[0] === 'elements' && patch.path[2] === 'hierarchy';
}

function assertRecordMap(
  records: ElementHierarchyState['records'], label: string,
): void {
  if (!records || typeof records !== 'object') throw new Error(`${label} 的元素记录无效`);
  for (const [id, record] of Object.entries(records)) {
    if (!id || (record !== null && record.id !== id)) throw new Error(`${label} 的元素记录身份无效：${id}`);
  }
}

function assertRemovedMap(
  removed: ElementHierarchyState['removed'], label: string,
): void {
  if (!removed || typeof removed !== 'object') throw new Error(`${label} 的删除记录无效`);
  for (const [id, record] of Object.entries(removed)) {
    if (!id || (record !== null && record.id !== id)) throw new Error(`${label} 的删除记录身份无效：${id}`);
  }
}

export function validateElementHierarchyPatch(
  doc: EditDoc, patch: ElementHierarchyPatch, index: number,
): void {
  const label = `Patch ${index}`;
  const state = patch.value;
  if (!state || typeof state !== 'object' || typeof state.parent !== 'string' || !state.parent
    || !Array.isArray(state.affected) || !state.affected.length
    || state.affected.some((id) => typeof id !== 'string' || !id)
    || new Set(state.affected).size !== state.affected.length) {
    throw new Error(`${label} 的元素层级状态无效`);
  }
  assertRecordMap(state.records, label);
  assertRemovedMap(state.removed, label);
  if (!doc.slides[state.parent] && !doc.elements[state.parent]
    && !state.records[state.parent]) throw new Error(`${label} 的外部父级不存在`);
  if (!state.children || typeof state.children !== 'object') throw new Error(`${label} 的 children 状态无效`);
  for (const [parent, children] of Object.entries(state.children)) {
    if (!parent || !Array.isArray(children) || new Set(children).size !== children.length
      || children.some((id) => typeof id !== 'string' || !id)) {
      throw new Error(`${label} 的父级 children 无效：${parent}`);
    }
  }
}

export function applyElementHierarchyPatch(doc: EditDoc, patch: ElementHierarchyPatch): void {
  const slide = doc.slides[elementHierarchySlide(doc, patch.value)];
  const before = new Map(Object.keys(patch.value.records).flatMap((id) =>
    doc.elements[id] ? [[id, doc.elements[id]] as const] : []));
  for (const [id, record] of Object.entries(patch.value.records)) {
    if (record === null) delete doc.elements[id];
    else {
      doc.elements[id] = cloneRecord(record as ElementRecord);
      const anchor = record.meta.origin;
      const next = anchor && doc.identity.nextSpid[anchor.part];
      // 远端层级 Patch 也可能携带新组；分配水位必须越过它，避免下一次本地组合撞 spid。
      if (anchor && next !== undefined && next <= anchor.spid) {
        doc.identity.nextSpid[anchor.part] = anchor.spid + 1;
      }
    }
  }
  for (const [parent, children] of Object.entries(patch.value.children)) {
    if (doc.slides[parent]) doc.slides[parent].children = [...children];
    else {
      const record = doc.elements[parent];
      if (!record || record.src.kind !== 'group') throw new Error(`层级 Patch 的父级不是组合：${parent}`);
      record.children = [...children];
    }
  }
  for (const [id, record] of Object.entries(patch.value.removed)) {
    if (record === null) delete doc.removedElements[id];
    else doc.removedElements[id] = cloneRecord(record as RemovedElementRecord);
  }
  const refreshIndex = (
    key: 'dynamicSlideNumbers' | 'dynamicSlideLinks',
    predicate: (record: ElementRecord) => boolean,
  ): void => {
    const affected = new Set(patch.value.affected);
    const retained = slide[key].filter((id) => !affected.has(id));
    for (const id of patch.value.affected) {
      const record = doc.elements[id];
      if (record && predicate(record)) retained.push(id);
    }
    slide[key] = retained;
  };
  if ([...before.values(), ...patch.value.affected.flatMap((id) => doc.elements[id] ?? [])]
    .some((record) => hasDynamicSlideNumber(record.src))) {
    refreshIndex('dynamicSlideNumbers', (record) => hasDynamicSlideNumber(record.src));
  }
  if ([...before.values(), ...patch.value.affected.flatMap((id) => doc.elements[id] ?? [])]
    .some((record) => hasDynamicSlideLink(record.src))) {
    refreshIndex('dynamicSlideLinks', (record) => hasDynamicSlideLink(record.src));
  }
}

export function elementHierarchySlide(doc: EditDoc, state: ElementHierarchyState): string {
  return doc.slides[state.parent] ? state.parent : slideOfElement(doc, state.parent as ElementId);
}
