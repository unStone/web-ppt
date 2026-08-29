import { customGeometryFromSvgPath } from '../custom-geometry-path';
import { own } from '../data-validation';
import { effectiveElement } from '../projection';
import type { EditDoc } from '../types';
import type { CommandPatches } from './types';
import type { ConvertToCustomGeometryCommand } from './geometry-types';

export function convertToCustomGeometryPatches(
  doc: EditDoc,
  command: ConvertToCustomGeometryCommand,
  origin: string,
): CommandPatches {
  if (doc.meta.readonly) throw new Error('只读编辑文档不能转换自由形状');
  const record = doc.elements[command.id];
  if (!record) throw new Error(`找不到元素：${command.id}`);
  if (record.src.kind !== 'shape' || record.meta.editable !== 'full') {
    throw new Error(`元素不能转换为自由形状：${command.id}`);
  }
  if (record.meta.customGeometry || own(record.ovr, 'geometry')) {
    throw new Error(`元素已经是自由形状：${command.id}`);
  }
  const effective = effectiveElement(doc, command.id);
  if (effective.kind !== 'shape' || !effective.path) throw new Error(`元素没有可物化路径：${command.id}`);
  const geometry = customGeometryFromSvgPath(
    effective.path, effective.w, effective.h, effective.openGeom === true,
  );
  const path = ['elements', command.id, 'ovr', 'geometry'] as const;
  return {
    forward: [{ op: 'set', path, value: geometry, origin }],
    inverse: [{ op: 'del', path, origin }],
  };
}
