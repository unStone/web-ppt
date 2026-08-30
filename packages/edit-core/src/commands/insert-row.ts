import { fractionalIndexBetween } from '../fractional-index';
import { logicalIdentityPrefix } from '../identity-allocation';
import type { EditDoc, ElementRecord } from '../types';
import { orderedTableRows, tableRowById } from '../table-grid';
import type { CommandPatches, InsertRowCommand, TableRowPatch } from './types';

function allocateRowId(doc: EditDoc, record: ElementRecord, origin: string): string {
  for (;;) {
    const serial = (doc.identity.nextElement++).toString(36);
    const id = `${logicalIdentityPrefix(doc.identity)}r${serial}:${origin.length.toString(36)}:${origin}`;
    if (!record.ovr.tableRows?.[id]) return id;
  }
}

export function insertRowPatches(
  doc: EditDoc,
  command: InsertRowCommand,
  origin: string,
): CommandPatches {
  if (doc.meta.readonly) throw new Error('只读编辑文档不能执行命令');
  const record = doc.elements[command.id];
  if (!record || record.src.kind !== 'table') throw new Error(`找不到可追加行的表格：${command.id}`);
  if (record.meta.editable !== 'full' || record.meta.locked) throw new Error(`表格不可编辑：${command.id}`);
  if (!record.src.rows.length || !record.src.colWidths.length) throw new Error(`表格没有可复制的行列：${command.id}`);
  if (command.at !== undefined) {
    if (!command.at || typeof command.at !== 'object'
      || Reflect.ownKeys(command.at).length !== 1 || !Object.prototype.hasOwnProperty.call(command.at, 'before')
      || (command.at.before !== null && (typeof command.at.before !== 'string' || !command.at.before))) {
      throw new Error('InsertRow.at 必须是只含稳定 before 行身份的纯数据对象');
    }
  }
  const rows = orderedTableRows(record);
  const before = command.at?.before === null || command.at === undefined
    ? null : tableRowById(record, command.at.before);
  if (command.at?.before && !before) throw new Error(`找不到插入位置行：${command.at.before}`);
  const nextIndex = before ? rows.findIndex((row) => row.id === before.id) : rows.length;
  const previous = rows[nextIndex - 1] ?? null;
  const next = rows[nextIndex] ?? null;
  const rowId = allocateRowId(doc, record, origin);
  const template = next?.source ?? previous?.source ?? record.src.rows.length - 1;
  const value = {
    order: fractionalIndexBetween(previous?.order ?? null, next?.order ?? null, rowId),
    template,
  };
  const path = ['elements', record.id, 'ovr', 'tableRows', rowId] as const;
  return {
    forward: [{ op: 'insert', path, value, origin } satisfies TableRowPatch],
    inverse: [{ op: 'remove', path, value, origin } satisfies TableRowPatch],
  };
}
