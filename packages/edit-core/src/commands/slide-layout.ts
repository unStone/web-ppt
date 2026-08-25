import { assertDataObject, own } from '../data-validation';
import type { EditDoc } from '../types';
import type { CommandPatches, SetLayoutCommand, SlideLayoutPatch } from './types';

export function isSlideLayoutPatch(patch: { readonly path: readonly unknown[] }): patch is SlideLayoutPatch {
  return patch.path.length === 3 && patch.path[0] === 'slides' && patch.path[2] === 'layoutId';
}

export function validateSlideLayoutPatch(
  doc: EditDoc,
  patch: SlideLayoutPatch,
  index: number,
): void {
  assertDataObject(
    patch,
    patch.op === 'set' ? ['op', 'path', 'value', 'origin'] : ['op', 'path', 'origin'],
    `Patch ${index}`,
  );
  const id = patch.path[1];
  if (!own(doc.slides, id)) throw new Error(`版式 Patch 指向不存在的幻灯片：${id}`);
  if (patch.op === 'set' && !doc.layoutOrder.includes(patch.value)) {
    throw new Error(`版式 Patch 指向不存在的版式：${patch.value}`);
  }
}

export function applySlideLayoutPatch(doc: EditDoc, patch: SlideLayoutPatch): void {
  if (patch.op === 'set') doc.slides[patch.path[1]].layoutId = patch.value;
  else delete doc.slides[patch.path[1]].layoutId;
}

export function setLayoutPatches(
  doc: EditDoc,
  command: SetLayoutCommand,
  origin: string,
): CommandPatches {
  if (doc.meta.readonly || doc.meta.source !== 'pptx' || !doc.package) {
    throw new Error('只读或非 OOXML 编辑文档不能切换版式');
  }
  if (!own(doc.slides, command.id)) throw new Error(`找不到幻灯片：${String(command.id)}`);
  const slide = doc.slides[command.id];
  if (typeof command.layoutId !== 'string' || !command.layoutId) {
    throw new Error('SetLayout.layoutId 必须是非空字符串');
  }
  if (!doc.layoutOrder.includes(command.layoutId)) throw new Error(`找不到版式：${command.layoutId}`);
  if (slide.layoutId === command.layoutId) return { forward: [], inverse: [] };
  const path = ['slides', command.id, 'layoutId'] as const;
  const forward: SlideLayoutPatch = { op: 'set', path, value: command.layoutId, origin };
  const inverse: SlideLayoutPatch = slide.layoutId
    ? { op: 'set', path, value: slide.layoutId, origin }
    : { op: 'del', path, origin };
  return { forward: [forward], inverse: [inverse] };
}
