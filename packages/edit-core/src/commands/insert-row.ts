import { fractionalIndexBetween } from '../fractional-index';
import type { EditDoc, ElementRecord } from '../types';
import { lastTableRowOrder } from '../table-rows';
import type { CommandPatches, InsertRowCommand, TableRowPatch } from './types';

function allocateRowId(doc: EditDoc, record: ElementRecord, origin: string): string {
  for (;;) {
    const serial = (doc.identity.nextElement++).toString(36);
    const id = `${doc.identity.prefix}r${serial}:${origin.length.toString(36)}:${origin}`;
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
  const rowId = allocateRowId(doc, record, origin);
  const value = { order: fractionalIndexBetween(lastTableRowOrder(record), null, rowId) };
  const path = ['elements', record.id, 'ovr', 'tableRows', rowId] as const;
  return {
    forward: [{ op: 'insert', path, value, origin } satisfies TableRowPatch],
    inverse: [{ op: 'remove', path, value, origin } satisfies TableRowPatch],
  };
}
