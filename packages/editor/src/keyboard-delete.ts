import { slideOfElement } from '@web-ppt/edit-core';
import type { KeyboardControllerOptions } from './keyboard-context';
import { shouldYieldKeyboardEvent } from './keyboard-owner';
import { isSelectable } from './selection-hit';
import { outermostSelectedElementIds } from './selection-roots';

/** 删除键只组合公开命令；占位符清空与递归删除语义由 headless RemoveElement 决定。 */
export class DeleteKeyboardController {
  constructor(private readonly options: KeyboardControllerOptions) {}

  keyDown(event: KeyboardEvent): boolean {
    if (event.defaultPrevented || (event.key !== 'Delete' && event.key !== 'Backspace')
      || event.ctrlKey || event.metaKey || event.altKey || shouldYieldKeyboardEvent(event)) return false;
    event.preventDefault();
    if (this.options.gestureActive()) return true;
    const selection = this.options.editor.selection;
    if (selection.kind !== 'elements') return true;
    const doc = this.options.editor.doc;
    if (selection.ids.some((id) => slideOfElement(doc, id) !== this.options.slideId()
      || !isSelectable(doc, id))) return true;
    const roots = outermostSelectedElementIds(doc, selection.ids);
    if (!roots.length) return true;
    this.options.editor.transaction((transaction) => {
      for (const id of roots) transaction.exec({ type: 'RemoveElement', id });
    }, '删除元素');
    return true;
  }
}
