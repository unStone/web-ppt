import { assertStroke } from '../shape-stroke';
import type { EditDoc } from '../types';
import type { ElementStrokePatch, Patch } from './types';

export function isElementStrokePatch(patch: Patch): patch is ElementStrokePatch {
  return patch.path.length === 4 && patch.path[0] === 'elements'
    && patch.path[2] === 'ovr' && patch.path[3] === 'stroke';
}

export function validateElementStrokePatch(doc: EditDoc, patch: ElementStrokePatch, index: number): void {
  const record = doc.elements[patch.path[1]];
  if (!record) throw new Error(`Patch 指向不存在的元素：${patch.path[1]}`);
  if ((record.src.kind !== 'shape' && record.src.kind !== 'image')
    || record.meta.editable !== 'full') {
    throw new Error(`Patch ${index} 指向不支持描边的元素`);
  }
  if (patch.op === 'set' && patch.value !== null) assertStroke(patch.value, `Patch ${index} 的 stroke`);
}

export function applyElementStrokePatch(doc: EditDoc, patch: ElementStrokePatch): void {
  const record = doc.elements[patch.path[1]];
  if (!record) throw new Error(`Patch 指向不存在的元素：${patch.path[1]}`);
  if (patch.op === 'set') record.ovr.stroke = structuredClone(patch.value);
  else delete record.ovr.stroke;
}
