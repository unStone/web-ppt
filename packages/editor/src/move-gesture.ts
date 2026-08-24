import { outermostSelectedElementIds, screenToSlidePoint, slideToElementParentPoint } from '@web-ppt/edit-core';
import type { Editor, ElementId, SpacePoint } from '@web-ppt/edit-core';
import { findElementPartition } from './dom-identity';
import { PointerGestureLifecycle } from './pointer-gesture';
import type { PointerGestureSnapshot } from './pointer-gesture';
import { snapMove } from './snap';
import type { SnapBounds, SnapMargins, SnapTarget } from './snap';
import { createSnapGuideLayer, renderSnapGuides } from './snap-guides';
import { transformFrameCorners } from './transform-frame';

const SVG_NS = 'http://www.w3.org/2000/svg';

interface MoveTarget {
  id: ElementId;
  x: number;
  y: number;
  startParent: SpacePoint;
  partition: SVGElement;
  wrapper: SVGGElement | null;
}

interface MoveSession {
  startSlide: SpacePoint;
  targets: MoveTarget[];
  overlay: SVGGElement | null;
  guideLayer: SVGGElement | null;
  bounds: SnapBounds;
  siblings: SnapTarget[];
}

interface MoveGestureOptions {
  root: HTMLElement;
  stage: HTMLElement;
  staticLayer: HTMLElement;
  interactionLayer: SVGSVGElement;
  editor: Editor;
  zoom: () => number;
  snapping: () => boolean;
  margins: () => SnapMargins | undefined;
}

const cleanNumber = (value: number): number => Math.abs(value) < 1e-9 ? 0 : value;
const translate = (point: SpacePoint): string =>
  `translate(${cleanNumber(point.x)} ${cleanNumber(point.y)})`;

function boundsOf(points: readonly SpacePoint[]): SnapBounds {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    left: Math.min(...xs), top: Math.min(...ys),
    right: Math.max(...xs), bottom: Math.max(...ys),
  };
}

export class MoveGestureController {
  private readonly options: MoveGestureOptions;
  private readonly lifecycle: PointerGestureLifecycle;

  constructor(options: MoveGestureOptions) {
    this.options = options;
    this.lifecycle = new PointerGestureLifecycle(options.root);
  }

  get isActive(): boolean { return this.lifecycle.isActive; }

  begin(event: PointerEvent, ids: readonly ElementId[]): void {
    this.cancel();
    const startScreen = { x: event.clientX, y: event.clientY };
    const startSlide = this.toSlide(startScreen);
    const roots = outermostSelectedElementIds(this.options.editor.doc, ids);
    const targets = roots
      .map((id): MoveTarget | null => {
        const partition = findElementPartition(this.options.staticLayer, id);
        if (!partition) return null;
        const source = this.options.editor.effectiveElement(id);
        return {
          id, x: source.x, y: source.y,
          startParent: slideToElementParentPoint(this.options.editor.doc, id, startSlide),
          partition, wrapper: null,
        };
      });
    if (!targets.length || targets.some((target) => target === null)) return;
    const session: MoveSession = {
      startSlide, targets: targets as MoveTarget[], overlay: null, guideLayer: null,
      bounds: this.selectionBounds(roots), siblings: this.siblingTargets(roots),
    };
    this.lifecycle.begin(event, {
      cursor: 'grabbing', dataset: { name: 'editDragging', value: '' },
      start: () => this.startPreview(session),
      frame: (snapshot) => this.applyFrame(session, snapshot),
      finish: (snapshot) => this.commit(session, snapshot),
      clear: () => this.clearPreview(session),
    });
  }

  move(event: PointerEvent): void { this.lifecycle.move(event); }
  finish(event: PointerEvent): void { this.lifecycle.finish(event); }
  modifier(event: KeyboardEvent): boolean {
    return event.key === 'Control' && this.lifecycle.modifier(event);
  }
  cancel(): void { this.lifecycle.cancel(); }
  cancelPointer(event: PointerEvent): void { this.lifecycle.cancelPointer(event); }

  private toSlide(point: SpacePoint): SpacePoint {
    const rect = this.options.stage.getBoundingClientRect();
    return screenToSlidePoint(point, { left: rect.left, top: rect.top, zoom: this.options.zoom() });
  }

  private positions(session: MoveSession, delta: SpacePoint): { target: MoveTarget; point: SpacePoint }[] {
    const currentSlide = { x: session.startSlide.x + delta.x, y: session.startSlide.y + delta.y };
    return session.targets.map((target) => {
      const currentParent = slideToElementParentPoint(this.options.editor.doc, target.id, currentSlide);
      return { target, point: {
        x: target.x + currentParent.x - target.startParent.x,
        y: target.y + currentParent.y - target.startParent.y,
      } };
    });
  }

  private startPreview(session: MoveSession): void {
    const document = this.options.root.ownerDocument;
    for (const target of session.targets) {
      const wrapper = document.createElementNS(SVG_NS, 'g');
      wrapper.dataset.editDragGhost = target.id;
      target.partition.before(wrapper);
      wrapper.append(target.partition);
      target.wrapper = wrapper;
    }
    session.overlay = this.options.interactionLayer.querySelector<SVGGElement>('[data-edit-selection-ids]');
    session.guideLayer = createSnapGuideLayer(document);
    this.options.interactionLayer.append(session.guideLayer);
  }

  private proposal(session: MoveSession, snapshot: PointerGestureSnapshot) {
    const currentSlide = this.toSlide(snapshot.screen);
    const delta = {
      x: currentSlide.x - session.startSlide.x,
      y: currentSlide.y - session.startSlide.y,
    };
    if (!this.options.snapping() || snapshot.ctrlKey) return { delta, guides: [] };
    return snapMove({
      bounds: session.bounds,
      delta,
      threshold: 6 / this.options.zoom(),
      siblings: session.siblings,
      slide: { width: this.options.editor.doc.meta.width, height: this.options.editor.doc.meta.height },
      margins: this.options.margins(),
    });
  }

  private applyFrame(session: MoveSession, snapshot: PointerGestureSnapshot): void {
    const proposal = this.proposal(session, snapshot);
    for (const { target, point } of this.positions(session, proposal.delta)) {
      target.wrapper?.setAttribute('transform', translate({
        x: point.x - target.x,
        y: point.y - target.y,
      }));
    }
    session.overlay?.setAttribute('transform', translate(proposal.delta));
    if (session.guideLayer) renderSnapGuides(session.guideLayer, proposal.guides, this.options.zoom());
  }

  private commit(session: MoveSession, snapshot: PointerGestureSnapshot): (() => void) | null {
    const positions = this.positions(session, this.proposal(session, snapshot).delta);
    if (!positions.some(({ target, point }) => Math.abs(point.x - target.x) >= 1e-9
      || Math.abs(point.y - target.y) >= 1e-9)) return null;
    return () => this.options.editor.transaction((transaction) => {
      for (const { target, point } of positions) {
        transaction.exec({ type: 'SetXfrm', id: target.id, x: point.x, y: point.y });
      }
    }, '移动元素');
  }

  private clearPreview(session: MoveSession): void {
    session.overlay?.removeAttribute('transform');
    session.guideLayer?.remove();
    for (const target of session.targets) {
      if (target.wrapper?.parentNode) target.wrapper.replaceWith(target.partition);
    }
  }

  private selectionBounds(ids: readonly ElementId[]): SnapBounds {
    return boundsOf(ids.flatMap((id) => transformFrameCorners(
      this.options.editor.doc, id, this.options.editor.effectiveElement(id),
    )));
  }

  private siblingTargets(ids: readonly ElementId[]): SnapTarget[] {
    const doc = this.options.editor.doc;
    const parent = doc.elements[ids[0]]?.parent;
    if (!parent || ids.some((id) => doc.elements[id]?.parent !== parent)) return [];
    const siblings = doc.slides[parent]?.children ?? doc.elements[parent]?.children ?? [];
    const excluded = new Set(ids);
    return siblings.filter((id) => !excluded.has(id) && !doc.elements[id].meta.hiddenByUser)
      .map((id) => ({ id, bounds: this.selectionBounds([id]) }));
  }
}
