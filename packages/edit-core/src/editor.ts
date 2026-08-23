import { applyPatches } from './commands/patch';
import { commandPatches } from './commands/dispatch';
import type {
  Command, EditorChange, EditorOptions, EditorSubscriber, History, HistoryEntry, Patch, Selection, Transaction,
  TransactionOptions, TransactionResult,
} from './commands/types';
import { HistoryStore } from './history';
import { validateEditDoc, validateEditElements } from './model-invariants';
import { effectiveElement, toSlide } from './projection';
import { cloneSelection, normalizeSelection } from './selection';
import type { EditDoc, ElementId, SlideId } from './types';

function reportSubscriberError(error: unknown): void {
  try {
    const reporter = (globalThis as typeof globalThis & { reportError?: (reason: unknown) => void }).reportError;
    if (reporter) reporter(error);
    else console.error('Editor 订阅者执行失败', error);
  } catch { /* 监听器与错误上报都不能把已提交事务伪装成失败。 */ }
}

class TransactionCollector implements Transaction {
  readonly commands: Command[] = [];
  selection: Selection | null = null;
  private active = true;

  exec(...commands: Command[]): void {
    if (!this.active) throw new Error('事务回调已经结束');
    this.commands.push(...commands);
  }

  select(selection: Selection): void {
    if (!this.active) throw new Error('事务回调已经结束');
    this.selection = selection;
  }

  close(): void { this.active = false; }
}

export class Editor {
  readonly doc: EditDoc;
  readonly history: History;
  private readonly historyStore: HistoryStore;
  private readonly origin: string;
  private readonly subscribers = new Set<EditorSubscriber>();
  private currentSelection: Selection = { kind: 'none' };
  private currentState = 0;
  private savedState = 0;
  private nextState = 1;

  constructor(doc: EditDoc, options: EditorOptions = {}) {
    validateEditDoc(doc);
    this.doc = doc;
    this.origin = options.origin ?? 'local';
    this.historyStore = new HistoryStore(options.historyLimit, options.historyByteLimit);
    this.history = this.historyStore;
  }

  get selection(): Selection { return cloneSelection(this.currentSelection); }

  isDirty(): boolean { return this.currentState !== this.savedState; }

  markSaved(): void {
    this.savedState = this.currentState;
    this.historyStore.breakMerge();
  }

  select(selection: Selection): void {
    const next = normalizeSelection(this.doc, selection);
    if (JSON.stringify(next) === JSON.stringify(this.currentSelection)) return;
    this.currentSelection = next;
    this.historyStore.breakMerge();
    this.emit('selection', new Set(), new Set());
  }

  subscribe(subscriber: EditorSubscriber): () => void {
    if (typeof subscriber !== 'function') throw new Error('订阅者必须是函数');
    this.subscribers.add(subscriber);
    return () => { this.subscribers.delete(subscriber); };
  }

  exec(...commands: Command[]): TransactionResult {
    if (!commands.length) throw new Error('exec 至少需要一个命令');
    return this.commit(commands, null, commands.length === 1 ? commands[0].type : '批量编辑', {});
  }

  transaction(
    callback: (transaction: Transaction) => void,
    label: string,
    options: TransactionOptions = {},
  ): TransactionResult {
    if (!label.trim()) throw new Error('事务标签不能为空');
    const transaction = new TransactionCollector();
    try {
      callback(transaction);
    } finally {
      transaction.close();
    }
    return this.commit(transaction.commands, transaction.selection, label, options);
  }

  undo(): EditorChange | null {
    const entry = this.historyStore.peekUndo();
    if (!entry) return null;
    const dirty = applyPatches(this.doc, entry.inverse);
    this.currentSelection = cloneSelection(entry.selectionBefore);
    this.historyStore.moveToRedo();
    this.currentState = this.currentState === entry.afterState ? entry.beforeState : this.nextState++;
    const change = { source: 'undo' as const, selection: this.selection, ...dirty };
    this.emit(change.source, change.dirtyElements, change.dirtySlides);
    return change;
  }

  redo(): EditorChange | null {
    const entry = this.historyStore.peekRedo();
    if (!entry) return null;
    const dirty = applyPatches(this.doc, entry.forward);
    this.currentSelection = cloneSelection(entry.selectionAfter);
    this.historyStore.moveToUndo();
    this.currentState = this.currentState === entry.beforeState ? entry.afterState : this.nextState++;
    const change = { source: 'redo' as const, selection: this.selection, ...dirty };
    this.emit(change.source, change.dirtyElements, change.dirtySlides);
    return change;
  }

  toSlide(id: SlideId) { return toSlide(this.doc, id); }
  effectiveElement(id: ElementId) { return effectiveElement(this.doc, id); }

  private commit(
    commands: readonly Command[],
    requestedSelection: Selection | null,
    label: string,
    options: TransactionOptions,
  ): TransactionResult {
    const forward: Patch[] = [];
    const inverse: Patch[] = [];
    const dirtyElements = new Set<ElementId>();
    const dirtySlides = new Set<SlideId>();
    const origin = options.origin ?? this.origin;
    const selectionBefore = this.selection;
    try {
      for (const command of commands) {
        const patches = commandPatches(this.doc, command, origin);
        const dirty = applyPatches(this.doc, patches.forward);
        for (const id of dirty.dirtyElements) dirtyElements.add(id);
        for (const id of dirty.dirtySlides) dirtySlides.add(id);
        forward.push(...patches.forward);
        inverse.unshift(...patches.inverse);
      }
      if (requestedSelection) this.currentSelection = normalizeSelection(this.doc, requestedSelection);
      validateEditElements(this.doc, forward.map((patch) => patch.path[1]));
    } catch (error) {
      if (inverse.length) applyPatches(this.doc, inverse);
      this.currentSelection = selectionBefore;
      throw error;
    }

    const selectionAfter = this.selection;
    const beforeState = this.currentState;
    if (forward.length) this.currentState = this.nextState++;
    const recordsHistory = forward.length && options.recordHistory !== false && origin === this.origin;
    if (recordsHistory) {
      const entry: HistoryEntry = {
        forward,
        inverse,
        selectionBefore,
        selectionAfter,
        label,
        time: options.time ?? Date.now(),
        ...(options.mergeKey ? { mergeKey: options.mergeKey } : {}),
        affectedSlides: [...dirtySlides],
      };
      this.historyStore.push(entry, beforeState, this.currentState);
    } else if (forward.length) {
      this.historyStore.rebaseUnrecorded(forward, this.currentState, () => this.nextState++);
    }
    const selectionChanged = JSON.stringify(selectionBefore) !== JSON.stringify(selectionAfter);
    if (!forward.length && selectionChanged) this.historyStore.breakMerge();
    if (forward.length || selectionChanged) {
      this.emit('transaction', dirtyElements, dirtySlides);
    }
    return { forward, inverse, dirtyElements, dirtySlides, selection: selectionAfter };
  }

  private emit(source: EditorChange['source'], elements: Set<ElementId>, slides: Set<SlideId>): void {
    for (const subscriber of this.subscribers) {
      try {
        subscriber({
          source,
          selection: this.selection,
          dirtyElements: new Set(elements),
          dirtySlides: new Set(slides),
        });
      } catch (error) {
        reportSubscriberError(error);
      }
    }
  }
}
