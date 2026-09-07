import { assertDataObject } from '../data-validation';
import { assertVectorFill } from '../shape-fill';
import { assertStoredSlideTransition } from '../slide-transition';
import type { EditDoc } from '../types';
import type {
  LayoutBackgroundPatch, LayoutPropertyPatch, LayoutTransitionPatch, Patch,
} from './types';

export function isLayoutBackgroundPatch(patch: Patch): patch is LayoutBackgroundPatch {
  return patch.path.length === 4 && patch.path[0] === 'layouts'
    && patch.path[2] === 'ovr' && patch.path[3] === 'background';
}

export function isLayoutTransitionPatch(patch: Patch): patch is LayoutTransitionPatch {
  return patch.path.length === 4 && patch.path[0] === 'layouts'
    && patch.path[2] === 'ovr' && patch.path[3] === 'transition';
}

export function isLayoutPropertyPatch(patch: Patch): patch is LayoutPropertyPatch {
  return isLayoutBackgroundPatch(patch) || isLayoutTransitionPatch(patch);
}

export function validateLayoutPropertyPatch(
  doc: EditDoc,
  patch: LayoutPropertyPatch,
  index: number,
): void {
  if (!doc.layouts[patch.path[1]]) throw new Error(`Patch 指向不存在的版式：${patch.path[1]}`);
  if (patch.op !== 'set' && patch.op !== 'del') {
    throw new Error(`Patch ${index} 的版式属性操作不受支持`);
  }
  assertDataObject(
    patch,
    patch.op === 'set' ? ['op', 'path', 'value', 'origin'] : ['op', 'path', 'origin'],
    `Patch ${index}`,
  );
  if (patch.op !== 'set') return;
  if (isLayoutBackgroundPatch(patch)) assertVectorFill(patch.value, `Patch ${index} 的版式背景`);
  else assertStoredSlideTransition(patch.value, `Patch ${index} 的版式切换`);
}

export { applyRecordOverridePatch as applyLayoutPropertyPatch } from './record-override';
