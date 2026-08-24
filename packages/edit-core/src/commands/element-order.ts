import { elementOrder, elementParentChildren, sortElementChildrenByOrder } from '../element-order';
import { assertFractionalIndex } from '../fractional-index';
import type { EditDoc, ElementId } from '../types';
import type { ElementOrderPatch, Patch } from './types';

export function isElementOrderPatch(patch: Patch): patch is ElementOrderPatch {
  return Array.isArray(patch.path) && patch.path.length === 3
    && patch.path[0] === 'elements' && typeof patch.path[1] === 'string'
    && patch.path[2] === 'order' && (patch.op === 'set' || patch.op === 'del');
}

export function validateElementOrderPatch(doc: EditDoc, patch: ElementOrderPatch, index: number): void {
  const id = patch.path[1];
  const record = doc.elements[id];
  if (!record) throw new Error(`Patch 指向不存在的元素：${id}`);
  const value = patch.op === 'set' ? patch.value : record.z;
  if (typeof value !== 'string') throw new Error(`Patch ${index} 的层级值必须是字符串`);
  assertFractionalIndex(value);
}

export function validateElementOrderPatchSet(doc: EditDoc, patches: readonly Patch[]): void {
  const values = new Map<ElementId, string>();
  const parents = new Set<string>();
  for (const patch of patches) {
    if (!isElementOrderPatch(patch)) continue;
    const id = patch.path[1];
    const record = doc.elements[id];
    if (!record) throw new Error(`Patch 指向不存在的元素：${id}`);
    values.set(id, patch.op === 'set' ? patch.value : record.z);
    parents.add(record.parent);
  }
  for (const parent of parents) {
    const owners = new Map<string, ElementId>();
    for (const id of elementParentChildren(doc, parent)) {
      const record = doc.elements[id];
      if (!record) throw new Error(`父节点 children 引用了不存在的元素：${id}`);
      const value = values.get(id) ?? elementOrder(record);
      const previous = owners.get(value);
      if (previous) throw new Error(`元素 ${id} 与 ${previous} 的层级值冲突`);
      owners.set(value, id);
    }
  }
}

export function applyElementOrderValue(doc: EditDoc, patch: ElementOrderPatch): string {
  const record = doc.elements[patch.path[1]];
  if (!record) throw new Error(`Patch 指向不存在的元素：${patch.path[1]}`);
  if (patch.op === 'set') record.order = patch.value;
  else delete record.order;
  return record.parent;
}

export function applyElementOrderPatch(doc: EditDoc, patch: ElementOrderPatch): void {
  sortElementChildrenByOrder(doc, applyElementOrderValue(doc, patch));
}
