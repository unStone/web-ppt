import { assertAltTextField } from '../alt-text';
import { own } from '../data-validation';
import type { EditDoc } from '../types';
import type { CommandPatches, ElementAltTextPatch, SetAltTextCommand } from './types';

function assertWritable(doc: EditDoc, id: string): EditDoc['elements'][string] {
  if (doc.meta.readonly) throw new Error('只读编辑文档不能修改替代文字');
  const record = doc.elements[id];
  if (!record) throw new Error(`找不到元素：${id}`);
  if (record.meta.editable === 'none' || !record.meta.origin) {
    throw new Error(`元素替代文字不可写：${id}`);
  }
  return record;
}

export function isElementAltTextPatch(
  patch: { readonly path: readonly unknown[] },
): patch is ElementAltTextPatch {
  return patch.path.length === 5 && patch.path[0] === 'elements'
    && typeof patch.path[1] === 'string' && patch.path[2] === 'ovr'
    && patch.path[3] === 'altText' && (patch.path[4] === 'title' || patch.path[4] === 'descr');
}

export function validateElementAltTextPatch(
  doc: EditDoc,
  patch: ElementAltTextPatch,
  index: number,
): void {
  try { assertWritable(doc, patch.path[1]); } catch {
    throw new Error(`元素替代文字 Patch ${index} 不可写`);
  }
  if (patch.op !== 'set' && patch.op !== 'del') throw new Error(`元素替代文字 Patch ${index} 操作无效`);
  if (patch.op === 'set') assertAltTextField(patch.value, `元素替代文字 Patch ${index}`);
}

export function applyElementAltTextPatch(doc: EditDoc, patch: ElementAltTextPatch): void {
  const record = doc.elements[patch.path[1]];
  const field = patch.path[4];
  if (patch.op === 'set') {
    (record.ovr.altText ??= {})[field] = patch.value;
    return;
  }
  if (!record.ovr.altText) return;
  delete record.ovr.altText[field];
  if (!Reflect.ownKeys(record.ovr.altText).length) delete record.ovr.altText;
}

export function setAltTextPatches(
  doc: EditDoc,
  command: SetAltTextCommand,
  origin: string,
): CommandPatches {
  const record = assertWritable(doc, command.id);
  for (const field of ['title', 'descr'] as const) {
    const value = command[field];
    if (value !== null) assertAltTextField(value, `SetAltText.${field}`);
  }
  const source = record.src.editInfo?.altText ?? {};
  const forward: ElementAltTextPatch[] = [];
  const inverse: ElementAltTextPatch[] = [];
  for (const field of ['title', 'descr'] as const) {
    const path = ['elements', record.id, 'ovr', 'altText', field] as const;
    const direct = own(record.ovr.altText ?? {}, field);
    const desired = command[field] === null || command[field] === (source[field] ?? '')
      ? null : command[field];
    if (desired === null && !direct || desired !== null && direct
      && record.ovr.altText![field] === desired) continue;
    forward.push(desired === null
      ? { op: 'del', path, origin }
      : { op: 'set', path, value: desired, origin });
    inverse.unshift(direct
      ? { op: 'set', path, value: record.ovr.altText![field]!, origin }
      : { op: 'del', path, origin });
  }
  return { forward, inverse };
}
