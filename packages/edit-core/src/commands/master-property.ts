import { assertDataObject } from '../data-validation';
import { assertVectorFill } from '../shape-fill';
import type { EditDoc } from '../types';
import type { MasterBackgroundPatch, Patch } from './types';

export function isMasterBackgroundPatch(patch: Patch): patch is MasterBackgroundPatch {
  return patch.path.length === 4 && patch.path[0] === 'masters'
    && patch.path[2] === 'ovr' && patch.path[3] === 'background';
}

export function validateMasterBackgroundPatch(
  doc: EditDoc,
  patch: MasterBackgroundPatch,
  index: number,
): void {
  if (!doc.masters[patch.path[1]]) throw new Error(`Patch 指向不存在的母版：${patch.path[1]}`);
  assertDataObject(
    patch,
    patch.op === 'set' ? ['op', 'path', 'value', 'origin'] : ['op', 'path', 'origin'],
    `Patch ${index}`,
  );
  if (patch.op === 'set') assertVectorFill(patch.value, `Patch ${index} 的母版背景`);
}

export function applyMasterBackgroundPatch(doc: EditDoc, patch: MasterBackgroundPatch): void {
  const record = doc.masters[patch.path[1]];
  if (!record) throw new Error(`Patch 指向不存在的母版：${patch.path[1]}`);
  if (patch.op === 'set') record.ovr.background = structuredClone(patch.value);
  else delete record.ovr.background;
}
