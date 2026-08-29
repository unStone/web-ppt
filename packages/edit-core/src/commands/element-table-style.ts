import { assertTableStyleSettings } from '../table-style';
import type { EditDoc } from '../types';
import type { ElementTableStylePatch, Patch } from './types';

export function isElementTableStylePatch(patch: Patch): patch is ElementTableStylePatch {
  return patch.path.length === 4 && patch.path[0] === 'elements'
    && patch.path[2] === 'ovr' && patch.path[3] === 'tableStyle';
}

export function validateElementTableStylePatch(
  doc: EditDoc,
  patch: ElementTableStylePatch,
  index: number,
): void {
  const record = doc.elements[patch.path[1]];
  if (!record || record.src.kind !== 'table' || record.meta.editable !== 'full') {
    throw new Error(`Patch ${index} 指向不可编辑表格`);
  }
  if (patch.op === 'set') assertTableStyleSettings(doc, record.id, patch.value, `Patch ${index} 的 tableStyle`);
}

export function applyElementTableStylePatch(doc: EditDoc, patch: ElementTableStylePatch): void {
  const record = doc.elements[patch.path[1]];
  if (!record) throw new Error(`Patch 指向不存在的元素：${patch.path[1]}`);
  if (patch.op === 'set') record.ovr.tableStyle = structuredClone(patch.value);
  else delete record.ovr.tableStyle;
}
