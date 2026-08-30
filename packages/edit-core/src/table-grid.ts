import type { TableRow } from '@web-ppt/core';
import { initialFractionalIndex } from './fractional-index';
import type {
  EditDoc, ElementId, ElementRecord, TableCellColumnRef, TableCellRowRef, TableColumnId,
  TableCellRef, TableColumnInsertion, TableMergeRegion, TableRowId, TableRowInsertion,
} from './types';

export interface TableGridRow {
  readonly id: TableRowId;
  readonly source: number | null;
  readonly height: number;
}

export interface TableGridColumn {
  readonly id: string;
  readonly source: number | null;
  readonly width: number;
}

export interface TableGridState {
  readonly rows: readonly TableGridRow[];
  readonly columns: readonly TableGridColumn[];
  readonly merges: readonly TableMergeRegion[];
}

export interface TableGridIdentities {
  readonly rows: readonly TableRowId[];
  readonly columns: readonly TableColumnId[];
}

export interface OrderedTableColumn extends TableColumnInsertion {
  readonly id: TableColumnId;
  readonly columnRef: TableCellColumnRef;
  readonly source: number | null;
}

export interface OrderedTableRow extends TableRowInsertion {
  readonly id: TableRowId;
  readonly rowRef: TableCellRowRef;
  readonly source: number | null;
}

export function sourceTableRowId(index: number): TableRowId { return `#r${index}`; }
export function sourceTableColumnId(index: number): string { return `#c${index}`; }
export function isReservedTableRowId(id: string): boolean { return /^#r\d+$/.test(id); }
export function isReservedTableColumnId(id: string): boolean { return /^#c\d+$/.test(id); }

export function tableGridIdentities(doc: EditDoc, id: ElementId): TableGridIdentities {
  const record = doc.elements[id];
  if (!record || record.src.kind !== 'table') throw new Error(`找不到表格：${id}`);
  return {
    rows: [
      ...record.src.rows.map((_, index) => sourceTableRowId(index)),
      ...Object.keys(record.ovr.tableRows ?? {}),
    ],
    columns: [
      ...record.src.colWidths.map((_, index) => sourceTableColumnId(index)),
      ...Object.keys(record.ovr.tableColumns ?? {}),
    ],
  };
}

export function orderedTableRows(record: ElementRecord): OrderedTableRow[] {
  if (record.src.kind !== 'table') throw new Error(`元素 ${record.id} 不是表格`);
  return [
    ...record.src.rows.map((_, source) => ({
      id: sourceTableRowId(source), rowRef: source, source,
      order: initialFractionalIndex(source),
    })),
    ...Object.entries(record.ovr.tableRows ?? {}).map(([id, insertion]) => ({
      id, rowRef: id, source: null, ...insertion,
    })),
  ].filter((row) => !record.ovr.tableRemovedRows?.[row.id])
    .sort((left, right) => left.order < right.order ? -1 : left.order > right.order ? 1
      : left.id < right.id ? -1 : 1);
}

export function orderedTableColumns(record: ElementRecord): OrderedTableColumn[] {
  if (record.src.kind !== 'table') throw new Error(`元素 ${record.id} 不是表格`);
  return [
    ...record.src.colWidths.map((_, source) => ({
      id: sourceTableColumnId(source), columnRef: source, source,
      order: initialFractionalIndex(source),
    })),
    ...Object.entries(record.ovr.tableColumns ?? {}).map(([id, insertion]) => ({
      id, columnRef: id, source: null, ...insertion,
    })),
  ].filter((column) => !record.ovr.tableRemovedColumns?.[column.id])
    .sort((left, right) => left.order < right.order ? -1 : left.order > right.order ? 1
      : left.id < right.id ? -1 : 1);
}

export function tableRowById(record: ElementRecord, id: TableRowId): OrderedTableRow | null {
  return orderedTableRows(record).find((row) => row.id === id) ?? null;
}

export function tableColumnById(record: ElementRecord, id: TableColumnId): OrderedTableColumn | null {
  return orderedTableColumns(record).find((column) => column.id === id) ?? null;
}

export function sourceTableMerges(record: ElementRecord): TableMergeRegion[] {
  if (record.src.kind !== 'table') throw new Error(`元素 ${record.id} 不是表格`);
  const merges: TableMergeRegion[] = [];
  record.src.rows.forEach((row, r) => row.cells.forEach((cell, c) => {
    if (cell.merged || (cell.rowSpan <= 1 && cell.colSpan <= 1)) return;
    merges.push({
      from: { row: sourceTableRowId(r), column: sourceTableColumnId(c) },
      to: {
        row: sourceTableRowId(r + cell.rowSpan - 1),
        column: sourceTableColumnId(c + cell.colSpan - 1),
      },
    });
  }));
  return merges;
}

export function effectiveTableMerges(record: ElementRecord): readonly TableMergeRegion[] {
  return record.ovr.tableMerges ?? sourceTableMerges(record);
}

export function tableCellMergeRole(
  record: ElementRecord, cell: TableCellRef,
): 'anchor' | 'placeholder' | null {
  if (record.src.kind !== 'table') return null;
  const complete = {
    ...record,
    ovr: { ...record.ovr, tableRemovedRows: undefined, tableRemovedColumns: undefined },
  } satisfies ElementRecord;
  const rows = orderedTableRows(complete);
  const columns = orderedTableColumns(complete);
  const point = {
    r: rows.findIndex((row) => row.id === cell.row),
    c: columns.findIndex((column) => column.id === cell.column),
  };
  if (point.r < 0 || point.c < 0) return null;
  for (const merge of effectiveTableMerges(record)) {
    const endpoints = [
      rows.findIndex((row) => row.id === merge.from.row),
      columns.findIndex((column) => column.id === merge.from.column),
      rows.findIndex((row) => row.id === merge.to.row),
      columns.findIndex((column) => column.id === merge.to.column),
    ];
    if (endpoints.some((index) => index < 0)) continue;
    const [r1, c1, r2, c2] = [
      Math.min(endpoints[0], endpoints[2]), Math.min(endpoints[1], endpoints[3]),
      Math.max(endpoints[0], endpoints[2]), Math.max(endpoints[1], endpoints[3]),
    ];
    if (point.r < r1 || point.r > r2 || point.c < c1 || point.c > c2) continue;
    return point.r === r1 && point.c === c1 ? 'anchor' : 'placeholder';
  }
  return null;
}

function visibleTableMerges(
  record: ElementRecord, rows: readonly { id: string }[], columns: readonly { id: string }[],
): TableMergeRegion[] {
  const unrestricted = {
    ...record,
    ovr: { ...record.ovr, tableRemovedRows: undefined, tableRemovedColumns: undefined },
  } satisfies ElementRecord;
  const allRows = orderedTableRows(unrestricted);
  const allColumns = orderedTableColumns(unrestricted);
  const visibleRows = new Set(rows.map((row) => row.id));
  const visibleColumns = new Set(columns.map((column) => column.id));
  return effectiveTableMerges(record).flatMap((merge) => {
    const r1 = allRows.findIndex((row) => row.id === merge.from.row);
    const r2 = allRows.findIndex((row) => row.id === merge.to.row);
    const c1 = allColumns.findIndex((column) => column.id === merge.from.column);
    const c2 = allColumns.findIndex((column) => column.id === merge.to.column);
    if ([r1, r2, c1, c2].some((index) => index < 0)) return [];
    const remainingRows = allRows.slice(Math.min(r1, r2), Math.max(r1, r2) + 1)
      .filter((row) => visibleRows.has(row.id));
    const remainingColumns = allColumns.slice(Math.min(c1, c2), Math.max(c1, c2) + 1)
      .filter((column) => visibleColumns.has(column.id));
    if (remainingRows.length * remainingColumns.length <= 1) return [];
    return [{
      from: { row: remainingRows[0].id, column: remainingColumns[0].id },
      to: {
        row: remainingRows[remainingRows.length - 1].id,
        column: remainingColumns[remainingColumns.length - 1].id,
      },
    }];
  });
}

export function queryTableGrid(doc: EditDoc, id: ElementId): TableGridState {
  const record = doc.elements[id];
  if (!record || record.src.kind !== 'table') throw new Error(`找不到表格：${id}`);
  const source = record.src;
  const rows = orderedTableRows(record).map((entry) => ({
    id: entry.id,
    source: entry.source,
    height: record.ovr.tableRowHeights?.[entry.id] ?? (entry.source === null
      ? source.rows[entry.template ?? source.rows.length - 1]?.height ?? 0
      : source.rows[entry.source].height),
  }));
  const columns = orderedTableColumns(record).map((entry) => ({
    id: entry.id,
    source: entry.source,
    width: record.ovr.tableColumnWidths?.[entry.id] ?? (entry.source === null
      ? source.colWidths[entry.template ?? source.colWidths.length - 1] ?? 0
      : source.colWidths[entry.source]),
  }));
  const merges = visibleTableMerges(record, rows, columns)
    .map((merge) => ({ from: { ...merge.from }, to: { ...merge.to } }));
  return { rows, columns, merges };
}

export function tableRowTemplate(record: ElementRecord, insertion: TableRowInsertion): TableRow {
  if (record.src.kind !== 'table') throw new Error(`元素 ${record.id} 不是表格`);
  const index = insertion.template ?? record.src.rows.length - 1;
  const row = record.src.rows[index];
  if (!row) throw new Error(`表格 ${record.id} 的行模板无效：${index}`);
  return row;
}
