import {
  elementFrameToSlidePoint, moveCustomGeometryPoint, queryElementCustomGeometry,
  screenToSlidePoint, setCustomGeometryClosed, setCustomGeometrySegmentType,
  slideOfElement, slideToElementFramePoint,
} from '@web-ppt/edit-core';
import type { CustomGeometry, CustomGeometryPoint } from '@web-ppt/core';
import type { ElementId, SpacePoint } from '@web-ppt/edit-core';
import { PointerGestureLifecycle } from '../pointer-gesture';
import type { PointerGesture, PointerGestureSnapshot } from '../pointer-gesture';
import type { EditorSession } from '../session';
import type { SlideEditor } from '../slide-editor-types';
import type { VertexEditor, VertexEditorOptions } from './types';

const SVG_NS = 'http://www.w3.org/2000/svg';

function svg<K extends keyof SVGElementTagNameMap>(
  document: Document,
  name: K,
): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, name);
}

class DomVertexEditor implements VertexEditor {
  private readonly root: HTMLDivElement;
  private readonly stage: HTMLElement;
  private readonly layer: SVGSVGElement;
  private readonly lifecycle: PointerGestureLifecycle;
  private readonly unsubscribe: () => void;
  private readonly observer: MutationObserver;
  private activeId: ElementId | null = null;
  private preview: CustomGeometry | null = null;
  private isDestroyed = false;

  constructor(
    private readonly session: EditorSession,
    private readonly view: SlideEditor,
    private readonly options: VertexEditorOptions,
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
  get geometry(): CustomGeometry | null {
    return this.activeId ? queryElementCustomGeometry(this.session.editor.doc, this.activeId) : null;
  }
  get destroyed(): boolean { return this.isDestroyed; }

  start(id?: ElementId): boolean {
    this.assertAlive();
    const selection = this.session.editor.selection;
    const target = id ?? (selection.kind === 'elements' && selection.ids.length === 1
      ? selection.ids[0] : null);
    if (!target || this.view.mode !== 'edit' || slideOfElement(this.session.editor.doc, target) !== this.view.slideId
      || !queryElementCustomGeometry(this.session.editor.doc, target)) return false;
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

  convert(id?: ElementId): boolean {
    this.assertAlive();
    const selection = this.session.editor.selection;
    const target = id ?? (selection.kind === 'elements' && selection.ids.length === 1
      ? selection.ids[0] : null);
    if (!target || this.view.mode !== 'edit') return false;
    try {
      this.session.editor.exec({ type: 'ConvertToCustomGeometry', id: target });
      return this.start(target);
    } catch (error) {
      this.report(error);
      return false;
    }
  }

  setClosed(pathId: string, closed: boolean): void {
    const geometry = this.requireGeometry();
    this.session.editor.exec({
      type: 'SetGeometry', id: this.activeId!,
      geometry: setCustomGeometryClosed(geometry, pathId, closed),
    });
  }

  setSegmentType(pathId: string, commandId: string, type: 'line' | 'cubic'): void {
    const geometry = this.requireGeometry();
    this.session.editor.exec({
      type: 'SetGeometry', id: this.activeId!,
      geometry: setCustomGeometrySegmentType(geometry, pathId, commandId, type),
    });
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
      throw new Error('顶点编辑扩展已经释放');
    }
  }

  private requireGeometry(): CustomGeometry {
    this.assertAlive();
    const geometry = this.geometry;
    if (!geometry || !this.activeId) throw new Error('当前没有正在编辑的自由形状');
    return geometry;
  }

  private group(): SVGGElement | null {
    return this.layer.querySelector<SVGGElement>('[data-ppt-vertex-editor]');
  }

  private slidePoint(point: CustomGeometryPoint, path: CustomGeometry['paths'][number]): SpacePoint {
    const id = this.activeId!;
    const element = this.session.editor.effectiveElement(id);
    return elementFrameToSlidePoint(this.session.editor.doc, id, {
      x: point.x.value / path.width * element.w,
      y: point.y.value / path.height * element.h,
    });
  }

  private render(): void {
    this.group()?.remove();
    const id = this.activeId;
    if (!id || this.isDestroyed || this.view.destroyed || this.view.mode !== 'edit'
      || !this.session.editor.doc.elements[id]
      || slideOfElement(this.session.editor.doc, id) !== this.view.slideId) return;
    const geometry = this.preview ?? queryElementCustomGeometry(this.session.editor.doc, id);
    if (!geometry) return;
    const group = svg(this.layer.ownerDocument, 'g');
    group.dataset.pptVertexEditor = '';
    group.dataset.pptVertexElement = id;
    for (const path of geometry.paths) {
      let previousAnchor: SpacePoint | null = null;
      let subpathAnchor: SpacePoint | null = null;
      const guide = (from: SpacePoint, to: SpacePoint): void => {
        const line = svg(this.layer.ownerDocument, 'line');
        line.setAttribute('x1', String(from.x));
        line.setAttribute('y1', String(from.y));
        line.setAttribute('x2', String(to.x));
        line.setAttribute('y2', String(to.y));
        line.setAttribute('stroke', '#f59e0b');
        line.setAttribute('stroke-width', String(1 / this.view.zoom));
        line.style.pointerEvents = 'none';
        group.append(line);
      };
      for (const command of path.commands) {
        if (command.type === 'arc') throw new Error('顶点查询未物化圆弧命令');
        if (command.type === 'close') {
          previousAnchor = subpathAnchor;
          continue;
        }
        const anchor = command.points[command.points.length - 1];
        const anchorSlide = this.slidePoint(anchor, path);
        const controls = command.points.slice(0, -1).map((control) => this.slidePoint(control, path));
        if (previousAnchor && controls.length) guide(previousAnchor, controls[0]);
        if (controls.length) guide(controls[controls.length - 1], anchorSlide);
        if (command.type === 'move') {
          subpathAnchor = anchorSlide;
        }
        for (const value of command.points) {
          const position = this.slidePoint(value, path);
          const handle = svg(this.layer.ownerDocument, 'circle');
          handle.dataset.pptVertexPoint = value.id;
          handle.dataset.pptVertexPath = path.id;
          handle.dataset.pptVertexRole = value.role;
          handle.setAttribute('cx', String(position.x));
          handle.setAttribute('cy', String(position.y));
          handle.setAttribute('r', String((value.role === 'anchor' ? 5 : 4) / this.view.zoom));
          handle.setAttribute('fill', value.role === 'anchor' ? '#fff' : '#fef3c7');
          handle.setAttribute('stroke', value.role === 'anchor' ? '#2563eb' : '#d97706');
          handle.setAttribute('stroke-width', String(1.5 / this.view.zoom));
          handle.style.pointerEvents = 'all';
          handle.style.cursor = 'crosshair';
          group.append(handle);
        }
        previousAnchor = anchorSlide;
      }
    }
    this.layer.append(group);
  }

  private geometryAt(snapshot: PointerGestureSnapshot, pointId: string, source: CustomGeometry): CustomGeometry {
    const id = this.activeId!;
    const path = source.paths.find((candidate) => candidate.commands.some((command) =>
      command.points.some((point) => point.id === pointId)));
    if (!path) throw new Error(`找不到顶点路径：${pointId}`);
    const rect = this.stage.getBoundingClientRect();
    const slide = screenToSlidePoint(snapshot.screen, { left: rect.left, top: rect.top, zoom: this.view.zoom });
    const frame = slideToElementFramePoint(this.session.editor.doc, id, slide);
    const element = this.session.editor.effectiveElement(id);
    return moveCustomGeometryPoint(source, pointId, {
      x: frame.x / element.w * path.width,
      y: frame.y / element.h * path.height,
    });
  }

  private gesture(pointId: string, source: CustomGeometry): PointerGesture {
    let latest = source;
    const update = (snapshot: PointerGestureSnapshot): void => {
      latest = this.geometryAt(snapshot, pointId, source);
      this.preview = latest;
      this.render();
    };
    return {
      cursor: 'crosshair', dataset: { name: 'pptVertexDragging', value: pointId },
      start: () => {},
      frame: update,
      finish: (snapshot) => {
        update(snapshot);
        const id = this.activeId!;
        return () => {
          this.preview = null;
          this.session.editor.exec({ type: 'SetGeometry', id, geometry: latest });
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
      ? event.target.closest<SVGCircleElement>('[data-ppt-vertex-point]') : null;
    if (!target || event.button !== 0 || event.isPrimary === false) return;
    try {
      const pointId = target.dataset.pptVertexPoint!;
      this.lifecycle.begin(event, this.gesture(pointId, this.requireGeometry()));
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

export function createVertexEditor(
  session: EditorSession,
  view: SlideEditor,
  options: VertexEditorOptions = {},
): VertexEditor {
  return new DomVertexEditor(session, view, options);
}
