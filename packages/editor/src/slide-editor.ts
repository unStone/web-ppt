import type {
  EditorChange, ElementId, ParagraphPropertiesState, ParagraphPropertyOverrides, RunPropertiesState,
  RunPropertyOverrides, SlideId, TextBodyProperties, TextBodyPropertyOverrides,
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
import { bindSlideEditorEvents } from './slide-editor-events';
import { SlideDomRenderer } from './slide-dom-renderer';
import { querySelectionBodyProps, setSelectionBodyProps } from './selection-body-properties';
import { ImageInsertionController } from './image-insertion';
import type { ImageInsertOptions } from './image-insertion';
import { SlidePointerController } from './slide-pointer-controller';
import { insertTable } from './table-insertion';
import type { TableInsertOptions } from './table-insertion';

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
  /** 注册外置工具栏，使其 pointer 交互不结束当前文字编辑。 */
  registerTextUi(element: HTMLElement): () => void;
  queryRunProps(): RunPropertiesState | null;
  setRunProps(props: RunPropertyOverrides): boolean;
  queryParaProps(): ParagraphPropertiesState | null;
  setParaProps(props: ParagraphPropertyOverrides): boolean;
  queryBodyProps(): TextBodyProperties | null;
  setBodyProps(props: TextBodyPropertyOverrides): boolean;
  insertImage(file: Blob, options?: ImageInsertOptions): Promise<ElementId>;
  chooseImage(options?: ImageInsertOptions): Promise<ElementId | null>;
  insertTable(rows: number, cols: number, options?: TableInsertOptions): ElementId;
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
  private readonly domRenderer: SlideDomRenderer;
  private readonly textEditor: TextEditorController;
  private readonly imageInsertion: ImageInsertionController;
  private readonly pointer: SlidePointerController;
  private isDestroyed = false;
  private readonly unsubscribe: () => void;
  private readonly unbindEvents: () => void;
  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (this.currentMode !== 'edit') return;
    if (this.textEditor.owns(event.target)) return;
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
    this.pointer = new SlidePointerController({
      editor: session.editor, root: this.element,
      staticLayer: this.staticLayer, interactionLayer: this.interactionLayer,
      textEditor: this.textEditor, imageInsertion: this.imageInsertion,
      marquee: this.marqueeGesture, move: this.moveGesture,
      resize: this.resizeGesture, rotation: this.rotationGesture,
      editable: () => this.currentMode === 'edit', slideId: () => this.currentSlide,
      hitCandidates: (path) => this.hitCandidates(path),
    });

    this.stage.append(this.staticLayer, this.interactionLayer, this.textLayer);
    this.element.append(this.stage);
    this.render();
    this.setMode(this.currentMode);
    this.setZoom(this.currentZoom);
    this.unsubscribe = session.editor.subscribe((change) => this.update(change));
    this.unbindEvents = bindSlideEditorEvents(this.element, {
      pointerdown: this.pointer.down, pointermove: this.pointer.move,
      pointerup: this.pointer.up, pointercancel: this.pointer.cancel,
      dblclick: this.pointer.doubleClick, keydown: this.onKeyDown, keyup: this.onKeyUp,
      blur: this.onBlur, copy: this.onCopy, cut: this.onCut, paste: this.onPaste,
    });
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

  releaseTextEditing(): void { this.textEditor.releaseTextEditing(); }
  registerTextUi(element: HTMLElement): () => void { return this.textEditor.registerExternalUi(element); }
  queryRunProps(): RunPropertiesState | null { return this.textEditor.queryRunProps(); }
  setRunProps(props: RunPropertyOverrides): boolean { return this.textEditor.setRunProps(props); }
  queryParaProps(): ParagraphPropertiesState | null { return this.textEditor.queryParaProps(); }
  setParaProps(props: ParagraphPropertyOverrides): boolean { return this.textEditor.setParaProps(props); }
  queryBodyProps(): TextBodyProperties | null {
    return querySelectionBodyProps(this.session.editor, this.currentSlide);
  }

  setBodyProps(props: TextBodyPropertyOverrides): boolean {
    if (this.currentMode !== 'edit' || this.textEditor.isComposing) return false;
    return setSelectionBodyProps(this.session.editor, this.currentSlide, props);
  }

  insertImage(file: Blob, options: ImageInsertOptions = {}): Promise<ElementId> {
    return this.imageInsertion.insert(file, options);
  }

  chooseImage(options: ImageInsertOptions = {}): Promise<ElementId | null> {
    return this.imageInsertion.choose(options);
  }

  insertTable(rows: number, cols: number, options: TableInsertOptions = {}): ElementId {
    if (this.isDestroyed) throw new Error('不能通过已销毁视图插入表格');
    if (this.currentMode !== 'edit') throw new Error('查看模式不能插入表格');
    return insertTable(this.session.editor, this.currentSlide, rows, cols, options);
  }

  setMode(mode: EditorMode): void {
    if (mode !== 'view' && mode !== 'edit') throw new Error(`未知编辑器模式：${String(mode)}`);
    if (mode !== this.currentMode) {
      this.cancelGestures();
      this.keyboard.breakSequence();
      if (mode === 'view') this.textEditor.close(false);
    }
    this.currentMode = mode;
    this.element.dataset.mode = mode;
    // Pointer Events 在按下前就按 touch-action 决定是否交给页面滚动；编辑态必须由画布拥有手势。
    this.element.style.touchAction = mode === 'edit' ? 'none' : '';
    this.interactionLayer.toggleAttribute('hidden', mode === 'view');
    this.textLayer.toggleAttribute('hidden', mode === 'view');
    this.interactionLayer.style.display = mode === 'view' ? 'none' : '';
    this.textLayer.style.display = mode === 'view' ? 'none' : '';
    this.domRenderer.renderSelection(this.session.editor.selection);
  }

  setSlide(slideId: SlideId): void {
    if (!this.session.editor.doc.slides[slideId]) throw new Error(`找不到幻灯片：${slideId}`);
    if (slideId === this.currentSlide) return;
    this.cancelGestures();
    this.keyboard.breakSequence();
    this.textEditor.close(false);
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
    this.domRenderer.renderSelection(this.session.editor.selection);
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
    this.textEditor.destroy();
    this.imageInsertion.destroy();
    this.unsubscribe();
    this.unbindEvents();
    sessionState(this.session).views.delete(this);
    this.element.remove();
  }

  private render(): void {
    this.domRenderer.render(this.session.editor.selection);
    this.textEditor.refreshStatic();
  }

  private hitCandidates(path: EventTarget[]): ElementId[] {
    const seen = new Set<ElementId>();
    return [this.interactionLayer, this.staticLayer].flatMap((root) =>
      selectableElementIdsFromPath(this.session.editor.doc, path, root))
      .filter((id) => !seen.has(id) && !!seen.add(id));
  }

  private update(change: EditorChange): void {
    this.cancelGestures();
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
