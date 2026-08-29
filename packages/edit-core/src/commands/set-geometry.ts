import { own } from '../data-validation';
import { assertCustomGeometryOverride } from '../custom-geometry';
import type { EditDoc } from '../types';
import type { CommandPatches } from './types';
import type { ElementGeometryPatch, SetGeometryCommand } from './geometry-types';

export function setGeometryPatches(
  doc: EditDoc,
  command: SetGeometryCommand,
  origin: string,
): CommandPatches {
  if (doc.meta.readonly) throw new Error('只读编辑文档不能修改顶点');
  const record = doc.elements[command.id];
  if (!record) throw new Error(`找不到元素：${command.id}`);
  if (record.src.kind !== 'shape' || record.meta.editable !== 'full') {
    throw new Error(`元素不支持顶点编辑：${command.id}`);
  }
  if (!record.meta.customGeometry && !own(record.ovr, 'geometry')) {
    throw new Error(`预设形状必须先显式转换为自由形状：${command.id}`);
  }
  if (command.geometry !== null) {
    const current = record.ovr.geometry ?? record.meta.customGeometry!;
    assertCustomGeometryOverride(current, command.geometry, 'SetGeometry.geometry');
  }
  const path = ['elements', command.id, 'ovr', 'geometry'] as const;
  const hadOverride = own(record.ovr, 'geometry');
  if (command.geometry === null) {
    if (!hadOverride) return { forward: [], inverse: [] };
    return {
      forward: [{ op: 'del', path, origin }],
      inverse: [{ op: 'set', path, value: structuredClone(record.ovr.geometry!), origin }],
    };
  }
  if (hadOverride && JSON.stringify(record.ovr.geometry) === JSON.stringify(command.geometry)) {
    return { forward: [], inverse: [] };
  }
  const forward: ElementGeometryPatch = {
    op: 'set', path, value: structuredClone(command.geometry), origin,
  };
  const inverse: ElementGeometryPatch = hadOverride
    ? { op: 'set', path, value: structuredClone(record.ovr.geometry!), origin }
    : { op: 'del', path, origin };
  return { forward: [forward], inverse: [inverse] };
}
