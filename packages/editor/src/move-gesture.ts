import type { Editor, ElementId } from '@web-ppt/edit-core';
import { findElementPartition } from './dom-identity';
import { PointerGestureLifecycle } from './pointer-gesture';
import type { PointerGestureSnapshot } from './pointer-gesture';
import { outermostSelectedElementIds } from './selection-roots';
import { screenToSlidePoint, slideToElementParentPoint } from './space';
import type { SpacePoint } from './space';

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
  startScreen: SpacePoint;
  startSlide: SpacePoint;
  targets: MoveTarget[];
  overlay: SVGGElement | null;
}

interface MoveGestureOptions {
  root: HTMLElement;
  stage: HTMLElement;
  staticLayer: HTMLElement;
  interactionLayer: SVGSVGElement;
  editor: Editor;
  zoom: () => number;
}

const cleanNumber = (value: number): number => Math.abs(value) < 1e-9 ? 0 : value;
const translate = (point: SpacePoint): string =>
  `translate(${cleanNumber(point.x)} ${cleanNumber(point.y)})`;

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
    const targets = outermostSelectedElementIds(this.options.editor.doc, ids)
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
      startScreen, startSlide, targets: targets as MoveTarget[], overlay: null,
    };
    this.lifecycle.begin(event, {
      cursor: 'grabbing', dataset: { name: 'editDragging', value: '' },
      start: () => this.startPreview(session),
      frame: (snapshot) => this.applyFrame(session, snapshot.screen),
      finish: (snapshot) => this.commit(session, snapshot),
      clear: () => this.clearPreview(session),
    });
  }

  move(event: PointerEvent): void { this.lifecycle.move(event); }
  finish(event: PointerEvent): void { this.lifecycle.finish(event); }
  cancel(): void { this.lifecycle.cancel(); }
  cancelPointer(event: PointerEvent): void { this.lifecycle.cancelPointer(event); }

  private toSlide(point: SpacePoint): SpacePoint {
    const rect = this.options.stage.getBoundingClientRect();
    return screenToSlidePoint(point, { left: rect.left, top: rect.top, zoom: this.options.zoom() });
  }

  private positions(session: MoveSession, currentSlide: SpacePoint): { target: MoveTarget; point: SpacePoint }[] {
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
  }

  private applyFrame(session: MoveSession, screen: SpacePoint): void {
    const currentSlide = this.toSlide(screen);
    for (const { target, point } of this.positions(session, currentSlide)) {
      target.wrapper?.setAttribute('transform', translate({
        x: point.x - target.x,
        y: point.y - target.y,
      }));
    }
    session.overlay?.setAttribute('transform', translate({
      x: currentSlide.x - session.startSlide.x,
      y: currentSlide.y - session.startSlide.y,
    }));
  }

  private commit(session: MoveSession, snapshot: PointerGestureSnapshot): (() => void) | null {
    const positions = this.positions(session, this.toSlide(snapshot.screen));
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
    for (const target of session.targets) {
      if (target.wrapper?.parentNode) target.wrapper.replaceWith(target.partition);
    }
  }
}
