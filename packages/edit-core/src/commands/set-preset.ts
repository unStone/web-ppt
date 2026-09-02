import { isKnownPreset } from '@web-ppt/core/geometry';
import { own } from '../data-validation';
import { effectivePresetGeometry } from '../preset-geometry';
import type { EditDoc } from '../types';
import { assertElementUnlocked } from './element-interaction';
import type { CommandPatches } from './types';
import type {
  ElementGeometryPatch, ElementPresetGeometryPatch, SetAdjCommand, SetPresetCommand,
} from './geometry-types';

export function setPresetPatches(
  doc: EditDoc,
  command: SetPresetCommand,
  origin: string,
): CommandPatches {
  if (doc.meta.readonly) throw new Error('只读编辑文档不能切换预设形状');
  const record = doc.elements[command.id];
  if (!record) throw new Error(`找不到元素：${command.id}`);
  if (record.src.kind !== 'shape' || record.meta.editable !== 'full') {
    throw new Error(`元素不支持预设切换：${command.id}`);
  }
  assertElementUnlocked(doc, command.id);
  if (typeof command.preset !== 'string' || !isKnownPreset(command.preset)) {
    throw new Error(`未知预设形状：${String(command.preset)}`);
  }
  const value = { preset: command.preset, adj: {} } as const;
  const path = ['elements', command.id, 'ovr', 'presetGeometry'] as const;
  const hadOverride = own(record.ovr, 'presetGeometry');
  if (hadOverride && record.ovr.presetGeometry?.preset === command.preset
    && Object.keys(record.ovr.presetGeometry.adj).length === 0) return { forward: [], inverse: [] };
  const presetForward: ElementPresetGeometryPatch = { op: 'set', path, value, origin };
  const presetInverse: ElementPresetGeometryPatch = hadOverride
    ? { op: 'set', path, value: structuredClone(record.ovr.presetGeometry!), origin }
    : { op: 'del', path, origin };
  const customPath = ['elements', command.id, 'ovr', 'geometry'] as const;
  // 缺失字段也发 tombstone，协同时才能与另一端的自由几何写入做同一时钟的 LWW。
  const customForward: ElementGeometryPatch[] = [{ op: 'del', path: customPath, origin }];
  const customInverse: ElementGeometryPatch[] = own(record.ovr, 'geometry')
    ? [{ op: 'set', path: customPath, value: structuredClone(record.ovr.geometry!), origin }] : [];
  return {
    forward: [...customForward, presetForward],
    inverse: [presetInverse, ...customInverse],
  };
}

export function setAdjPatches(
  doc: EditDoc,
  command: SetAdjCommand,
  origin: string,
): CommandPatches {
  if (doc.meta.readonly) throw new Error('只读编辑文档不能调整预设形状');
  const record = doc.elements[command.id];
  if (!record) throw new Error(`找不到元素：${command.id}`);
  if (record.src.kind !== 'shape' || record.meta.editable !== 'full') {
    throw new Error(`元素不支持预设调节：${command.id}`);
  }
  assertElementUnlocked(doc, command.id);
  if (typeof command.name !== 'string'
    || !/^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/.test(command.name)
    || !Number.isSafeInteger(command.value)
    || command.value < -2147483648 || command.value > 2147483647) {
    throw new Error('SetAdj 必须使用合法 guide 名与 DrawingML 32 位整数');
  }
  const current = effectivePresetGeometry(doc, command.id);
  if (!current) throw new Error(`元素不是可调预设形状：${command.id}`);
  if (current.adj[command.name] === command.value) return { forward: [], inverse: [] };
  const value = { ...current, adj: { ...current.adj, [command.name]: command.value } };
  const path = ['elements', command.id, 'ovr', 'presetGeometry'] as const;
  const hadOverride = own(record.ovr, 'presetGeometry');
  if (hadOverride && JSON.stringify(record.ovr.presetGeometry) === JSON.stringify(value)) {
    return { forward: [], inverse: [] };
  }
  const customPath = ['elements', command.id, 'ovr', 'geometry'] as const;
  return {
    forward: [
      { op: 'del', path: customPath, origin },
      { op: 'set', path, value, origin },
    ],
    inverse: hadOverride
      ? [{ op: 'set', path, value: structuredClone(record.ovr.presetGeometry!), origin }]
      : [{ op: 'del', path, origin }],
  };
}
