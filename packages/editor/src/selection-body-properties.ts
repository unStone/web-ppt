import { queryBodyProps, slideOfElement } from '@web-ppt/edit-core';
import type {
  Editor, ElementId, SlideId, TableCellAddress, TextBodyProperties, TextBodyPropertyOverrides,
} from '@web-ppt/edit-core';

interface BodyPropsTarget { readonly id: ElementId; readonly cell?: TableCellAddress }

function resolveBodyPropsTarget(editor: Editor, slideId: SlideId): BodyPropsTarget | null {
  const selection = editor.selection;
  const target = selection.kind === 'text'
    ? { id: selection.id, ...(selection.cell !== undefined ? { cell: selection.cell } : {}) }
    : selection.kind === 'elements' && selection.ids.length === 1
      ? { id: selection.ids[0] } : null;
  return target && editor.doc.elements[target.id]
    && slideOfElement(editor.doc, target.id) === slideId ? target : null;
}

export function querySelectionBodyProps(editor: Editor, slideId: SlideId): TextBodyProperties | null {
  const target = resolveBodyPropsTarget(editor, slideId);
  if (!target) return null;
  try { return queryBodyProps(editor.doc, target.id, target.cell); }
  catch { return null; }
}

export function setSelectionBodyProps(
  editor: Editor,
  slideId: SlideId,
  props: TextBodyPropertyOverrides,
): boolean {
  const target = resolveBodyPropsTarget(editor, slideId);
  if (!target) return false;
  // 无效选区收敛为 false；合法目标的参数错误仍抛出给框架属性面板。
  try { queryBodyProps(editor.doc, target.id, target.cell); }
  catch { return false; }
  editor.exec({ type: 'SetBodyProps', id: target.id, ...('cell' in target ? { cell: target.cell } : {}), props });
  return true;
}
