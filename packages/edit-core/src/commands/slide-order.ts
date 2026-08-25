import { assertDataObject, own } from '../data-validation';
import type { EditDoc, SlideId } from '../types';
import type { CommandPatches, MoveSlideCommand, Patch, SlideOrderPatch } from './types';

export function isSlideOrderPatch(patch: Patch): patch is SlideOrderPatch {
  return patch.op === 'move' && patch.path.length === 2
    && patch.path[0] === 'slideOrder' && typeof patch.path[1] === 'string';
}

function assertAfter(doc: EditDoc, id: SlideId, after: unknown, label: string): asserts after is SlideId | null {
  if (after !== null && (typeof after !== 'string' || !doc.slides[after])) {
    throw new Error(`${label} 指向不存在的页面：${String(after)}`);
  }
  if (after === id) throw new Error(`${label} 不能指向待移动页面自身`);
}

export function validateSlideOrderPatch(doc: EditDoc, patch: SlideOrderPatch, index: number): void {
  const id = patch.path[1];
  if (!doc.slides[id] || !doc.slideOrder.includes(id)) {
    throw new Error(`Patch ${index} 移动的页面不存在：${id}`);
  }
  if (!patch.value || typeof patch.value !== 'object' || !own(patch.value, 'after')
    || Reflect.ownKeys(patch.value).some((key) => key !== 'after')) {
    throw new Error(`Patch ${index} 的页面锚点无效`);
  }
  assertAfter(doc, id, patch.value.after, `Patch ${index} 的页面锚点`);
}

export function slideOrderPatchStart(doc: EditDoc, patch: SlideOrderPatch): number {
  const current = doc.slideOrder.indexOf(patch.path[1]);
  const anchor = patch.value.after === null ? 0 : doc.slideOrder.indexOf(patch.value.after) + 1;
  return Math.max(0, Math.min(current, anchor));
}

export function applySlideOrderPatch(doc: EditDoc, patch: SlideOrderPatch): void {
  const id = patch.path[1];
  const current = doc.slideOrder.indexOf(id);
  if (current < 0) throw new Error(`待移动页面不在 slideOrder 中：${id}`);
  doc.slideOrder.splice(current, 1);
  const index = patch.value.after === null ? 0 : doc.slideOrder.indexOf(patch.value.after) + 1;
  if (index < 0) throw new Error(`页面锚点不在 slideOrder 中：${String(patch.value.after)}`);
  doc.slideOrder.splice(index, 0, id);
}

export function moveSlidePatches(doc: EditDoc, command: MoveSlideCommand, origin: string): CommandPatches {
  if (doc.meta.readonly) throw new Error('只读编辑文档不能移动页面');
  if (typeof command.id !== 'string' || !doc.slides[command.id]) {
    throw new Error(`找不到页面：${String(command.id)}`);
  }
  assertDataObject(command.at, ['after'], 'MoveSlide.at');
  if (!own(command.at, 'after')) throw new Error('MoveSlide.at.after 必须存在');
  assertAfter(doc, command.id, command.at.after, 'MoveSlide.at.after');
  const current = doc.slideOrder.indexOf(command.id);
  const previous = current > 0 ? doc.slideOrder[current - 1] : null;
  if (previous === command.at.after) return { forward: [], inverse: [] };
  const path = ['slideOrder', command.id] as const;
  return {
    forward: [{ op: 'move', path, value: { after: command.at.after }, origin }],
    inverse: [{ op: 'move', path, value: { after: previous }, origin }],
  };
}
