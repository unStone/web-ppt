import {
  assertTableDimension, isEmptyContentPlaceholder,
  type AddTableCommand, type Editor, type ElementId, type SlideId,
} from '@web-ppt/edit-core';

export interface TableInsertOptions {
  readonly rect?: AddTableCommand['rect'];
  /** 通常无需传；显式工具栏可指定要原子替换的空内容占位符。 */
  readonly placeholderId?: ElementId;
}

function selectedPlaceholder(editor: Editor, slideId: SlideId): ElementId | undefined {
  const selection = editor.selection;
  if (selection.kind !== 'elements' || selection.ids.length !== 1) return undefined;
  const id = selection.ids[0];
  return isEmptyContentPlaceholder(editor.doc, slideId, id) ? id : undefined;
}

function placeholderRect(editor: Editor, slideId: SlideId, id: ElementId): AddTableCommand['rect'] {
  if (!isEmptyContentPlaceholder(editor.doc, slideId, id)) {
    throw new Error(`找不到可替换的空内容占位符：${id}`);
  }
  const element = editor.effectiveElement(id);
  return { x: element.x, y: element.y, w: element.w, h: element.h };
}

/** 无占位符时按内容规模给一个稳定、可用且不越过页面主要安全区的初始 frame。 */
function fittedRect(
  rows: number,
  cols: number,
  width: number,
  height: number,
): AddTableCommand['rect'] {
  const maxWidth = width * 0.8;
  const maxHeight = height * 0.7;
  const tableWidth = Math.min(maxWidth, Math.max(Math.min(320, maxWidth), cols * 120));
  const tableHeight = Math.min(maxHeight, Math.max(Math.min(96, maxHeight), rows * 44));
  return {
    x: (width - tableWidth) / 2, y: (height - tableHeight) / 2,
    w: tableWidth, h: tableHeight,
  };
}

export function insertTable(
  editor: Editor,
  slideId: SlideId,
  rows: number,
  cols: number,
  options: TableInsertOptions = {},
): ElementId {
  assertTableDimension(rows, '表格行数');
  assertTableDimension(cols, '表格列数');
  const explicitPlaceholder = options.placeholderId;
  const placeholderId = explicitPlaceholder
    ?? (options.rect === undefined ? selectedPlaceholder(editor, slideId) : undefined);
  const rect = options.rect ?? (placeholderId
    ? placeholderRect(editor, slideId, placeholderId)
    : fittedRect(rows, cols, editor.doc.meta.width, editor.doc.meta.height));
  const result = editor.exec({
    type: 'AddTable', slideId, rows, cols, rect,
    ...(placeholderId ? { placeholderId } : {}),
  });
  const id = result.forward.find((patch) =>
    patch.op === 'insert' && patch.path[0] === 'elements' && patch.path.length === 2)?.path[1];
  if (!id || editor.doc.elements[id]?.src.kind !== 'table') {
    throw new Error('表格命令没有返回新元素身份');
  }
  return id;
}
