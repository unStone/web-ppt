import type { EditDoc } from '../types';
import type { ElementGeometryPatch, ElementPresetGeometryPatch } from './geometry-types';
import type { LayoutPropertyPatch, MasterBackgroundPatch, SlidePropertyPatch, SlideBackgroundImagePatch, ElementTransformPatch, ElementCropPatch, ElementEffectsPatch, ElementFillPatch, ElementLinkPatch, ElementNamePatch, ElementStrokePatch } from './types';

/** 值已通过各领域校验，应用阶段共用克隆/删除语义，避免属性实现漂移。 */
export function applyRecordOverridePatch(doc: EditDoc,
  patch: LayoutPropertyPatch | MasterBackgroundPatch | Exclude<SlidePropertyPatch, SlideBackgroundImagePatch> | ElementGeometryPatch | ElementPresetGeometryPatch | ElementTransformPatch | ElementCropPatch | ElementEffectsPatch | ElementFillPatch | ElementLinkPatch | ElementNamePatch | ElementStrokePatch,
): void {
  const record = doc[patch.path[0]][patch.path[1]];
  if (!record) throw new Error(`Patch 指向不存在的记录：${patch.path[1]}`);
  const overrides = record.ovr as Record<string, unknown>;
  if (patch.op === 'set') overrides[patch.path[3]] = patch.value && typeof patch.value === 'object' ? structuredClone(patch.value) : patch.value;
  else delete overrides[patch.path[3]];
}
