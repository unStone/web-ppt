import { slideOfElement } from '@web-ppt/edit-core';
import type { KeyboardControllerOptions } from './keyboard-context';
import { shouldYieldKeyboardEvent } from './keyboard-owner';

/** 历史快捷键只负责把画布事件路由到公开 Editor；历史语义仍由 headless 内核拥有。 */
export class HistoryKeyboardController {
  constructor(private readonly options: KeyboardControllerOptions) {}

  keyDown(event: KeyboardEvent): boolean {
    if (event.defaultPrevented) return false;
    const primary = event.ctrlKey !== event.metaKey && (event.ctrlKey || event.metaKey);
    const key = event.key.toLowerCase();
    const action = key === 'z' ? event.shiftKey ? 'redo' : 'undo'
      : key === 'y' && !event.shiftKey ? 'redo' : null;
    if (!primary || event.altKey || !action || shouldYieldKeyboardEvent(event)) return false;
    event.preventDefault();
    if (this.options.gestureActive()) return true;
    const change = this.options.editor[action]();
    if (!change) return true;
    const selection = change.selection;
    const elementId = selection.kind === 'elements' ? selection.ids[0]
      : selection.kind === 'none' ? null : selection.id;
    const structuralSlide = change.createdSlides.values().next().value;
    const slideId = structuralSlide ?? (elementId
      ? slideOfElement(this.options.editor.doc, elementId)
      : change.removedSlideFallbacks.values().next().value
        ?? change.dirtySlides.values().next().value);
    if (slideId) this.options.revealSlide(slideId);
    return true;
  }
}
