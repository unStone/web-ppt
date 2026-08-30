import { applyLocalPatches, applyPatches } from './commands/patch';
import { assertPureCommand, commandPatches, commandSelectsInsertedElement } from './commands/dispatch';
import { isElementTreePatch } from './commands/element-tree';
import { isElementHierarchyPatch } from './commands/element-hierarchy';
import { isElementOrderPatch } from './commands/element-order';
import { setZBatchPatches } from './commands/set-z';
import { isSlideTreePatch, slidePatchSets } from './commands/slide-tree';
import { fitTextShapePatches } from './commands/fit-text-shape';
import { isImageResourcePatch } from './commands/element-image-content';
import { isElementInteractionPatch } from './commands/element-interaction';
import {
  affectsSlideSequence, bodyPropsPatchElements, hasDocumentPatch, panePatchElements,
  renderPatchSlides,
} from './change-classification';
import type {
  Command, EditorChange, EditorOptions, EditorPatchEvent, EditorPatchSubscriber,
  EditorPatchSubscribeOptions, EditorSubscriber,
  ExternalPatchOptions, History, HistoryEntry, Patch, Selection, SlideChangeSets, Transaction,
  TransactionOptions, TransactionResult,
} from './commands/types';
import { HistoryStore } from './history';
import type { HistoryPatchLink } from './history';
import {
  activeImageResourceHashes, historyImageResourceHashes, imageReachabilityMayChange,
} from './image-resource-history';
import { validateEditDoc, validateEditElements } from './model-invariants';
import type { OpcPatchResult } from './opc/types';
import { effectiveElement, toSlide } from './projection';
import { RecoveryJournal, restoreRecoveryFrames } from './recovery';
import type { RecoveryFrameSource, RecoverySubscriber } from './recovery-types';
import {
  cloneSelection, normalizeSelection, selectionAfterInteractionState, selectionAfterStructure,
} from './selection';
import { validateCommandRelations } from './transaction-validation';
import type { EditDoc, ElementId, SlideId } from './types';
import { changeFromPatches } from './patch-change';
import { assertEditIdentityWatermark, mergeEditIdentityWatermark } from './identity-watermark';
import {
  advanceCollaborationVersion, assertCollaborationVersionAvailable,
} from './identity-allocation';
import { EditorPatchJournal, reportEditorSubscriberError } from './patch-events';

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
  private readonly patchJournal = new EditorPatchJournal();
  private readonly recoveryJournal: RecoveryJournal;
  private currentSelection: Selection = { kind: 'none' };
  private currentState = 0;
  private savedState = 0;
  private nextState = 1;
  private activeImageResources: Set<string>;

  constructor(doc: EditDoc, options: EditorOptions = {}) {
    validateEditDoc(doc);
    this.doc = doc;
    this.origin = options.origin ?? 'local';
    const recovered = options.recoveryFrames?.length
      ? restoreRecoveryFrames(doc, options.recoveryFrames)
      : { selection: { kind: 'none' } as const, dirty: false, sequence: 0 };
    this.currentSelection = cloneSelection(recovered.selection);
    if (recovered.dirty) {
      this.currentState = 1;
      this.nextState = 2;
    }
    this.recoveryJournal = new RecoveryJournal(recovered.sequence);
    this.activeImageResources = activeImageResourceHashes(doc);
    this.historyStore = new HistoryStore(options.historyLimit, options.historyByteLimit, {
      externalByteSize: (entries) => this.historyImageResourceBytes(entries),
      changed: (entries) => this.pruneImageResources(entries),
    });
    this.history = this.historyStore;
    this.pruneImageResources([]);
  }

  get selection(): Selection { return cloneSelection(this.currentSelection); }

  isDirty(): boolean { return this.currentState !== this.savedState; }

  async save(): Promise<Uint8Array> {
    return (await this.saveDetailed()).bytes;
  }

  async saveDetailed(): Promise<OpcPatchResult> {
    const result = this.doc.meta.source === 'pptx' && this.doc.package && !this.doc.package.disposed
      ? (await import('./save/index')).saveEditDoc(this.doc)
      : (await import('./generate/index')).generateEditDoc(this.doc);
    this.markSaved();
    return result;
  }

  markSaved(): void {
    const changed = this.isDirty();
    this.savedState = this.currentState;
    this.historyStore.breakMerge();
    if (changed) this.emitRecovery('savepoint', [], '保存点');
  }

  select(selection: Selection): void {
    const next = normalizeSelection(this.doc, selection);
    if (JSON.stringify(next) === JSON.stringify(this.currentSelection)) return;
    this.currentSelection = next;
    this.historyStore.breakMerge();
    this.emitRecovery('selection', [], '选择');
    this.emit('selection', new Set(), new Set(), new Set(), new Set(), new Set(), new Set());
  }

  subscribe(subscriber: EditorSubscriber): () => void {
    if (typeof subscriber !== 'function') throw new Error('订阅者必须是函数');
    this.subscribers.add(subscriber);
    return () => { this.subscribers.delete(subscriber); };
  }

  subscribeRecovery(subscriber: RecoverySubscriber): () => void {
    return this.recoveryJournal.subscribe(subscriber);
  }

  subscribePatches(
    subscriber: EditorPatchSubscriber,
    options: EditorPatchSubscribeOptions = {},
  ): () => void {
    return this.patchJournal.subscribe(subscriber, options);
  }

  exec(...commands: Command[]): TransactionResult {
    if (!commands.length) throw new Error('exec 至少需要一个命令');
    for (const command of commands) assertPureCommand(command);
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
    assertCollaborationVersionAvailable(this.doc.identity);
    // 历史创建后可能已有远端 Patch 改变模型；重放必须重新在完整暂存模型上验真。
    const dirty = applyPatches(this.doc, entry.inverse);
    this.refreshActiveImageResources(entry.inverse);
    this.currentSelection = cloneSelection(entry.selectionBefore);
    this.historyStore.moveToRedo();
    this.currentState = this.currentState === entry.afterState ? entry.beforeState : this.nextState++;
    const change = changeFromPatches(this.doc, entry.inverse, entry.forward, 'undo', this.selection, dirty);
    const time = Date.now();
    advanceCollaborationVersion(this.doc.identity);
    this.queuePatches('undo', entry.inverse, this.origin, entry.label, time);
    this.emitRecovery('undo', entry.inverse, entry.label, time);
    this.emit(
      change.source, change.dirtyElements, change.dirtySlides, change.touchedElements,
      change.renderElements, change.reorderedElements, change.bodyPropsElements,
      change,
      change.renderSlides,
      change.paneElements,
    );
    this.flushPatches();
    return change;
  }

  redo(): EditorChange | null {
    const entry = this.historyStore.peekRedo();
    if (!entry) return null;
    assertCollaborationVersionAvailable(this.doc.identity);
    // redo 尤其可能与远端新增的 OPC 身份相撞，不能沿用命令事务内的可信快速路径。
    const dirty = applyPatches(this.doc, entry.forward);
    this.refreshActiveImageResources(entry.forward);
    this.currentSelection = cloneSelection(entry.selectionAfter);
    this.historyStore.moveToUndo();
    this.currentState = this.currentState === entry.beforeState ? entry.afterState : this.nextState++;
    const change = changeFromPatches(this.doc, entry.forward, entry.inverse, 'redo', this.selection, dirty);
    const time = Date.now();
    advanceCollaborationVersion(this.doc.identity);
    this.queuePatches('redo', entry.forward, this.origin, entry.label, time);
    this.emitRecovery('redo', entry.forward, entry.label, time);
    this.emit(
      change.source, change.dirtyElements, change.dirtySlides, change.touchedElements,
      change.renderElements, change.reorderedElements, change.bodyPropsElements,
      change,
      change.renderSlides,
      change.paneElements,
    );
    this.flushPatches();
    return change;
  }

  applyExternalPatches(patches: readonly Patch[], options: ExternalPatchOptions = {}): EditorChange | null {
    if (!Array.isArray(patches)) throw new Error('外部补丁必须是数组');
    const time = options.time ?? Date.now();
    const origin = options.origin ?? 'external';
    const label = options.label?.trim() || '外部编辑';
    if (!Number.isFinite(time)) throw new Error('外部补丁时间必须是有限数字');
    if (typeof origin !== 'string' || !origin) throw new Error('外部补丁 origin 必须是非空字符串');
    if (options.identity) assertEditIdentityWatermark(options.identity);
    if (!patches.length) {
      if (options.identity) mergeEditIdentityWatermark(this.doc.identity, options.identity);
      // 纯延迟/LWW 消息也改变协同 checkpoint；空帧把元数据与 identity 水位一起持久化。
      if (options.identity) this.emitRecovery('transaction', [], label, time);
      return null;
    }
    const dirty = applyPatches(this.doc, patches);
    if (options.identity) mergeEditIdentityWatermark(this.doc.identity, options.identity);
    const structural = patches.some((patch) =>
      isSlideTreePatch(patch) || isElementTreePatch(patch) || isElementHierarchyPatch(patch));
    if (structural) this.currentSelection = selectionAfterStructure(this.doc, this.currentSelection);
    if (patches.some(isElementInteractionPatch)) {
      this.currentSelection = selectionAfterInteractionState(this.doc, this.currentSelection);
    }
    this.refreshActiveImageResources(patches);
    if (hasDocumentPatch(patches)) this.currentState = this.nextState++;
    this.historyStore.rebaseUnrecorded(patches, this.currentState, () => this.nextState++);
    const change = changeFromPatches(this.doc, patches, [], 'external', this.selection, dirty);
    this.queuePatches('external', patches, origin, label, time);
    this.emitRecovery('transaction', patches, label, time);
    this.emit(
      change.source, change.dirtyElements, change.dirtySlides, change.touchedElements,
      change.renderElements, change.reorderedElements, change.bodyPropsElements,
      change, change.renderSlides, change.paneElements,
    );
    this.flushPatches();
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
    for (const command of commands) assertPureCommand(command);
    validateCommandRelations(this.doc, commands);
    const operationTime = options.time ?? Date.now();
    if (!Number.isFinite(operationTime)) throw new Error('事务时间必须是有限数字');
    const forward: Patch[] = [];
    const inverse: Patch[] = [];
    const dirtyElements = new Set<ElementId>();
    const dirtySlides = new Set<SlideId>();
    const touchedElements = new Set<ElementId>();
    const renderElements = new Set<ElementId>();
    const renderSlides = new Set<SlideId>();
    const reorderedElements = new Set<ElementId>();
    const bodyPropsElements = new Set<ElementId>();
    const origin = options.origin ?? this.origin;
    const autoFitTargets = new Set<ElementId>();
    const historyLinks: HistoryPatchLink[] = [];
    let commandSelection: Selection | null = null;
    const selectionBefore = this.selection;
    const identityBefore = structuredClone(this.doc.identity);
    const applyCommandPatches = (patches: { forward: Patch[]; inverse: Patch[] }): void => {
      const dirty = applyLocalPatches(this.doc, patches.forward);
      for (const id of dirty.dirtyElements) dirtyElements.add(id);
      for (const id of dirty.dirtySlides) dirtySlides.add(id);
      if (affectsSlideSequence(patches.forward)) {
        for (const id of dirty.dirtyElements) renderElements.add(id);
      }
      for (const id of renderPatchSlides(patches.forward)) renderSlides.add(id);
      for (const patch of patches.forward) {
        if (isElementHierarchyPatch(patch)) {
          for (const id of patch.value.affected) {
            touchedElements.add(id);
            renderElements.add(id);
            reorderedElements.add(id);
          }
          continue;
        }
        if (patch.path[0] !== 'elements') continue;
        touchedElements.add(patch.path[1]);
        if (isElementOrderPatch(patch)) reorderedElements.add(patch.path[1]);
        else if (!isElementInteractionPatch(patch)) renderElements.add(patch.path[1]);
      }
      forward.push(...patches.forward);
      inverse.unshift(...patches.inverse);
    };
    try {
      if (commands.length && commands.every((command) => command.type === 'SetZ')) {
        applyCommandPatches(setZBatchPatches(this.doc, commands, origin));
      } else for (const command of commands) {
        const patches = commandPatches(this.doc, command, origin);
        applyCommandPatches(patches);
        if (patches.selection) commandSelection = patches.selection;
        // 批量文字命令没有单一 command.id；以实际文字 patch 为真相才能完整覆盖所有 shape。
        for (const patch of patches.forward) {
          if (patch.path[0] === 'elements' && patch.path.length === 4 && patch.path[3] === 'text') {
            autoFitTargets.add(patch.path[1]);
          }
        }
      }
      for (const id of autoFitTargets) {
        const element = effectiveElement(this.doc, id);
        if (element.kind === 'shape' && element.text?.autoFitShape) {
          const fitted = fitTextShapePatches(this.doc, { type: 'FitTextShape', id }, origin);
          if (fitted.forward.length) historyLinks.push({
            trigger: ['elements', id, 'ovr', 'text'],
            related: fitted.forward.map((patch) => patch.path),
          });
          applyCommandPatches(fitted);
        }
      }
      const structural = forward.some((patch) =>
        isSlideTreePatch(patch) || isElementTreePatch(patch) || isElementHierarchyPatch(patch));
      if (requestedSelection) this.currentSelection = normalizeSelection(this.doc, requestedSelection);
      else if (commandSelection) this.currentSelection = normalizeSelection(this.doc, commandSelection);
      else if (commands.length === 1 && commands[0].type === 'PasteElements') {
        const ids = forward.filter((patch) => patch.path.length === 2 && patch.op === 'insert')
          .map((patch) => patch.path[1]);
        this.currentSelection = normalizeSelection(this.doc, {
          kind: 'elements', ids, enteredGroup: this.doc.slides[commands[0].at.parentId]
            ? null : commands[0].at.parentId,
        });
      } else if (commands.length === 1 && commandSelectsInsertedElement(commands[0])) {
        const id = forward.find((patch) => patch.path.length === 2 && patch.op === 'insert')?.path[1];
        if (id) this.currentSelection = normalizeSelection(this.doc, {
          kind: 'elements', ids: [id], enteredGroup: null,
        });
      } else if (structural) this.currentSelection = selectionAfterStructure(this.doc, this.currentSelection);
      if (forward.some(isElementInteractionPatch)) {
        this.currentSelection = selectionAfterInteractionState(this.doc, this.currentSelection);
      }
      if (structural) validateEditDoc(this.doc);
      else validateEditElements(this.doc, forward
        .filter((patch) => patch.path[0] === 'elements').map((patch) => patch.path[1]));
      if (forward.length) advanceCollaborationVersion(this.doc.identity);
    } catch (error) {
      // 多命令事务的逆补丁依赖前序恢复的行列/元素；失败回滚也必须按顺序暂存验证。
      if (inverse.length) applyPatches(this.doc, inverse);
      // AddSlide 会惰性创建 OPC 水位；只 Object.assign 会把失败事务新增的字段残留在文档中。
      for (const key of Object.keys(this.doc.identity)) {
        if (!Object.prototype.hasOwnProperty.call(identityBefore, key)) {
          delete (this.doc.identity as unknown as Record<string, unknown>)[key];
        }
      }
      Object.assign(this.doc.identity, identityBefore);
      this.currentSelection = selectionBefore;
      throw error;
    }

    const selectionAfter = this.selection;
    this.refreshActiveImageResources(forward);
    const slideChanges = slidePatchSets(this.doc, forward);
    const beforeState = this.currentState;
    if (hasDocumentPatch(forward)) this.currentState = this.nextState++;
    const recordsHistory = forward.length && options.recordHistory !== false && origin === this.origin;
    if (recordsHistory) {
      // 资源表是按哈希寻址的会话缓存；撤销只切换元素引用，避免新旧 Base64 同时挤占历史预算。
      const historyForward = forward.filter((patch) => !isImageResourcePatch(patch));
      const historyInverse = inverse.filter((patch) => !isImageResourcePatch(patch));
      const entry: HistoryEntry = {
        forward: historyForward,
        inverse: historyInverse,
        selectionBefore,
        selectionAfter,
        label,
        time: operationTime,
        ...(options.mergeKey ? { mergeKey: options.mergeKey } : {}),
        affectedSlides: [...new Set([...dirtySlides, ...slideChanges.notesSlides])],
      };
      this.historyStore.push(entry, beforeState, this.currentState, historyLinks);
    } else if (forward.length) {
      this.historyStore.rebaseUnrecorded(forward, this.currentState, () => this.nextState++);
    }
    const selectionChanged = JSON.stringify(selectionBefore) !== JSON.stringify(selectionAfter);
    const paneElements = panePatchElements(forward);
    for (const id of bodyPropsPatchElements(forward, inverse)) bodyPropsElements.add(id);
    if (!forward.length && selectionChanged) this.historyStore.breakMerge();
    if (forward.length || selectionChanged) {
      if (forward.length) this.queuePatches('transaction', forward, origin, label, operationTime);
      this.emitRecovery(forward.length ? 'transaction' : 'selection', forward, label, operationTime);
      this.emit(
        'transaction', dirtyElements, dirtySlides, touchedElements,
        renderElements, reorderedElements, bodyPropsElements,
        slideChanges,
        renderSlides,
        paneElements,
      );
      this.flushPatches();
    }
    return {
      forward, inverse, dirtyElements, dirtySlides, renderSlides, selection: selectionAfter,
      ...slideChanges,
    };
  }

  private emitRecovery(
    source: RecoveryFrameSource,
    patches: readonly Patch[],
    label: string,
    time = Date.now(),
  ): void {
    this.recoveryJournal.emit({
      source,
      patches,
      doc: this.doc,
      identity: this.doc.identity,
      selection: this.currentSelection,
      dirty: this.isDirty(),
      label,
      time,
    });
  }

  private queuePatches(
    source: EditorPatchEvent['source'], patches: readonly Patch[], origin: string, label: string, time: number,
  ): void {
    const event: EditorPatchEvent = {
      source, patches: structuredClone([...patches]), identity: structuredClone(this.doc.identity),
      origin, label, time,
    };
    this.patchJournal.queue(event);
  }

  private flushPatches(): void { this.patchJournal.flush(); }

  private emit(
    source: EditorChange['source'],
    elements: Set<ElementId>,
    slides: Set<SlideId>,
    touched: Set<ElementId>,
    render: Set<ElementId>,
    reordered: Set<ElementId>,
    bodyProps: Set<ElementId> = new Set(),
    slideChanges: SlideChangeSets = {
      createdSlides: new Set(), removedSlides: new Set(), movedSlides: new Set(),
      notesSlides: new Set(),
      removedSlideFallbacks: new Map(),
    },
    renderSlides: Set<SlideId> = new Set(),
    paneElements: Set<ElementId> = new Set(),
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
          renderSlides: new Set(renderSlides),
          bodyPropsElements: new Set(bodyProps),
          reorderedElements: new Set(reordered),
          paneElements: new Set(paneElements),
          createdSlides: new Set(slideChanges.createdSlides),
          removedSlides: new Set(slideChanges.removedSlides),
          movedSlides: new Set(slideChanges.movedSlides),
          notesSlides: new Set(slideChanges.notesSlides),
          removedSlideFallbacks: new Map(slideChanges.removedSlideFallbacks),
        });
      } catch (error) {
        reportEditorSubscriberError(error);
      }
    }
  }

  private refreshActiveImageResources(patches: readonly Patch[]): void {
    if (imageReachabilityMayChange(patches)) {
      this.activeImageResources = activeImageResourceHashes(this.doc);
    }
  }

  private historyImageResourceBytes(entries: readonly HistoryEntry[]): number {
    let bytes = 0;
    for (const hash of historyImageResourceHashes(entries)) {
      if (this.activeImageResources.has(hash)) continue;
      const resource = this.doc.imageResources[hash];
      if (resource) bytes += resource.bytes.length + 256;
    }
    return bytes;
  }

  private pruneImageResources(entries: readonly HistoryEntry[]): void {
    const retained = historyImageResourceHashes(entries);
    this.activeImageResources.forEach((hash) => retained.add(hash));
    for (const hash of Object.keys(this.doc.imageResources)) {
      if (!retained.has(hash)) delete this.doc.imageResources[hash];
    }
  }
}
