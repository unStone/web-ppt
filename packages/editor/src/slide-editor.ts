import { renderSlideToSvg } from '@web-ppt/core';
import type { EditorChange, ElementId, SlideId } from '@web-ppt/edit-core';
import { foreignObjectScalesCorrectly } from '@web-ppt/viewer-core';
import type { EditorSession } from './session';
import {
  bindSlideIdentities, findElementPartition, shouldRenderWholeSlide, touchedElementPartitions,
} from './dom-identity';
import {
  insertElementPartition, patchElement, removeElementPartition, reorderElementPartitions,
} from './dom-patch';
import { EditorKeyboardController } from './editor-keyboard';
import { ElementClipboardController } from './element-clipboard';
import { MarqueeGestureController } from './marquee-gesture';
import { MoveGestureController } from './move-gesture';
import { ResizeGestureController } from './resize-gesture';
import { isResizeHandle } from './resize-geometry';
import type { ResizeHandle } from './resize-geometry';
import { RotationGestureController } from './rotation-gesture';
import { normalizeSnapMargins } from './snap';
import type { SnapMargins } from './snap';
import { combineSelectionIds, selectionModifierActive } from './selection-combine';
import {
  alternateSelectableElementId, directSelectableChildIds, enteredGroupOnSlide, isSelectable,
  outermostHitCandidate, selectableElementIdsFromPath,
} from './selection-hit';
import { renderSelectionOverlay } from './selection-overlay';
import { sessionState } from './session-state';

export type EditorMode = 'view' | 'edit';

export interface SlideEditorOptions {
  slideId?: SlideId;
  mode?: EditorMode;
  zoom?: number;
  /** 默认 auto；受 WebKit foreignObject 缩放缺陷影响时自动切到原生 SVG 文本。 */
  textMode?: 'auto' | 'html' | 'svg';
  /** 默认开启；false 使本视图的移动手势保留原始指针位移。 */
  snapping?: boolean;
  /** 文档没有通用形状页边距；需要时由宿主在幻灯片 px 中显式给出。 */
  snapMargins?: SnapMargins;
}

let viewSerial = 0;

function layer(document: Document, name: string): HTMLDivElement {
  const element = document.createElement('div');
  element.dataset.pptLayer = name;
  element.style.position = 'absolute';
  element.style.inset = '0';
  return element;
}

export interface SlideEditor {
  readonly element: HTMLDivElement;
  readonly mode: EditorMode;
  readonly slideId: SlideId;
  readonly zoom: number;
  readonly snapping: boolean;
  readonly destroyed: boolean;
  setMode(mode: EditorMode): void;
  setSlide(slideId: SlideId): void;
  setZoom(zoom: number): void;
  setSnapping(enabled: boolean): void;
  destroy(): void;
}

class DomSlideEditor implements SlideEditor {
  readonly element: HTMLDivElement;
  private readonly session: EditorSession;
  private readonly stage: HTMLDivElement;
  private readonly staticLayer: HTMLDivElement;
  private readonly interactionLayer: SVGSVGElement;
  private readonly textLayer: HTMLDivElement;
  private readonly idPrefix: string;
  private currentMode: EditorMode;
  private currentZoom: number;
  private currentSlide: SlideId;
  private currentSnapping: boolean;
  private readonly snapMargins: SnapMargins | undefined;
  private readonly textMode: 'html' | 'svg';
  private readonly keyboard: EditorKeyboardController;
  private readonly clipboard: ElementClipboardController;
  private readonly marqueeGesture: MarqueeGestureController;
  private readonly moveGesture: MoveGestureController;
  private readonly resizeGesture: ResizeGestureController;
  private readonly rotationGesture: RotationGestureController;
  private isDestroyed = false;
  private readonly unsubscribe: () => void;
  private readonly onPointerDown = (event: PointerEvent): void => {
    if (this.currentMode !== 'edit' || event.button !== 0 || event.isPrimary === false) return;
    if (this.rotationHandle(event.target)) {
      const selection = this.session.editor.selection;
      if (selection.kind === 'elements'
        && selection.ids.every((selectedId) => isSelectable(this.session.editor.doc, selectedId))) {
        this.moveGesture.cancel();
        this.resizeGesture.cancel();
        this.marqueeGesture.cancel();
        this.rotationGesture.begin(event, selection.ids);
      }
      event.preventDefault();
      this.element.focus({ preventScroll: true });
      return;
    }
    this.rotationGesture.cancel();
    const resizeHandle = this.resizeHandle(event.target);
    if (resizeHandle) {
      const selection = this.session.editor.selection;
      if (selection.kind === 'elements'
        && selection.ids.every((selectedId) => isSelectable(this.session.editor.doc, selectedId))) {
        this.moveGesture.cancel();
        this.marqueeGesture.cancel();
        this.resizeGesture.begin(event, resizeHandle, selection.ids);
      }
      event.preventDefault();
      this.element.focus({ preventScroll: true });
      return;
    }
    this.resizeGesture.cancel();
    const candidates = this.hitCandidates(event.composedPath());
    const enteredGroup = enteredGroupOnSlide(
      this.session.editor.doc,
      this.session.editor.selection.kind === 'elements'
        ? this.session.editor.selection.enteredGroup : null,
      this.currentSlide,
    );
    const togglesSelection = selectionModifierActive(event);
    const id = event.altKey
      ? alternateSelectableElementId(
        this.session.editor.doc,
        this.element.ownerDocument.elementsFromPoint?.(event.clientX, event.clientY) ?? [],
        this.staticLayer,
        enteredGroup,
        this.session.editor.selection,
        togglesSelection,
      )
      : this.outermostCandidate(candidates, enteredGroup);
    const selection = this.session.editor.selection;
    const keepsSelection = id && !event.altKey && !togglesSelection && selection.kind === 'elements'
      && selection.ids.includes(id);
    if (!id) {
      this.moveGesture.cancel();
      this.marqueeGesture.begin(event, enteredGroup);
      event.preventDefault();
      this.element.focus({ preventScroll: true });
      return;
    }
    this.marqueeGesture.cancel();
    if (!keepsSelection) {
      const scope = directSelectableChildIds(this.session.editor.doc, this.currentSlide, enteredGroup);
      const ids = combineSelectionIds(
        scope, selection.kind === 'elements' ? selection.ids : [], [id], togglesSelection,
      );
      this.session.editor.select(ids.length
        ? { kind: 'elements', ids, enteredGroup }
        : { kind: 'none' });
    }
    const nextSelection = this.session.editor.selection;
    if (id && (!event.altKey || togglesSelection) && nextSelection.kind === 'elements'
      && nextSelection.ids.includes(id)
      && nextSelection.ids.every((selectedId) => isSelectable(this.session.editor.doc, selectedId))) {
      this.moveGesture.begin(event, nextSelection.ids);
    }
    event.preventDefault();
    this.element.focus({ preventScroll: true });
  };
  private readonly onPointerMove = (event: PointerEvent): void => {
    this.marqueeGesture.move(event);
    this.rotationGesture.move(event);
    this.resizeGesture.move(event);
    this.moveGesture.move(event);
  };
  private readonly onPointerUp = (event: PointerEvent): void => {
    this.marqueeGesture.finish(event);
    this.rotationGesture.finish(event);
    this.resizeGesture.finish(event);
    this.moveGesture.finish(event);
  };
  private readonly onPointerCancel = (event: PointerEvent): void => {
    this.marqueeGesture.cancelPointer(event);
    this.rotationGesture.cancelPointer(event);
    this.resizeGesture.cancelPointer(event);
    this.moveGesture.cancelPointer(event);
  };
  private readonly onDoubleClick = (event: MouseEvent): void => {
    if (this.currentMode !== 'edit') return;
    const candidates = this.hitCandidates(event.composedPath());
    const selected = this.session.editor.selection;
    if (selected.kind !== 'elements' || selected.ids.length !== 1) return;
    const groupId = selected.ids[0];
    const groupIndex = candidates.indexOf(groupId);
    if (groupIndex < 1 || this.session.editor.doc.elements[groupId]?.src.kind !== 'group') return;
    const id = this.outermostCandidate(candidates.slice(0, groupIndex), groupId);
    if (!id) return;
    this.session.editor.select({ kind: 'elements', ids: [id], enteredGroup: groupId });
    event.preventDefault();
  };
  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (this.currentMode !== 'edit') return;
    if (this.marqueeGesture.modifier(event)) event.preventDefault();
    if (this.moveGesture.modifier(event)) event.preventDefault();
    if (this.rotationGesture.modifier(event)) event.preventDefault();
    if (this.resizeGesture.modifier(event)) event.preventDefault();
    if (this.clipboard.duplicate(event) || this.keyboard.keyDown(event)) return;
    if (event.key !== 'Escape') return;
    if (this.cancelActiveGesture()) {
      event.preventDefault();
      return;
    }
    const selection = this.session.editor.selection;
    if (selection.kind === 'elements' && selection.enteredGroup) {
      const groupId = selection.enteredGroup;
      const parent = this.session.editor.doc.elements[groupId]?.parent;
      const enteredGroup = parent && this.session.editor.doc.elements[parent]?.src.kind === 'group'
        ? parent : null;
      this.session.editor.select({ kind: 'elements', ids: [groupId], enteredGroup });
    } else {
      this.session.editor.select({ kind: 'none' });
    }
    event.preventDefault();
  };
  private readonly onKeyUp = (event: KeyboardEvent): void => {
    if (this.currentMode === 'edit' && this.marqueeGesture.modifier(event)) event.preventDefault();
    if (this.currentMode === 'edit' && this.moveGesture.modifier(event)) event.preventDefault();
    if (this.currentMode === 'edit' && this.rotationGesture.modifier(event)) event.preventDefault();
    if (this.currentMode === 'edit' && this.resizeGesture.modifier(event)) event.preventDefault();
    if (this.keyboard.keyUp(event)) event.preventDefault();
  };
  private readonly onBlur = (): void => { this.keyboard.breakSequence(); };
  private readonly onCopy = (event: ClipboardEvent): void => { this.clipboard.copy(event); };
  private readonly onCut = (event: ClipboardEvent): void => { this.clipboard.cut(event); };
  private readonly onPaste = (event: ClipboardEvent): void => { this.clipboard.paste(event); };

  constructor(container: HTMLElement, session: EditorSession, options: SlideEditorOptions = {}) {
    if (session.disposed) throw new Error('不能挂载已经释放的编辑会话');
    const state = sessionState(session);
    const slideId = options.slideId ?? session.editor.doc.slideOrder[0];
    if (!slideId || !session.editor.doc.slides[slideId]) throw new Error('找不到要挂载的幻灯片');
    this.session = session;
    this.currentSlide = slideId;
    this.currentMode = options.mode ?? 'edit';
    this.currentZoom = options.zoom ?? 1;
    if (options.snapping !== undefined && typeof options.snapping !== 'boolean') {
      throw new Error('吸附开关必须是布尔值');
    }
    this.currentSnapping = options.snapping ?? true;
    this.snapMargins = normalizeSnapMargins(options.snapMargins, session.editor.doc.meta);
    const requestedTextMode = options.textMode ?? 'auto';
    this.textMode = requestedTextMode === 'auto'
      ? foreignObjectScalesCorrectly(container.ownerDocument) ? 'html' : 'svg'
      : requestedTextMode;
    this.idPrefix = `${session.editor.doc.identity.prefix}view-${++viewSerial}-`;

    const document = container.ownerDocument;
    this.element = document.createElement('div');
    this.element.dataset.webPptEditor = '';
    this.element.tabIndex = 0;
    this.element.style.position = 'relative';
    this.element.style.overflow = 'hidden';

    this.stage = document.createElement('div');
    this.stage.dataset.pptStage = '';
    this.stage.style.position = 'relative';
    this.stage.style.transformOrigin = '0 0';
    this.stage.style.width = `${state.presentation.width}px`;
    this.stage.style.height = `${state.presentation.height}px`;

    this.staticLayer = layer(document, 'static');
    this.interactionLayer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.interactionLayer.dataset.pptLayer = 'interaction';
    this.interactionLayer.setAttribute('viewBox', `0 0 ${state.presentation.width} ${state.presentation.height}`);
    this.interactionLayer.style.position = 'absolute';
    this.interactionLayer.style.inset = '0';
    this.interactionLayer.style.width = '100%';
    this.interactionLayer.style.height = '100%';
    this.textLayer = layer(document, 'text');
    this.interactionLayer.style.pointerEvents = 'none';
    this.textLayer.style.pointerEvents = 'none';

    this.keyboard = new EditorKeyboardController({
      editor: session.editor, namespace: this.idPrefix,
      slideId: () => this.currentSlide, revealSlide: (slideId) => this.setSlide(slideId),
      gestureActive: () => this.hasActiveGesture(),
    });
    this.clipboard = new ElementClipboardController({
      editor: session.editor,
      slideId: () => this.currentSlide,
      editable: () => this.currentMode === 'edit',
      gestureActive: () => this.hasActiveGesture(),
    });

    this.marqueeGesture = new MarqueeGestureController({
      root: this.element,
      stage: this.stage,
      interactionLayer: this.interactionLayer,
      editor: session.editor,
      zoom: () => this.currentZoom,
      candidateIds: (enteredGroup) => directSelectableChildIds(
        session.editor.doc, this.currentSlide, enteredGroup,
      ),
    });

    this.moveGesture = new MoveGestureController({
      root: this.element,
      stage: this.stage,
      staticLayer: this.staticLayer,
      interactionLayer: this.interactionLayer,
      editor: session.editor,
      zoom: () => this.currentZoom,
      snapping: () => this.currentSnapping,
      margins: () => this.snapMargins,
    });
    this.resizeGesture = new ResizeGestureController({
      root: this.element,
      stage: this.stage,
      staticLayer: this.staticLayer,
      interactionLayer: this.interactionLayer,
      editor: session.editor,
      zoom: () => this.currentZoom,
    });
    this.rotationGesture = new RotationGestureController({
      root: this.element,
      stage: this.stage,
      staticLayer: this.staticLayer,
      interactionLayer: this.interactionLayer,
      editor: session.editor,
      zoom: () => this.currentZoom,
    });

    this.stage.append(this.staticLayer, this.interactionLayer, this.textLayer);
    this.element.append(this.stage);
    this.render();
    this.setMode(this.currentMode);
    this.setZoom(this.currentZoom);
    this.unsubscribe = session.editor.subscribe((change) => this.update(change));
    this.element.addEventListener('pointerdown', this.onPointerDown);
    this.element.addEventListener('pointermove', this.onPointerMove);
    this.element.addEventListener('pointerup', this.onPointerUp);
    this.element.addEventListener('pointercancel', this.onPointerCancel);
    this.element.addEventListener('lostpointercapture', this.onPointerCancel);
    this.element.addEventListener('dblclick', this.onDoubleClick);
    this.element.addEventListener('keydown', this.onKeyDown);
    this.element.addEventListener('keyup', this.onKeyUp);
    this.element.addEventListener('blur', this.onBlur);
    this.element.addEventListener('copy', this.onCopy);
    this.element.addEventListener('cut', this.onCut);
    this.element.addEventListener('paste', this.onPaste);
    try {
      container.append(this.element);
      state.views.add(this);
    } catch (error) {
      this.unsubscribe();
      this.unbindEvents();
      this.element.remove();
      throw error;
    }
  }

  get mode(): EditorMode { return this.currentMode; }
  get slideId(): SlideId { return this.currentSlide; }
  get zoom(): number { return this.currentZoom; }
  get snapping(): boolean { return this.currentSnapping; }
  get destroyed(): boolean { return this.isDestroyed; }

  setMode(mode: EditorMode): void {
    if (mode !== 'view' && mode !== 'edit') throw new Error(`未知编辑器模式：${String(mode)}`);
    if (mode !== this.currentMode) {
      this.cancelGestures();
      this.keyboard.breakSequence();
    }
    this.currentMode = mode;
    this.element.dataset.mode = mode;
    // Pointer Events 在按下前就按 touch-action 决定是否交给页面滚动；编辑态必须由画布拥有手势。
    this.element.style.touchAction = mode === 'edit' ? 'none' : '';
    this.interactionLayer.toggleAttribute('hidden', mode === 'view');
    this.textLayer.toggleAttribute('hidden', mode === 'view');
    this.interactionLayer.style.display = mode === 'view' ? 'none' : '';
    this.textLayer.style.display = mode === 'view' ? 'none' : '';
  }

  setSlide(slideId: SlideId): void {
    if (!this.session.editor.doc.slides[slideId]) throw new Error(`找不到幻灯片：${slideId}`);
    if (slideId === this.currentSlide) return;
    this.cancelGestures();
    this.keyboard.breakSequence();
    this.currentSlide = slideId;
    this.render();
  }

  setZoom(zoom: number): void {
    if (!Number.isFinite(zoom) || zoom <= 0) throw new Error('缩放必须是有限正数');
    if (zoom !== this.currentZoom) {
      this.cancelGestures();
      this.keyboard.breakSequence();
    }
    this.currentZoom = zoom;
    this.stage.style.transform = `scale(${zoom})`;
    this.renderSelection(this.session.editor.selection);
  }

  setSnapping(enabled: boolean): void {
    if (typeof enabled !== 'boolean') throw new Error('吸附开关必须是布尔值');
    if (enabled === this.currentSnapping) return;
    this.moveGesture.cancel();
    this.currentSnapping = enabled;
  }

  destroy(): void {
    if (this.isDestroyed) return;
    this.isDestroyed = true;
    this.cancelGestures();
    this.keyboard.breakSequence();
    this.unsubscribe();
    this.unbindEvents();
    sessionState(this.session).views.delete(this);
    this.element.remove();
  }

  private render(): void {
    const state = sessionState(this.session);
    this.staticLayer.innerHTML = renderSlideToSvg(
      state.presentation,
      this.session.editor.toSlide(this.currentSlide),
      { textMode: this.textMode, idPrefix: `${this.idPrefix}${this.currentSlide}-` },
    );
    bindSlideIdentities(this.staticLayer, this.session.editor.doc, this.currentSlide);
    this.renderSelection(this.session.editor.selection);
  }

  private hitCandidates(path: EventTarget[]): ElementId[] {
    return selectableElementIdsFromPath(this.session.editor.doc, path, this.staticLayer);
  }

  private resizeHandle(target: EventTarget | null): ResizeHandle | null {
    if (!target || typeof target !== 'object' || (target as Node).nodeType !== 1) return null;
    const handle = (target as Element).closest<SVGRectElement>('[data-edit-resize-handle]');
    if (!handle || !this.interactionLayer.contains(handle)) return null;
    const value = handle.dataset.editResizeHandle;
    return isResizeHandle(value) ? value : null;
  }

  private rotationHandle(target: EventTarget | null): boolean {
    if (!target || typeof target !== 'object' || (target as Node).nodeType !== 1) return false;
    const handle = (target as Element).closest<SVGCircleElement>('[data-edit-rotation-handle]');
    return !!handle && this.interactionLayer.contains(handle);
  }

  private outermostCandidate(candidates: ElementId[], enteredGroup: ElementId | null): ElementId | undefined {
    return outermostHitCandidate(this.session.editor.doc, candidates, enteredGroup);
  }

  private update(change: EditorChange): void {
    this.cancelGestures();
    if (!change.dirtySlides.has(this.currentSlide)) {
      this.renderSelection(change.selection);
      return;
    }
    const doc = this.session.editor.doc;
    const partitions = touchedElementPartitions(doc, this.currentSlide, change.renderElements);
    const elementCount = doc.slides[this.currentSlide].children.length;
    const removed = [...change.renderElements].filter((id) => !doc.elements[id]
      && !!findElementPartition(this.staticLayer, id));
    const changedCount = partitions.ids.length + removed.length;
    if (changedCount && shouldRenderWholeSlide(
      changedCount, partitions.topLevelCount + removed.length, elementCount + removed.length,
    )) {
      this.render();
      return;
    }
    for (const id of removed) {
      if (!removeElementPartition(this.staticLayer, id)) {
        this.render();
        return;
      }
    }
    for (const id of partitions.ids) {
      const exists = !!findElementPartition(this.staticLayer, id);
      const updated = exists
        ? patchElement(this.staticLayer, this.session.editor, id, this.idPrefix, this.textMode)
        : insertElementPartition(this.staticLayer, this.session.editor, id, this.idPrefix, this.textMode);
      if (!updated) {
        this.render();
        return;
      }
    }
    if (change.reorderedElements.size
      && !reorderElementPartitions(this.staticLayer, this.session.editor, change.reorderedElements)) {
      this.render();
      return;
    }
    this.renderSelection(change.selection);
  }

  private renderSelection(selection: EditorChange['selection']): void {
    renderSelectionOverlay(
      this.interactionLayer, this.session.editor.doc, selection, this.currentSlide, this.currentZoom,
    );
  }

  private cancelGestures(): void {
    this.marqueeGesture.cancel();
    this.moveGesture.cancel();
    this.resizeGesture.cancel();
    this.rotationGesture.cancel();
  }

  private cancelActiveGesture(): boolean {
    const gesture = [this.marqueeGesture, this.rotationGesture, this.resizeGesture, this.moveGesture]
      .find((candidate) => candidate.isActive);
    gesture?.cancel();
    return !!gesture;
  }

  private unbindEvents(): void {
    this.element.removeEventListener('pointerdown', this.onPointerDown);
    this.element.removeEventListener('pointermove', this.onPointerMove);
    this.element.removeEventListener('pointerup', this.onPointerUp);
    this.element.removeEventListener('pointercancel', this.onPointerCancel);
    this.element.removeEventListener('lostpointercapture', this.onPointerCancel);
    this.element.removeEventListener('dblclick', this.onDoubleClick);
    this.element.removeEventListener('keydown', this.onKeyDown);
    this.element.removeEventListener('keyup', this.onKeyUp);
    this.element.removeEventListener('blur', this.onBlur);
    this.element.removeEventListener('copy', this.onCopy);
    this.element.removeEventListener('cut', this.onCut);
    this.element.removeEventListener('paste', this.onPaste);
  }

  private hasActiveGesture(): boolean {
    return this.marqueeGesture.isActive || this.moveGesture.isActive
      || this.resizeGesture.isActive || this.rotationGesture.isActive;
  }
}

export function createSlideEditor(
  container: HTMLElement,
  session: EditorSession,
  options: SlideEditorOptions = {},
): SlideEditor {
  return new DomSlideEditor(container, session, options);
}
