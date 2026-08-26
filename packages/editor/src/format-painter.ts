import { assertFormatMask, textPositionToIndex } from '@web-ppt/edit-core';
import type {
  Editor, FormatMaskField, Selection, TextRange,
} from '@web-ppt/edit-core';
import type {
  FormatPainter, FormatPainterSnapshot, FormatPainterSource, FormatPainterStartOptions,
  FormatPainterSubscriber, FormatPainterTarget,
} from './format-painter-types';

const INACTIVE: FormatPainterSnapshot = Object.freeze({
  active: false, mode: 'inactive', source: null,
});

function cloneRange(range: TextRange): TextRange {
  return { from: { ...range.from }, to: { ...range.to } };
}

function snapshotOf(
  mode: Exclude<FormatPainterSnapshot['mode'], 'inactive'>,
  source: FormatPainterSource,
): FormatPainterSnapshot {
  return Object.freeze({
    active: true,
    mode,
    source: Object.freeze({
      id: source.id,
      ...(source.cell ? { cell: Object.freeze({ ...source.cell }) } : {}),
      ...(source.range ? { range: Object.freeze({
        from: Object.freeze({ ...source.range.from }),
        to: Object.freeze({ ...source.range.to }),
      }) } : {}),
      mask: Object.freeze([...source.mask]),
    }),
  });
}

function defaultMask(editor: Editor, selection: Selection): readonly FormatMaskField[] | null {
  if (selection.kind === 'text') return ['run', 'paragraph', 'body'];
  if (selection.kind !== 'elements' || selection.ids.length !== 1) return null;
  const element = editor.effectiveElement(selection.ids[0]);
  if (element.kind === 'shape') {
    return element.fill?.type === 'image' ? ['stroke', 'effects'] : ['fill', 'stroke', 'effects'];
  }
  if (element.kind === 'image') return ['stroke', 'effects'];
  if (element.kind === 'group') return ['effects'];
  return null;
}

function validateOptions(options: FormatPainterStartOptions): void {
  if (options.continuous !== undefined && typeof options.continuous !== 'boolean') {
    throw new Error('格式刷 continuous 必须是布尔值');
  }
  if (options.mask !== undefined) assertFormatMask(options.mask, '格式刷 mask');
}

/** 会话状态只保留稳定模型身份，不持有 DOM 或某个框架实例。 */
export class SessionFormatPainter implements FormatPainter {
  private current: FormatPainterSnapshot = INACTIVE;
  private readonly subscribers = new Set<FormatPainterSubscriber>();
  private readonly unsubscribeEditor: () => void;
  private isDisposed = false;

  constructor(private readonly editor: Editor) {
    this.unsubscribeEditor = editor.subscribe(() => {
      const id = this.current.source?.id;
      if (id && !editor.doc.elements[id]) this.cancel();
    });
  }

  get snapshot(): FormatPainterSnapshot { return this.current; }
  get disposed(): boolean { return this.isDisposed; }

  start(options: FormatPainterStartOptions = {}): boolean {
    this.assertActive();
    validateOptions(options);
    if (this.editor.doc.meta.readonly) return false;
    const selection = this.editor.selection;
    const mask = options.mask ?? defaultMask(this.editor, selection);
    if (!mask) return false;
    let source: FormatPainterSource;
    if (selection.kind === 'text') {
      const range = this.normalizedRange(selection);
      source = {
        id: selection.id,
        ...(selection.cell ? { cell: { ...selection.cell } } : {}),
        range,
        mask: [...mask],
      };
    } else if (selection.kind === 'elements' && selection.ids.length === 1) {
      source = { id: selection.ids[0], mask: [...mask] };
    } else {
      return false;
    }
    this.current = snapshotOf(options.continuous ? 'continuous' : 'single', source);
    this.emit();
    return true;
  }

  apply(target: FormatPainterTarget): boolean {
    this.assertActive();
    const source = this.current.source;
    if (!source) return false;
    this.editor.exec({
      type: 'ApplyFormat', from: source.id, to: target.id, mask: [...source.mask],
      ...(source.cell ? { fromCell: { ...source.cell } } : {}),
      ...(target.cell ? { toCell: { ...target.cell } } : {}),
      ...(source.range ? { fromRange: cloneRange(source.range) } : {}),
      ...(target.range ? { toRange: cloneRange(target.range) } : {}),
    });
    if (this.current.mode === 'single') this.cancel();
    return true;
  }

  cancel(): void {
    if (!this.current.active) return;
    this.current = INACTIVE;
    this.emit();
  }

  subscribe(subscriber: FormatPainterSubscriber): () => void {
    this.assertActive();
    if (typeof subscriber !== 'function') throw new Error('格式刷订阅者必须是函数');
    this.subscribers.add(subscriber);
    return () => { this.subscribers.delete(subscriber); };
  }

  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    this.unsubscribeEditor();
    const changed = this.current.active;
    this.current = INACTIVE;
    if (changed) this.emit();
    this.subscribers.clear();
  }

  private normalizedRange(selection: Extract<Selection, { kind: 'text' }>): TextRange {
    const element = this.editor.effectiveElement(selection.id);
    const body = selection.cell
      ? element.kind === 'table'
        ? element.rows[selection.cell.r]?.cells[selection.cell.c]?.text
        : null
      : element.kind === 'shape' ? element.text : null;
    if (!body) throw new Error('格式来源没有可读文字体');
    const anchor = textPositionToIndex(body, selection.anchor);
    const focus = textPositionToIndex(body, selection.focus);
    return anchor <= focus
      ? { from: { ...selection.anchor }, to: { ...selection.focus } }
      : { from: { ...selection.focus }, to: { ...selection.anchor } };
  }

  private emit(): void {
    for (const subscriber of [...this.subscribers]) {
      try { subscriber(this.current); } catch (error) { globalThis.reportError?.(error); }
    }
  }

  private assertActive(): void {
    if (this.isDisposed) throw new Error('格式刷控制器已经释放');
  }
}
