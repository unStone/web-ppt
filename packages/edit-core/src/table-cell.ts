import { assertDataObject } from './data-validation';
import { orderedTableColumns, orderedTableRows } from './table-grid';
import type {
  ElementRecord, TableCellAddress, TableCellColumnRef, TableCellKey, TableCellRef,
  TableCellRowRef, TableRowId,
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

function refToken(ref: number | string): string { return typeof ref === 'number' ? `#${ref}` : ref; }

function universalTableCellKey(row: TableCellRowRef, column: TableCellColumnRef): TableCellKey {
  const rowToken = refToken(row);
  const columnToken = refToken(column);
  return `!${rowToken.length}:${rowToken}:${columnToken.length}:${columnToken}`;
}

function parseRefToken(token: string): number | string | null {
  const source = /^#(0|[1-9]\d*)$/.exec(token);
  if (!source) return token || null;
  const index = Number(source[1]);
  return Number.isSafeInteger(index) ? index : null;
}

function parseUniversalTableCellKey(value: string): {
  row: TableCellRowRef; column: TableCellColumnRef;
} | null {
  if (!value.startsWith('!')) return null;
  const rowLengthEnd = value.indexOf(':', 1);
  if (rowLengthEnd < 0) return null;
  const rowLength = Number(value.slice(1, rowLengthEnd));
  if (!Number.isSafeInteger(rowLength) || rowLength <= 0) return null;
  const rowFrom = rowLengthEnd + 1;
  const rowTo = rowFrom + rowLength;
  if (value[rowTo] !== ':') return null;
  const columnLengthEnd = value.indexOf(':', rowTo + 1);
  if (columnLengthEnd < 0) return null;
  const columnLength = Number(value.slice(rowTo + 1, columnLengthEnd));
  if (!Number.isSafeInteger(columnLength) || columnLength <= 0) return null;
  const columnFrom = columnLengthEnd + 1;
  if (columnFrom + columnLength !== value.length) return null;
  const row = parseRefToken(value.slice(rowFrom, rowTo));
  const column = parseRefToken(value.slice(columnFrom));
  return row === null || column === null ? null : { row, column };
}

export function tableCellKeyBelongsToRow(key: string, rowId: TableRowId): boolean {
  return key.startsWith(`@${rowId.length}:${rowId}:`)
    || parseUniversalTableCellKey(key)?.row === rowId;
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
  return orderedTableRows(record)[cell.r]?.rowRef ?? null;
}

export function tableCellColumnRef(
  record: ElementRecord,
  cell: TableCellAddress,
): TableCellColumnRef | null {
  if (record.src.kind !== 'table') return null;
  return orderedTableColumns(record)[cell.c]?.columnRef ?? null;
}

export function tableCellAddressFromRowRef(
  record: ElementRecord,
  row: unknown,
  column: unknown,
): TableCellAddress | null {
  if (record.src.kind !== 'table' || !Number.isSafeInteger(column) || Number(column) < 0) return null;
  if (typeof row === 'number') {
    const r = orderedTableRows(record).findIndex((entry) => entry.rowRef === row);
    return r < 0 ? null : { r, c: Number(column) };
  }
  if (typeof row !== 'string' || !row) return null;
  const index = orderedTableRows(record).findIndex((entry) => entry.rowRef === row);
  return index < 0 ? null : { r: index, c: Number(column) };
}

export function tableCellAddressFromRefs(
  record: ElementRecord,
  row: unknown,
  column: unknown,
): TableCellAddress | null {
  if (record.src.kind !== 'table') return null;
  const r = orderedTableRows(record).findIndex((entry) => entry.rowRef === row);
  const c = orderedTableColumns(record).findIndex((entry) => entry.columnRef === column);
  return r < 0 || c < 0 ? null : { r, c };
}

export function tableCellAddressFromStableRef(
  record: ElementRecord,
  cell: TableCellRef,
): TableCellAddress | null {
  if (record.src.kind !== 'table') return null;
  const r = orderedTableRows(record).findIndex((entry) => entry.id === cell.row);
  const c = orderedTableColumns(record).findIndex((entry) => entry.id === cell.column);
  return r < 0 || c < 0 ? null : { r, c };
}

export function tableCellOverrideKeyFromRowRef(
  row: TableCellRowRef,
  column: number,
): TableCellKey {
  return typeof row === 'number' ? tableCellKey({ r: row, c: column }) : insertedTableCellKey(row, column);
}

export function tableCellOverrideKeyFromRefs(
  row: TableCellRowRef,
  column: TableCellColumnRef,
): TableCellKey {
  return typeof column === 'number' ? tableCellOverrideKeyFromRowRef(row, column)
    : universalTableCellKey(row, column);
}

export function tableCellOverrideKey(record: ElementRecord, cell: TableCellAddress): TableCellKey {
  const row = tableCellRowRef(record, cell);
  const column = tableCellColumnRef(record, cell);
  if (row === null || column === null) throw new Error(`表格单元格越界：${cell.r},${cell.c}`);
  return tableCellOverrideKeyFromRefs(row, column);
}

export function tableCellKeyResolver(
  record: ElementRecord,
): (key: string) => TableCellAddress | null {
  const rows = orderedTableRows(record);
  const columns = orderedTableColumns(record);
  const sourceRows = new Map(rows.flatMap((entry, index) =>
    entry.source === null ? [] : [[entry.source, index] as const]));
  const sourceColumns = new Map(columns.flatMap((entry, index) =>
    entry.source === null ? [] : [[entry.source, index] as const]));
  const insertedRows = new Map(rows.flatMap((entry, index) =>
    entry.source === null ? [[entry.id, index] as const] : []));
  return (key) => {
    const source = parseTableCellKey(key);
    if (source) {
      const r = sourceRows.get(source.r);
      const c = sourceColumns.get(source.c);
      return record.src.kind === 'table' && r !== undefined && c !== undefined ? { r, c } : null;
    }
    const inserted = parseInsertedTableCellKey(key);
    if (inserted) {
      const r = insertedRows.get(inserted.rowId);
      const c = columns.findIndex((entry) => entry.columnRef === inserted.c);
      return r === undefined || r < 0 || c < 0 ? null : { r, c };
    }
    const universal = parseUniversalTableCellKey(key);
    return universal ? tableCellAddressFromRefs(record, universal.row, universal.column) : null;
  };
}

/** 协同冲突判断必须能解析已被 tombstone 隐藏的格，但不能让普通编辑重新寻址它。 */
export function tableCellStableRefFromKey(
  record: ElementRecord, key: string,
): TableCellRef | null {
  if (record.src.kind !== 'table') return null;
  const unrestricted = {
    ...record,
    ovr: {
      ...record.ovr, tableRemovedRows: undefined, tableRemovedColumns: undefined,
    },
  } satisfies ElementRecord;
  const address = tableCellKeyResolver(unrestricted)(key);
  if (!address) return null;
  const row = orderedTableRows(unrestricted)[address.r];
  const column = orderedTableColumns(unrestricted)[address.c];
  return row && column ? { row: row.id, column: column.id } : null;
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
