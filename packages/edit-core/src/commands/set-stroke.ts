import type { Stroke } from '@web-ppt/core';
import { assertDataObject, own } from '../data-validation';
import { assertStroke, normalizeStroke } from '../shape-stroke';
import type { EditDoc } from '../types';
import type { CommandPatches, ElementStrokePatch, SetStrokeCommand } from './types';

export function setStrokePatches(
  doc: EditDoc,
  command: SetStrokeCommand,
  origin: string,
): CommandPatches {
  if (doc.meta.readonly) throw new Error('只读编辑文档不能修改描边');
  const record = doc.elements[command.id];
  if (!record) throw new Error(`找不到元素：${command.id}`);
  if ((record.src.kind !== 'shape' && record.src.kind !== 'image')
    || record.meta.editable !== 'full') {
    throw new Error(`元素不支持描边：${command.id}`);
  }
  if (record.meta.locked) throw new Error(`元素已锁定：${command.id}`);
  const reset = command.stroke === null;
  let candidate: Stroke | null = command.stroke as Stroke | null;
  if (!reset && command.stroke && typeof command.stroke === 'object' && 'type' in command.stroke) {
    assertDataObject(command.stroke, ['type'], 'SetStroke.stroke');
    if (command.stroke.type !== 'none') throw new Error('SetStroke.stroke.type 只支持 none');
    candidate = null;
  }
  if (!reset && candidate !== null) assertStroke(candidate, 'SetStroke.stroke');
  const value = candidate === null ? null : normalizeStroke(candidate);
  const path = ['elements', command.id, 'ovr', 'stroke'] as const;
  const hadOverride = own(record.ovr, 'stroke');
  if (reset) {
    if (!hadOverride) return { forward: [], inverse: [] };
    return {
      forward: [{ op: 'del', path, origin }],
      inverse: [{ op: 'set', path, value: structuredClone(record.ovr.stroke ?? null), origin }],
    };
  }
  const rawBefore = hadOverride ? record.ovr.stroke ?? null : record.src.stroke ?? null;
  const before = rawBefore === null ? null : normalizeStroke(rawBefore);
  if (JSON.stringify(before) === JSON.stringify(value)) return { forward: [], inverse: [] };
  const forward: ElementStrokePatch = {
    op: 'set', path, value: structuredClone(value), origin,
  };
  const inverse: ElementStrokePatch = hadOverride
    ? { op: 'set', path, value: structuredClone(record.ovr.stroke ?? null), origin }
    : { op: 'del', path, origin };
  return { forward: [forward], inverse: [inverse] };
}
