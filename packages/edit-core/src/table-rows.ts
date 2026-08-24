import type { TableRow, TextBody } from '@web-ppt/core';
import { initialFractionalIndex } from './fractional-index';
import type { ElementRecord, TableRowId, TableRowInsertion } from './types';

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
  const insertions = orderedTableRowInsertions(record);
  return insertions[insertions.length - 1]?.order ?? initialFractionalIndex(record.src.rows.length - 1);
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
  const insertions = orderedTableRowInsertions(record);
  if (!insertions.length) {
    projectedRows.delete(record);
    return record.src.rows;
  }
  const sourceTemplate = record.src.rows[record.src.rows.length - 1];
  if (!sourceTemplate) throw new Error(`表格 ${record.id} 没有可复制的行`);
  const styles = record.src.editInfo?.tableRowAppend;
  const sourceRows = [...record.src.rows];
  if (styles) sourceRows[sourceRows.length - 1] = styles.previousLast ?? styles.regular[1];
  const nextCache = new Map<TableRowId, AppendedRowProjection>();
  const appended = insertions.map((insertion, index) => {
    const template = index === insertions.length - 1
      ? styles?.last[index % 2]
      : styles?.regular[index % 2];
    const resolved = template ?? sourceTemplate;
    const row = projectedAppendRow(record, insertion.id, resolved);
    nextCache.set(insertion.id, { template: resolved, row });
    return row;
  });
  // 只保留当前稀疏行；撤销后被 redo 截断的 rowId 不得把深克隆格式留到会话结束。
  projectedRows.set(record, nextCache);
  return [
    ...sourceRows,
    ...appended,
  ];
}

export function tableRowHeightDelta(record: ElementRecord): number {
  if (record.src.kind !== 'table') return 0;
  return orderedTableRowInsertions(record).length
    * (record.src.rows[record.src.rows.length - 1]?.height ?? 0);
}

export function effectiveTableFrameHeight(record: ElementRecord): number {
  const base = typeof record.ovr.h === 'number' ? record.ovr.h : record.src.h;
  return base + tableRowHeightDelta(record);
}
