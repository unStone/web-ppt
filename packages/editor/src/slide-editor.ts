import type {
  EditAnimationStep, EditorChange, ElementId, ImageCrop, LinkTarget, ParagraphPropertiesState, ParagraphPropertyOverrides, RunLinkState, RunPropertiesState,
  RunPropertyOverrides, SlideId, SlideLayoutState, TextBodyProperties, TextBodyPropertyOverrides,
  SlideAnimationState, SlideNotesState, SlideTransitionInput, SlideTransitionState,
} from '@web-ppt/edit-core';
import { foreignObjectScalesCorrectly } from '@web-ppt/viewer-core';
import type { EditorSession } from './session';
import { EditorKeyboardController } from './editor-keyboard';
import { ElementClipboardController } from './element-clipboard';
import { MarqueeGestureController } from './marquee-gesture';
import { MoveGestureController } from './move-gesture';
import { ResizeGestureController } from './resize-gesture';
import { RotationGestureController } from './rotation-gesture';
import { normalizeSnapMargins } from './snap';
import type { SnapMargins } from './snap';
import {
  directSelectableChildIds, selectableElementIdsFromPath,
} from './selection-hit';
import { TextEditorController } from './text-editor';
import { claimTextEditing, releaseTextEditing, sessionState } from './session-state';
import { bindSlideEditorEditEvents, bindSlideEditorLinkEvent } from './slide-editor-events';
import { SlideDomRenderer } from './slide-dom-renderer';
import { ImageInsertionController } from './image-insertion';
import type { ImageBackgroundOptions, ImageInsertOptions, ImageReplaceOptions } from './image-insertion';
import { SlidePointerController } from './slide-pointer-controller';
import type { TableInsertOptions } from './table-insertion';
import { ImageCropGestureController } from './image-crop-gesture';
import { SlideLinkController } from './slide-link-controller';
import type { EditorMode, SlideEditor, SlideEditorOptions } from './slide-editor-types';
import { createEditorLayer, nextViewIdPrefix } from './slide-editor-dom';
import type { FormatPainterStartOptions } from './format-painter-types';
import { FormatPainterViewBinding } from './format-painter-view';
import { SlideEditorCommands } from './slide-editor-commands';
import { SlideEditorKeyboardEvents } from './slide-editor-keyboard-events';
import { TextSearchViewBinding } from './text-search-view';
import type { TextSearchOpenOptions } from './text-search-types';
import { TransitionPreviewController } from './transition-preview';
import { AnimationPreviewController } from './animation-preview';

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
  private readonly imageCropGesture: ImageCropGestureController;
  private readonly domRenderer: SlideDomRenderer;
  private readonly textEditor: TextEditorController;
  private readonly imageInsertion: ImageInsertionController;
  private readonly pointer: SlidePointerController;
  private readonly links: SlideLinkController;
  private readonly formatPainter: FormatPainterViewBinding;
  private readonly textSearch: TextSearchViewBinding;
  private readonly commands: SlideEditorCommands;
  private readonly keyboardEvents: SlideEditorKeyboardEvents;
  private transitionPreview: TransitionPreviewController | null = null;
  private animationPreview: AnimationPreviewController | null = null;
  private isDestroyed = false;
  private readonly unsubscribe: () => void;
  private readonly unbindLinkEvent: () => void;
  private unbindEditEvents: (() => void) | null = null;
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
    this.idPrefix = nextViewIdPrefix(session.editor.doc.identity.prefix);

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

    this.staticLayer = createEditorLayer(document, 'static');
    this.interactionLayer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.interactionLayer.dataset.pptLayer = 'interaction';
    this.interactionLayer.setAttribute('viewBox', `0 0 ${state.presentation.width} ${state.presentation.height}`);
    this.interactionLayer.style.position = 'absolute';
    this.interactionLayer.style.inset = '0';
    this.interactionLayer.style.width = '100%';
    this.interactionLayer.style.height = '100%';
    this.textLayer = createEditorLayer(document, 'text');
    this.interactionLayer.style.pointerEvents = 'none';
    this.textLayer.style.pointerEvents = 'none';

    this.domRenderer = new SlideDomRenderer({
      presentation: state.presentation, editor: session.editor,
      staticLayer: this.staticLayer, interactionLayer: this.interactionLayer,
      slideId: () => this.currentSlide, zoom: () => this.currentZoom,
      idPrefix: this.idPrefix, textMode: this.textMode,
      editable: () => this.currentMode === 'edit',
    });

    this.textEditor = new TextEditorController({
      editor: session.editor,
      boundary: this.element,
      staticLayer: this.staticLayer,
      textLayer: this.textLayer,
      textLayout: this.textMode === 'svg' ? 'engine' : 'browser',
      slideId: () => this.currentSlide,
      claim: () => claimTextEditing(this.session, this),
      release: () => releaseTextEditing(this.session, this),
      syncStatic: (id) => this.domRenderer.syncElement(id),
    });

    this.imageInsertion = new ImageInsertionController({
      editor: session.editor, root: this.element,
      slideId: () => this.currentSlide,
      editable: () => this.currentMode === 'edit',
    });

    this.keyboard = new EditorKeyboardController({
      editor: session.editor, namespace: this.idPrefix,
      slideId: () => this.currentSlide, revealSlide: (slideId) => this.setSlide(slideId),
      gestureActive: () => this.hasActiveGesture(),
      onError: options.onError,
    });
    this.clipboard = new ElementClipboardController({
      editor: session.editor,
      slideId: () => this.currentSlide,
      editable: () => this.currentMode === 'edit',
      gestureActive: () => this.hasActiveGesture(),
      insertImage: (file) => this.imageInsertion.insert(file),
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
    this.imageCropGesture = new ImageCropGestureController({
      root: this.element, stage: this.stage, interactionLayer: this.interactionLayer,
      editor: session.editor, editable: () => this.currentMode === 'edit',
      slideId: () => this.currentSlide, zoom: () => this.currentZoom,
      renderSelection: () => this.domRenderer.renderSelection(this.session.editor.selection),
    });
    this.formatPainter = new FormatPainterViewBinding(
      this.element, session.formatPainter, options.onError,
    );
    this.textSearch = new TextSearchViewBinding(
      this.element, this.staticLayer, session.textSearch,
      () => this.currentMode, () => session.editor.doc.meta.readonly, () => this.currentSlide,
      (match) => this.setSlide(match.slideId), options.onError,
    );
    this.pointer = new SlidePointerController({
      editor: session.editor, root: this.element,
      staticLayer: this.staticLayer, interactionLayer: this.interactionLayer,
      textEditor: this.textEditor, imageInsertion: this.imageInsertion,
      marquee: this.marqueeGesture, move: this.moveGesture,
      resize: this.resizeGesture, rotation: this.rotationGesture, crop: this.imageCropGesture,
      editable: () => this.currentMode === 'edit', slideId: () => this.currentSlide,
      hitCandidates: (path) => this.hitCandidates(path),
      formatPainter: {
        active: () => this.formatPainter.active,
        apply: (target) => this.formatPainter.apply(target),
        error: (error) => this.formatPainter.report(error),
      },
    });
    this.links = new SlideLinkController({
      editor: session.editor, root: this.element,
      mode: () => this.currentMode, slideId: () => this.currentSlide,
      setSlide: (target) => this.setSlide(target),
      queryRunLink: () => this.textEditor.queryRunLink(),
      onFollow: options.onLinkFollow,
    });
    this.commands = new SlideEditorCommands({
      session, element: this.element, textEditor: this.textEditor,
      imageInsertion: this.imageInsertion, imageCropGesture: this.imageCropGesture,
      links: this.links, formatPainter: this.formatPainter,
      textSearch: this.textSearch,
      transitionPreview: () => this.transitionPreviewController(),
      animationPreview: () => this.animationPreviewController(),
      mode: () => this.currentMode, slideId: () => this.currentSlide,
      destroyed: () => this.isDestroyed, cancelGestures: () => this.cancelGestures(),
    });
    this.keyboardEvents = new SlideEditorKeyboardEvents({
      session, keyboard: this.keyboard, clipboard: this.clipboard,
      marquee: this.marqueeGesture, move: this.moveGesture,
      resize: this.resizeGesture, rotation: this.rotationGesture,
      crop: this.imageCropGesture, textEditor: this.textEditor,
      links: this.links, formatPainter: this.formatPainter,
      mode: () => this.currentMode, cancelActiveGesture: () => this.cancelActiveGesture(),
    });

    this.stage.append(this.staticLayer, this.interactionLayer, this.textLayer);
    this.element.append(this.stage);
    this.render();
    this.setZoom(this.currentZoom);
    this.unsubscribe = session.editor.subscribe((change) => this.update(change));
    this.unbindLinkEvent = bindSlideEditorLinkEvent(this.element, {
      click: this.links.click,
      keydown: (event) => { if (!this.textSearch.keydown(event)) this.links.keydown(event); },
    });
    this.setMode(this.currentMode);
    try {
      container.append(this.element);
      state.views.add(this);
    } catch (error) {
      this.unsubscribe();
      this.textSearch.destroy();
      this.formatPainter.destroy();
      this.unbindLinkEvent();
      this.unbindEditEvents?.();
      this.element.remove();
      throw error;
    }
  }

  get mode(): EditorMode { return this.currentMode; }
  get slideId(): SlideId { return this.currentSlide; }
  get zoom(): number { return this.currentZoom; }
  get snapping(): boolean { return this.currentSnapping; }
  get destroyed(): boolean { return this.isDestroyed; }

  startFormatPainter(options: FormatPainterStartOptions = {}): boolean {
    return this.commands.startFormatPainter(options);
  }

  cancelFormatPainter(): void { this.commands.cancelFormatPainter(); }

  openTextSearch(options: TextSearchOpenOptions = {}): void { this.commands.openTextSearch(options); }
  closeTextSearch(): void { this.commands.closeTextSearch(); }
  nextTextSearch() { return this.commands.nextTextSearch(); }
  previousTextSearch() { return this.commands.previousTextSearch(); }
  replaceCurrentText(): boolean { return this.commands.replaceCurrentText(); }
  replaceAllText(): number { return this.commands.replaceAllText(); }

  followLink(target?: LinkTarget): boolean { return this.commands.followLink(target); }
  releaseTextEditing(): void { this.commands.releaseTextEditing(); }
  registerTextUi(element: HTMLElement): () => void { return this.commands.registerTextUi(element); }
  queryRunProps(): RunPropertiesState | null { return this.commands.queryRunProps(); }
  queryRunLink(): RunLinkState | null { return this.commands.queryRunLink(); }
  setRunProps(props: RunPropertyOverrides): boolean { return this.commands.setRunProps(props); }
  queryParaProps(): ParagraphPropertiesState | null { return this.commands.queryParaProps(); }
  setParaProps(props: ParagraphPropertyOverrides): boolean { return this.commands.setParaProps(props); }
  queryBodyProps(): TextBodyProperties | null { return this.commands.queryBodyProps(); }
  setBodyProps(props: TextBodyPropertyOverrides): boolean { return this.commands.setBodyProps(props); }

  insertImage(file: Blob, options: ImageInsertOptions = {}): Promise<ElementId> {
    return this.commands.insertImage(file, options);
  }
  chooseImage(options: ImageInsertOptions = {}): Promise<ElementId | null> {
    return this.commands.chooseImage(options);
  }
  replaceImage(file: Blob, options: ImageReplaceOptions = {}): Promise<ElementId> {
    return this.commands.replaceImage(file, options);
  }
  chooseReplacementImage(options: ImageReplaceOptions = {}): Promise<ElementId | null> {
    return this.commands.chooseReplacementImage(options);
  }

  setBackgroundImage(file: Blob, options: ImageBackgroundOptions = {}): Promise<SlideId> {
    return this.commands.setBackgroundImage(file, options);
  }
  chooseBackgroundImage(options: ImageBackgroundOptions = {}): Promise<SlideId | null> {
    return this.commands.chooseBackgroundImage(options);
  }
  setBackgroundCrop(crop: ImageCrop | null): boolean { return this.commands.setBackgroundCrop(crop); }

  queryTransition(): SlideTransitionState { return this.commands.queryTransition(); }
  previewTransition(value?: SlideTransitionInput): Promise<boolean> {
    this.animationPreview?.cancel();
    return this.commands.previewTransition(value);
  }
  setTransition(value: SlideTransitionInput | null): boolean {
    return this.commands.setTransition(value);
  }
  queryAnimations(): SlideAnimationState { return this.commands.queryAnimations(); }
  previewAnimations(value?: readonly EditAnimationStep[]): Promise<boolean> {
    this.transitionPreview?.cancel();
    return this.commands.previewAnimations(value);
  }
  setAnimations(value: readonly EditAnimationStep[] | null): boolean {
    return this.commands.setAnimations(value);
  }

  queryLayout(): SlideLayoutState { return this.commands.queryLayout(); }

  setLayout(layoutId: string): boolean { return this.commands.setLayout(layoutId); }

  queryNotes(): SlideNotesState {
    return this.commands.queryNotes();
  }

  setNotes(text: string): boolean {
    return this.commands.setNotes(text);
  }

  insertTable(rows: number, cols: number, options: TableInsertOptions = {}): ElementId {
    return this.commands.insertTable(rows, cols, options);
  }

  startImageCrop(id?: ElementId): boolean {
    return this.commands.startImageCrop(id);
  }

  endImageCrop(): void { this.commands.endImageCrop(); }

  setMode(mode: EditorMode): void {
    if (mode !== 'view' && mode !== 'edit') throw new Error(`未知编辑器模式：${String(mode)}`);
    if (mode === 'view' && mode !== this.currentMode) this.formatPainter.cancel();
    if (mode !== this.currentMode) {
      this.transitionPreview?.cancel();
      this.animationPreview?.cancel();
      this.cancelGestures();
      this.keyboard.breakSequence();
      if (mode === 'view') {
        this.textEditor.close(false);
        this.imageCropGesture.exit();
      }
    }
    this.currentMode = mode;
    this.syncEditEvents();
    this.element.dataset.mode = mode;
    // Pointer Events 在按下前就按 touch-action 决定是否交给页面滚动；编辑态必须由画布拥有手势。
    this.element.style.touchAction = mode === 'edit' ? 'none' : '';
    this.interactionLayer.toggleAttribute('hidden', mode === 'view');
    this.textLayer.toggleAttribute('hidden', mode === 'view');
    this.interactionLayer.style.display = mode === 'view' ? 'none' : '';
    this.textLayer.style.display = mode === 'view' ? 'none' : '';
    this.domRenderer.renderSelection(this.session.editor.selection);
    this.textSearch.sync();
  }

  setSlide(slideId: SlideId): void {
    if (!this.session.editor.doc.slides[slideId]) throw new Error(`找不到幻灯片：${slideId}`);
    if (slideId === this.currentSlide) return;
    this.transitionPreview?.cancel();
    this.animationPreview?.cancel();
    this.cancelGestures();
    this.imageCropGesture.exit();
    this.keyboard.breakSequence();
    this.textEditor.close(false);
    this.currentSlide = slideId;
    this.render();
  }

  setZoom(zoom: number): void {
    if (!Number.isFinite(zoom) || zoom <= 0) throw new Error('缩放必须是有限正数');
    if (zoom !== this.currentZoom) {
      this.transitionPreview?.cancel();
      this.animationPreview?.cancel();
      this.cancelGestures();
      this.keyboard.breakSequence();
    }
    this.currentZoom = zoom;
    this.stage.style.transform = `scale(${zoom})`;
    this.domRenderer.renderSelection(this.session.editor.selection);
    this.imageCropGesture.sync(this.session.editor.selection);
    this.textSearch.sync();
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
    this.transitionPreview?.cancel();
    this.animationPreview?.cancel();
    this.cancelGestures();
    this.keyboard.breakSequence();
    this.textEditor.destroy();
    this.imageInsertion.destroy();
    this.imageCropGesture.destroy();
    this.unsubscribe();
    this.textSearch.destroy();
    this.formatPainter.destroy();
    this.unbindEditEvents?.();
    this.unbindEditEvents = null;
    this.unbindLinkEvent();
    sessionState(this.session).views.delete(this);
    this.element.remove();
  }

  private render(): void {
    this.domRenderer.render(this.session.editor.selection);
    this.imageCropGesture.sync(this.session.editor.selection);
    this.textEditor.refreshStatic();
    this.textSearch.sync();
  }

  private syncEditEvents(): void {
    if (this.currentMode === 'view') {
      this.unbindEditEvents?.();
      this.unbindEditEvents = null;
      return;
    }
    if (this.unbindEditEvents) return;
    this.unbindEditEvents = bindSlideEditorEditEvents(this.element, {
      pointerdown: this.pointer.down, pointermove: this.pointer.move,
      pointerup: this.pointer.up, pointercancel: this.pointer.cancel,
      dblclick: this.pointer.doubleClick,
      keydown: this.keyboardEvents.keydown, keyup: this.keyboardEvents.keyup,
      blur: this.keyboardEvents.blur, copy: this.keyboardEvents.copy,
      cut: this.keyboardEvents.cut, paste: this.keyboardEvents.paste,
    });
  }

  private hitCandidates(path: EventTarget[]): ElementId[] {
    const seen = new Set<ElementId>();
    return [this.interactionLayer, this.staticLayer].flatMap((root) =>
      selectableElementIdsFromPath(this.session.editor.doc, path, root))
      .filter((id) => !seen.has(id) && !!seen.add(id));
  }

  private update(change: EditorChange): void {
    this.cancelGestures();
    if (change.dirtySlides.has(this.currentSlide)) {
      this.transitionPreview?.cancel();
      this.animationPreview?.cancel();
    }
    if (!this.session.editor.doc.slides[this.currentSlide]) {
      this.keyboard.breakSequence();
      this.textEditor.close(false);
      const fallback = change.removedSlideFallbacks.get(this.currentSlide)
        ?? this.session.editor.doc.slideOrder[0];
      if (!fallback) return;
      this.currentSlide = fallback;
      this.render();
      return;
    }
    this.domRenderer.update(change, this.textEditor.activeElementId);
    this.textEditor.update(change);
    this.imageCropGesture.sync(change.selection);
    this.textSearch.sync();
  }

  private cancelGestures(): void {
    this.marqueeGesture.cancel();
    this.moveGesture.cancel();
    this.resizeGesture.cancel();
    this.rotationGesture.cancel();
    this.imageCropGesture.cancelGesture();
  }

  private transitionPreviewController(): TransitionPreviewController {
    if (!this.transitionPreview) {
      this.transitionPreview = new TransitionPreviewController({
        layer: this.staticLayer,
        chrome: [this.interactionLayer, this.textLayer],
        current: () => this.session.editor.toSlide(this.currentSlide).transition,
        destroyed: () => this.isDestroyed,
      });
    }
    return this.transitionPreview;
  }

  private animationPreviewController(): AnimationPreviewController {
    if (!this.animationPreview) {
      this.animationPreview = new AnimationPreviewController({
        layer: this.staticLayer,
        chrome: [this.interactionLayer, this.textLayer],
        current: () => this.session.editor.toSlide(this.currentSlide).animations,
        destroyed: () => this.isDestroyed,
      });
    }
    return this.animationPreview;
  }

  private cancelActiveGesture(): boolean {
    if (this.imageCropGesture.isGestureActive) {
      this.imageCropGesture.cancelGesture();
      return true;
    }
    const gesture = [this.marqueeGesture, this.rotationGesture, this.resizeGesture, this.moveGesture]
      .find((candidate) => candidate.isActive);
    gesture?.cancel();
    return !!gesture;
  }

  private hasActiveGesture(): boolean {
    return this.marqueeGesture.isActive || this.moveGesture.isActive
      || this.resizeGesture.isActive || this.rotationGesture.isActive
      || this.imageCropGesture.isGestureActive;
  }
}

export function createSlideEditor(
  container: HTMLElement,
  session: EditorSession,
  options: SlideEditorOptions = {},
): SlideEditor {
  return new DomSlideEditor(container, session, options);
}
