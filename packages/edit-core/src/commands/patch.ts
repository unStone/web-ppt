import { invalidateElement, invalidateElementStructure } from '../projection';
import type { EditDoc, ProjectionInvalidation } from '../types';
import { applyElementTransformPatch } from './element-transform';
import { applyElementTreePatch, isElementTreePatch, validateElementTreePatch } from './element-tree';
import { applyElementTextPatch, isElementTextPatch, validateElementTextPatch } from './element-text';
import type { ElementTransformPatch, ElementTreePatch, Patch, XfrmField } from './types';
import { assertXfrmValue, XFRM_FIELD_SET } from './xfrm';

function validatePatch(doc: EditDoc, input: Patch, index: number): void {
  const patch = input as Partial<Patch> & { path?: unknown; value?: unknown };
  if (!['set', 'del', 'remove', 'insert'].includes(String(patch.op))) {
    throw new Error(`Patch ${index} 的 op 不受支持`);
  }
  if (typeof patch.origin !== 'string' || !patch.origin) throw new Error(`Patch ${index} 缺少 origin`);
  if (Array.isArray(patch.path) && patch.path.length === 2
    && patch.path[0] === 'elements' && typeof patch.path[1] === 'string'
    && (patch.op === 'remove' || patch.op === 'insert')) {
    validateElementTreePatch(doc, patch as ElementTreePatch, index);
    return;
  }
  if (Array.isArray(patch.path) && patch.path.length === 4 && patch.path[3] === 'text'
    && (patch.op === 'set' || patch.op === 'del')) {
    validateElementTextPatch(doc, patch as import('./types').ElementTextPatch, index);
    return;
  }
  if (!Array.isArray(patch.path) || patch.path.length !== 4
    || patch.path[0] !== 'elements' || typeof patch.path[1] !== 'string'
    || patch.path[2] !== 'ovr' || !XFRM_FIELD_SET.has(patch.path[3] as XfrmField)) {
    throw new Error(`Patch ${index} 的路径不受支持`);
  }
  const id = patch.path[1];
  const field = patch.path[3] as XfrmField;
  if (!doc.elements[id]) throw new Error(`Patch 指向不存在的元素：${id}`);
  if (patch.op === 'set') {
    assertXfrmValue(field, patch.value, `Patch ${index} 的 ${field}`);
  }
}

function validatePatchRelations(patches: readonly Patch[]): void {
  const owner = new Map<string, number>();
  patches.forEach((patch, index) => {
    if (!isElementTreePatch(patch)) return;
    for (const id of Object.keys(patch.value.records)) {
      const previous = owner.get(id);
      if (previous !== undefined) {
        throw new Error(`Patch ${index} 与 Patch ${previous} 的元素树重叠：${id}`);
      }
      owner.set(id, index);
    }
  });
  patches.forEach((patch, index) => {
    if (isElementTreePatch(patch)) return;
    const tree = owner.get(patch.path[1]);
    if (tree !== undefined) {
      throw new Error(`Patch ${index} 与 Patch ${tree} 同时修改将被移除的元素：${patch.path[1]}`);
    }
  });
}

export function applyPatches(doc: EditDoc, patches: readonly Patch[]): ProjectionInvalidation {
  validatePatchRelations(patches);
  patches.forEach((patch, index) => validatePatch(doc, patch, index));
  const dirtyElements = new Set<string>();
  const dirtySlides = new Set<string>();
  // 失效可能因外部破坏的父链而失败；先完成它，保证失败时还没有任何 patch 落到模型。
  for (const patch of patches) {
    const dirty = isElementTreePatch(patch)
      ? invalidateElementStructure(doc, Object.keys(patch.value.records), patch.value.parent)
      : invalidateElement(doc, patch.path[1]);
    for (const elementId of dirty.dirtyElements) dirtyElements.add(elementId);
    for (const slideId of dirty.dirtySlides) dirtySlides.add(slideId);
  }
  for (const patch of patches) {
    if (isElementTreePatch(patch)) applyElementTreePatch(doc, patch);
    else if (isElementTextPatch(patch)) applyElementTextPatch(doc, patch);
    else applyElementTransformPatch(doc, patch as ElementTransformPatch);
  }
  return { dirtyElements, dirtySlides };
}
