import { renderSlideToSvg } from '@web-ppt/core';
import type { EditorChange, SlideId } from '@web-ppt/edit-core';
import { foreignObjectScalesCorrectly } from '@web-ppt/viewer-core';
import type { EditorSession } from './session';
import { bindSlideIdentities, touchedElementPartitions } from './dom-identity';
import { patchElement } from './dom-patch';
import { sessionState } from './session-state';

export type EditorMode = 'view' | 'edit';

export interface SlideEditorOptions {
  slideId?: SlideId;
  mode?: EditorMode;
  zoom?: number;
  /** 默认 auto；受 WebKit foreignObject 缩放缺陷影响时自动切到原生 SVG 文本。 */
  textMode?: 'auto' | 'html' | 'svg';
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
  readonly destroyed: boolean;
  setMode(mode: EditorMode): void;
  setSlide(slideId: SlideId): void;
  setZoom(zoom: number): void;
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
  private readonly textMode: 'html' | 'svg';
  private isDestroyed = false;
  private readonly unsubscribe: () => void;

  constructor(container: HTMLElement, session: EditorSession, options: SlideEditorOptions = {}) {
    if (session.disposed) throw new Error('不能挂载已经释放的编辑会话');
    const state = sessionState(session);
    const slideId = options.slideId ?? session.editor.doc.slideOrder[0];
    if (!slideId || !session.editor.doc.slides[slideId]) throw new Error('找不到要挂载的幻灯片');
    this.session = session;
    this.currentSlide = slideId;
    this.currentMode = options.mode ?? 'edit';
    this.currentZoom = options.zoom ?? 1;
    const requestedTextMode = options.textMode ?? 'auto';
    this.textMode = requestedTextMode === 'auto'
      ? foreignObjectScalesCorrectly(container.ownerDocument) ? 'html' : 'svg'
      : requestedTextMode;
    this.idPrefix = `${session.editor.doc.identity.prefix}view-${++viewSerial}-`;

    const document = container.ownerDocument;
    this.element = document.createElement('div');
    this.element.dataset.webPptEditor = '';
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

    this.stage.append(this.staticLayer, this.interactionLayer, this.textLayer);
    this.element.append(this.stage);
    this.render();
    this.setMode(this.currentMode);
    this.setZoom(this.currentZoom);
    this.unsubscribe = session.editor.subscribe((change) => this.update(change));
    try {
      container.append(this.element);
      state.views.add(this);
    } catch (error) {
      this.unsubscribe();
      this.element.remove();
      throw error;
    }
  }

  get mode(): EditorMode { return this.currentMode; }
  get slideId(): SlideId { return this.currentSlide; }
  get zoom(): number { return this.currentZoom; }
  get destroyed(): boolean { return this.isDestroyed; }

  setMode(mode: EditorMode): void {
    if (mode !== 'view' && mode !== 'edit') throw new Error(`未知编辑器模式：${String(mode)}`);
    this.currentMode = mode;
    this.element.dataset.mode = mode;
    this.interactionLayer.toggleAttribute('hidden', mode === 'view');
    this.textLayer.toggleAttribute('hidden', mode === 'view');
    this.interactionLayer.style.display = mode === 'view' ? 'none' : '';
    this.textLayer.style.display = mode === 'view' ? 'none' : '';
  }

  setSlide(slideId: SlideId): void {
    if (!this.session.editor.doc.slides[slideId]) throw new Error(`找不到幻灯片：${slideId}`);
    if (slideId === this.currentSlide) return;
    this.currentSlide = slideId;
    this.render();
  }

  setZoom(zoom: number): void {
    if (!Number.isFinite(zoom) || zoom <= 0) throw new Error('缩放必须是有限正数');
    this.currentZoom = zoom;
    this.stage.style.transform = `scale(${zoom})`;
  }

  destroy(): void {
    if (this.isDestroyed) return;
    this.isDestroyed = true;
    this.unsubscribe();
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
  }

  private update(change: EditorChange): void {
    if (!change.dirtySlides.has(this.currentSlide)) return;
    const doc = this.session.editor.doc;
    const partitions = touchedElementPartitions(doc, this.currentSlide, change.touchedElements);
    const elementCount = doc.slides[this.currentSlide].children.length;
    if (!partitions.ids.length || partitions.topLevelCount / Math.max(elementCount, 1) > 0.3) {
      this.render();
      return;
    }
    for (const id of partitions.ids) {
      if (!patchElement(this.staticLayer, this.session.editor, id, this.idPrefix, this.textMode)) {
        this.render();
        return;
      }
    }
  }
}

export function createSlideEditor(
  container: HTMLElement,
  session: EditorSession,
  options: SlideEditorOptions = {},
): SlideEditor {
  return new DomSlideEditor(container, session, options);
}
