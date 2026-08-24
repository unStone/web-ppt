import type { TextBody } from '@web-ppt/core';
import type { Editor, ElementId, TableCellAddress, TextPosition } from '@web-ppt/edit-core';
import { rangePositions } from './text-dom';
import { sameTextCell } from './text-editor-target';
import type { ActiveText } from './text-editor-types';

export interface TextEditorContext {
  id: ElementId;
  cell: TableCellAddress | null;
  text: TextBody;
  positions: { from: TextPosition; to: TextPosition };
}

export function resolveTextEditorContext(
  editor: Editor,
  active: ActiveText,
  root: HTMLDivElement,
): TextEditorContext | null {
  const dom = rangePositions(root, active.text);
  const selection = editor.selection;
  const positions = dom ?? (selection.kind === 'text' && selection.id === active.id
    && sameTextCell(selection.cell, active.cell)
    ? { from: selection.anchor, to: selection.focus }
    : null);
  return positions
    ? {
      id: active.id,
      cell: active.cell ? { ...active.cell } : null,
      text: active.text,
      positions,
    }
    : null;
}
