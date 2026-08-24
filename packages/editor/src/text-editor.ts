import {
  applyRunProps, applyTextEditOps, slideOfElement, tableCellKey,
  queryParaProps as queryHeadlessParaProps, queryRunProps, textBodyEditText, textBodyFromOverride,
  textPositionAtIndex, textPositionToIndex,
} from '@web-ppt/edit-core';
import type {
  EditorChange, ElementId, ParagraphPropertiesState, ParagraphPropertyOverrides,
  RunPropertiesState, RunPropertyOverrides, Selection, TableCellAddress, TextEditOp, TextPosition,
} from '@web-ppt/edit-core';
import { findElementPartition } from './dom-identity';
import { compositionChangedRange, rangePositions, readEditableDom, rebaseRange } from './text-dom';
import { TextClipboardController } from './text-clipboard-controller';
import type { ActiveText, CompositionSnapshot, TextEditorControllerOptions } from './text-editor-types';
import { nextEditableTableCell, resolveActiveText, sameTextCell, textTargetFields } from './text-editor-target';
import { createTextEditorRoot, setTextDomSelection } from './text-editor-view';
import { planTextInput } from './text-input-plan';
import { TextAutofitThrottle } from './text-autofit';
import type { TextAutofitTarget } from './text-autofit';
import { resolveTextEditorContext } from './text-editor-context';

export class TextEditorController {
  private readonly options: TextEditorControllerOptions;
  private readonly clipboard: TextClipboardController;
  private readonly autofit: TextAutofitThrottle;
  private activeId: ElementId | null = null;
  private activeCell: TableCellAddress | null = null;
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

  constructor(options: TextEditorControllerOptions) {
    this.options = options;
    this.autofit = new TextAutofitThrottle(options.boundary.ownerDocument.defaultView!);
    this.clipboard = new TextClipboardController({
      enabled: () => !this.composing,
      context: () => this.textContext(),
      pendingProps: () => this.pendingRunProps,
      commit: (ops, nextIndex, label) => this.commit(ops, nextIndex, label),
    });
  }

  get isActive(): boolean { return this.activeId !== null; }
  get activeElementId(): ElementId | null { return this.activeId; }

  registerExternalUi(element: HTMLElement): () => void {
    this.externalUi.add(element);
    return () => { this.externalUi.delete(element); };
  }

  queryRunProps(): RunPropertiesState | null {
    const context = this.textContext();
    if (!context) return null;
    const state = queryRunProps(
      this.options.editor.doc, context.id, context.positions, context.cell ?? undefined,
    );
    if (textPositionToIndex(context.text, context.positions.from)
      !== textPositionToIndex(context.text, context.positions.to)) return state;
    return Object.fromEntries(Object.entries(state).map(([field, value]) => {
      const pending = this.pendingRunProps[field as keyof RunPropertyOverrides];
      return [field, pending === undefined ? value : { value: pending, mixed: false }];
    })) as unknown as RunPropertiesState;
  }

  queryParaProps(): ParagraphPropertiesState | null {
    const context = this.textContext();
    return context
      ? queryHeadlessParaProps(
        this.options.editor.doc, context.id, context.positions, context.cell ?? undefined,
      )
      : null;
  }

  setParaProps(props: ParagraphPropertyOverrides): boolean {
    const context = this.textContext();
    if (!context || this.composing) return false;
    this.options.editor.transaction((transaction) => {
      transaction.exec({
        type: 'SetParaProps', id: context.id, ...textTargetFields(context.cell),
        range: context.positions, props,
      });
      transaction.select({
        kind: 'text', id: context.id, ...textTargetFields(context.cell),
        anchor: context.positions.from, focus: context.positions.to,
      });
    }, '设置段落格式');
    this.root?.focus({ preventScroll: true });
    this.setSelection(context.positions.from, context.positions.to);
    return true;
  }

  setRunProps(props: RunPropertyOverrides): boolean {
    const context = this.textContext();
    if (!context || this.composing) return false;
    const from = textPositionToIndex(context.text, context.positions.from);
    const to = textPositionToIndex(context.text, context.positions.to);
    const command = {
      type: 'SetRunProps' as const, id: context.id, ...textTargetFields(context.cell),
      range: context.positions, props,
    };
    if (from === to) {
      // headless no-op 仍负责统一校验；视图只保存不能进入 OOXML 的待输入状态。
      this.options.editor.exec(command);
      this.pendingRunProps = { ...this.pendingRunProps, ...props };
      this.options.editor.select({
        kind: 'text', id: context.id, ...textTargetFields(context.cell),
        anchor: context.positions.from, focus: context.positions.to,
      });
    } else {
      this.pendingRunProps = {};
      this.options.editor.transaction((transaction) => {
        transaction.exec(command);
        transaction.select({
          kind: 'text', id: context.id, ...textTargetFields(context.cell),
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
    return this.enterTarget(id, null);
  }

  enterCell(id: ElementId, cell: TableCellAddress): boolean {
    return this.enterTarget(id, cell);
  }

  private enterTarget(id: ElementId, cell: TableCellAddress | null): boolean {
    const active = resolveActiveText(this.options.editor, id, cell);
    if (!active || slideOfElement(this.options.editor.doc, id) !== this.options.slideId()) return false;
    this.options.claim();
    this.activeId = id;
    this.activeCell = cell ? { ...cell } : null;
    this.pendingRunProps = {};
    this.staticStale = false;
    this.autofit.reset();
    this.render();
    this.options.boundary.ownerDocument.addEventListener('pointerdown', this.onDocumentPointerDown, true);
    const end = textPositionAtIndex(active.text, textBodyEditText(active.text).length);
    this.options.editor.select({
      kind: 'text', id, ...textTargetFields(this.activeCell), anchor: end, focus: end,
    });
    this.root?.focus({ preventScroll: true });
    this.setCaret(end);
    return true;
  }

  releaseTextEditing(): void { this.close(false); }

  close(selectElement = true): void {
    const id = this.activeId;
    const syncStatic = this.staticStale;
    this.activeId = null;
    this.activeCell = null;
    this.composing = false;
    this.composition = null;
    this.pendingRunProps = {};
    this.staticStale = false;
    this.autofit.reset();
    this.clipboard.release();
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
    if (!sameTextCell(change.selection.cell, this.activeCell)) {
      if (this.composing) return this.close(false);
      this.restoreStaticText();
      if (this.staticStale || change.renderElements.has(this.activeId)) {
        this.options.syncStatic(this.activeId);
      }
      this.staticStale = false;
      this.activeCell = change.selection.cell ? { ...change.selection.cell } : null;
      this.pendingRunProps = {};
      if (!this.activeText()) return this.close(false);
      this.autofit.reset();
      this.render(change.selection);
      return;
    }
    if (this.composing) {
      this.staticStale ||= change.renderElements.has(this.activeId);
      return;
    }
    if (change.renderElements.has(this.activeId)) {
      this.staticStale = true;
      const active = this.activeText();
      // spAutoFit 同一事务会改变 frame；静态形状若仍保留旧 frame，编辑层与点击轮廓会瞬间分叉。
      if (active?.text.autoFitShape) {
        this.options.syncStatic(this.activeId);
        this.staticStale = false;
      }
      this.render(change.selection, true);
    }
    else this.hideStaticText();
  }

  refreshStatic(): void { if (this.activeId) this.hideStaticText(); }

  destroy(): void {
    this.close(false);
    this.externalUi.clear();
  }

  private textContext() {
    const active = this.activeText();
    return active && this.root
      ? resolveTextEditorContext(this.options.editor, active, this.root)
      : null;
  }

  private activeText(): ActiveText | null {
    if (!this.activeId) return null;
    return resolveActiveText(this.options.editor, this.activeId, this.activeCell);
  }

  private render(selection?: Selection, deferAutofit = false): void {
    const active = this.activeText();
    if (!active) return this.close(false);
    const { id, cell } = active;
    const root = createTextEditorRoot(
      this.options.textLayer.ownerDocument, active, this.options.textLayout,
      this.autofit.displayScale(active),
    );
    this.bind(root);
    const restoreFocus = this.root?.ownerDocument.activeElement === this.root;
    this.root?.replaceWith(root);
    if (!this.root) this.options.textLayer.append(root);
    this.root = root;
    if (restoreFocus) root.focus({ preventScroll: true });
    this.hideStaticText();
    if (selection?.kind === 'text' && selection.id === id && sameTextCell(selection.cell, cell)) {
      this.setSelection(selection.anchor, selection.focus);
    }
    if (deferAutofit) {
      this.autofit.schedule(active, (target) => this.settleAutofit(target));
    }
  }

  private settleAutofit(target: TextAutofitTarget): void {
    const active = this.activeText();
    if (!active || !this.autofit.settle(active, target)) return;
    this.render(this.options.editor.selection);
  }

  private bind(root: HTMLDivElement): void {
    this.clipboard.bind(root);
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
      if (event.key === 'Tab' && this.activeCell) {
        event.preventDefault();
        event.stopPropagation();
        this.navigateTableCell(event.shiftKey);
        return;
      }
      if (event.altKey || (!event.ctrlKey && !event.metaKey)) return;
      const field = ({ b: 'b', i: 'i', u: 'u' } as const)[event.key.toLowerCase() as 'b' | 'i' | 'u'];
      if (!field || !this.formatSelection(field)) return;
      event.preventDefault();
      event.stopPropagation();
    });
  }

  private navigateTableCell(reverse: boolean): void {
    if (!this.activeId || !this.activeCell || this.composing) return;
    const element = this.options.editor.effectiveElement(this.activeId);
    if (element.kind !== 'table') return;
    const next = nextEditableTableCell(element, this.activeCell, reverse);
    // 末格新增行必须走后续 InsertRow 结构命令；当前阶段只守住焦点所有权。
    if (!next) return;
    this.restoreStaticText();
    if (this.staticStale) this.options.syncStatic(this.activeId);
    this.staticStale = false;
    this.activeCell = { ...next };
    this.pendingRunProps = {};
    const active = this.activeText();
    if (!active) return this.close(false);
    this.autofit.reset();
    this.render();
    const end = textPositionAtIndex(active.text, textBodyEditText(active.text).length);
    this.options.editor.select({
      kind: 'text', id: active.id, cell: { ...next }, anchor: end, focus: end,
    });
    this.root?.focus({ preventScroll: true });
    this.setCaret(end);
  }

  private syncSelection(): void {
    if (this.composing) return;
    const context = this.textContext();
    if (context) this.options.editor.select({
      kind: 'text', id: context.id, ...textTargetFields(context.cell),
      anchor: context.positions.from, focus: context.positions.to,
    });
  }

  private beforeInput(event: InputEvent): void {
    if (this.composing || event.isComposing) return;
    if (this.clipboard.beforeInput(event)) return;
    const context = this.textContext();
    if (!context) return;
    const plan = planTextInput(context.text, context.positions, event.inputType, event.data);
    if (!plan) return;
    event.preventDefault();
    if (plan.type === 'format') {
      this.formatSelection(plan.field, context.positions);
    } else if (plan.type === 'history') {
      if (plan.direction === 'undo') this.options.editor.undo();
      else this.options.editor.redo();
    } else {
      this.commit(plan.ops, plan.nextIndex, plan.label, plan.insertedFrom);
    }
  }

  private commit(
    ops: readonly TextEditOp[],
    nextIndex: number,
    label: string,
    insertedFrom: number | null = null,
  ): void {
    const active = this.activeText();
    if (!active) return;
    const { id, cell, text } = active;
    const record = this.options.editor.doc.elements[id];
    const currentOverride = cell
      ? record.ovr.tableCells?.[tableCellKey(cell)]?.text
      : record.ovr.text;
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
      kind: 'text', id, ...textTargetFields(cell ?? null), anchor: caret, focus: caret,
    };
    this.options.editor.transaction((transaction) => {
      transaction.exec({ type: 'EditText', id, ...textTargetFields(cell ?? null), ops });
      if (formatRange) {
        transaction.exec({
          type: 'SetRunProps', id, ...textTargetFields(cell ?? null),
          range: formatRange,
          props: this.pendingRunProps,
        });
      }
      transaction.select(selection);
    }, label, label === '文字输入'
      ? { mergeKey: `text:${id}${cell ? `:${cell.r}:${cell.c}` : ''}` }
      : {});
    this.setCaret(caret);
  }

  private endComposition(): void {
    if (!this.activeId) return;
    const snapshot = this.composition;
    const after = this.root ? readEditableDom(this.root) : { valid: false, text: '' };
    this.composing = false;
    this.composition = null;
    if (!snapshot) {
      this.render(undefined, true);
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
      this.render(undefined, true);
      return;
    }
    if (local.from === local.to && !local.text) {
      if (currentText !== snapshot.modelText) this.render(undefined, true);
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
    const state = queryRunProps(
      this.options.editor.doc, this.activeId, positions, this.activeCell ?? undefined,
    )[field];
    const pending = this.pendingRunProps[field];
    const current = from === to && typeof pending === 'boolean'
      ? pending : !state.mixed && state.value === true;
    const value = !current;
    const selection: Selection = {
      kind: 'text', id: this.activeId, ...textTargetFields(this.activeCell),
      anchor: positions.from, focus: positions.to,
    };
    if (from === to) {
      return this.setRunProps({ [field]: value });
    }
    this.pendingRunProps = {};
    const labels = { b: '粗体', i: '斜体', u: '下划线' } as const;
    this.options.editor.transaction((transaction) => {
      transaction.exec({
        type: 'SetRunProps', id: this.activeId!, ...textTargetFields(this.activeCell),
        range: positions, props: { [field]: value },
      });
      transaction.select(selection);
    }, `设置${labels[field]}`);
    return true;
  }

  private setSelection(anchor: TextPosition, focus: TextPosition): void {
    if (this.root) setTextDomSelection(this.root, anchor, focus);
  }

  private setCaret(position: TextPosition): void { this.setSelection(position, position); }

  private hideStaticText(): void {
    this.restoreStaticText();
    if (!this.activeId) return;
    const partition = findElementPartition(this.options.staticLayer, this.activeId);
    if (!partition) return;
    const owner = this.activeCell
      ? partition.querySelector<SVGElement>(`[data-table-cell="${this.activeCell.r}:${this.activeCell.c}"]`)
      : partition;
    if (!owner) return;
    for (const node of owner.querySelectorAll<HTMLElement | SVGElement>('foreignObject, text')) {
      this.hidden.set(node, node.style.visibility);
      node.style.visibility = 'hidden';
    }
  }

  private restoreStaticText(): void {
    for (const [node, visibility] of this.hidden) node.style.visibility = visibility;
    this.hidden.clear();
  }
}
