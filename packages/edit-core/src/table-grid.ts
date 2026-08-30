import type { TableRow } from '@web-ppt/core';
import { initialFractionalIndex } from './fractional-index';
import type {
  EditDoc, ElementId, ElementRecord, TableCellColumnRef, TableCellRowRef, TableColumnId,
  TableColumnInsertion, TableMergeRegion, TableRowId, TableRowInsertion,
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
  const rowIds = new Set(rows.map((row) => row.id));
  const columnIds = new Set(columns.map((column) => column.id));
  const merges = effectiveTableMerges(record).filter((merge) =>
    rowIds.has(merge.from.row) && rowIds.has(merge.to.row)
      && columnIds.has(merge.from.column) && columnIds.has(merge.to.column));
  return { rows, columns, merges };
}

export function tableRowTemplate(record: ElementRecord, insertion: TableRowInsertion): TableRow {
  if (record.src.kind !== 'table') throw new Error(`元素 ${record.id} 不是表格`);
  const index = insertion.template ?? record.src.rows.length - 1;
  const row = record.src.rows[index];
  if (!row) throw new Error(`表格 ${record.id} 的行模板无效：${index}`);
  return row;
}
