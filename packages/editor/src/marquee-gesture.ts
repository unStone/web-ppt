import { effectiveElement } from '@web-ppt/edit-core';
import type { Editor, ElementId } from '@web-ppt/edit-core';
import { PointerGestureLifecycle } from './pointer-gesture';
import type { PointerGestureSnapshot } from './pointer-gesture';
import { screenToSlidePoint } from './space';
import type { SpacePoint } from './space';
import { transformFrameCorners } from './transform-frame';

const SVG_NS = 'http://www.w3.org/2000/svg';
const CONTAINMENT_SCREEN_TOLERANCE = 0.5;

interface MarqueeCandidate {
  id: ElementId;
  corners: readonly SpacePoint[];
  preview: SVGPolygonElement | null;
}

interface MarqueeSession {
  start: SpacePoint;
  enteredGroup: ElementId | null;
  candidates: MarqueeCandidate[];
  selected: ElementId[];
  layer: SVGGElement | null;
  frame: SVGRectElement | null;
  priorOverlay: SVGGElement | null;
}

interface MarqueeGestureOptions {
  root: HTMLElement;
  stage: HTMLElement;
  interactionLayer: SVGSVGElement;
  editor: Editor;
  zoom(): number;
  candidateIds(enteredGroup: ElementId | null): ElementId[];
}

export class MarqueeGestureController {
  private readonly options: MarqueeGestureOptions;
  private readonly lifecycle: PointerGestureLifecycle;
  private session: MarqueeSession | null = null;

  constructor(options: MarqueeGestureOptions) {
    this.options = options;
    this.lifecycle = new PointerGestureLifecycle(options.root);
  }

  get isActive(): boolean { return this.lifecycle.isActive; }

  begin(event: PointerEvent, enteredGroup: ElementId | null): void {
    this.cancel();
    const session: MarqueeSession = {
      start: this.toSlide({ x: event.clientX, y: event.clientY }),
      enteredGroup,
      candidates: [],
      selected: [], layer: null, frame: null, priorOverlay: null,
    };
    this.session = session;
    this.lifecycle.begin(event, {
      cursor: 'crosshair', dataset: { name: 'editMarquee', value: '' },
      start: () => this.startPreview(session),
      frame: (snapshot) => this.applyFrame(session, snapshot),
      finish: (snapshot) => this.commit(session, snapshot),
      clear: () => this.clearPreview(session),
    });
  }

  move(event: PointerEvent): void { this.lifecycle.move(event); }
  finish(event: PointerEvent): void {
    const result = this.lifecycle.finish(event);
    if (result === 'click') this.options.editor.select({ kind: 'none' });
    if (result !== 'ignored') this.session = null;
  }
  cancel(): void {
    this.lifecycle.cancel();
    this.session = null;
  }
  cancelPointer(event: PointerEvent): void {
    this.lifecycle.cancelPointer(event);
    if (!this.lifecycle.isActive) this.session = null;
  }

  private toSlide(point: SpacePoint): SpacePoint {
    const rect = this.options.stage.getBoundingClientRect();
    return screenToSlidePoint(point, { left: rect.left, top: rect.top, zoom: this.options.zoom() });
  }

  private startPreview(session: MarqueeSession): void {
    const document = this.options.root.ownerDocument;
    session.candidates = this.options.candidateIds(session.enteredGroup).map((id) => ({
      id,
      corners: transformFrameCorners(
        this.options.editor.doc, id, effectiveElement(this.options.editor.doc, id),
      ),
      preview: null,
    }));
    const layer = document.createElementNS(SVG_NS, 'g');
    layer.dataset.editMarqueeLayer = '';
    layer.setAttribute('aria-hidden', 'true');
    layer.style.pointerEvents = 'none';
    const frame = document.createElementNS(SVG_NS, 'rect');
    frame.dataset.editMarqueeFrame = '';
    frame.setAttribute('fill', '#2563eb1a');
    frame.setAttribute('stroke', '#2563eb');
    frame.setAttribute('stroke-dasharray', `${4 / this.options.zoom()} ${3 / this.options.zoom()}`);
    layer.append(frame);
    for (const candidate of session.candidates) {
      const preview = document.createElementNS(SVG_NS, 'polygon');
      preview.dataset.editMarqueeCandidate = candidate.id;
      preview.setAttribute('points', candidate.corners.map((point) => `${point.x},${point.y}`).join(' '));
      preview.setAttribute('fill', 'none');
      preview.setAttribute('stroke', '#2563eb');
      preview.setAttribute('display', 'none');
      layer.append(preview);
      candidate.preview = preview;
    }
    session.priorOverlay = this.options.interactionLayer
      .querySelector<SVGGElement>('[data-edit-selection-ids]');
    session.priorOverlay?.setAttribute('display', 'none');
    session.layer = layer;
    session.frame = frame;
    this.options.interactionLayer.append(layer);
  }

  private rectangle(session: MarqueeSession, snapshot: PointerGestureSnapshot) {
    const current = this.toSlide(snapshot.screen);
    return {
      left: Math.min(session.start.x, current.x), top: Math.min(session.start.y, current.y),
      right: Math.max(session.start.x, current.x), bottom: Math.max(session.start.y, current.y),
    };
  }

  private selectionAt(session: MarqueeSession, snapshot: PointerGestureSnapshot): ElementId[] {
    const rectangle = this.rectangle(session, snapshot);
    // 多层旋转/缩放的屏幕坐标往返会留下浮点尾差；容差固定在屏幕空间，避免随 zoom 改变手感。
    const tolerance = CONTAINMENT_SCREEN_TOLERANCE / this.options.zoom();
    return session.candidates.filter((candidate) => candidate.corners.every((point) =>
      point.x >= rectangle.left - tolerance && point.x <= rectangle.right + tolerance
      && point.y >= rectangle.top - tolerance && point.y <= rectangle.bottom + tolerance))
      .map((candidate) => candidate.id);
  }

  private applyFrame(session: MarqueeSession, snapshot: PointerGestureSnapshot): void {
    const rectangle = this.rectangle(session, snapshot);
    const strokeWidth = 1.5 / this.options.zoom();
    session.frame?.setAttribute('x', String(rectangle.left));
    session.frame?.setAttribute('y', String(rectangle.top));
    session.frame?.setAttribute('width', String(rectangle.right - rectangle.left));
    session.frame?.setAttribute('height', String(rectangle.bottom - rectangle.top));
    session.frame?.setAttribute('stroke-width', String(strokeWidth));
    session.selected = this.selectionAt(session, snapshot);
    const selected = new Set(session.selected);
    for (const candidate of session.candidates) {
      candidate.preview?.setAttribute('stroke-width', String(strokeWidth));
      candidate.preview?.setAttribute('display', selected.has(candidate.id) ? '' : 'none');
    }
  }

  private commit(session: MarqueeSession, snapshot: PointerGestureSnapshot): () => void {
    const ids = this.selectionAt(session, snapshot);
    return () => this.options.editor.select(ids.length
      ? { kind: 'elements', ids, enteredGroup: session.enteredGroup }
      : { kind: 'none' });
  }

  private clearPreview(session: MarqueeSession): void {
    session.layer?.remove();
    session.priorOverlay?.removeAttribute('display');
    if (this.session === session) this.session = null;
  }
}
