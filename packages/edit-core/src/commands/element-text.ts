import type { EditDoc } from '../types';
import { validateFlatTextOverride } from '../text-override-validation';
import type { CommandPatches, ElementTextPatch, Patch } from './types';

const own = (object: object, key: PropertyKey): boolean => Object.prototype.hasOwnProperty.call(object, key);

export function isElementTextPatch(patch: Patch): patch is ElementTextPatch {
  return patch.path.length === 4 && patch.path[3] === 'text';
}

export function clearElementTextPatches(doc: EditDoc, id: string, origin: string): CommandPatches {
  const record = doc.elements[id];
  if (!record || record.src.kind !== 'shape') throw new Error(`找不到可清空文本的形状：${id}`);
  const path = ['elements', id, 'ovr', 'text'] as const;
  const before = record.ovr.text;
  if (before?.kind === 'empty') return { forward: [], inverse: [] };
  return {
    forward: [{ op: 'set', path, value: { kind: 'empty' }, origin }],
    inverse: [own(record.ovr, 'text') && before
      ? { op: 'set', path, value: before, origin }
      : { op: 'del', path, origin }],
  };
}

export function validateElementTextPatch(doc: EditDoc, patch: ElementTextPatch, index: number): void {
  const record = doc.elements[patch.path[1]];
  if (!record || record.src.kind !== 'shape') throw new Error(`Patch ${index} 指向非文本形状`);
  if (record.meta.editable !== 'full') throw new Error(`Patch ${index} 指向不可编辑文本`);
  if (patch.op === 'set') {
    if (patch.value.kind === 'flat') validateFlatTextOverride(patch.value);
    else if (patch.value.kind !== 'empty') throw new Error(`Patch ${index} 的文本覆盖无效`);
  }
}

export function applyElementTextPatch(doc: EditDoc, patch: ElementTextPatch): void {
  const record = doc.elements[patch.path[1]];
  if (!record) throw new Error(`Patch 指向不存在的元素：${patch.path[1]}`);
  if (patch.op === 'set') record.ovr.text = { ...patch.value };
  else delete record.ovr.text;
}
