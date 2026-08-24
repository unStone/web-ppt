import { renderTextBodyToHtml } from '@web-ppt/core';
import type { TextBody } from '@web-ppt/core';
import {
  applyTextEditOps, elementFrameToSlideMatrix, slideOfElement, TEXT_ATOM,
  textBodyEditText, textBodyFromOverride, textPositionAtIndex, textPositionToIndex,
} from '@web-ppt/edit-core';
import type {
  Editor, EditorChange, ElementId, Selection, TextEditOp, TextPosition,
} from '@web-ppt/edit-core';
import { findElementPartition } from './dom-identity';

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
interface DomRead { valid: boolean; text: string }

function readSemanticNode(node: Node): DomRead {
  if (node.nodeType === node.TEXT_NODE) return { valid: true, text: node.nodeValue ?? '' };
  if (node.nodeType !== node.ELEMENT_NODE) return { valid: true, text: '' };
  const element = node as HTMLElement;
  if (element.hasAttribute('data-bullet')) return { valid: true, text: '' };
  if (element.localName === 'svg' && element.hasAttribute('data-r')) {
    return { valid: true, text: TEXT_ATOM };
  }
  if (element.localName === 'br') return { valid: true, text: '\n' };
  let text = '';
  for (const child of element.childNodes) {
    const read = readSemanticNode(child);
    if (!read.valid) return read;
    text += read.text;
  }
  // 浏览器/输入法可能加 b/font/div 等私有包装；样式不可信，只接纳其中的纯文本。
  if (element.dataset.empty === 'true' && text.startsWith('\u00A0')) text = text.slice(1);
  return { valid: true, text };
}

/** 只接受渲染器会生成的段落、run、链接、换行和公式节点；浏览器私有样式节点不会进模型。 */
function readEditableDom(root: ParentNode): DomRead {
  const paragraphs = [...root.querySelectorAll<HTMLElement>('[data-p]')]
    .filter((paragraph) => !paragraph.parentElement?.closest('[data-p]'));
  const values: string[] = [];
  for (const paragraph of paragraphs) {
    let text = '';
    for (const child of paragraph.childNodes) {
      const read = readSemanticNode(child);
      if (!read.valid) return read;
      text += read.text;
    }
    values.push(text);
  }
  return { valid: true, text: values.join('\n') };
}

function domPointIndex(root: HTMLElement, node: Node, offset: number): number | null {
  const range = root.ownerDocument.createRange();
  try {
    range.setStart(root, 0);
    range.setEnd(node, offset);
  } catch { return null; }
  const read = readEditableDom(range.cloneContents());
  return read.valid ? read.text.length : null;
}

function rangePositions(root: HTMLElement, body: TextBody): { from: TextPosition; to: TextPosition } | null {
  const selection = root.ownerDocument.defaultView?.getSelection();
  if (!selection?.rangeCount) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer) && range.commonAncestorContainer !== root) return null;
  const from = domPointIndex(root, range.startContainer, range.startOffset);
  const to = domPointIndex(root, range.endContainer, range.endOffset);
  return from === null || to === null ? null : {
    from: textPositionAtIndex(body, from), to: textPositionAtIndex(body, to),
  };
}

function caretPointAt(container: HTMLElement, offset: number): { node: Node; offset: number } {
  let remaining = offset;
  for (let index = 0; index < container.childNodes.length; index++) {
    const child = container.childNodes[index];
    if (child.nodeType === child.TEXT_NODE) {
      const length = container.dataset.empty === 'true' && child.nodeValue === '\u00A0'
        ? 0 : child.nodeValue?.length ?? 0;
      if (remaining <= length) return { node: child, offset: Math.min(remaining, length) };
      remaining -= length;
      continue;
    }
    const read = readSemanticNode(child);
    if (!read.valid) continue;
    if (remaining <= read.text.length) {
      if (child instanceof HTMLElement && !['br', 'svg'].includes(child.localName)) {
        return caretPointAt(child, remaining);
      }
      return { node: container, offset: index + (remaining ? 1 : 0) };
    }
    remaining -= read.text.length;
  }
  return { node: container, offset: container.childNodes.length };
}

function changedRange(before: string, after: string): { from: number; to: number; text: string } {
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++;
  let suffix = 0;
  while (suffix < before.length - prefix && suffix < after.length - prefix
    && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++;
  return { from: prefix, to: before.length - suffix, text: after.slice(prefix, after.length - suffix) };
}

function compositionChangedRange(
  before: string, after: string, from: number, to: number,
): { from: number; to: number; text: string } | null {
  const prefix = before.slice(0, from);
  const suffix = before.slice(to);
  if (after.length < prefix.length + suffix.length
    || !after.startsWith(prefix) || !after.endsWith(suffix)) return null;
  return { from, to, text: after.slice(prefix.length, after.length - suffix.length) };
}

function rebaseRange(
  base: string, current: string, from: number, to: number,
): { from: number; to: number } | null {
  if (base === current) return { from, to };
  const remote = changedRange(base, current);
  if (remote.to <= from) {
    const delta = remote.text.length - (remote.to - remote.from);
    return { from: from + delta, to: to + delta };
  }
  if (remote.from >= to) return { from, to };
  return null;
}

export class TextEditorController {
  private readonly options: TextEditorControllerOptions;
  private activeId: ElementId | null = null;
  private root: HTMLDivElement | null = null;
  private composing = false;
  private composition: CompositionSnapshot | null = null;
  private staticStale = false;
  private readonly hidden = new Map<HTMLElement | SVGElement, string>();
  private readonly onDocumentPointerDown = (event: Event): void => {
    const target = event.target;
    if (this.activeId && target instanceof Node && !this.options.boundary.contains(target)) this.close();
  };

  constructor(options: TextEditorControllerOptions) { this.options = options; }

  get isActive(): boolean { return this.activeId !== null; }
  get activeElementId(): ElementId | null { return this.activeId; }

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

  destroy(): void { this.close(false); }

  private render(selection?: Selection): void {
    if (!this.activeId) return;
    const element = this.options.editor.effectiveElement(this.activeId);
    const text = element.kind === 'shape'
      ? element.text ?? this.options.editor.doc.elements[this.activeId].meta.textTemplate : null;
    if (element.kind !== 'shape' || !text) return this.close(false);
    const root = this.options.textLayer.ownerDocument.createElement('div');
    root.dataset.pptTextEditor = this.activeId;
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
    const matrix = elementFrameToSlideMatrix(this.options.editor.doc, this.activeId);
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
    const caret = selection?.kind === 'text' ? selection.focus : null;
    if (caret) this.setCaret(caret);
  }

  private bind(root: HTMLDivElement): void {
    root.addEventListener('beforeinput', (event) => this.beforeInput(event as InputEvent));
    root.addEventListener('compositionstart', () => {
      this.composing = true;
      const element = this.activeId && this.options.editor.effectiveElement(this.activeId);
      const model = element && element.kind === 'shape'
        ? element.text ?? this.options.editor.doc.elements[this.activeId!].meta.textTemplate : null;
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
    root.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      this.close();
    });
  }

  private beforeInput(event: InputEvent): void {
    if (!this.activeId || this.composing || event.isComposing) return;
    const element = this.options.editor.effectiveElement(this.activeId);
    const text = element.kind === 'shape'
      ? element.text ?? this.options.editor.doc.elements[this.activeId].meta.textTemplate : null;
    if (element.kind !== 'shape' || !text || !this.root) return;
    const positions = rangePositions(this.root, text);
    if (!positions) return;
    let fromIndex = textPositionToIndex(text, positions.from);
    let toIndex = textPositionToIndex(text, positions.to);
    let ops: TextEditOp[] = [];
    let nextIndex = fromIndex;
    let label = '文字输入';
    if (event.inputType === 'insertText') {
      const text = event.data ?? '';
      ops = [{ type: 'replace', ...positions, text }];
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
    this.commit(ops, nextIndex, label);
  }

  private commit(ops: readonly TextEditOp[], nextIndex: number, label: string): void {
    if (!this.activeId) return;
    const current = this.options.editor.effectiveElement(this.activeId);
    const text = current.kind === 'shape'
      ? current.text ?? this.options.editor.doc.elements[this.activeId].meta.textTemplate : null;
    if (current.kind !== 'shape' || !text) return;
    const currentOverride = this.options.editor.doc.elements[this.activeId].ovr.text;
    // 选区必须按命令实际使用的 flat mark 身份预测；从投影重新 flatten 会丢失来源边界。
    const predicted = applyTextEditOps(
      text, ops, currentOverride?.kind === 'flat' ? currentOverride : undefined,
    );
    if (predicted.kind !== 'flat') return;
    const caret = textPositionAtIndex(textBodyFromOverride(predicted), nextIndex);
    const selection: Selection = {
      kind: 'text', id: this.activeId, anchor: caret, focus: caret,
    };
    this.options.editor.transaction((transaction) => {
      transaction.exec({ type: 'EditText', id: this.activeId!, ops });
      transaction.select(selection);
    }, label, label === '文字输入' ? { mergeKey: `text:${this.activeId}` } : {});
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
    const element = this.options.editor.effectiveElement(this.activeId);
    const text = element.kind === 'shape'
      ? element.text ?? this.options.editor.doc.elements[this.activeId].meta.textTemplate : null;
    const local = after.valid
      ? compositionChangedRange(snapshot.domText, after.text, snapshot.from, snapshot.to) : null;
    const currentText = text ? textBodyEditText(text) : '';
    const rebased = local && snapshot.domText === snapshot.modelText
      ? rebaseRange(snapshot.modelText, currentText, local.from, local.to) : null;
    if (element.kind !== 'shape' || !text || !local || !rebased || local.text.includes('\n')) {
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
    }], rebased.from + local.text.length, 'IME 输入');
  }

  private setCaret(position: TextPosition): void {
    if (!this.root) return;
    const marker = this.root.querySelector<HTMLElement>(`[data-r="${position.p}.${position.r}"]`);
    const selection = this.root.ownerDocument.defaultView?.getSelection();
    if (!marker || !selection) return;
    const range = this.root.ownerDocument.createRange();
    if (marker.localName === 'svg') {
      if (position.off === 0) range.setStartBefore(marker);
      else range.setStartAfter(marker);
    } else {
      const target = caretPointAt(marker, position.off);
      range.setStart(target.node, target.offset);
    }
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }

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
