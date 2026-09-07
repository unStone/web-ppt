import { assertSlideSize } from '../slide-size';
import { extensionCommandPatches } from '../extension-runtime';
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

/** 画布与内容变化属于同一历史事务；按需策略只负责产出内容补丁。 */
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
  if (command.fit !== undefined && command.fit !== 'none' && command.fit !== 'ensureFit') {
    throw new Error('SetSlideSize.fit 必须是 none 或 ensureFit');
  }
  const forward: Patch[] = [];
  const inverse: Patch[] = [];
  for (const field of ['w', 'h'] as const) {
    const current = field === 'w' ? doc.meta.width : doc.meta.height;
    if (current === desired[field]) continue;
    const path = ['document', 'size', field] as const;
    forward.push({ op: 'set', path, value: desired[field], origin });
    inverse.unshift({ op: 'set', path, value: current, origin });
  }
  if (forward.length && command.fit === 'ensureFit') {
    const content = extensionCommandPatches(doc, { type: 'Extension', namespace: 'resize', id: '', payload: desired }, origin);
    forward.push(...content.forward);
    inverse.unshift(...content.inverse);
  }
  return { forward, inverse };
}
