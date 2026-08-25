import { assertVectorFill } from '../shape-fill';
import type { EditDoc } from '../types';
import type { Patch, SlideBackgroundPatch, SlideHiddenPatch, SlidePropertyPatch } from './types';

export function isSlideBackgroundPatch(patch: Patch): patch is SlideBackgroundPatch {
  return patch.path.length === 4 && patch.path[0] === 'slides'
    && patch.path[2] === 'ovr' && patch.path[3] === 'background';
}

export function isSlideHiddenPatch(patch: Patch): patch is SlideHiddenPatch {
  return patch.path.length === 4 && patch.path[0] === 'slides'
    && patch.path[2] === 'ovr' && patch.path[3] === 'hidden';
}

export function isSlidePropertyPatch(patch: Patch): patch is SlidePropertyPatch {
  return isSlideBackgroundPatch(patch) || isSlideHiddenPatch(patch);
}

export function validateSlidePropertyPatch(
  doc: EditDoc,
  patch: SlidePropertyPatch,
  index: number,
): void {
  if (!doc.slides[patch.path[1]]) throw new Error(`Patch 指向不存在的页面：${patch.path[1]}`);
  if (patch.op !== 'set' && patch.op !== 'del') {
    throw new Error(`Patch ${index} 的页面属性操作不受支持`);
  }
  if (patch.op !== 'set') return;
  if (isSlideBackgroundPatch(patch)) {
    assertVectorFill(patch.value, `Patch ${index} 的 background`);
  } else if (typeof patch.value !== 'boolean') {
    throw new Error(`Patch ${index} 的 hidden 必须是布尔值`);
  }
}

export function applySlidePropertyPatch(doc: EditDoc, patch: SlidePropertyPatch): void {
  const record = doc.slides[patch.path[1]];
  if (!record) throw new Error(`Patch 指向不存在的页面：${patch.path[1]}`);
  if (isSlideBackgroundPatch(patch)) {
    if (patch.op === 'set') record.ovr.background = structuredClone(patch.value);
    else delete record.ovr.background;
  } else if (patch.op === 'set') record.ovr.hidden = patch.value;
  else delete record.ovr.hidden;
}
