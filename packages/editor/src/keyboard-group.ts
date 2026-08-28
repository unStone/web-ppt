import { outermostSelectedElementIds, slideOfElement } from '@web-ppt/edit-core';
import type { KeyboardControllerOptions } from './keyboard-context';
import { shouldYieldKeyboardEvent } from './keyboard-owner';
import { isSelectable } from './selection-hit';

/** 组合快捷键只编排公开 Group/Ungroup；不可逆原因由 headless 命令原样上报宿主。 */
export class GroupKeyboardController {
  constructor(private readonly options: KeyboardControllerOptions) {}

  keyDown(event: KeyboardEvent): boolean {
    const hasOnePrimary = event.ctrlKey !== event.metaKey;
    if (event.defaultPrevented || event.key.toLowerCase() !== 'g' || !hasOnePrimary
      || event.altKey || shouldYieldKeyboardEvent(event)) return false;
    event.preventDefault();
    if (this.options.gestureActive()) return true;
    const selection = this.options.editor.selection;
    if (selection.kind !== 'elements') return true;
    const doc = this.options.editor.doc;
    if (selection.ids.some((id) => slideOfElement(doc, id) !== this.options.slideId()
      || !isSelectable(doc, id))) return true;
    const roots = outermostSelectedElementIds(doc, selection.ids);
    try {
      if (event.shiftKey) {
        if (roots.length !== 1 || doc.elements[roots[0]]?.src.kind !== 'group') return true;
        this.options.editor.transaction((transaction) => {
          transaction.exec({ type: 'Ungroup', id: roots[0] });
        }, '解组元素');
        return true;
      }
      if (roots.length < 2) return true;
      const parent = doc.elements[roots[0]]?.parent;
      if (!parent || roots.some((id) => doc.elements[id]?.parent !== parent)) return true;
      this.options.editor.transaction((transaction) => {
        transaction.exec({ type: 'Group', ids: roots });
      }, '组合元素');
    } catch (error) {
      if (this.options.onError) this.options.onError(error);
      else {
        const reporter = (globalThis as typeof globalThis & { reportError?: (reason: unknown) => void })
          .reportError;
        if (reporter) reporter(error);
        else console.error('组合快捷键执行失败', error);
      }
    }
    return true;
  }
}
