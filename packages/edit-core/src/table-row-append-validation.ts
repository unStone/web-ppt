import type { TableElement, TableRow, TextBody } from '@web-ppt/core';
import { assertDataObject } from './data-validation';

function assertTextTemplate(value: unknown, label: string): asserts value is TextBody {
  if (!value || typeof value !== 'object' || !Array.isArray((value as TextBody).paragraphs)
    || !(value as TextBody).paragraphs.length
    || !Array.isArray((value as TextBody).paragraphs[0]?.runs)
    || !(value as TextBody).paragraphs[0].runs.length) {
    throw new Error(`${label} 缺少可继承的段落与字符格式`);
  }
}

function assertTemplateRow(value: unknown, columns: number, label: string): asserts value is TableRow {
  assertDataObject(value, ['height', 'cells'], label);
  const row = value as TableRow;
  if (!Number.isFinite(row.height) || row.height <= 0 || !Array.isArray(row.cells)
    || row.cells.length !== columns) throw new Error(`${label} 的尺寸或列数无效`);
  row.cells.forEach((cell, index) => {
    assertDataObject(cell, [
      'colSpan', 'rowSpan', 'merged', 'fill', 'text', 'borders', 'margins', 'vAlign', 'vert', 'editInfo',
    ], `${label}.cells[${index}]`);
    if (!Number.isSafeInteger(cell.colSpan) || cell.colSpan < 1
      || !Number.isSafeInteger(cell.rowSpan) || cell.rowSpan < 1
      || typeof cell.merged !== 'boolean') throw new Error(`${label}.cells[${index}] 的合并拓扑无效`);
    const body = cell.text ?? cell.editInfo?.textTemplate;
    assertTextTemplate(body, `${label}.cells[${index}]`);
  });
}

/** tableRowAppend 是公开剪贴板与 EditDoc 的结构入口，不能等到投影时才发现坏模板。 */
export function assertTableRowAppendEditInfo(table: TableElement, label: string): void {
  const append = table.editInfo?.tableRowAppend;
  if (append === undefined) return;
  assertDataObject(append, ['previousLast', 'regular', 'last'], `${label}.tableRowAppend`);
  if (!Array.isArray(append.regular) || append.regular.length !== 2
    || !Array.isArray(append.last) || append.last.length !== 2
    || !Array.isArray(table.colWidths) || !table.colWidths.length) {
    throw new Error(`${label}.tableRowAppend 的奇偶模板无效`);
  }
  if (append.previousLast !== undefined) {
    assertTemplateRow(append.previousLast, table.colWidths.length, `${label}.tableRowAppend.previousLast`);
  }
  append.regular.forEach((row, index) =>
    assertTemplateRow(row, table.colWidths.length, `${label}.tableRowAppend.regular[${index}]`));
  append.last.forEach((row, index) =>
    assertTemplateRow(row, table.colWidths.length, `${label}.tableRowAppend.last[${index}]`));
}
