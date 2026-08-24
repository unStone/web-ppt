import type { TableElement } from '@web-ppt/core';
import {
  composeSpaceMatrices, elementContentToSlideMatrix, elementFrameToSlideMatrix,
} from '@web-ppt/edit-core';
import type { Editor, TableCellAddress } from '@web-ppt/edit-core';
import type { ActiveText } from './text-editor-types';

const translation = (x: number, y: number) => ({ a: 1, b: 0, c: 0, d: 1, e: x, f: y });

function tableCellFrame(table: TableElement, address: TableCellAddress) {
  const cell = table.rows[address.r]?.cells[address.c];
  const text = cell?.text ?? cell?.editInfo?.textTemplate;
  if (!cell || cell.merged || !text) return null;
  return {
    cell, text,
    x: table.colWidths.slice(0, address.c).reduce((sum, width) => sum + width, 0),
    y: table.rows.slice(0, address.r).reduce((sum, row) => sum + row.height, 0),
    width: table.colWidths.slice(address.c, address.c + cell.colSpan)
      .reduce((sum, width) => sum + width, 0) || table.colWidths[address.c] || 0,
    height: table.rows.slice(address.r, address.r + cell.rowSpan)
      .reduce((sum, row) => sum + row.height, 0) || table.rows[address.r].height,
  };
}

export function resolveActiveText(
  editor: Editor,
  id: string,
  address: TableCellAddress | null,
): ActiveText | null {
  const record = editor.doc.elements[id];
  if (!record || record.meta.editable !== 'full') return null;
  const element = editor.effectiveElement(id);
  if (!address) {
    const text = element.kind === 'shape' ? element.text ?? record.meta.textTemplate : null;
    return element.kind === 'shape' && text
      ? {
        id, text, width: element.w, height: element.h,
        matrix: elementFrameToSlideMatrix(editor.doc, id),
      }
      : null;
  }
  if (element.kind !== 'table') return null;
  const frame = tableCellFrame(element, address);
  if (!frame) return null;
  const matrix = elementContentToSlideMatrix(editor.doc, id);
  return {
    id,
    cell: { ...address },
    text: frame.text,
    width: frame.width,
    height: frame.height,
    matrix: composeSpaceMatrices(matrix, translation(frame.x, frame.y)),
    ...(frame.cell.margins ? { insets: frame.cell.margins } : {}),
    ...(frame.cell.vAlign ? { anchor: frame.cell.vAlign } : {}),
    ...(frame.cell.vert ? { vert: frame.cell.vert } : {}),
  };
}

export function editableTableCells(table: TableElement): TableCellAddress[] {
  return table.rows.flatMap((row, r) => row.cells.flatMap((cell, c) =>
    !cell.merged && (cell.text || cell.editInfo?.textTemplate) ? [{ r, c }] : []));
}

export function nextEditableTableCell(
  table: TableElement,
  current: TableCellAddress,
  reverse: boolean,
): TableCellAddress | null {
  const cells = editableTableCells(table);
  const index = cells.findIndex((cell) => cell.r === current.r && cell.c === current.c);
  return cells[index + (reverse ? -1 : 1)] ?? null;
}
