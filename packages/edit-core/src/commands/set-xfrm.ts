import type { EditDoc, ElementOverrides } from '../types';
import type { CommandPatches, Patch, SetXfrmCommand } from './types';
import { assertXfrmValue, XFRM_FIELDS } from './xfrm';

const own = (object: object, key: PropertyKey): boolean => Object.prototype.hasOwnProperty.call(object, key);

export function setXfrmPatches(doc: EditDoc, command: SetXfrmCommand, origin: string): CommandPatches {
  if (doc.meta.readonly) throw new Error('只读编辑文档不能执行命令');
  const record = doc.elements[command.id];
  if (!record) throw new Error(`找不到元素：${command.id}`);
  if (record.meta.editable === 'none') throw new Error(`元素不可编辑：${command.id}`);
  if (record.meta.locked) throw new Error(`元素已锁定：${command.id}`);

  const forward: Patch[] = [];
  const inverse: Patch[] = [];
  for (const field of XFRM_FIELDS) {
    const value = command[field];
    if (value === undefined) continue;
    assertXfrmValue(field, value, `SetXfrm.${field}`);
    const hadOverride = own(record.ovr, field);
    const before = (hadOverride ? record.ovr[field] : record.src[field]) as number;
    if (Object.is(before, value)) continue;
    const path = ['elements', command.id, 'ovr', field] as const;
    forward.push({ op: 'set', path, value, origin });
    inverse.unshift(hadOverride
      ? { op: 'set', path, value: before, origin }
      : { op: 'del', path, origin });
  }
  if (!forward.length && !XFRM_FIELDS.some((field) => command[field] !== undefined)) {
    throw new Error('SetXfrm 至少需要一个变换字段');
  }
  return { forward, inverse };
}

export function applyXfrmPatch(doc: EditDoc, patch: Patch): void {
  const [, id, , field] = patch.path;
  const record = doc.elements[id];
  if (!record) throw new Error(`Patch 指向不存在的元素：${id}`);
  const overrides = record.ovr as ElementOverrides;
  if (patch.op === 'set') overrides[field] = patch.value;
  else delete overrides[field];
}
