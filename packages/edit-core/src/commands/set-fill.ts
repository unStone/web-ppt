import { own } from '../data-validation';
import { assertVectorFill, normalizeVectorFill } from '../shape-fill';
import type { EditDoc } from '../types';
import type { CommandPatches, ElementFillPatch, SetFillCommand } from './types';

export function setFillPatches(
  doc: EditDoc,
  command: SetFillCommand,
  origin: string,
): CommandPatches {
  if (doc.meta.readonly) throw new Error('只读编辑文档不能修改填充');
  const record = doc.elements[command.id];
  if (!record) throw new Error(`找不到元素：${command.id}`);
  if (record.src.kind !== 'shape' || record.meta.editable !== 'full') {
    throw new Error(`元素不支持填充：${command.id}`);
  }
  if (record.meta.locked) throw new Error(`元素已锁定：${command.id}`);
  if (command.fill !== null) assertVectorFill(command.fill, 'SetFill.fill');
  const value = command.fill === null ? null : normalizeVectorFill(command.fill);
  const path = ['elements', command.id, 'ovr', 'fill'] as const;
  const hadOverride = own(record.ovr, 'fill');
  if (command.fill === null) {
    if (!hadOverride) return { forward: [], inverse: [] };
    return {
      forward: [{ op: 'del', path, origin }],
      inverse: [{ op: 'set', path, value: structuredClone(record.ovr.fill!), origin }],
    };
  }
  const before = hadOverride ? record.ovr.fill : record.src.fill;
  if (JSON.stringify(before) === JSON.stringify(value)) return { forward: [], inverse: [] };
  const forward: ElementFillPatch = {
    op: 'set', path, value: structuredClone(value!), origin,
  };
  const inverse: ElementFillPatch = hadOverride
    ? { op: 'set', path, value: structuredClone(record.ovr.fill!), origin }
    : { op: 'del', path, origin };
  return { forward: [forward], inverse: [inverse] };
}
