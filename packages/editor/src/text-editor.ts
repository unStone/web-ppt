import { renderTextBodyToHtml } from '@web-ppt/core';
import type { ShapeElement, TextBody } from '@web-ppt/core';
import {
  applyRunProps, applyTextEditOps, elementFrameToSlideMatrix, slideOfElement,
  queryRunProps, textBodyEditText, textBodyFromOverride, textPositionAtIndex, textPositionToIndex,
} from '@web-ppt/edit-core';
import type {
  Editor, EditorChange, ElementId, RunPropertiesState, RunPropertyOverrides, Selection, TextEditOp, TextPosition,
} from '@web-ppt/edit-core';
import { findElementPartition } from './dom-identity';
import {
  caretPointAt, compositionChangedRange, rangePositions, readEditableDom, rebaseRange,
} from './text-dom';

interface TextEditorControllerOptions {
  editor: Editor;
  boundary: HTMLElement;
  staticLayer: HTMLElement;
  textLayer: HTMLElement;
  slideId: () => string;
  claim: () => void;
  release: () => void;
  syncStatic: (id: ElementId) => void;
}

interface CompositionSnapshot {
  domText: string;
  modelText: string;
  from: number;
  to: number;
}

interface ActiveText {
  id: ElementId;
  element: ShapeElement;
  text: TextBody;
}

export class TextEditorController {
  private readonly options: TextEditorControllerOptions;
  private activeId: ElementId | null = null;
  private root: HTMLDivElement | null = null;
  private composing = false;
  private composition: CompositionSnapshot | null = null;
  private pendingRunProps: RunPropertyOverrides = {};
  private staticStale = false;
  private readonly hidden = new Map<HTMLElement | SVGElement, string>();
  private readonly externalUi = new Set<HTMLElement>();
  private readonly onDocumentPointerDown = (event: Event): void => {
    const target = event.target;
    if (this.activeId && target instanceof Node && !this.options.boundary.contains(target)
      && ![...this.externalUi].some((element) => element.contains(target))) this.close();
  };

  constructor(options: TextEditorControllerOptions) { this.options = options; }

  get isActive(): boolean { return this.activeId !== null; }
  get activeElementId(): ElementId | null { return this.activeId; }

  registerExternalUi(element: HTMLElement): () => void {
    this.externalUi.add(element);
    return () => { this.externalUi.delete(element); };
  }

  queryRunProps(): RunPropertiesState | null {
    const context = this.textContext();
    if (!context) return null;
    const state = queryRunProps(this.options.editor.doc, context.id, context.positions);
    if (textPositionToIndex(context.text, context.positions.from)
      !== textPositionToIndex(context.text, context.positions.to)) return state;
    return Object.fromEntries(Object.entries(state).map(([field, value]) => {
      const pending = this.pendingRunProps[field as keyof RunPropertyOverrides];
      return [field, pending === undefined ? value : { value: pending, mixed: false }];
    })) as unknown as RunPropertiesState;
  }

  setRunProps(props: RunPropertyOverrides): boolean {
    const context = this.textContext();
    if (!context || this.composing) return false;
    const from = textPositionToIndex(context.text, context.positions.from);
    const to = textPositionToIndex(context.text, context.positions.to);
    const command = {
      type: 'SetRunProps' as const, id: context.id, range: context.positions, props,
    };
    if (from === to) {
      // headless no-op 仍负责统一校验；视图只保存不能进入 OOXML 的待输入状态。
      this.options.editor.exec(command);
      this.pendingRunProps = { ...this.pendingRunProps, ...props };
      this.options.editor.select({
        kind: 'text', id: context.id,
        anchor: context.positions.from, focus: context.positions.to,
      });
    } else {
      this.pendingRunProps = {};
      this.options.editor.transaction((transaction) => {
        transaction.exec(command);
        transaction.select({
          kind: 'text', id: context.id,
          anchor: context.positions.from, focus: context.positions.to,
        });
      }, '设置字符格式');
    }
    this.root?.focus({ preventScroll: true });
    this.setSelection(context.positions.from, context.positions.to);
    return true;
  }

  owns(target: EventTarget | null): boolean {
    return !!this.root && target instanceof Node && this.root.contains(target);
  }

  enter(id: ElementId): boolean {
    const record = this.options.editor.doc.elements[id];
    const element = record && this.options.editor.effectiveElement(id);
    const text = record && element.kind === 'shape' ? element.text ?? record.meta.textTemplate : null;
    if (!record || record.meta.editable !== 'full' || element.kind !== 'shape' || !text
      || slideOfElement(this.options.editor.doc, id) !== this.options.slideId()) return false;
    this.options.claim();
    this.activeId = id;
    this.pendingRunProps = {};
    this.staticStale = false;
    this.render();
    this.options.boundary.ownerDocument.addEventListener('pointerdown', this.onDocumentPointerDown, true);
    const end = textPositionAtIndex(text, textBodyEditText(text).length);
    this.options.editor.select({ kind: 'text', id, anchor: end, focus: end });
    this.root?.focus({ preventScroll: true });
    this.setCaret(end);
    return true;
  }

  releaseTextEditing(): void { this.close(false); }

  close(selectElement = true): void {
    const id = this.activeId;
    const syncStatic = this.staticStale;
    this.activeId = null;
    this.composing = false;
    this.composition = null;
    this.pendingRunProps = {};
    this.staticStale = false;
    this.options.boundary.ownerDocument.removeEventListener('pointerdown', this.onDocumentPointerDown, true);
    this.root?.remove();
    this.root = null;
    if (syncStatic && id) this.options.syncStatic(id);
    this.restoreStaticText();
    this.options.release();
    if (selectElement && id && this.options.editor.doc.elements[id]) {
      this.options.editor.select({ kind: 'elements', ids: [id], enteredGroup: null });
    }
  }

  update(change: EditorChange): void {
    if (!this.activeId) return;
    if (change.selection.kind !== 'text' || change.selection.id !== this.activeId
      || !this.options.editor.doc.elements[this.activeId]) {
      this.close(false);
      return;
    }
    if (this.composing) {
      this.staticStale ||= change.renderElements.has(this.activeId);
      return;
    }
    if (change.renderElements.has(this.activeId)) {
      this.staticStale = true;
      this.render(change.selection);
    }
    else this.hideStaticText();
  }

  refreshStatic(): void { if (this.activeId) this.hideStaticText(); }

  destroy(): void {
    this.close(false);
    this.externalUi.clear();
  }

  private textContext(): {
    id: ElementId;
    text: TextBody;
    positions: { from: TextPosition; to: TextPosition };
  } | null {
    const active = this.activeText();
    if (!active || !this.root) return null;
    const dom = rangePositions(this.root, active.text);
    const selection = this.options.editor.selection;
    const positions = dom ?? (selection.kind === 'text' && selection.id === active.id
      ? { from: selection.anchor, to: selection.focus } : null);
    return positions ? { id: active.id, text: active.text, positions } : null;
  }

  private activeText(): ActiveText | null {
    if (!this.activeId) return null;
    const record = this.options.editor.doc.elements[this.activeId];
    const element = record && this.options.editor.effectiveElement(this.activeId);
    const text = element?.kind === 'shape' ? element.text ?? record.meta.textTemplate : null;
    return element?.kind === 'shape' && text ? { id: this.activeId, element, text } : null;
  }

  private render(selection?: Selection): void {
    const active = this.activeText();
    if (!active) return this.close(false);
    const { id, element, text } = active;
    const root = this.options.textLayer.ownerDocument.createElement('div');
    root.dataset.pptTextEditor = id;
    root.setAttribute('contenteditable', 'true');
    root.setAttribute('role', 'textbox');
    root.setAttribute('aria-multiline', 'true');
    root.spellcheck = false;
    root.style.position = 'absolute';
    root.style.left = '0';
    root.style.top = '0';
    root.style.width = `${element.w}px`;
    root.style.height = `${element.h}px`;
    root.style.transformOrigin = '0 0';
    const matrix = elementFrameToSlideMatrix(this.options.editor.doc, id);
    root.style.transform = `matrix(${matrix.a},${matrix.b},${matrix.c},${matrix.d},${matrix.e},${matrix.f})`;
    root.style.pointerEvents = 'auto';
    root.style.outline = 'none';
    root.innerHTML = renderTextBodyToHtml(text, element.w, element.h, { includeEditMarkers: true });
    for (const formula of root.querySelectorAll<HTMLElement>('svg[data-r]')) {
      formula.contentEditable = 'false';
    }
    this.bind(root);
    const restoreFocus = this.root?.ownerDocument.activeElement === this.root;
    this.root?.replaceWith(root);
    if (!this.root) this.options.textLayer.append(root);
    this.root = root;
    if (restoreFocus) root.focus({ preventScroll: true });
    this.hideStaticText();
    if (selection?.kind === 'text') this.setSelection(selection.anchor, selection.focus);
  }

  private bind(root: HTMLDivElement): void {
    root.addEventListener('beforeinput', (event) => this.beforeInput(event as InputEvent));
    root.addEventListener('compositionstart', () => {
      this.composing = true;
      const model = this.activeText()?.text ?? null;
      const dom = readEditableDom(root);
      const positions = model ? rangePositions(root, model) : null;
      this.composition = dom.valid && model && positions
        ? {
          domText: dom.text, modelText: textBodyEditText(model),
          from: textPositionToIndex(model, positions.from),
          to: textPositionToIndex(model, positions.to),
        } : null;
    });
    root.addEventListener('compositionend', () => this.endComposition());
    root.addEventListener('pointerup', () => this.syncSelection());
    root.addEventListener('keyup', () => this.syncSelection());
    root.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        this.close();
        return;
      }
      if (event.altKey || (!event.ctrlKey && !event.metaKey)) return;
      const field = ({ b: 'b', i: 'i', u: 'u' } as const)[event.key.toLowerCase() as 'b' | 'i' | 'u'];
      if (!field || !this.formatSelection(field)) return;
      event.preventDefault();
      event.stopPropagation();
    });
  }

  private syncSelection(): void {
    if (this.composing) return;
    const context = this.textContext();
    if (context) this.options.editor.select({
      kind: 'text', id: context.id,
      anchor: context.positions.from, focus: context.positions.to,
    });
  }

  private beforeInput(event: InputEvent): void {
    if (this.composing || event.isComposing) return;
    const context = this.textContext();
    if (!context) return;
    const { text, positions } = context;
    const formatField = ({
      formatBold: 'b', formatItalic: 'i', formatUnderline: 'u',
    } as const)[event.inputType as 'formatBold' | 'formatItalic' | 'formatUnderline'];
    if (formatField) {
      event.preventDefault();
      this.formatSelection(formatField, positions);
      return;
    }
    let fromIndex = textPositionToIndex(text, positions.from);
    let toIndex = textPositionToIndex(text, positions.to);
    let ops: TextEditOp[] = [];
    let nextIndex = fromIndex;
    let insertedFrom: number | null = null;
    let label = '文字输入';
    if (event.inputType === 'insertText') {
      const text = event.data ?? '';
      ops = [{ type: 'replace', ...positions, text }];
      insertedFrom = fromIndex;
      nextIndex += text.length;
    } else if (event.inputType === 'deleteContentBackward') {
      if (fromIndex === toIndex) fromIndex = Math.max(0, fromIndex - 1);
      ops = [{ type: 'replace', from: textPositionAtIndex(text, fromIndex), to: positions.to, text: '' }];
      nextIndex = fromIndex;
    } else if (event.inputType === 'deleteContentForward') {
      if (fromIndex === toIndex) toIndex = Math.min(textBodyEditText(text).length, toIndex + 1);
      ops = [{ type: 'replace', from: positions.from, to: textPositionAtIndex(text, toIndex), text: '' }];
    } else if (event.inputType === 'insertParagraph') {
      label = '新建段落';
      let at = positions.from;
      if (fromIndex !== toIndex) {
        const remove: TextEditOp = { type: 'replace', ...positions, text: '' };
        const interim = applyTextEditOps(text, [remove]);
        if (interim.kind !== 'flat') return;
        at = textPositionAtIndex(textBodyFromOverride(interim), fromIndex);
        ops.push(remove);
      }
      ops.push({ type: 'splitParagraph', at });
      nextIndex++;
    } else if (event.inputType === 'insertLineBreak') {
      label = '插入换行';
      let at = positions.from;
      if (fromIndex !== toIndex) {
        const remove: TextEditOp = { type: 'replace', ...positions, text: '' };
        const interim = applyTextEditOps(text, [remove]);
        if (interim.kind !== 'flat') return;
        at = textPositionAtIndex(textBodyFromOverride(interim), fromIndex);
        ops.push(remove);
      }
      ops.push({ type: 'insertLineBreak', at });
      nextIndex++;
    } else if (event.inputType === 'historyUndo') {
      event.preventDefault(); this.options.editor.undo(); return;
    } else if (event.inputType === 'historyRedo') {
      event.preventDefault(); this.options.editor.redo(); return;
    } else return;
    event.preventDefault();
    this.commit(ops, nextIndex, label, insertedFrom);
  }

  private commit(
    ops: readonly TextEditOp[],
    nextIndex: number,
    label: string,
    insertedFrom: number | null = null,
  ): void {
    const active = this.activeText();
    if (!active) return;
    const { id, text } = active;
    const currentOverride = this.options.editor.doc.elements[id].ovr.text;
    // 选区必须按命令实际使用的 flat mark 身份预测；从投影重新 flatten 会丢失来源边界。
    const predicted = applyTextEditOps(
      text, ops, currentOverride?.kind === 'flat' ? currentOverride : undefined,
    );
    if (predicted.kind !== 'flat') return;
    const predictedBody = textBodyFromOverride(predicted);
    const formatRange = insertedFrom !== null && nextIndex > insertedFrom
      && Object.keys(this.pendingRunProps).length
      ? {
        from: textPositionAtIndex(predictedBody, insertedFrom),
        to: textPositionAtIndex(predictedBody, nextIndex),
      } : null;
    const formatted = formatRange
      ? applyRunProps(predictedBody, formatRange, this.pendingRunProps, predicted)
      : predicted;
    if (formatted.kind !== 'flat') return;
    const caret = textPositionAtIndex(textBodyFromOverride(formatted), nextIndex);
    const selection: Selection = {
      kind: 'text', id, anchor: caret, focus: caret,
    };
    this.options.editor.transaction((transaction) => {
      transaction.exec({ type: 'EditText', id, ops });
      if (formatRange) {
        transaction.exec({
          type: 'SetRunProps', id,
          range: formatRange,
          props: this.pendingRunProps,
        });
      }
      transaction.select(selection);
    }, label, label === '文字输入' ? { mergeKey: `text:${id}` } : {});
    this.setCaret(caret);
  }

  private endComposition(): void {
    if (!this.activeId) return;
    const snapshot = this.composition;
    const after = this.root ? readEditableDom(this.root) : { valid: false, text: '' };
    this.composing = false;
    this.composition = null;
    if (!snapshot) {
      this.render();
      return;
    }
    const active = this.activeText();
    const text = active?.text ?? null;
    const local = after.valid
      ? compositionChangedRange(snapshot.domText, after.text, snapshot.from, snapshot.to) : null;
    const currentText = text ? textBodyEditText(text) : '';
    const rebased = local && snapshot.domText === snapshot.modelText
      ? rebaseRange(snapshot.modelText, currentText, local.from, local.to) : null;
    if (!active || !text || !local || !rebased || local.text.includes('\n')) {
      this.render();
      return;
    }
    if (local.from === local.to && !local.text) {
      if (currentText !== snapshot.modelText) this.render();
      return;
    }
    this.commit([{
      type: 'replace', from: textPositionAtIndex(text, rebased.from),
      to: textPositionAtIndex(text, rebased.to), text: local.text,
    }], rebased.from + local.text.length, 'IME 输入', rebased.from);
  }

  private formatSelection(
    field: 'b' | 'i' | 'u',
    knownPositions?: { from: TextPosition; to: TextPosition },
  ): boolean {
    if (!this.activeId || !this.root || this.composing) return false;
    const context = this.textContext();
    const positions = knownPositions ?? context?.positions;
    if (!context || !positions) return false;
    const from = textPositionToIndex(context.text, positions.from);
    const to = textPositionToIndex(context.text, positions.to);
    const state = queryRunProps(this.options.editor.doc, this.activeId, positions)[field];
    const pending = this.pendingRunProps[field];
    const current = from === to && typeof pending === 'boolean'
      ? pending : !state.mixed && state.value === true;
    const value = !current;
    const selection: Selection = {
      kind: 'text', id: this.activeId, anchor: positions.from, focus: positions.to,
    };
    if (from === to) {
      return this.setRunProps({ [field]: value });
    }
    this.pendingRunProps = {};
    const labels = { b: '粗体', i: '斜体', u: '下划线' } as const;
    this.options.editor.transaction((transaction) => {
      transaction.exec({
        type: 'SetRunProps', id: this.activeId!, range: positions, props: { [field]: value },
      });
      transaction.select(selection);
    }, `设置${labels[field]}`);
    return true;
  }

  private domPoint(position: TextPosition): { node: Node; offset: number } | null {
    if (!this.root) return null;
    const marker = this.root.querySelector<HTMLElement>(`[data-r="${position.p}.${position.r}"]`);
    if (!marker) return null;
    if (marker.localName === 'svg') {
      const parent = marker.parentNode;
      if (!parent) return null;
      const index = [...parent.childNodes].indexOf(marker);
      return { node: parent, offset: index + (position.off ? 1 : 0) };
    }
    return caretPointAt(marker, position.off);
  }

  private setSelection(anchor: TextPosition, focus: TextPosition): void {
    if (!this.root) return;
    const start = this.domPoint(anchor);
    const end = this.domPoint(focus);
    const selection = this.root.ownerDocument.defaultView?.getSelection();
    if (!start || !end || !selection) return;
    const range = this.root.ownerDocument.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  private setCaret(position: TextPosition): void { this.setSelection(position, position); }

  private hideStaticText(): void {
    this.restoreStaticText();
    if (!this.activeId) return;
    const partition = findElementPartition(this.options.staticLayer, this.activeId);
    if (!partition) return;
    for (const node of partition.querySelectorAll<HTMLElement | SVGElement>('foreignObject, text')) {
      this.hidden.set(node, node.style.visibility);
      node.style.visibility = 'hidden';
    }
  }

  private restoreStaticText(): void {
    for (const [node, visibility] of this.hidden) node.style.visibility = visibility;
    this.hidden.clear();
  }
}
