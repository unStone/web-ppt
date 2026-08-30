import { assertDataObject } from '../data-validation';
import { assertFractionalIndex, initialFractionalIndex } from '../fractional-index';
import type { EditDoc } from '../types';
import type { Patch, TableRowPatch } from './types';

export function isTableRowPatch(patch: Patch): patch is TableRowPatch {
  return patch.path.length === 5 && patch.path[0] === 'elements'
    && patch.path[2] === 'ovr' && patch.path[3] === 'tableRows'
    && (patch.op === 'insert' || patch.op === 'remove');
}

export function validateTableRowPatch(doc: EditDoc, patch: TableRowPatch, index: number): void {
  const record = doc.elements[patch.path[1]];
  if (!record || record.src.kind !== 'table') throw new Error(`Patch ${index} 没有指向表格`);
  if (record.meta.editable !== 'full') throw new Error(`Patch ${index} 指向不可编辑表格`);
  const rowId = patch.path[4];
  if (!rowId || typeof rowId !== 'string') throw new Error(`Patch ${index} 的行身份无效`);
  assertDataObject(patch.value, ['order', 'template'], `Patch ${index} 的新增行`);
  if (typeof patch.value.order !== 'string') throw new Error(`Patch ${index} 的行顺序无效`);
  assertFractionalIndex(patch.value.order);
  if (patch.value.template !== undefined
    && (!Number.isSafeInteger(patch.value.template) || patch.value.template < 0
      || patch.value.template >= record.src.rows.length)) {
    throw new Error(`Patch ${index} 的行模板无效`);
  }
  const current = record.ovr.tableRows?.[rowId];
  if (patch.op === 'insert' && current) throw new Error(`Patch ${index} 的行身份已经存在：${rowId}`);
  if (patch.op === 'remove' && (!current || current.order !== patch.value.order)) {
    throw new Error(`Patch ${index} 要移除的行状态不存在：${rowId}`);
  }
  if (record.src.rows.some((_, source) => patch.value.order === initialFractionalIndex(source))) {
    throw new Error(`Patch ${index} 的行顺序与来源行冲突`);
  }
  const duplicate = Object.entries(record.ovr.tableRows ?? {})
    .find(([id, value]) => id !== rowId && value.order === patch.value.order);
  if (duplicate) throw new Error(`Patch ${index} 的行顺序与 ${duplicate[0]} 冲突`);
}

export function applyTableRowPatch(doc: EditDoc, patch: TableRowPatch): void {
  const record = doc.elements[patch.path[1]];
  if (!record || record.src.kind !== 'table') throw new Error(`Patch 指向不存在的表格：${patch.path[1]}`);
  const rowId = patch.path[4];
  if (patch.op === 'insert') {
    const rows = record.ovr.tableRows ?? (record.ovr.tableRows = Object.create(null));
    rows[rowId] = { ...patch.value };
    return;
  }
  delete record.ovr.tableRows?.[rowId];
  if (record.ovr.tableRows && !Reflect.ownKeys(record.ovr.tableRows).length) delete record.ovr.tableRows;
}
