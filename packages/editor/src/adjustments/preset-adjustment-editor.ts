import type { GeomSpec } from '@web-ppt/core';
import {
  dragPresetAdjustmentHandle, resolvePresetAdjustmentHandles,
} from '@web-ppt/core/geometry/handles';
import type { PresetAdjustmentHandle } from '@web-ppt/core/geometry/handles';
import {
  elementFrameToSlidePoint, queryElementPresetGeometry, screenToSlidePoint, slideOfElement,
  slideToElementFramePoint,
} from '@web-ppt/edit-core';
import type { ElementId } from '@web-ppt/edit-core';
import { PointerGestureLifecycle } from '../pointer-gesture';
import type { PointerGesture, PointerGestureSnapshot } from '../pointer-gesture';
import type { EditorSession } from '../session';
import type { SlideEditor } from '../slide-editor-types';
import type { PresetAdjustmentEditor, PresetAdjustmentEditorOptions } from './types';

const SVG_NS = 'http://www.w3.org/2000/svg';

function svg<K extends keyof SVGElementTagNameMap>(
  document: Document,
  name: K,
): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, name);
}

class DomPresetAdjustmentEditor implements PresetAdjustmentEditor {
  private readonly root: HTMLDivElement;
  private readonly stage: HTMLElement;
  private readonly layer: SVGSVGElement;
  private readonly lifecycle: PointerGestureLifecycle;
  private readonly unsubscribe: () => void;
  private readonly observer: MutationObserver;
  private activeId: ElementId | null = null;
  private preview: GeomSpec | null = null;
  private isDestroyed = false;

  constructor(
    private readonly session: EditorSession,
    private readonly view: SlideEditor,
    private readonly options: PresetAdjustmentEditorOptions,
  ) {
    if (session.disposed || view.destroyed) throw new Error('不能挂载到已释放的编辑视图');
    this.root = view.element;
    const stage = this.root.querySelector<HTMLElement>('[data-ppt-stage]');
    const layer = this.root.querySelector<SVGSVGElement>('[data-ppt-layer="interaction"]');
    const staticLayer = this.root.querySelector<HTMLElement>('[data-ppt-layer="static"]');
    if (!stage || !layer || !staticLayer) throw new Error('编辑视图缺少三层 DOM');
    this.stage = stage;
    this.layer = layer;
    this.lifecycle = new PointerGestureLifecycle(this.root);
    this.root.addEventListener('pointerdown', this.pointerDown, true);
    this.root.addEventListener('pointermove', this.pointerMove, true);
    this.root.addEventListener('pointerup', this.pointerUp, true);
    this.root.addEventListener('pointercancel', this.pointerCancel, true);
    this.root.addEventListener('keydown', this.keyDown, true);
    this.unsubscribe = session.editor.subscribe(() => this.render());
    const Mutation = this.root.ownerDocument.defaultView?.MutationObserver ?? MutationObserver;
    this.observer = new Mutation(() => this.render());
    this.observer.observe(staticLayer, { childList: true });
  }

  get elementId(): ElementId | null { return this.activeId; }
  get geometry(): GeomSpec | null {
    if (!this.activeId || !this.session.editor.doc.elements[this.activeId]) return null;
    return queryElementPresetGeometry(this.session.editor.doc, [this.activeId]).value;
  }
  get handles(): readonly PresetAdjustmentHandle[] {
    const id = this.activeId;
    const geometry = this.preview ?? this.geometry;
    if (!id || !geometry) return [];
    const element = this.session.editor.effectiveElement(id);
    return resolvePresetAdjustmentHandles(geometry, element.w, element.h);
  }
  get destroyed(): boolean { return this.isDestroyed; }

  start(id?: ElementId): boolean {
    this.assertAlive();
    const selection = this.session.editor.selection;
    const target = id ?? (selection.kind === 'elements' && selection.ids.length === 1
      ? selection.ids[0] : null);
    if (!target || this.view.mode !== 'edit'
      || slideOfElement(this.session.editor.doc, target) !== this.view.slideId
      || !queryElementPresetGeometry(this.session.editor.doc, [target]).value) return false;
    this.activeId = target;
    this.preview = null;
    this.render();
    return true;
  }

  end(): void {
    this.lifecycle.cancel();
    this.activeId = null;
    this.preview = null;
    this.group()?.remove();
  }

  setPreset(preset: string): boolean {
    this.assertAlive();
    const selection = this.session.editor.selection;
    const target = this.activeId ?? (selection.kind === 'elements' && selection.ids.length === 1
      ? selection.ids[0] : null);
    if (!target || this.view.mode !== 'edit') return false;
    try {
      this.session.editor.exec({ type: 'SetPreset', id: target, preset });
      this.activeId = target;
      this.preview = null;
      this.render();
      return true;
    } catch (error) {
      this.report(error);
      return false;
    }
  }

  refresh(): void { this.assertAlive(); this.render(); }

  destroy(): void {
    if (this.isDestroyed) return;
    this.isDestroyed = true;
    this.lifecycle.cancel();
    this.unsubscribe();
    this.observer.disconnect();
    this.root.removeEventListener('pointerdown', this.pointerDown, true);
    this.root.removeEventListener('pointermove', this.pointerMove, true);
    this.root.removeEventListener('pointerup', this.pointerUp, true);
    this.root.removeEventListener('pointercancel', this.pointerCancel, true);
    this.root.removeEventListener('keydown', this.keyDown, true);
    this.group()?.remove();
    this.activeId = null;
    this.preview = null;
  }

  private assertAlive(): void {
    if (this.isDestroyed || this.session.disposed || this.view.destroyed) {
      throw new Error('预设调节柄扩展已经释放');
    }
  }

  private group(): SVGGElement | null {
    return this.layer.querySelector<SVGGElement>('[data-ppt-preset-adjustments]');
  }

  private render(): void {
    this.group()?.remove();
    const id = this.activeId;
    if (!id || this.isDestroyed || this.view.destroyed || this.view.mode !== 'edit'
      || !this.session.editor.doc.elements[id]
      || slideOfElement(this.session.editor.doc, id) !== this.view.slideId) return;
    const group = svg(this.layer.ownerDocument, 'g');
    group.dataset.pptPresetAdjustments = '';
    group.dataset.pptPresetElement = id;
    for (const handle of this.handles) {
      const point = elementFrameToSlidePoint(this.session.editor.doc, id, handle);
      const circle = svg(this.layer.ownerDocument, 'circle');
      circle.dataset.pptPresetHandle = String(handle.index);
      circle.dataset.pptPresetKind = handle.kind;
      circle.setAttribute('cx', String(point.x));
      circle.setAttribute('cy', String(point.y));
      circle.setAttribute('r', String(6 / this.view.zoom));
      circle.setAttribute('fill', '#f59e0b');
      circle.setAttribute('stroke', '#fff');
      circle.setAttribute('stroke-width', String(2 / this.view.zoom));
      circle.style.pointerEvents = 'all';
      circle.style.cursor = 'crosshair';
      group.append(circle);
    }
    this.layer.append(group);
  }

  private geometryAt(snapshot: PointerGestureSnapshot, index: number, source: GeomSpec): GeomSpec {
    const id = this.activeId!;
    const rect = this.stage.getBoundingClientRect();
    const slide = screenToSlidePoint(snapshot.screen, {
      left: rect.left, top: rect.top, zoom: this.view.zoom,
    });
    const frame = slideToElementFramePoint(this.session.editor.doc, id, slide);
    const element = this.session.editor.effectiveElement(id);
    return dragPresetAdjustmentHandle(source, element.w, element.h, index, frame);
  }

  private gesture(index: number, source: GeomSpec): PointerGesture {
    let latest = source;
    const update = (snapshot: PointerGestureSnapshot): void => {
      latest = this.geometryAt(snapshot, index, source);
      this.preview = latest;
      this.render();
    };
    return {
      cursor: 'crosshair', dataset: { name: 'pptPresetDragging', value: String(index) },
      start: () => {}, frame: update,
      finish: (snapshot) => {
        update(snapshot);
        const id = this.activeId!;
        const changes = Object.entries(latest.adj)
          .filter(([name, value]) => source.adj[name] !== value);
        if (!changes.length) return null;
        return () => {
          this.preview = null;
          this.session.editor.transaction((transaction) => {
            for (const [name, value] of changes) {
              transaction.exec({ type: 'SetAdj', id, name, value });
            }
          }, '拖动预设调节柄');
        };
      },
      clear: () => { this.preview = null; this.render(); },
    };
  }

  private stop(event: Event): void {
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  private pointerDown = (event: PointerEvent): void => {
    const target = event.target instanceof Element
      ? event.target.closest<SVGCircleElement>('[data-ppt-preset-handle]') : null;
    if (!target || event.button !== 0 || event.isPrimary === false) return;
    try {
      const geometry = this.geometry;
      if (!geometry) return;
      this.lifecycle.begin(event, this.gesture(Number(target.dataset.pptPresetHandle), geometry));
      this.stop(event);
    } catch (error) { this.report(error); }
  };

  private pointerMove = (event: PointerEvent): void => {
    if (!this.lifecycle.isActive) return;
    try { this.lifecycle.move(event); this.stop(event); } catch (error) { this.report(error); }
  };

  private pointerUp = (event: PointerEvent): void => {
    if (!this.lifecycle.isActive) return;
    try { this.lifecycle.finish(event); this.stop(event); } catch (error) { this.report(error); }
  };

  private pointerCancel = (event: PointerEvent): void => {
    if (!this.lifecycle.isActive) return;
    this.lifecycle.cancelPointer(event);
    this.stop(event);
  };

  private keyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || !this.lifecycle.isActive) return;
    this.lifecycle.cancel();
    this.stop(event);
  };

  private report(error: unknown): void {
    this.lifecycle.cancel();
    this.options.onError?.(error);
    if (!this.options.onError) queueMicrotask(() => { throw error; });
  }
}

export function createPresetAdjustmentEditor(
  session: EditorSession,
  view: SlideEditor,
  options: PresetAdjustmentEditorOptions = {},
): PresetAdjustmentEditor {
  return new DomPresetAdjustmentEditor(session, view, options);
}
