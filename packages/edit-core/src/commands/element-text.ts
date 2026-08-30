import type { EditDoc, TableRowInsertion } from '../types';
import { validateEmptyTextOverride, validateFlatTextOverride } from '../text-override-validation';
import { tableCellAddressFromRefs, tableCellOverrideKeyFromRefs } from '../table-cell';
import { orderedTableColumns, orderedTableRows, tableCellMergeRole } from '../table-grid';
import type { CommandPatches, ElementTextPatch, Patch } from './types';
import { textTargetContextForRecord } from './text-target';

const own = (object: object, key: PropertyKey): boolean => Object.prototype.hasOwnProperty.call(object, key);

export function isElementTextPatch(patch: Patch): patch is ElementTextPatch {
  return patch.path[0] === 'elements' && typeof patch.path[1] === 'string' && patch.path[2] === 'ovr'
    && ((patch.path.length === 4 && patch.path[3] === 'text')
      || (patch.path.length === 7 && patch.path[3] === 'tableCells'
        && (typeof patch.path[4] === 'number' || typeof patch.path[4] === 'string')
        && (typeof patch.path[5] === 'number' || typeof patch.path[5] === 'string')
        && patch.path[6] === 'text'));
}

export function clearElementTextPatches(doc: EditDoc, id: string, origin: string): CommandPatches {
  const record = doc.elements[id];
  if (!record || record.src.kind !== 'shape') throw new Error(`找不到可清空文本的形状：${id}`);
  const path = ['elements', id, 'ovr', 'text'] as const;
  const before = record.ovr.text;
  if (before?.kind === 'empty') return { forward: [], inverse: [] };
  const value = before?.kind === 'flat'
    ? {
      kind: 'empty' as const,
      body: before.body,
      ...(before.bodyOverrides ? { bodyOverrides: before.bodyOverrides } : {}),
    }
    : { kind: 'empty' as const };
  return {
    forward: [{ op: 'set', path, value, origin }],
    inverse: [own(record.ovr, 'text') && before
      ? { op: 'set', path, value: before, origin }
      : { op: 'del', path, origin }],
  };
}

export function validateElementTextPatch(
  doc: EditDoc,
  patch: ElementTextPatch,
  index: number,
  stagedTableRows?: Record<string, TableRowInsertion>,
): void {
  const sourceRecord = doc.elements[patch.path[1]];
  const stagedRecord = sourceRecord && stagedTableRows
    ? { ...sourceRecord, ovr: { ...sourceRecord.ovr, tableRows: stagedTableRows } }
    : sourceRecord;
  const record = stagedRecord && patch.path.length === 7
    ? {
      ...stagedRecord,
      ovr: {
        ...stagedRecord.ovr, tableRemovedRows: undefined, tableRemovedColumns: undefined,
      },
    }
    : stagedRecord;
  const cell = patch.path.length === 7 && record
    ? tableCellAddressFromRefs(record, patch.path[4], patch.path[5]) : null;
  if (patch.path.length === 7 && !cell) throw new Error(`Patch ${index} 的表格行身份或列坐标无效`);
  const target = patch.path.length === 4 ? { id: patch.path[1] } : { id: patch.path[1], cell: cell! };
  if (!record) throw new Error(`Patch ${index} 指向不存在的元素`);
  const stable = patch.path.length === 7 && cell && record.src.kind === 'table'
    ? {
      row: orderedTableRows(record)[cell.r]?.id,
      column: orderedTableColumns(record)[cell.c]?.id,
    } : null;
  const dormant = stable?.row && stable.column
    && tableCellMergeRole(record, { row: stable.row, column: stable.column }) === 'placeholder';
  if (!dormant) textTargetContextForRecord(record, target);
  if (patch.op === 'set') {
    if (patch.value.kind === 'flat') validateFlatTextOverride(patch.value);
    else if (patch.value.kind === 'empty') validateEmptyTextOverride(patch.value);
    else throw new Error(`Patch ${index} 的文本覆盖无效`);
  }
}

export function applyElementTextPatch(doc: EditDoc, patch: ElementTextPatch): void {
  const record = doc.elements[patch.path[1]];
  if (!record) throw new Error(`Patch 指向不存在的元素：${patch.path[1]}`);
  if (patch.path.length === 4) {
    if (patch.op === 'set') record.ovr.text = { ...patch.value };
    else delete record.ovr.text;
    return;
  }
  const key = tableCellOverrideKeyFromRefs(patch.path[4], patch.path[5]);
  if (patch.op === 'set') {
    const cells = record.ovr.tableCells ?? (record.ovr.tableCells = Object.create(null));
    const cell = cells[key] ?? (cells[key] = {});
    cell.text = { ...patch.value };
    return;
  }
  const cells = record.ovr.tableCells;
  const cell = cells?.[key];
  if (!cell) return;
  delete cell.text;
  if (!Reflect.ownKeys(cell).length) delete cells![key];
  if (!Reflect.ownKeys(cells!).length) delete record.ovr.tableCells;
}
