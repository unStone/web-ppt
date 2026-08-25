import type { EditDoc, ElementId, ElementRecord } from '../types';
import type { CommandPatches, RemoveSlideCommand, SlideTreePatch, SlideTreeSnapshot } from './types';

function snapshotSlide(doc: EditDoc, id: string): SlideTreeSnapshot {
  const slide = doc.slides[id];
  if (!slide) throw new Error(`找不到页面：${id}`);
  const index = doc.slideOrder.indexOf(id);
  if (index < 0) throw new Error(`页面不在 slideOrder 中：${id}`);
  const records: Record<ElementId, ElementRecord> = Object.create(null);
  const visit = (elementId: ElementId): void => {
    const record = doc.elements[elementId];
    if (!record) throw new Error(`页面 ${id} 引用了不存在的元素：${elementId}`);
    records[elementId] = structuredClone(record);
    for (const child of record.children ?? []) visit(child);
  };
  for (const child of slide.children) visit(child);
  return {
    slide: structuredClone(slide), records,
    after: doc.slideOrder[index - 1] ?? null,
    before: doc.slideOrder[index + 1] ?? null,
  };
}

export function removeSlidePatches(
  doc: EditDoc,
  command: RemoveSlideCommand,
  origin: string,
): CommandPatches {
  if (doc.meta.readonly) throw new Error('只读编辑文档不能删除页面');
  if (typeof command.id !== 'string' || !doc.slides[command.id]) {
    throw new Error(`找不到页面：${String(command.id)}`);
  }
  if (doc.slideOrder.length <= 1) throw new Error('演示文稿必须至少保留一页');
  const value = snapshotSlide(doc, command.id);
  const path = ['slides', command.id] as const;
  const forward: SlideTreePatch = { op: 'remove', path, value, origin };
  const inverse: SlideTreePatch = { op: 'insert', path, value, origin };
  return { forward: [forward], inverse: [inverse] };
}
