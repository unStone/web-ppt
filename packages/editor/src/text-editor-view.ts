import { renderTextBodyToHtml } from '@web-ppt/core';
import type { TextPosition } from '@web-ppt/edit-core';
import { domPointAt } from './text-dom';
import type { ActiveText } from './text-editor-types';

export function createTextEditorRoot(
  document: Document,
  active: ActiveText,
  layout: 'browser' | 'engine',
): HTMLDivElement {
  const root = document.createElement('div');
  root.dataset.pptTextEditor = active.id;
  if (active.cell) root.dataset.pptTextCell = `${active.cell.r}:${active.cell.c}`;
  root.setAttribute('contenteditable', 'true');
  root.setAttribute('role', 'textbox');
  root.setAttribute('aria-multiline', 'true');
  root.spellcheck = false;
  root.style.position = 'absolute';
  root.style.left = '0';
  root.style.top = '0';
  root.style.width = `${active.width}px`;
  root.style.height = `${active.height}px`;
  root.style.transformOrigin = '0 0';
  const { matrix } = active;
  root.style.transform = `matrix(${matrix.a},${matrix.b},${matrix.c},${matrix.d},${matrix.e},${matrix.f})`;
  root.style.pointerEvents = 'auto';
  root.style.outline = 'none';
  root.innerHTML = renderTextBodyToHtml(active.text, active.width, active.height, {
    includeEditMarkers: true,
    layout,
    ...(active.insets ? { insets: active.insets } : {}),
    ...(active.anchor ? { anchor: active.anchor } : {}),
    ...(active.vert ? { vert: active.vert } : {}),
  });
  for (const formula of root.querySelectorAll<HTMLElement>('svg[data-r]')) {
    formula.contentEditable = 'false';
  }
  return root;
}

export function setTextDomSelection(
  root: HTMLDivElement,
  anchor: TextPosition,
  focus: TextPosition,
): void {
  const start = domPointAt(root, anchor);
  const end = domPointAt(root, focus);
  const selection = root.ownerDocument.defaultView?.getSelection();
  if (!start || !end || !selection) return;
  const range = root.ownerDocument.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  selection.removeAllRanges();
  selection.addRange(range);
}
