import type { EditDoc, ElementRecord, SlideTreePatch } from '@web-ppt/edit-core';

/** 远端删页必须以接收端当前整页闭包落模，否则并发新增元素会变成孤儿。 */
export function rebaseSlideRemoval(doc: EditDoc, patch: SlideTreePatch): SlideTreePatch | null {
  if (patch.op !== 'remove') return patch;
  const slide = doc.slides[patch.path[1]];
  if (!slide) return null;
  const records: Record<string, ElementRecord> = Object.create(null);
  const visit = (id: string): void => {
    const record = doc.elements[id];
    if (!record) throw new Error(`协同删页找不到当前元素：${id}`);
    records[id] = structuredClone(record);
    for (const child of record.children ?? []) visit(child);
  };
  for (const child of slide.children) visit(child);
  const index = doc.slideOrder.indexOf(slide.id);
  if (index < 0) throw new Error(`协同删页找不到当前页序：${slide.id}`);
  return {
    ...patch,
    value: {
      slide: structuredClone(slide),
      after: doc.slideOrder[index - 1] ?? null,
      before: doc.slideOrder[index + 1] ?? null,
      records,
    },
  };
}
