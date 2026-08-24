import { assertDataObject } from './data-validation';
import { orderedTableRowInsertions } from './table-rows';
import type {
  ElementRecord, TableCellAddress, TableCellKey, TableCellRowRef, TableRowId,
} from './types';

export function tableCellKey(cell: TableCellAddress): TableCellKey {
  return `${cell.r}:${cell.c}`;
}

export function parseTableCellKey(value: string): TableCellAddress | null {
  const match = /^(0|[1-9]\d*):(0|[1-9]\d*)$/.exec(value);
  if (!match) return null;
  const cell = { r: Number(match[1]), c: Number(match[2]) };
  return Number.isSafeInteger(cell.r) && Number.isSafeInteger(cell.c) ? cell : null;
}

function insertedTableCellKey(rowId: TableRowId, column: number): TableCellKey {
  return `@${rowId.length}:${rowId}:${column}`;
}

export function tableCellKeyBelongsToRow(key: string, rowId: TableRowId): boolean {
  return key.startsWith(`@${rowId.length}:${rowId}:`);
}

function parseInsertedTableCellKey(value: string): { rowId: TableRowId; c: number } | null {
  const prefix = /^@([1-9]\d*):/.exec(value);
  if (!prefix) return null;
  const length = Number(prefix[1]);
  if (!Number.isSafeInteger(length)) return null;
  const from = prefix[0].length;
  const to = from + length;
  if (value[to] !== ':') return null;
  const rowId = value.slice(from, to);
  const column = value.slice(to + 1);
  if (!/^(0|[1-9]\d*)$/.test(column)) return null;
  const c = Number(column);
  return rowId && Number.isSafeInteger(c) ? { rowId, c } : null;
}

export function tableCellRowRef(
  record: ElementRecord,
  cell: TableCellAddress,
): TableCellRowRef | null {
  if (record.src.kind !== 'table') return null;
  if (cell.r < record.src.rows.length) return cell.r;
  return orderedTableRowInsertions(record)[cell.r - record.src.rows.length]?.id ?? null;
}

export function tableCellAddressFromRowRef(
  record: ElementRecord,
  row: unknown,
  column: unknown,
): TableCellAddress | null {
  if (record.src.kind !== 'table' || !Number.isSafeInteger(column) || Number(column) < 0) return null;
  if (typeof row === 'number') {
    return Number.isSafeInteger(row) && row >= 0 && row < record.src.rows.length
      ? { r: row, c: Number(column) } : null;
  }
  if (typeof row !== 'string' || !row) return null;
  const index = orderedTableRowInsertions(record).findIndex((insertion) => insertion.id === row);
  return index < 0 ? null : { r: record.src.rows.length + index, c: Number(column) };
}

export function tableCellOverrideKeyFromRowRef(
  row: TableCellRowRef,
  column: number,
): TableCellKey {
  return typeof row === 'number' ? tableCellKey({ r: row, c: column }) : insertedTableCellKey(row, column);
}

export function tableCellOverrideKey(record: ElementRecord, cell: TableCellAddress): TableCellKey {
  const row = tableCellRowRef(record, cell);
  if (row === null) throw new Error(`表格单元格越界：${cell.r},${cell.c}`);
  return tableCellOverrideKeyFromRowRef(row, cell.c);
}

export function tableCellKeyResolver(
  record: ElementRecord,
): (key: string) => TableCellAddress | null {
  const insertedRows = new Map(orderedTableRowInsertions(record)
    .map((insertion, index) => [insertion.id, record.src.kind === 'table'
      ? record.src.rows.length + index : -1]));
  return (key) => {
    const source = parseTableCellKey(key);
    if (source) {
      return record.src.kind === 'table' && source.r < record.src.rows.length ? source : null;
    }
    const inserted = parseInsertedTableCellKey(key);
    if (!inserted) return null;
    const r = insertedRows.get(inserted.rowId);
    return r === undefined || r < 0 ? null : { r, c: inserted.c };
  };
}

export function assertTableCellAddress(
  value: unknown,
  label: string,
): asserts value is TableCellAddress {
  assertDataObject(value, ['r', 'c'], label);
  const cell = value as TableCellAddress;
  if (!Number.isSafeInteger(cell.r) || cell.r < 0
    || !Number.isSafeInteger(cell.c) || cell.c < 0) {
    throw new Error(`${label} 必须使用非负安全整数行列坐标`);
  }
}
