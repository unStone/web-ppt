import { assertElementName } from '../element-name';
import type { EditDoc } from '../types';
import type { CommandPatches, ElementNamePatch, SetNameCommand } from './types';

const own = (object: object, key: PropertyKey): boolean => Object.prototype.hasOwnProperty.call(object, key);

function assertElementNameWritable(doc: EditDoc, id: string): EditDoc['elements'][string] {
  if (doc.meta.readonly) throw new Error('只读编辑文档不能重命名元素');
  const record = doc.elements[id];
  if (!record) throw new Error(`找不到元素：${id}`);
  if (record.meta.editable === 'none' || !record.meta.origin) throw new Error(`元素不可重命名：${id}`);
  return record;
}

export function isElementNamePatch(patch: { readonly path: readonly unknown[] }): patch is ElementNamePatch {
  return patch.path.length === 4 && patch.path[0] === 'elements' && typeof patch.path[1] === 'string'
    && patch.path[2] === 'ovr' && patch.path[3] === 'name';
}

export function validateElementNamePatch(doc: EditDoc, patch: ElementNamePatch, index: number): void {
  try { assertElementNameWritable(doc, patch.path[1]); } catch {
    throw new Error(`元素名称 Patch ${index} 不可写`);
  }
  if (patch.op !== 'set' && patch.op !== 'del') throw new Error(`元素名称 Patch ${index} 操作无效`);
  if (patch.op === 'set') assertElementName(patch.value, `元素名称 Patch ${index}`);
}

export function applyElementNamePatch(doc: EditDoc, patch: ElementNamePatch): void {
  const record = doc.elements[patch.path[1]];
  if (patch.op === 'set') record.ovr.name = patch.value;
  else delete record.ovr.name;
}

export function setNamePatches(
  doc: EditDoc,
  command: SetNameCommand,
  origin: string,
): CommandPatches {
  const record = assertElementNameWritable(doc, command.id);
  if (command.name !== null) assertElementName(command.name);
  const desired = command.name === record.src.name ? null : command.name;
  const direct = own(record.ovr, 'name');
  if ((desired === null && !direct) || (desired !== null && direct && record.ovr.name === desired)) {
    return { forward: [], inverse: [] };
  }
  const path = ['elements', record.id, 'ovr', 'name'] as const;
  const forward: ElementNamePatch = desired === null
    ? { op: 'del', path, origin }
    : { op: 'set', path, value: desired, origin };
  const inverse: ElementNamePatch = direct
    ? { op: 'set', path, value: record.ovr.name as string, origin }
    : { op: 'del', path, origin };
  return { forward: [forward], inverse: [inverse] };
}
