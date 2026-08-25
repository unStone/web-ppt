import type { EditDoc, ElementId, SlideId } from './types';

export const MAX_TABLE_DIMENSION = 75;

export function assertTableDimension(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1 || value > MAX_TABLE_DIMENSION) {
    throw new Error(`${label} 必须是 1–${MAX_TABLE_DIMENSION} 的整数`);
  }
}

/** 命令层与公开交互层必须共享同一占位符资格规则，避免 UI 接受而模型拒绝。 */
export function isEmptyContentPlaceholder(
  doc: EditDoc,
  slideId: SlideId,
  id: unknown,
): id is ElementId {
  if (typeof id !== 'string' || !id) return false;
  const record = doc.elements[id];
  return record?.parent === slideId && record.meta.ph?.type === 'obj'
    && record.meta.editable === 'full' && !record.meta.locked && record.src.kind === 'shape'
    && (record.ovr.text?.kind === 'empty'
      || (record.ovr.text === undefined && record.src.text === null));
}
