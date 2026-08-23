import { invalidateElement } from '../projection';
import type { EditDoc, ProjectionInvalidation } from '../types';
import { applyElementTransformPatch } from './element-transform';
import type { Patch, XfrmField } from './types';
import { assertXfrmValue, XFRM_FIELD_SET } from './xfrm';

function validatePatch(doc: EditDoc, input: Patch, index: number): void {
  const patch = input as Partial<Patch> & { path?: unknown; value?: unknown };
  if (patch.op !== 'set' && patch.op !== 'del') throw new Error(`Patch ${index} 的 op 不受支持`);
  if (typeof patch.origin !== 'string' || !patch.origin) throw new Error(`Patch ${index} 缺少 origin`);
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

export function applyPatches(doc: EditDoc, patches: readonly Patch[]): ProjectionInvalidation {
  patches.forEach((patch, index) => validatePatch(doc, patch, index));
  const dirtyElements = new Set<string>();
  const dirtySlides = new Set<string>();
  const touched = new Set(patches.map((patch) => patch.path[1]));
  // 失效可能因外部破坏的父链而失败；先完成它，保证失败时还没有任何 patch 落到模型。
  for (const id of touched) {
    const dirty = invalidateElement(doc, id);
    for (const elementId of dirty.dirtyElements) dirtyElements.add(elementId);
    for (const slideId of dirty.dirtySlides) dirtySlides.add(slideId);
  }
  for (const patch of patches) applyElementTransformPatch(doc, patch);
  return { dirtyElements, dirtySlides };
}
