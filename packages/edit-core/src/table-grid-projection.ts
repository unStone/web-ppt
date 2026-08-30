import type { TableCell, TableElement, TableRow } from '@web-ppt/core';
import { queryTableGrid, orderedTableColumns, orderedTableRows } from './table-grid';
import { initialFractionalIndex } from './fractional-index';
import { emptyTableCell, tableRowsWithoutTextOverrides } from './table-rows';
import type { EditDoc, ElementRecord } from './types';

export function hasTableStructureOverrides(record: ElementRecord): boolean {
  return !!record.ovr.tableRows || !!record.ovr.tableColumns
    || !!record.ovr.tableRemovedRows || !!record.ovr.tableRemovedColumns
    || !!record.ovr.tableRowHeights || !!record.ovr.tableColumnWidths
    || record.ovr.tableMerges !== undefined;
}

export function hasComplexTableStructureOverrides(record: ElementRecord): boolean {
  if (record.src.kind !== 'table') return false;
  if (record.ovr.tableColumns || record.ovr.tableRemovedRows || record.ovr.tableRemovedColumns
    || record.ovr.tableRowHeights || record.ovr.tableColumnWidths
    || record.ovr.tableMerges !== undefined) return true;
  const sourceLast = initialFractionalIndex(record.src.rows.length - 1);
  return Object.values(record.ovr.tableRows ?? {}).some((row) => row.order <= sourceLast);
}

function normalizedCell(source: TableCell, empty: boolean): TableCell {
  // 合并占位格仍有自己的来源内容；结构删除/拆分后它会重新成为普通逻辑格。
  const cell = empty ? emptyTableCell(source) : structuredClone(source);
  return { ...cell, colSpan: 1, rowSpan: 1, merged: false };
}

/** 稀疏结构覆盖在这里一次性收敛为 core 的矩形二维 Schema。 */
export function projectTableStructure(record: ElementRecord, base: TableElement): TableElement {
  if (record.src.kind !== 'table') throw new Error(`元素 ${record.id} 不是表格`);
  const source = record.src;
  const rows = orderedTableRows(record);
  const columns = orderedTableColumns(record);
  const baseRows = tableRowsWithoutTextOverrides(record);
  const projectedRows: TableRow[] = rows.map((rowEntry, r) => {
    const rowTemplate = rowEntry.source ?? rowEntry.template ?? source.rows.length - 1;
    const templateRow = baseRows[r] ?? source.rows[rowTemplate];
    const cells = columns.map((columnEntry) => {
      const columnTemplate = columnEntry.source ?? columnEntry.template ?? source.colWidths.length - 1;
      const template = columnEntry.source === null
        ? templateRow.cells[columnTemplate] ?? templateRow.cells[templateRow.cells.length - 1]
        : templateRow.cells[columnEntry.source];
      if (!template) throw new Error(`表格 ${record.id} 缺少单元格模板`);
      return normalizedCell(template, rowEntry.source === null || columnEntry.source === null);
    });
    return {
      height: record.ovr.tableRowHeights?.[rowEntry.id] ?? templateRow.height,
      cells,
    };
  });
  const grid = queryTableGrid({ elements: { [record.id]: record } } as EditDoc, record.id);
  for (const merge of grid.merges) {
    const r1 = grid.rows.findIndex((row) => row.id === merge.from.row);
    const r2 = grid.rows.findIndex((row) => row.id === merge.to.row);
    const c1 = grid.columns.findIndex((column) => column.id === merge.from.column);
    const c2 = grid.columns.findIndex((column) => column.id === merge.to.column);
    if ([r1, r2, c1, c2].some((value) => value < 0)) continue;
    const top = Math.min(r1, r2);
    const bottom = Math.max(r1, r2);
    const left = Math.min(c1, c2);
    const right = Math.max(c1, c2);
    projectedRows[top].cells[left] = {
      ...projectedRows[top].cells[left], rowSpan: bottom - top + 1, colSpan: right - left + 1,
    };
    for (let r = top; r <= bottom; r++) for (let c = left; c <= right; c++) {
      if (r !== top || c !== left) projectedRows[r].cells[c] = {
        ...projectedRows[r].cells[c], merged: true, rowSpan: 1, colSpan: 1,
      };
    }
  }
  const colWidths = columns.map((entry) => record.ovr.tableColumnWidths?.[entry.id]
    ?? (entry.source === null
      ? source.colWidths[entry.template ?? source.colWidths.length - 1]
      : source.colWidths[entry.source]));
  const sourceWidth = source.colWidths.reduce((sum, width) => sum + width, 0);
  const sourceHeight = source.rows.reduce((sum, row) => sum + row.height, 0);
  const baseWidth = typeof record.ovr.w === 'number' ? record.ovr.w : base.w;
  const baseHeight = typeof record.ovr.h === 'number' ? record.ovr.h : base.h;
  const width = colWidths.reduce((sum, value) => sum + value, 0);
  const height = projectedRows.reduce((sum, row) => sum + row.height, 0);
  return {
    ...base,
    colWidths,
    rows: projectedRows,
    w: sourceWidth > 0 ? width * baseWidth / sourceWidth : width,
    h: sourceHeight > 0 ? height * baseHeight / sourceHeight : height,
  };
}
