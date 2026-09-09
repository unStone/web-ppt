import { applyLocalPatches, applyPatches } from './commands/patch';
import { prepareExtensionCopies } from './extension-copy';
import { rebaseExtensionCopyHistory } from './extension-copy-history';
import { isDocumentExtensionPatch } from './document-extensions';
import { assertPatchCount } from './commands/patch-count';
import {
  assertPureCommand, commandPatches, commandSelectsInsertedElement, commandTargetIds,
} from './commands/dispatch';
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
  Command, DesignCommand, EditorChange, EditorOptions, EditorPatchEvent, EditorPatchSubscriber,
  EditorPatchSubscribeOptions, EditorSubscriber,
  ExternalPatchOptions, History, HistoryEntry, Patch, Selection, SlideChangeSets, Transaction,
  TransactionOptions, TransactionResult,
} from './commands/types';
import { HistoryStore } from './history';
import type { HistoryPatchLink } from './history';
import {
  activeImageResourceHashes, historyImageResourceHashes, imageReachabilityMayChange, imageResourcePatchClosure,
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
import type { DesignTarget, EditDoc, ElementId, SlideId } from './types';
import { changeFromPatches } from './patch-change';
import { assertEditIdentityWatermark, mergeEditIdentityWatermark } from './identity-watermark';
import {
  advanceCollaborationVersion, assertCollaborationVersionAvailable,
} from './identity-allocation';
import { EditorPatchJournal, reportEditorSubscriberError } from './patch-events';
import { assertDesignTarget, canvasTargetOfElement, sameCanvas } from './design-target';
import { toDesignCanvas } from './design';
import { extensionMigrationPatches, observeEditExtensionRegistration } from './extension-runtime';
import { own } from './data-validation';
import { canonicalExtensionPatch, canonicalExtensionPath } from './extension-addresses';

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
  private readonly unsubscribeExtensions: () => void;

  constructor(doc: EditDoc, options: EditorOptions = {}) {
    validateEditDoc(doc);
    this.doc = doc;
    this.origin = options.origin ?? 'local';
    const recovered = options.recoveryFrames && options.recoveryFrames.length
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
      canonicalPath: path => canonicalExtensionPath(doc, path),
      rebase: (entry, patches) => rebaseExtensionCopyHistory(doc, entry, patches),
      externalByteSize: (entries) => this.historyImageResourceBytes(entries),
      changed: (entries) => this.pruneImageResources(entries),
      canMerge: ({ forward, inverse }) => {
        try { this.assertReplayableHistory(forward, inverse); return true; }
        catch { return false; }
      },
    });
    this.history = this.historyStore;
    this.pruneImageResources([]);
    this.unsubscribeExtensions = observeEditExtensionRegistration(doc,
      (render, slides) => this.emit('external', render, slides, new Set(), render, new Set()),
      patches => {
        const recovery = this.recoveryJournal.prepare(doc, patches);
        applyPatches(doc, patches);
        this.historyStore.breakMerge();
        this.emitRecovery('transaction', patches, '扩展数据地址迁移', undefined, recovery);
      });
  }

  get selection(): Selection { return cloneSelection(this.currentSelection); }

  isDirty(): boolean { return this.currentState !== this.savedState; }

  async save(): Promise<Uint8Array> {
    return (await this.saveDetailed()).bytes;
  }

  async saveDetailed(): Promise<OpcPatchResult> {
    const result = await (await import('./save/index')).serializeEditDoc(this.doc);
    this.markSaved();
    return result;
  }

  markSaved(): void {
    this.captureSavepoint()();
  }

  captureSavepoint(): () => void {
    // 确认捕获版本，而不是清除写入期间的新编辑；调用约定见包 README。
    let state: number | undefined = this.currentState;
    this.historyStore.breakMerge();
    return () => {
      if (state === undefined) return;
      const changed = this.savedState !== state;
      this.savedState = state;
      state = undefined;
      // v1 的 savepoint 表示当前干净；迟到的交付用兼容的元数据事务记录当前脏状态。
      if (changed) this.emitRecovery(this.isDirty() ? 'transaction' : 'savepoint', [], '保存点');
    };
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
    return this.commit(commands, null, '', {});
  }

  execDesign(target: DesignTarget, ...commands: DesignCommand[]): TransactionResult {
    assertDesignTarget(this.doc, target);
    if (!commands.length) throw new Error('execDesign 缺少命令');
    for (const command of commands) {
      assertPureCommand(command);
      if (command.type === 'SetBackground' || command.type === 'SetTransition'
        || command.type === 'SetMasterTextStyle'
        || command.type === 'AddShape' || command.type === 'AddImage' || command.type === 'AddTable') {
        if (!('target' in command) || !command.target || !sameCanvas(command.target, target)) {
          throw new Error('设计目标不一致');
        }
        continue;
      }
      const ids = commandTargetIds(command);
      if (!ids.length || ids.some((id) =>
        !sameCanvas(canvasTargetOfElement(this.doc, id), target))) {
        throw new Error(`${command.type} 设计目标不一致`);
      }
    }
    return this.commit(commands, null,
      commands[1] ? '批量设计' : commands[0].type, {}, target);
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

  undo(): EditorChange | null { return this.replayHistory('undo'); }

  redo(): EditorChange | null { return this.replayHistory('redo'); }

  private replayHistory(source: 'undo' | 'redo'): EditorChange | null {
    const undo = source === 'undo';
    const entry = undo ? this.historyStore.peekUndo() : this.historyStore.peekRedo();
    if (!entry) return null;
    const patches = (undo ? entry.inverse : entry.forward).map(patch => canonicalExtensionPatch(this.doc, patch));
    const inverse = (undo ? entry.forward : entry.inverse).map(patch => canonicalExtensionPatch(this.doc, patch));
    const outgoing = this.transportPatches(patches, this.origin);
    assertCollaborationVersionAvailable(this.doc.identity);
    // 远端 Patch 可能改变模型或占用 OPC 身份，两个方向都须在完整暂存模型上重新验真。
    const dirty = applyPatches(this.doc, patches);
    this.refreshActiveImageResources(patches);
    this.currentSelection = cloneSelection(undo ? entry.selectionBefore : entry.selectionAfter);
    if (undo) this.historyStore.moveToRedo(); else this.historyStore.moveToUndo();
    this.currentState = this.currentState === (undo ? entry.afterState : entry.beforeState)
      ? (undo ? entry.beforeState : entry.afterState) : this.nextState++;
    const change = changeFromPatches(this.doc, patches, inverse, source, this.selection, dirty);
    const time = Date.now();
    advanceCollaborationVersion(this.doc.identity);
    this.queuePatches(source, outgoing.patches, this.origin, entry.label, time);
    this.emitRecovery(source, patches, entry.label, time, outgoing.recovery);
    this.emitPatchChange(change);
    this.patchJournal.flush();
    return change;
  }

  applyExternalPatches(patches: readonly Patch[], options: ExternalPatchOptions = {}): EditorChange | null {
    if (!Array.isArray(patches)) throw new Error('外部补丁必须是数组');
    const time = options.time ?? Date.now();
    const origin = options.origin ?? 'external';
    const label = options.label && options.label.trim() || '外部编辑';
    if (!Number.isFinite(time)) throw new Error('外部补丁时间必须是有限数字');
    if (typeof origin !== 'string' || !origin) throw new Error('外部补丁 origin 必须是非空字符串');
    if (options.identity) assertEditIdentityWatermark(options.identity);
    if (!patches.length) {
      if (options.identity) mergeEditIdentityWatermark(this.doc.identity, options.identity);
      // 纯延迟/LWW 消息也改变协同 checkpoint；空帧把元数据与 identity 水位一起持久化。
      if (options.identity) this.emitRecovery('transaction', [], label, time);
      return null;
    }
    patches = [...extensionMigrationPatches(this.doc, patches), ...patches];
    const outgoing = this.transportPatches(patches, origin);
    const history = this.historyStore.prepareRebase(patches);
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
    this.historyStore.rebaseUnrecorded(patches, this.currentState, () => this.nextState++, history);
    const change = changeFromPatches(this.doc, patches, [], 'external', this.selection, dirty);
    this.queuePatches('external', outgoing.patches, origin, label, time);
    this.emitRecovery('transaction', patches, label, time, outgoing.recovery);
    this.emitPatchChange(change);
    this.patchJournal.flush();
    return change;
  }

  toSlide(id: SlideId) { return toSlide(this.doc, id); }
  toDesignCanvas(target: DesignTarget) { return toDesignCanvas(this.doc, target); }
  effectiveElement(id: ElementId) { return effectiveElement(this.doc, id); }

  dispose(): void {
    this.unsubscribeExtensions();
    this.subscribers.clear();
  }

  private commit(
    commands: readonly Command[],
    requestedSelection: Selection | null,
    label: string,
    options: TransactionOptions,
    designTarget?: DesignTarget,
  ): TransactionResult {
    for (const command of commands) {
      assertPureCommand(command);
      if (!designTarget && ('target' in command && (command.target as DesignTarget | null)
        && (command.target as DesignTarget).id
        || commandTargetIds(command).some((id) =>
          this.doc.elements[id] && canvasTargetOfElement(this.doc, id).kind !== 'slide'))) {
        throw new Error('用execDesign');
      }
    }
    label ||= commands[1] ? '批量编辑' : commands[0].type;
    validateCommandRelations(this.doc, commands);
    const operationTime = options.time ?? Date.now();
    if (!Number.isFinite(operationTime)) throw new Error('事务时间必须是有限数字');
    const forward: Patch[] = [];
    let outgoing = { patches: forward as readonly Patch[], recovery: forward as readonly Patch[] };
    const inverse: Patch[] = [];
    const dirtyElements = new Set<ElementId>();
    const dirtySlides = new Set<SlideId>();
    const touchedElements = new Set<ElementId>();
    const renderElements = new Set<ElementId>();
    const renderSlides = new Set<SlideId>();
    const reorderedElements = new Set<ElementId>();
    const bodyPropsElements = new Set<ElementId>();
    const origin = options.origin ?? this.origin;
    const recordsHistory = options.recordHistory !== false && origin === this.origin;
    let historyForward: Patch[] = [], historyInverse: Patch[] = [];
    let rebasedHistory: ReadonlyMap<HistoryEntry, HistoryEntry> | undefined;
    const autoFitTargets = new Set<ElementId>();
    const historyLinks: HistoryPatchLink[] = [];
    let commandSelection: Selection | null = null;
    const selectionBefore = this.selection;
    const identityBefore = structuredClone(this.doc.identity);
    const retainedOriginsBefore = this.doc.retainedElementOrigins;
    const applyCommandPatches = (patches: { forward: Patch[]; inverse: Patch[] }): void => {
      prepareExtensionCopies(this.doc, patches, forward);
      assertPatchCount(Math.max(forward.length + patches.forward.length, inverse.length + patches.inverse.length));
      const dirty = applyLocalPatches(this.doc, patches.forward);
      for (const id of dirty.dirtyElements) dirtyElements.add(id);
      for (const id of dirty.dirtySlides) dirtySlides.add(id);
      if (affectsSlideSequence(patches.forward)) {
        for (const id of dirty.dirtyElements) renderElements.add(id);
      }
      if (patches.forward.some(isDocumentExtensionPatch)) {
        for (const id of dirty.dirtyElements) { renderElements.add(id); touchedElements.add(id); }
      }
      for (const id of renderPatchSlides(this.doc, patches.forward, dirty.dirtySlides)) renderSlides.add(id);
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
        if (element.kind === 'shape' && element.text && element.text.autoFitShape) {
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
        const inserted = forward.find((patch) => patch.path.length === 2 && patch.op === 'insert');
        if (inserted) this.currentSelection = normalizeSelection(this.doc, {
          kind: 'elements', ids: [inserted.path[1]], enteredGroup: null,
        });
      } else if (structural) this.currentSelection = selectionAfterStructure(this.doc, this.currentSelection);
      if (forward.some(isElementInteractionPatch)) {
        this.currentSelection = selectionAfterInteractionState(this.doc, this.currentSelection);
      }
      if (structural) validateEditDoc(this.doc);
      else validateEditElements(this.doc, forward
        .filter((patch) => patch.path[0] === 'elements').map((patch) => patch.path[1]));
      const migrations = extensionMigrationPatches(this.doc, forward);
      outgoing = this.transportPatches(migrations.length ? [...migrations, ...forward] : forward, origin);
      if (recordsHistory) {
        // 历史不存资源表 Patch，但两个重放方向补齐资源后也必须可传输。
        historyForward = forward.filter((patch) => !isImageResourcePatch(patch));
        historyInverse = inverse.filter((patch) => !isImageResourcePatch(patch));
        this.assertReplayableHistory(historyForward, historyInverse);
      } else rebasedHistory = this.historyStore.prepareRebase(forward);
      if (migrations.length) applyPatches(this.doc, migrations);
      if (forward.length) advanceCollaborationVersion(this.doc.identity);
    } catch (error) {
      // 多命令事务的逆补丁依赖前序恢复的行列/元素；失败回滚也必须按顺序暂存验证。
      if (inverse.length) applyPatches(this.doc, inverse);
      if (retainedOriginsBefore === undefined) delete this.doc.retainedElementOrigins;
      else this.doc.retainedElementOrigins = retainedOriginsBefore;
      // AddSlide 会惰性创建 OPC 水位；只 Object.assign 会把失败事务新增的字段残留在文档中。
      for (const key of Object.keys(this.doc.identity)) {
        if (!own(identityBefore, key)) {
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
    if (forward.length && recordsHistory) {
      // 资源表是按哈希寻址的会话缓存；撤销只切换元素引用，避免新旧 Base64 同时挤占历史预算。
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
      this.historyStore.rebaseUnrecorded(forward, this.currentState, () => this.nextState++, rebasedHistory);
    }
    const selectionChanged = JSON.stringify(selectionBefore) !== JSON.stringify(selectionAfter);
    const paneElements = panePatchElements(forward);
    for (const id of bodyPropsPatchElements(forward, inverse)) bodyPropsElements.add(id);
    if (!forward.length && selectionChanged) this.historyStore.breakMerge();
    if (forward.length || selectionChanged) {
      if (forward.length) this.queuePatches('transaction', outgoing.patches, origin, label, operationTime);
      this.emitRecovery(forward.length ? 'transaction' : 'selection', forward, label, operationTime, outgoing.recovery);
      this.emit(
        'transaction', dirtyElements, dirtySlides, touchedElements,
        renderElements, reorderedElements, bodyPropsElements,
        slideChanges,
        renderSlides,
        paneElements,
      );
      this.patchJournal.flush();
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
    preparedPatches?: readonly Patch[],
  ): void {
    this.recoveryJournal.emit({
      source,
      patches,
      preparedPatches,
      doc: this.doc,
      identity: this.doc.identity,
      selection: this.currentSelection,
      dirty: this.isDirty(),
      label,
      time,
    });
  }

  private transportPatches(patches: readonly Patch[], origin: string) {
    // 必须在落模前冻结日志前缀；落模后补声明会把新凭据插到其历史来源之前。
    const recovery = this.recoveryJournal.prepare(this.doc, patches);
    return { recovery, patches: this.patchJournal.observed ? this.patchJournal.transport(this.doc,
      imageResourcePatchClosure(this.doc, patches, origin), origin) : patches };
  }

  private assertReplayableHistory(...directions: readonly Patch[][]): void {
    for (const patches of directions) imageResourcePatchClosure(this.doc, patches, this.origin);
  }

  private queuePatches(
    source: EditorPatchEvent['source'], patches: readonly Patch[], origin: string, label: string, time: number,
  ): void {
    // 协同是可选能力；未订阅时不能为结构事务深拷贝整棵元素树。
    if (!this.patchJournal.observed) return;
    this.patchJournal.queue({
      source, patches: structuredClone(patches), identity: structuredClone(this.doc.identity),
      origin, label, time,
    });
  }

  private emitPatchChange(change: EditorChange): void {
    this.emit(
      change.source, change.dirtyElements, change.dirtySlides, change.touchedElements,
      change.renderElements, change.reorderedElements, change.bodyPropsElements,
      change, change.renderSlides, change.paneElements,
    );
  }

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
