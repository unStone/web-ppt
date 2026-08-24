import { queryBodyProps, slideOfElement } from '@web-ppt/edit-core';
import type {
  Editor, ElementId, SlideId, TextBodyProperties, TextBodyPropertyOverrides,
} from '@web-ppt/edit-core';

function resolveBodyPropsTarget(editor: Editor, slideId: SlideId): ElementId | null {
  const selection = editor.selection;
  const id = selection.kind === 'text' && selection.cell === undefined
    ? selection.id
    : selection.kind === 'elements' && selection.ids.length === 1
      ? selection.ids[0] : null;
  return id && editor.doc.elements[id] && slideOfElement(editor.doc, id) === slideId ? id : null;
}

export function querySelectionBodyProps(editor: Editor, slideId: SlideId): TextBodyProperties | null {
  const id = resolveBodyPropsTarget(editor, slideId);
  if (!id) return null;
  try { return queryBodyProps(editor.doc, id); }
  catch { return null; }
}

export function setSelectionBodyProps(
  editor: Editor,
  slideId: SlideId,
  props: TextBodyPropertyOverrides,
): boolean {
  const id = resolveBodyPropsTarget(editor, slideId);
  if (!id) return false;
  // 无效选区收敛为 false；合法目标的参数错误仍抛出给框架属性面板。
  try { queryBodyProps(editor.doc, id); }
  catch { return false; }
  editor.exec({ type: 'SetBodyProps', id, props });
  return true;
}
