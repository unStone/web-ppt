import { assertEffects } from '../shape-effects';
import type { EditDoc } from '../types';
import type { ElementEffectsPatch, Patch } from './types';

export function isElementEffectsPatch(patch: Patch): patch is ElementEffectsPatch {
  return patch.path.length === 4 && patch.path[0] === 'elements'
    && patch.path[2] === 'ovr' && patch.path[3] === 'effects';
}

export function validateElementEffectsPatch(doc: EditDoc, patch: ElementEffectsPatch, index: number): void {
  const record = doc.elements[patch.path[1]];
  if (!record) throw new Error(`Patch 指向不存在的元素：${patch.path[1]}`);
  if (!['shape', 'image', 'group'].includes(record.src.kind) || record.meta.editable !== 'full') {
    throw new Error(`Patch ${index} 指向不支持二维效果的元素`);
  }
  if (patch.op === 'set') assertEffects(patch.value, `Patch ${index} 的 effects`);
}

export function applyElementEffectsPatch(doc: EditDoc, patch: ElementEffectsPatch): void {
  const record = doc.elements[patch.path[1]];
  if (!record) throw new Error(`Patch 指向不存在的元素：${patch.path[1]}`);
  if (patch.op === 'set') record.ovr.effects = structuredClone(patch.value);
  else delete record.ovr.effects;
}
