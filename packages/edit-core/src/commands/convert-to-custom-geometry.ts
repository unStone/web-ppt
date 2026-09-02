import { customGeometryFromSvgPath } from '../custom-geometry-path';
import { own } from '../data-validation';
import { effectiveElement } from '../projection';
import type { EditDoc } from '../types';
import type { CommandPatches } from './types';
import type {
  ConvertToCustomGeometryCommand, ElementGeometryPatch, ElementPresetGeometryPatch,
} from './geometry-types';

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
  const hadPresetOverride = own(record.ovr, 'presetGeometry');
  if (own(record.ovr, 'geometry') || (record.meta.customGeometry && !hadPresetOverride)) {
    throw new Error(`元素已经是自由形状：${command.id}`);
  }
  const effective = effectiveElement(doc, command.id);
  if (effective.kind !== 'shape' || !effective.path) throw new Error(`元素没有可物化路径：${command.id}`);
  const geometry = customGeometryFromSvgPath(
    effective.path, effective.w, effective.h, effective.openGeom === true,
  );
  const geometryPath = ['elements', command.id, 'ovr', 'geometry'] as const;
  const presetPath = ['elements', command.id, 'ovr', 'presetGeometry'] as const;
  // 本地没有覆盖也要广播 tombstone，确保并发预设写入与本事务一起 LWW。
  const presetForward: ElementPresetGeometryPatch[] = [{ op: 'del', path: presetPath, origin }];
  const presetInverse: ElementPresetGeometryPatch[] = hadPresetOverride
    ? [{
      op: 'set', path: presetPath,
      value: structuredClone(record.ovr.presetGeometry!), origin,
    }] : [];
  const geometryForward: ElementGeometryPatch = {
    op: 'set', path: geometryPath, value: geometry, origin,
  };
  const geometryInverse: ElementGeometryPatch = { op: 'del', path: geometryPath, origin };
  return {
    // 两种几何覆盖不能短暂共存；顺序也是远端逐 patch 重放时的不变量。
    forward: [...presetForward, geometryForward],
    inverse: [geometryInverse, ...presetInverse],
  };
}
