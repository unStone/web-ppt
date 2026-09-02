import { assertCustomGeometryOverride } from '../custom-geometry';
import { assertPresetGeometry } from '../preset-geometry';
import type { EditDoc } from '../types';
import type { Patch } from './types';
import type { ElementGeometryPatch, ElementPresetGeometryPatch } from './geometry-types';

export function isElementGeometryPatch(patch: Patch): patch is ElementGeometryPatch {
  return patch.path.length === 4 && patch.path[0] === 'elements'
    && patch.path[2] === 'ovr' && patch.path[3] === 'geometry';
}

export function isElementPresetGeometryPatch(patch: Patch): patch is ElementPresetGeometryPatch {
  return patch.path.length === 4 && patch.path[0] === 'elements'
    && patch.path[2] === 'ovr' && patch.path[3] === 'presetGeometry';
}

export function validateElementPresetGeometryPatch(
  doc: EditDoc,
  patch: ElementPresetGeometryPatch,
  index: number,
): void {
  const record = doc.elements[patch.path[1]];
  if (!record) throw new Error(`Patch 指向不存在的元素：${patch.path[1]}`);
  if (record.src.kind !== 'shape' || record.meta.editable !== 'full') {
    throw new Error(`Patch ${index} 指向不支持预设几何的元素`);
  }
  if (patch.op === 'set') assertPresetGeometry(patch.value, `Patch ${index} 的 presetGeometry`);
}

export function applyElementPresetGeometryPatch(
  doc: EditDoc,
  patch: ElementPresetGeometryPatch,
): void {
  const record = doc.elements[patch.path[1]];
  if (patch.op === 'set') record.ovr.presetGeometry = structuredClone(patch.value);
  else delete record.ovr.presetGeometry;
}

export function validateElementGeometryPatch(
  doc: EditDoc,
  patch: ElementGeometryPatch,
  index: number,
): void {
  const record = doc.elements[patch.path[1]];
  if (!record) throw new Error(`Patch 指向不存在的元素：${patch.path[1]}`);
  if (record.src.kind !== 'shape' || record.meta.editable !== 'full') {
    throw new Error(`Patch ${index} 指向不支持顶点编辑的元素`);
  }
  if (patch.op === 'set') assertCustomGeometryOverride(
    record.ovr.geometry ?? record.meta.customGeometry ?? null,
    patch.value,
    `Patch ${index} 的 geometry`,
  );
}

export function applyElementGeometryPatch(doc: EditDoc, patch: ElementGeometryPatch): void {
  const record = doc.elements[patch.path[1]];
  if (patch.op === 'set') record.ovr.geometry = structuredClone(patch.value);
  else delete record.ovr.geometry;
}
