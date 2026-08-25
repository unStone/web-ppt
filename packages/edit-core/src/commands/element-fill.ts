import { assertVectorFill } from '../shape-fill';
import type { EditDoc } from '../types';
import type { ElementFillPatch, Patch } from './types';

export function isElementFillPatch(patch: Patch): patch is ElementFillPatch {
  return patch.path.length === 4 && patch.path[0] === 'elements'
    && patch.path[2] === 'ovr' && patch.path[3] === 'fill';
}

export function validateElementFillPatch(doc: EditDoc, patch: ElementFillPatch, index: number): void {
  const record = doc.elements[patch.path[1]];
  if (!record) throw new Error(`Patch 指向不存在的元素：${patch.path[1]}`);
  if (record.src.kind !== 'shape' || record.meta.editable !== 'full') {
    throw new Error(`Patch ${index} 指向不支持填充的元素`);
  }
  if (patch.op === 'set') assertVectorFill(patch.value, `Patch ${index} 的 fill`);
}

export function applyElementFillPatch(doc: EditDoc, patch: ElementFillPatch): void {
  const record = doc.elements[patch.path[1]];
  if (!record) throw new Error(`Patch 指向不存在的元素：${patch.path[1]}`);
  if (patch.op === 'set') record.ovr.fill = structuredClone(patch.value);
  else delete record.ovr.fill;
}
