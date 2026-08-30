import type { TableCell, TableRow, TextBody } from '@web-ppt/core';
import type { ElementRecord, TableRowId, TableRowInsertion } from './types';
import { initialFractionalIndex } from './fractional-index';
import { orderedTableRows, tableRowTemplate } from './table-grid';

export interface OrderedTableRowInsertion extends TableRowInsertion {
  readonly id: TableRowId;
}

interface AppendedRowProjection {
  readonly template: TableRow;
  readonly row: TableRow;
}

const projectedRows = new WeakMap<ElementRecord, Map<TableRowId, AppendedRowProjection>>();

export function orderedTableRowInsertions(record: ElementRecord): OrderedTableRowInsertion[] {
  return Object.entries(record.ovr.tableRows ?? {})
    .map(([id, insertion]) => ({ id, ...insertion }))
    .sort((left, right) => left.order < right.order ? -1 : left.order > right.order ? 1 : 0);
}

export function lastTableRowOrder(record: ElementRecord): string {
  if (record.src.kind !== 'table' || !record.src.rows.length) throw new Error(`表格 ${record.id} 没有可复制的行`);
  const rows = orderedTableRows(record);
  return rows[rows.length - 1].order;
}

function emptyTextTemplate(body: TextBody): TextBody {
  const paragraph = body.paragraphs[0];
  const run = paragraph?.runs[0];
  if (!paragraph || !run) throw new Error('表格行模板缺少可继承的段落与字符格式');
  return {
    ...structuredClone(body),
    paragraphs: [{
      ...structuredClone(paragraph),
      runs: [{ ...structuredClone(run), text: '', math: undefined }],
    }],
  };
}

export function emptyTableCell(source: TableCell): TableCell {
  const body = source.text ?? source.editInfo?.textTemplate;
  if (!body) throw new Error('表格单元格模板缺少文本体');
  return {
    ...structuredClone(source),
    colSpan: 1,
    rowSpan: 1,
    merged: false,
    text: null,
    editInfo: { ...structuredClone(source.editInfo), textTemplate: emptyTextTemplate(body) },
  };
}

/** 纵向合并只属于旧行区；新增尾行仅继承原末行的横向合并拓扑。 */
function emptyAppendRow(source: TableRow): TableRow {
  let coveredUntil = 0;
  return {
    height: source.height,
    cells: source.cells.map((cell, column) => {
      const horizontalPlaceholder = column < coveredUntil;
      if (!horizontalPlaceholder) coveredUntil = Math.max(coveredUntil, column + Math.max(1, cell.colSpan));
      const body = cell.text ?? cell.editInfo?.textTemplate;
      if (!body) throw new Error(`表格行模板第 ${column} 格缺少文本体`);
      const template = emptyTextTemplate(body);
      return {
        ...structuredClone(cell),
        colSpan: horizontalPlaceholder ? 1 : Math.max(1, cell.colSpan),
        rowSpan: 1,
        merged: horizontalPlaceholder,
        text: null,
        editInfo: { textTemplate: template },
      };
    }),
  };
}

function projectedAppendRow(record: ElementRecord, id: TableRowId, template: TableRow): TableRow {
  const cached = projectedRows.get(record)?.get(id);
  if (cached?.template === template) return cached.row;
  return emptyAppendRow(template);
}

export function tableRowsWithoutTextOverrides(record: ElementRecord): TableRow[] {
  if (record.src.kind !== 'table') throw new Error(`元素 ${record.id} 不是表格`);
  const source = record.src;
  const insertions = orderedTableRowInsertions(record);
  if (!insertions.length) {
    projectedRows.delete(record);
    const rows = orderedTableRows(record);
    return rows.length === source.rows.length
      ? source.rows
      : rows.map((entry) => source.rows[entry.source!]);
  }
  const styles = source.editInfo?.tableRowAppend;
  const allAppended = insertions.every((insertion) =>
    insertion.order > initialFractionalIndex(source.rows.length - 1));
  const sourceRows = [...source.rows];
  if (styles && allAppended) sourceRows[sourceRows.length - 1] = styles.previousLast ?? styles.regular[1];
  const nextCache = new Map<TableRowId, AppendedRowProjection>();
  const appendedIndex = new Map(insertions.map((insertion, index) => [insertion.id, index]));
  const rows = orderedTableRows(record).map((entry) => {
    if (entry.source !== null) return sourceRows[entry.source];
    const index = appendedIndex.get(entry.id)!;
    const styleTemplate = allAppended
      ? (index === insertions.length - 1 ? styles?.last[index % 2] : styles?.regular[index % 2])
      : undefined;
    const resolved = styleTemplate ?? tableRowTemplate(record, entry);
    const row = projectedAppendRow(record, entry.id, resolved);
    nextCache.set(entry.id, { template: resolved, row });
    return row;
  });
  // 只保留当前稀疏行；撤销后被 redo 截断的 rowId 不得把深克隆格式留到会话结束。
  projectedRows.set(record, nextCache);
  return rows;
}

export function tableRowHeightDelta(record: ElementRecord): number {
  if (record.src.kind !== 'table') return 0;
  const base = typeof record.ovr.h === 'number' ? record.ovr.h : record.src.h;
  const scale = record.src.h > 0 ? base / record.src.h : 1;
  return orderedTableRowInsertions(record)
    .reduce((sum, insertion) => sum + tableRowTemplate(record, insertion).height, 0) * scale;
}

export function effectiveTableFrameHeight(record: ElementRecord): number {
  const base = typeof record.ovr.h === 'number' ? record.ovr.h : record.src.h;
  return base + tableRowHeightDelta(record);
}

/** SetXfrm 面向当前可见整表；稀疏覆盖保存的是追加前 frame，故需反解同一缩放比例。 */
export function tableBaseFrameHeight(record: ElementRecord, effectiveHeight: number): number {
  if (record.src.kind !== 'table') return effectiveHeight;
  const appended = orderedTableRowInsertions(record)
    .reduce((sum, insertion) => sum + tableRowTemplate(record, insertion).height, 0);
  return record.src.h > 0 ? effectiveHeight * record.src.h / (record.src.h + appended) : effectiveHeight;
}
