import { assertSlideSize } from '../slide-size';
import type { EditDoc } from '../types';
import type { CommandPatches, DocumentSizePatch, Patch, SetSlideSizeCommand } from './types';

export function isDocumentSizePatch(patch: Patch): patch is DocumentSizePatch {
  return patch.op === 'set' && patch.path.length === 3 && patch.path[0] === 'document'
    && patch.path[1] === 'size' && (patch.path[2] === 'w' || patch.path[2] === 'h');
}

export function validateDocumentSizePatch(patch: DocumentSizePatch, index: number): void {
  assertSlideSize(patch.value, `Patch ${index} 的页面${patch.path[2] === 'w' ? '宽度' : '高度'}`);
}

export function applyDocumentSizePatch(doc: EditDoc, patch: DocumentSizePatch): void {
  if (patch.path[2] === 'w') doc.meta.width = patch.value;
  else doc.meta.height = patch.value;
}

/** v1 只改变画布边界；元素坐标与尺寸保持不变，即 PowerPoint 的“最大化”语义。 */
export function setSlideSizePatches(
  doc: EditDoc,
  command: SetSlideSizeCommand,
  origin: string,
): CommandPatches {
  if (doc.meta.readonly) throw new Error('只读编辑文档不能修改页面尺寸');
  const desired = {
    w: command.w === null ? doc.meta.sourceWidth : command.w,
    h: command.h === null ? doc.meta.sourceHeight : command.h,
  };
  assertSlideSize(desired.w, 'SetSlideSize.w');
  assertSlideSize(desired.h, 'SetSlideSize.h');
  const forward: Patch[] = [];
  const inverse: Patch[] = [];
  for (const field of ['w', 'h'] as const) {
    const current = field === 'w' ? doc.meta.width : doc.meta.height;
    if (current === desired[field]) continue;
    const path = ['document', 'size', field] as const;
    forward.push({ op: 'set', path, value: desired[field], origin });
    inverse.unshift({ op: 'set', path, value: current, origin });
  }
  return { forward, inverse };
}
