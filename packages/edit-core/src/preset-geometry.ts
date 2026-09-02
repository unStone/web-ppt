import { isKnownPreset } from '@web-ppt/core/geometry';
import type { GeomSpec } from '@web-ppt/core';
import { assertDataObject, own } from './data-validation';
import { rebasedElementBase } from './layout-projection';
import { slideOfElement } from './projection';
import type { EditDoc, ElementId, ElementPresetGeometryState } from './types';

const signature = (value: GeomSpec | null): string => JSON.stringify(value);

export function assertPresetGeometry(value: unknown, label: string): asserts value is GeomSpec {
  assertDataObject(value, ['preset', 'adj'], label);
  const spec = value as Partial<GeomSpec>;
  if (typeof spec.preset !== 'string' || !isKnownPreset(spec.preset)) {
    throw new Error(`${label}.preset 不是受支持的预设形状`);
  }
  assertDataObject(spec.adj, Object.keys(spec.adj ?? {}), `${label}.adj`);
  for (const [name, adjustment] of Object.entries(spec.adj ?? {})) {
    if (!/^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/.test(name)
      || !Number.isSafeInteger(adjustment) || adjustment < -2147483648 || adjustment > 2147483647) {
      throw new Error(`${label}.adj.${name} 不是合法的 DrawingML 调节值`);
    }
  }
}

export function sourcePresetGeometry(doc: EditDoc, id: ElementId): GeomSpec | null {
  const record = doc.elements[id];
  if (!record || record.src.kind !== 'shape') throw new Error(`元素不支持预设几何：${id}`);
  if (record.meta.customGeometry) return null;
  return structuredClone(rebasedElementBase(doc, slideOfElement(doc, id), record).geom ?? null);
}

export function effectivePresetGeometry(doc: EditDoc, id: ElementId): GeomSpec | null {
  const record = doc.elements[id];
  if (!record || record.src.kind !== 'shape') throw new Error(`元素不支持预设几何：${id}`);
  if (own(record.ovr, 'presetGeometry')) return structuredClone(record.ovr.presetGeometry!);
  if (own(record.ovr, 'geometry')) return null;
  return sourcePresetGeometry(doc, id);
}

export function queryElementPresetGeometry(
  doc: EditDoc,
  ids: readonly ElementId[],
): ElementPresetGeometryState {
  if (!ids.length) throw new Error('预设几何查询至少需要一个元素');
  const values = ids.map((id) => effectivePresetGeometry(doc, id));
  const sources = ids.map((id) => sourcePresetGeometry(doc, id));
  const valueSignature = signature(values[0]);
  const sourceSignature = signature(sources[0]);
  return {
    value: structuredClone(values[0]),
    source: structuredClone(sources[0]),
    mixed: values.some((value) => signature(value) !== valueSignature),
    sourceMixed: sources.some((value) => signature(value) !== sourceSignature),
    direct: ids.some((id) => own(doc.elements[id].ovr, 'presetGeometry')),
  };
}
