import type { EditDoc, ElementId } from '../types';
import { elementOrAncestorMatches } from '../element-ancestry';
import type {
  CommandPatches, ElementInteractionField, ElementInteractionPatch,
  SetElementHiddenCommand, SetLockedCommand,
} from './types';

export function isElementInteractionPatch(
  patch: { readonly path: readonly unknown[] },
): patch is ElementInteractionPatch {
  return patch.path.length === 4 && patch.path[0] === 'elements' && typeof patch.path[1] === 'string'
    && patch.path[2] === 'meta' && (patch.path[3] === 'locked' || patch.path[3] === 'hiddenByUser');
}

export function validateElementInteractionPatch(
  doc: EditDoc,
  patch: ElementInteractionPatch,
  index: number,
): void {
  if (!doc.elements[patch.path[1]]) throw new Error(`交互状态 Patch ${index} 指向不存在的元素`);
  if (patch.op !== 'set' && patch.op !== 'del') throw new Error(`交互状态 Patch ${index} 操作无效`);
  if (patch.op === 'set' && patch.value !== true) throw new Error(`交互状态 Patch ${index} 只能写入 true`);
}

export function applyElementInteractionPatch(doc: EditDoc, patch: ElementInteractionPatch): void {
  const meta = doc.elements[patch.path[1]].meta;
  const field = patch.path[3];
  if (patch.op === 'set') meta[field] = true;
  else delete meta[field];
}

function interactionPatches(
  doc: EditDoc,
  id: ElementId,
  field: ElementInteractionField,
  value: boolean,
  origin: string,
): CommandPatches {
  if (typeof value !== 'boolean') throw new Error('元素交互状态必须是布尔值');
  const record = doc.elements[id];
  if (!record) throw new Error(`找不到元素：${id}`);
  const active = record.meta[field] === true;
  if (active === value) return { forward: [], inverse: [] };
  const path = ['elements', id, 'meta', field] as const;
  const forward: ElementInteractionPatch = value
    ? { op: 'set', path, value: true, origin }
    : { op: 'del', path, origin };
  const inverse: ElementInteractionPatch = active
    ? { op: 'set', path, value: true, origin }
    : { op: 'del', path, origin };
  return { forward: [forward], inverse: [inverse] };
}

export function setLockedPatches(
  doc: EditDoc,
  command: SetLockedCommand,
  origin: string,
): CommandPatches {
  return interactionPatches(doc, command.id, 'locked', command.locked, origin);
}

export function setElementHiddenPatches(
  doc: EditDoc,
  command: SetElementHiddenCommand,
  origin: string,
): CommandPatches {
  return interactionPatches(doc, command.id, 'hiddenByUser', command.hidden, origin);
}

export function elementHasLockedAncestor(doc: EditDoc, id: ElementId): boolean {
  return elementOrAncestorMatches(doc, id, (record) => record.meta.locked === true);
}

export function assertElementUnlocked(doc: EditDoc, id: ElementId): void {
  if (elementHasLockedAncestor(doc, id)) throw new Error(`元素或祖先已锁定：${id}`);
}
