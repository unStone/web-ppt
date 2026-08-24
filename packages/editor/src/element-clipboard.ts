import {
  copyElements, outermostSelectedElementIds, slideOfElement,
} from '@web-ppt/edit-core';
import type { Editor, ElementClipboardPayload, ElementId, SlideId } from '@web-ppt/edit-core';
import { shouldYieldClipboardEvent, shouldYieldKeyboardEvent } from './keyboard-owner';

export const ELEMENT_CLIPBOARD_MIME = 'application/x-web-ppt-elements+json';

interface ElementClipboardOptions {
  editor: Editor;
  slideId(): SlideId;
  editable(): boolean;
  gestureActive(): boolean;
  insertImage(file: File): Promise<ElementId>;
}

function reportClipboardError(error: unknown): void {
  const reporter = (globalThis as typeof globalThis & { reportError?: (reason: unknown) => void }).reportError;
  if (reporter) reporter(error);
  else console.error('元素剪贴板操作失败', error);
}

export class ElementClipboardController {
  private readonly options: ElementClipboardOptions;

  constructor(options: ElementClipboardOptions) { this.options = options; }

  copy(event: ClipboardEvent): void { this.write(event, false); }
  cut(event: ClipboardEvent): void { this.write(event, true); }

  paste(event: ClipboardEvent): void {
    if (this.shouldYieldBase(event)) return;
    const json = event.clipboardData?.getData(ELEMENT_CLIPBOARD_MIME);
    if (!json) {
      const image = [...(event.clipboardData?.files ?? [])].find((file) =>
        file.type.startsWith('image/'));
      if (!image) return;
      event.preventDefault();
      void this.options.insertImage(image).catch(reportClipboardError);
      return;
    }
    event.preventDefault();
    try {
      const payload = JSON.parse(json) as ElementClipboardPayload;
      this.pastePayload(payload);
    } catch (error) {
      reportClipboardError(error);
    }
  }

  duplicate(event: KeyboardEvent): boolean {
    const modifier = event.ctrlKey !== event.metaKey && (event.ctrlKey || event.metaKey);
    if (!modifier || event.altKey || event.shiftKey || event.repeat || event.key.toLowerCase() !== 'd'
      || !this.options.editable() || this.options.gestureActive() || shouldYieldKeyboardEvent(event)) {
      return false;
    }
    const selection = this.selectedRoots();
    if (!selection.length) return false;
    try {
      this.pastePayload(copyElements(this.options.editor.doc, selection));
      event.preventDefault();
      return true;
    } catch (error) {
      reportClipboardError(error);
      return false;
    }
  }

  private shouldYield(event: ClipboardEvent): boolean {
    return this.shouldYieldBase(event) || !this.selectedRoots().length;
  }

  private shouldYieldBase(event: ClipboardEvent): boolean {
    const selection = this.options.editor.selection;
    return !this.options.editable() || this.options.gestureActive()
      || selection.kind === 'text' || selection.kind === 'table'
      || shouldYieldClipboardEvent(event);
  }

  private selectedRoots(): ElementId[] {
    const selection = this.options.editor.selection;
    if (selection.kind !== 'elements' || !selection.ids.length) return [];
    const slideId = this.options.slideId();
    if (selection.ids.some((id) => slideOfElement(this.options.editor.doc, id) !== slideId)) return [];
    return outermostSelectedElementIds(this.options.editor.doc, selection.ids);
  }

  private write(event: ClipboardEvent, cut: boolean): void {
    if (this.shouldYield(event) || !event.clipboardData) return;
    const roots = this.selectedRoots();
    try {
      const json = JSON.stringify(copyElements(this.options.editor.doc, roots));
      event.clipboardData.setData(ELEMENT_CLIPBOARD_MIME, json);
      event.clipboardData.setData('text/plain', json);
      event.preventDefault();
      if (!cut) return;
      this.options.editor.transaction((transaction) => {
        transaction.exec(...roots.map((id) => ({ type: 'RemoveElement' as const, id })));
        transaction.select({ kind: 'none' });
      }, '剪切元素');
    } catch (error) {
      reportClipboardError(error);
    }
  }

  private pastePayload(payload: ElementClipboardPayload): void {
    const selection = this.options.editor.selection;
    const enteredGroup = selection.kind === 'elements' ? selection.enteredGroup : null;
    const parentId = enteredGroup && slideOfElement(this.options.editor.doc, enteredGroup) === this.options.slideId()
      ? enteredGroup : this.options.slideId();
    this.options.editor.exec({
      type: 'PasteElements', payload,
      at: { parentId, x: payload.bounds.left + 10, y: payload.bounds.top + 10 },
    });
  }
}
