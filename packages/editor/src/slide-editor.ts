import { renderSlideToSvg } from '@web-ppt/core';
import { isElementDescendantOf } from '@web-ppt/edit-core';
import type { EditorChange, ElementId, SlideId } from '@web-ppt/edit-core';
import { foreignObjectScalesCorrectly } from '@web-ppt/viewer-core';
import type { EditorSession } from './session';
import { bindSlideIdentities, touchedElementPartitions } from './dom-identity';
import { patchElement } from './dom-patch';
import { sessionState } from './session-state';

export type EditorMode = 'view' | 'edit';
const SVG_NS = 'http://www.w3.org/2000/svg';

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

function elementsFromPath(path: EventTarget[], root: Element): Element[] {
  return path.filter((target): target is Element =>
    !!target && typeof target === 'object' && (target as Node).nodeType === 1 && root.contains(target as Node));
}

function stripInteractionIdentity(root: Element): void {
  // 交互层与静态层共用一棵 document，复制 id 会让 DOM 查询与 SVG 引用指向不确定。
  for (const element of [root, ...root.querySelectorAll('*')]) {
    element.removeAttribute('id');
    element.removeAttribute('data-edit-id');
    element.removeAttribute('data-edit-root');
  }
}

function selectionClone(target: SVGElement, svg: SVGSVGElement): Element {
  // 组的变换留在祖先 <g>；只克隆目标会掉出当前画布位置。
  let clone = target.cloneNode(true) as Element;
  for (let parent = target.parentNode; parent && parent !== svg; parent = parent.parentNode) {
    if ((parent as Node).nodeType !== 1) continue;
    const shell = parent.cloneNode(false) as Element;
    shell.append(clone);
    clone = shell;
  }
  stripInteractionIdentity(clone);
  return clone;
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
  private readonly onPointerDown = (event: PointerEvent): void => {
    if (this.currentMode !== 'edit') return;
    const candidates = this.hitCandidates(event.composedPath());
    const enteredGroup = this.session.editor.selection.kind === 'elements'
      ? this.session.editor.selection.enteredGroup : null;
    const id = event.altKey
      ? this.alternateCandidate(event.clientX, event.clientY, enteredGroup)
      : this.outermostCandidate(candidates, enteredGroup);
    this.session.editor.select(id
      ? { kind: 'elements', ids: [id], enteredGroup }
      : { kind: 'none' });
    event.preventDefault();
    this.element.focus({ preventScroll: true });
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
    if (this.currentMode !== 'edit' || event.key !== 'Escape') return;
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

    this.stage.append(this.staticLayer, this.interactionLayer, this.textLayer);
    this.element.append(this.stage);
    this.render();
    this.setMode(this.currentMode);
    this.setZoom(this.currentZoom);
    this.unsubscribe = session.editor.subscribe((change) => this.update(change));
    this.element.addEventListener('pointerdown', this.onPointerDown);
    this.element.addEventListener('dblclick', this.onDoubleClick);
    this.element.addEventListener('keydown', this.onKeyDown);
    try {
      container.append(this.element);
      state.views.add(this);
    } catch (error) {
      this.unsubscribe();
      this.element.removeEventListener('pointerdown', this.onPointerDown);
      this.element.removeEventListener('dblclick', this.onDoubleClick);
      this.element.removeEventListener('keydown', this.onKeyDown);
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
    this.element.removeEventListener('pointerdown', this.onPointerDown);
    this.element.removeEventListener('dblclick', this.onDoubleClick);
    this.element.removeEventListener('keydown', this.onKeyDown);
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
    return elementsFromPath(path, this.staticLayer)
      .map((element) => (element as SVGElement).dataset.editId)
      .filter((id): id is ElementId => !!id && this.isSelectable(id));
  }

  private alternateCandidate(x: number, y: number, enteredGroup: ElementId | null): ElementId | undefined {
    const elements = this.element.ownerDocument.elementsFromPoint?.(x, y) ?? [];
    const candidates: ElementId[] = [];
    for (const element of elements) {
      if (!this.staticLayer.contains(element)) continue;
      const path: EventTarget[] = [];
      for (let current: Element | null = element; current && current !== this.staticLayer; current = current.parentElement) {
        path.push(current);
      }
      const id = this.outermostCandidate(this.hitCandidates(path), enteredGroup);
      if (id && !candidates.includes(id)) candidates.push(id);
    }
    const selection = this.session.editor.selection;
    const currentId = selection.kind === 'elements' && selection.ids.length === 1 ? selection.ids[0] : null;
    const currentIndex = currentId ? candidates.indexOf(currentId) : -1;
    return candidates[currentIndex < 0 ? 0 : (currentIndex + 1) % candidates.length];
  }

  private isSelectable(id: ElementId): boolean {
    let record = this.session.editor.doc.elements[id];
    if (!record) return false;
    while (record) {
      if (record.meta.locked || record.meta.hiddenByUser || record.meta.editable === 'none') return false;
      record = this.session.editor.doc.elements[record.parent];
    }
    return true;
  }

  private outermostCandidate(candidates: ElementId[], enteredGroup: ElementId | null): ElementId | undefined {
    if (!enteredGroup) return candidates[candidates.length - 1];
    const descendants = candidates.filter((id) => id !== enteredGroup
      && isElementDescendantOf(this.session.editor.doc, id, enteredGroup));
    return descendants[descendants.length - 1];
  }

  private update(change: EditorChange): void {
    if (!change.dirtySlides.has(this.currentSlide)) {
      this.renderSelection(change.selection);
      return;
    }
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
    this.renderSelection(change.selection);
  }

  private renderSelection(selection: EditorChange['selection']): void {
    this.interactionLayer.replaceChildren();
    if (selection.kind !== 'elements') return;
    const svg = this.staticLayer.querySelector<SVGSVGElement>('svg');
    if (!svg) return;
    for (const id of selection.ids) {
      let record = this.session.editor.doc.elements[id];
      if (!record) continue;
      while (this.session.editor.doc.elements[record.parent]) {
        record = this.session.editor.doc.elements[record.parent];
      }
      if (record.parent !== this.currentSlide) continue;
      const target = [...this.staticLayer.querySelectorAll<SVGElement>('[data-edit-id]')]
        .find((element) => element.dataset.editId === id);
      if (!target) continue;
      const marker = this.element.ownerDocument.createElementNS(SVG_NS, 'g');
      marker.dataset.editSelectionId = id;
      marker.setAttribute('aria-hidden', 'true');
      marker.style.pointerEvents = 'none';
      marker.style.filter = 'drop-shadow(0 0 2px #2563eb)';
      marker.style.opacity = '0.78';
      marker.append(selectionClone(target, svg));
      this.interactionLayer.append(marker);
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
