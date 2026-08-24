import type { EditDoc } from '../types';
import type { CommandPatches, ElementTransformPatch, Patch, XfrmField, XfrmValueByField } from './types';
import { assertXfrmValue, isFrameXfrmField } from './xfrm';

const own = (object: object, key: PropertyKey): boolean => Object.prototype.hasOwnProperty.call(object, key);

/** 变换命令共用权限与 patch 语义，避免位置和翻转两条路径逐渐分叉。 */
export function elementTransformPatches(
  doc: EditDoc,
  id: string,
  values: Partial<Record<XfrmField, unknown>>,
  fields: readonly XfrmField[],
  origin: string,
  label: string,
): CommandPatches {
  if (doc.meta.readonly) throw new Error('只读编辑文档不能执行命令');
  const record = doc.elements[id];
  if (!record) throw new Error(`找不到元素：${id}`);
  if (record.meta.editable === 'none') throw new Error(`元素不可编辑：${id}`);
  if (record.meta.locked) throw new Error(`元素已锁定：${id}`);
  if (record.meta.editable === 'frame'
    && fields.some((field) => values[field] !== undefined && !isFrameXfrmField(field))) {
    throw new Error(`框架对象只允许修改位置与尺寸：${id}`);
  }

  const forward: Patch[] = [];
  const inverse: Patch[] = [];
  for (const field of fields) {
    const value = values[field];
    if (value === undefined) continue;
    assertXfrmValue(field, value, `${label}.${field}`);
    const hadOverride = own(record.ovr, field);
    const before = (hadOverride ? record.ovr[field] : record.src[field]) as XfrmValueByField[typeof field];
    if (Object.is(before, value)) continue;
    const path = ['elements', id, 'ovr', field] as const;
    forward.push({ op: 'set', path, value, origin } as Patch);
    inverse.unshift((hadOverride
      ? { op: 'set', path, value: before, origin }
      : { op: 'del', path, origin }) as Patch);
  }
  return { forward, inverse };
}

export function applyElementTransformPatch(doc: EditDoc, patch: ElementTransformPatch): void {
  const [, id, , field] = patch.path;
  const record = doc.elements[id];
  if (!record) throw new Error(`Patch 指向不存在的元素：${id}`);
  const overrides = record.ovr as unknown as Record<XfrmField, number | boolean | undefined>;
  if (patch.op === 'set') overrides[field] = patch.value;
  else delete overrides[field];
}
