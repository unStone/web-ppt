import { applyPatches } from './commands/patch';
import { commandPatches } from './commands/dispatch';
import { willRemoveElementStructure } from './commands/element-tree';
import { assertSetZCommand, setZBatchPatches } from './commands/set-z';
import { isElementOrderPatch } from './commands/element-order';
import { writableLayerSiblingIds } from './element-order';
import type {
  Command, EditorChange, EditorOptions, EditorSubscriber, History, HistoryEntry, Patch, Selection, Transaction,
  TransactionOptions, TransactionResult,
} from './commands/types';
import { HistoryStore } from './history';
import { validateEditDoc, validateEditElements } from './model-invariants';
import type { OpcPatchResult } from './opc/types';
import { effectiveElement, toSlide } from './projection';
import {
  cloneSelection, isElementDescendantOf, normalizeSelection, selectionAfterStructure,
} from './selection';
import type { EditDoc, ElementId, SlideId } from './types';

function patchElements(patches: readonly Patch[]): Set<ElementId> {
  return new Set(patches.map((patch) => patch.path[1]));
}

function renderPatchElements(patches: readonly Patch[]): Set<ElementId> {
  return new Set(patches.filter((patch) => !isElementOrderPatch(patch)).map((patch) => patch.path[1]));
}

function reorderedPatchElements(patches: readonly Patch[]): Set<ElementId> {
  return new Set(patches.filter(isElementOrderPatch).map((patch) => patch.path[1]));
}

function reportSubscriberError(error: unknown): void {
  try {
    const reporter = (globalThis as typeof globalThis & { reportError?: (reason: unknown) => void }).reportError;
    if (reporter) reporter(error);
    else console.error('Editor 订阅者执行失败', error);
  } catch { /* 监听器与错误上报都不能把已提交事务伪装成失败。 */ }
}

/** 删除子树与同树属性编辑无法形成无需依赖顺序的双向 patch，必须在任何模型修改前拒绝。 */
function validateCommandRelations(doc: EditDoc, commands: readonly Command[]): void {
  const layers = commands.filter((command) => command.type === 'SetZ');
  const layerRecords = layers.map((command) => assertSetZCommand(doc, command));
  if (layerRecords.length > 1) {
    const parent = layerRecords[0].parent;
    const part = layerRecords[0].meta.origin?.part ?? null;
    if (layerRecords.some((record) => record.parent !== parent
      || (record.meta.origin?.part ?? null) !== part)) {
      throw new Error('同一层级事务只能调整同一父级、同一来源 part 的元素');
    }
  }
  const removals = commands.filter((command) => command.type === 'RemoveElement');
  if (new Set(removals.map((command) => command.id)).size !== removals.length) {
    throw new Error('同一事务不能重复删除同一元素');
  }
  const roots = removals.filter((command) => willRemoveElementStructure(doc.elements[command.id]));
  if (roots.length && layerRecords.length) {
    const layerCandidates = writableLayerSiblingIds(doc, layerRecords[0]);
    if (roots.some((root) => layerCandidates.some((id) => id === root.id
      || isElementDescendantOf(doc, id, root.id)))) {
      throw new Error('同一事务不能删除可能承担层级覆盖的兄弟子树');
    }
  }
  for (let left = 0; left < roots.length; left++) {
    for (let right = left + 1; right < roots.length; right++) {
      if (isElementDescendantOf(doc, roots[left].id, roots[right].id)
        || isElementDescendantOf(doc, roots[right].id, roots[left].id)) {
        throw new Error('同一事务的删除根不能互为祖先与后代');
      }
    }
  }
  const targetIds = (command: Command): readonly ElementId[] => {
    if (command.type === 'AlignElements') return Array.isArray(command.ids) ? command.ids : [];
    if (command.type === 'PasteElements') return [];
    return [command.id];
  };
  for (const command of commands) {
    if (command.type === 'RemoveElement') continue;
    const conflict = targetIds(command).find((id) => roots.some((root) => id === root.id
      || isElementDescendantOf(doc, id, root.id)));
    if (conflict) {
      throw new Error(`同一事务不能先修改再删除同一子树：${conflict}`);
    }
  }
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

  async save(): Promise<Uint8Array> {
    return (await this.saveDetailed()).bytes;
  }

  async saveDetailed(): Promise<OpcPatchResult> {
    const { saveEditDoc } = await import('./save/index');
    const result = saveEditDoc(this.doc);
    this.markSaved();
    return result;
  }

  markSaved(): void {
    this.savedState = this.currentState;
    this.historyStore.breakMerge();
  }

  select(selection: Selection): void {
    const next = normalizeSelection(this.doc, selection);
    if (JSON.stringify(next) === JSON.stringify(this.currentSelection)) return;
    this.currentSelection = next;
    this.historyStore.breakMerge();
    this.emit('selection', new Set(), new Set(), new Set(), new Set(), new Set());
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
    const change = {
      source: 'undo' as const,
      selection: this.selection,
      touchedElements: patchElements(entry.inverse),
      renderElements: renderPatchElements(entry.inverse),
      reorderedElements: reorderedPatchElements(entry.inverse),
      ...dirty,
    };
    this.emit(
      change.source, change.dirtyElements, change.dirtySlides, change.touchedElements,
      change.renderElements, change.reorderedElements,
    );
    return change;
  }

  redo(): EditorChange | null {
    const entry = this.historyStore.peekRedo();
    if (!entry) return null;
    const dirty = applyPatches(this.doc, entry.forward);
    this.currentSelection = cloneSelection(entry.selectionAfter);
    this.historyStore.moveToUndo();
    this.currentState = this.currentState === entry.beforeState ? entry.afterState : this.nextState++;
    const change = {
      source: 'redo' as const,
      selection: this.selection,
      touchedElements: patchElements(entry.forward),
      renderElements: renderPatchElements(entry.forward),
      reorderedElements: reorderedPatchElements(entry.forward),
      ...dirty,
    };
    this.emit(
      change.source, change.dirtyElements, change.dirtySlides, change.touchedElements,
      change.renderElements, change.reorderedElements,
    );
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
    validateCommandRelations(this.doc, commands);
    const forward: Patch[] = [];
    const inverse: Patch[] = [];
    const dirtyElements = new Set<ElementId>();
    const dirtySlides = new Set<SlideId>();
    const touchedElements = new Set<ElementId>();
    const renderElements = new Set<ElementId>();
    const reorderedElements = new Set<ElementId>();
    const origin = options.origin ?? this.origin;
    const selectionBefore = this.selection;
    const applyCommandPatches = (patches: { forward: Patch[]; inverse: Patch[] }): void => {
      const dirty = applyPatches(this.doc, patches.forward);
      for (const id of dirty.dirtyElements) dirtyElements.add(id);
      for (const id of dirty.dirtySlides) dirtySlides.add(id);
      for (const patch of patches.forward) {
        touchedElements.add(patch.path[1]);
        if (isElementOrderPatch(patch)) reorderedElements.add(patch.path[1]);
        else renderElements.add(patch.path[1]);
      }
      forward.push(...patches.forward);
      inverse.unshift(...patches.inverse);
    };
    try {
      if (commands.length && commands.every((command) => command.type === 'SetZ')) {
        applyCommandPatches(setZBatchPatches(this.doc, commands, origin));
      } else for (const command of commands) {
        applyCommandPatches(commandPatches(this.doc, command, origin));
      }
      const structural = forward.some((patch) => patch.path.length === 2);
      if (requestedSelection) this.currentSelection = normalizeSelection(this.doc, requestedSelection);
      else if (commands.length === 1 && commands[0].type === 'PasteElements') {
        const ids = forward.filter((patch) => patch.path.length === 2 && patch.op === 'insert')
          .map((patch) => patch.path[1]);
        this.currentSelection = normalizeSelection(this.doc, {
          kind: 'elements', ids, enteredGroup: this.doc.slides[commands[0].at.parentId]
            ? null : commands[0].at.parentId,
        });
      } else if (structural) this.currentSelection = selectionAfterStructure(this.doc, this.currentSelection);
      if (structural) validateEditDoc(this.doc);
      else validateEditElements(this.doc, forward.map((patch) => patch.path[1]));
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
      this.emit('transaction', dirtyElements, dirtySlides, touchedElements, renderElements, reorderedElements);
    }
    return { forward, inverse, dirtyElements, dirtySlides, selection: selectionAfter };
  }

  private emit(
    source: EditorChange['source'],
    elements: Set<ElementId>,
    slides: Set<SlideId>,
    touched: Set<ElementId>,
    render: Set<ElementId>,
    reordered: Set<ElementId>,
  ): void {
    for (const subscriber of this.subscribers) {
      try {
        subscriber({
          source,
          selection: this.selection,
          dirtyElements: new Set(elements),
          dirtySlides: new Set(slides),
          touchedElements: new Set(touched),
          renderElements: new Set(render),
          reorderedElements: new Set(reordered),
        });
      } catch (error) {
        reportSubscriberError(error);
      }
    }
  }
}
