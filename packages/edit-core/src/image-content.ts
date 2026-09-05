import type { ImageElement } from '@web-ppt/core';
import { assertDataObject, own } from './data-validation';
import { effectiveElement } from './projection';
import type { EditDoc, ElementCropState, ElementId, ElementRecord, ImageCrop } from './types';

const FIELDS = ['l', 't', 'r', 'b'] as const;

export function assertImageCrop(value: unknown, label: string): asserts value is ImageCrop {
  assertDataObject(value, FIELDS, label);
  for (const field of FIELDS) {
    const part = (value as ImageCrop)[field];
    if (typeof part !== 'number' || !Number.isFinite(part) || part < 0 || part >= 1) {
      throw new Error(`${label}.${field} 必须是 [0, 1) 内的有限数`);
    }
  }
  const crop = value as ImageCrop;
  if (crop.l + crop.r >= 1 || crop.t + crop.b >= 1) {
    throw new Error(`${label} 必须保留正面积的可见区域`);
  }
}

/** srcRect 用十万分数保存；命令入口先收敛，避免保存重开制造脏状态。 */
export function normalizeImageCrop(crop: ImageCrop): ImageCrop {
  const normalized = Object.fromEntries(FIELDS.map((field) => [
    field, Math.round(crop[field] * 100000) / 100000,
  ])) as unknown as ImageCrop;
  assertImageCrop(normalized, '量化后的裁剪');
  return normalized;
}

/** 海报只能改普通媒体宿主的 blip，不能越过兼容分支或开放媒体裁剪。 */
export function canEditImageContent(record: ElementRecord, poster = false): record is ElementRecord & { src: ImageElement } {
  return record.src.kind === 'image' && !record.src.editInfo?.requiresOriginal
    && record.meta.editable === (record.src.media ? (poster ? 'frame' : null) : 'full');
}

export function queryElementCrop(doc: EditDoc, ids: readonly ElementId[]): ElementCropState {
  if (!ids.length) throw new Error('图片裁剪查询至少需要一个元素');
  const values = ids.map((id) => {
    const element = effectiveElement(doc, id);
    if (element.kind !== 'image' || element.media) {
      throw new Error(`元素不支持图片裁剪：${id}`);
    }
    return element.crop;
  });
  const signature = JSON.stringify(values[0]);
  return {
    value: structuredClone(values[0]),
    mixed: values.some((value) => JSON.stringify(value) !== signature),
    direct: ids.some((id) => own(doc.elements[id].ovr, 'crop')),
  };
}
