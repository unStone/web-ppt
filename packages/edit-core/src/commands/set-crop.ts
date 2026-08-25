import { own } from '../data-validation';
import { assertImageCrop, isEditablePicture, normalizeImageCrop } from '../image-content';
import type { EditDoc } from '../types';
import type { CommandPatches, ElementCropPatch, SetCropCommand } from './types';

export function setCropPatches(
  doc: EditDoc,
  command: SetCropCommand,
  origin: string,
): CommandPatches {
  if (doc.meta.readonly) throw new Error('只读编辑文档不能裁剪图片');
  const record = doc.elements[command.id];
  if (!record) throw new Error(`找不到元素：${command.id}`);
  if (record.src.kind !== 'image' || !isEditablePicture(record.src)
    || record.meta.editable !== 'full') {
    throw new Error(`元素不支持图片裁剪：${command.id}`);
  }
  if (record.meta.locked) throw new Error(`元素已锁定：${command.id}`);
  if (command.crop !== null) assertImageCrop(command.crop, 'SetCrop.crop');
  const value = command.crop === null ? null : normalizeImageCrop(command.crop);
  const path = ['elements', command.id, 'ovr', 'crop'] as const;
  const hadOverride = own(record.ovr, 'crop');
  if (value === null) {
    if (!hadOverride) return { forward: [], inverse: [] };
    return {
      forward: [{ op: 'del', path, origin }],
      inverse: [{ op: 'set', path, value: structuredClone(record.ovr.crop!), origin }],
    };
  }
  if (hadOverride && JSON.stringify(record.ovr.crop) === JSON.stringify(value)) {
    return { forward: [], inverse: [] };
  }
  const forward: ElementCropPatch = { op: 'set', path, value: structuredClone(value), origin };
  const inverse: ElementCropPatch = hadOverride
    ? { op: 'set', path, value: structuredClone(record.ovr.crop!), origin }
    : { op: 'del', path, origin };
  return { forward: [forward], inverse: [inverse] };
}
