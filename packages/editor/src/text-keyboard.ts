import { textBodyEditText, textPositionAtIndex, textPositionToIndex } from '@web-ppt/edit-core';
import type { Editor, ParagraphPropertyOverrides, TableCellAddress, TextPosition } from '@web-ppt/edit-core';
import type { TextEditorContext } from './text-editor-context';
import { textTargetFields } from './text-editor-target';

interface TextKeyboardOptions {
  editor: Editor;
  composing(): boolean;
  activeCell(): TableCellAddress | null;
  context(): TextEditorContext | null;
  close(selectElement?: boolean): void;
  navigateTableCell(reverse: boolean): void;
  changeListLevel(delta: -1 | 1): void;
  formatSelection(field: 'b' | 'i' | 'u'): boolean;
  stepFontSize(direction: -1 | 1): boolean;
  setParaProps(props: ParagraphPropertyOverrides): boolean;
  restoreSelection(from: TextPosition, to: TextPosition): void;
  selectAllElements(): void;
  documentKeyDown(event: KeyboardEvent): boolean;
}

function primary(event: KeyboardEvent): boolean {
  return event.ctrlKey !== event.metaKey;
}

/** contenteditable 保留唯一 keydown 监听；这里只把已承诺键位路由到模型 seam。 */
export class TextKeyboardController {
  constructor(private readonly options: TextKeyboardOptions) {}

  bind(root: HTMLDivElement): void {
    root.addEventListener('keydown', (event) => this.keyDown(root, event));
  }

  private finish(event: KeyboardEvent): void {
    event.preventDefault();
    event.stopPropagation();
  }

  private forwardDocumentKey(event: KeyboardEvent): boolean {
    // Chrome 在组词边界会用 keyCode 229；此时切页会移除 editable，未提交 DOM 文本将永久丢失。
    return !this.options.composing() && !event.isComposing && event.keyCode !== 229
      && this.options.documentKeyDown(event);
  }

  private selectAll(root: HTMLDivElement): boolean {
    const context = this.options.composing() ? null : this.options.context();
    if (!context) return false;
    const length = textBodyEditText(context.text).length;
    const from = textPositionToIndex(context.text, context.positions.from);
    const to = textPositionToIndex(context.text, context.positions.to);
    if (from === 0 && to === length) {
      this.options.close(false);
      this.options.selectAllElements();
      return true;
    }
    const start = textPositionAtIndex(context.text, 0);
    const end = textPositionAtIndex(context.text, length);
    this.options.editor.select({
      kind: 'text', id: context.id, ...textTargetFields(context.cell), anchor: start, focus: end,
    });
    root.focus({ preventScroll: true });
    this.options.restoreSelection(start, end);
    return true;
  }

  private keyDown(root: HTMLDivElement, event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.finish(event);
      this.options.close();
      return;
    }
    if (event.key === 'Tab' && this.options.activeCell()) {
      this.finish(event);
      this.options.navigateTableCell(event.shiftKey);
      return;
    }
    if (event.key === 'Tab' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      this.finish(event);
      this.options.changeListLevel(event.shiftKey ? -1 : 1);
      return;
    }
    if (!primary(event) || event.altKey) {
      if (this.forwardDocumentKey(event)) event.stopPropagation();
      return;
    }
    const key = event.key.toLowerCase();
    let handled = false;
    if (!event.shiftKey && key === 'a') handled = this.selectAll(root);
    else if (!event.shiftKey && ['b', 'i', 'u'].includes(key)) {
      handled = this.options.formatSelection(key as 'b' | 'i' | 'u');
    } else if (event.shiftKey && (event.code === 'Period' || event.code === 'Comma'
      || key === '>' || key === '<')) {
      const direction = event.code === 'Comma' || key === '<' ? -1 : 1;
      handled = this.options.stepFontSize(direction);
    } else if (!event.shiftKey) {
      const align = ({ e: 'center', l: 'left', r: 'right', j: 'justify' } as const)[
        key as 'e' | 'l' | 'r' | 'j'
      ];
      if (align) handled = this.options.setParaProps({ align });
    }
    if (handled) this.finish(event);
    else if (this.forwardDocumentKey(event)) event.stopPropagation();
  }
}
