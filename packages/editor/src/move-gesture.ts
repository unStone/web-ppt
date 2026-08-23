import { isElementDescendantOf } from '@web-ppt/edit-core';
import type { Editor, ElementId } from '@web-ppt/edit-core';
import { findElementPartition } from './dom-identity';
import { screenToSlidePoint, slideToElementParentPoint } from './space';
import type { SpacePoint } from './space';

const SVG_NS = 'http://www.w3.org/2000/svg';
const DRAG_THRESHOLD = 3;

interface MoveTarget {
  id: ElementId;
  x: number;
  y: number;
  startParent: SpacePoint;
  partition: SVGElement;
  wrapper: SVGGElement | null;
}

interface ActiveMove {
  pointerId: number;
  startScreen: SpacePoint;
  startSlide: SpacePoint;
  currentScreen: SpacePoint;
  targets: MoveTarget[];
  started: boolean;
  frame: number | null;
  overlay: SVGGElement | null;
  cursor: string | null;
}

interface MoveGestureOptions {
  root: HTMLElement;
  stage: HTMLElement;
  staticLayer: HTMLElement;
  interactionLayer: SVGSVGElement;
  editor: Editor;
  zoom: () => number;
}

const pointerId = (event: PointerEvent): number => event.pointerId ?? 0;
const cleanNumber = (value: number): number => Math.abs(value) < 1e-9 ? 0 : value;
const translate = (point: SpacePoint): string =>
  `translate(${cleanNumber(point.x)} ${cleanNumber(point.y)})`;

export class MoveGestureController {
  private readonly options: MoveGestureOptions;
  private active: ActiveMove | null = null;

  constructor(options: MoveGestureOptions) {
    this.options = options;
  }

  get isActive(): boolean { return this.active !== null; }

  begin(event: PointerEvent, ids: readonly ElementId[]): void {
    this.cancel();
    const startScreen = { x: event.clientX, y: event.clientY };
    const startSlide = this.toSlide(startScreen);
    const targets = this.moveRoots(ids).map((id): MoveTarget | null => {
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
    this.active = {
      pointerId: pointerId(event), startScreen, startSlide, currentScreen: startScreen,
      targets: targets as MoveTarget[],
      started: false, frame: null, overlay: null, cursor: null,
    };
    try {
      this.options.root.setPointerCapture?.(pointerId(event));
    } catch { /* 合成事件没有活动指针；真实浏览器输入仍必须成功捕获。 */ }
  }

  move(event: PointerEvent): void {
    const active = this.active;
    if (!active || pointerId(event) !== active.pointerId) return;
    active.currentScreen = { x: event.clientX, y: event.clientY };
    if (!active.started) {
      const distance = Math.hypot(
        active.currentScreen.x - active.startScreen.x,
        active.currentScreen.y - active.startScreen.y,
      );
      if (distance < DRAG_THRESHOLD) return;
      this.startPreview(active);
    }
    event.preventDefault();
    this.scheduleFrame(active);
  }

  finish(event: PointerEvent): void {
    const active = this.active;
    if (!active || pointerId(event) !== active.pointerId) return;
    active.currentScreen = { x: event.clientX, y: event.clientY };
    const positions = active.started ? this.positions(active, this.toSlide(active.currentScreen)) : [];
    this.clear(active);
    if (!positions.some(({ target, point }) => Math.abs(point.x - target.x) >= 1e-9
      || Math.abs(point.y - target.y) >= 1e-9)) return;
    this.options.editor.transaction((transaction) => {
      for (const { target, point } of positions) {
        transaction.exec({ type: 'SetXfrm', id: target.id, x: point.x, y: point.y });
      }
    }, '移动元素');
    event.preventDefault();
  }

  cancel(): void {
    if (this.active) this.clear(this.active);
  }

  cancelPointer(event: PointerEvent): void {
    if (this.active && pointerId(event) === this.active.pointerId) this.clear(this.active);
  }

  private toSlide(point: SpacePoint): SpacePoint {
    const rect = this.options.stage.getBoundingClientRect();
    return screenToSlidePoint(point, { left: rect.left, top: rect.top, zoom: this.options.zoom() });
  }

  private moveRoots(ids: readonly ElementId[]): ElementId[] {
    return ids.filter((id) => !ids.some((ancestor) => ancestor !== id
      && isElementDescendantOf(this.options.editor.doc, id, ancestor)));
  }

  private positions(active: ActiveMove, currentSlide: SpacePoint): { target: MoveTarget; point: SpacePoint }[] {
    return active.targets.map((target) => {
      const currentParent = slideToElementParentPoint(this.options.editor.doc, target.id, currentSlide);
      return { target, point: {
        x: target.x + currentParent.x - target.startParent.x,
        y: target.y + currentParent.y - target.startParent.y,
      } };
    });
  }

  private startPreview(active: ActiveMove): void {
    const document = this.options.root.ownerDocument;
    for (const target of active.targets) {
      const wrapper = document.createElementNS(SVG_NS, 'g');
      wrapper.dataset.editDragGhost = target.id;
      target.partition.before(wrapper);
      wrapper.append(target.partition);
      target.wrapper = wrapper;
    }
    active.overlay = this.options.interactionLayer.querySelector<SVGGElement>('[data-edit-selection-ids]');
    active.started = true;
    active.cursor = this.options.root.style.cursor;
    this.options.root.style.cursor = 'grabbing';
    this.options.root.dataset.editDragging = '';
  }

  private scheduleFrame(active: ActiveMove): void {
    if (active.frame !== null) return;
    const view = this.options.root.ownerDocument.defaultView;
    if (!view?.requestAnimationFrame) {
      this.applyFrame(active);
      return;
    }
    active.frame = view.requestAnimationFrame(() => {
      active.frame = null;
      if (this.active === active) this.applyFrame(active);
    });
  }

  private applyFrame(active: ActiveMove): void {
    const currentSlide = this.toSlide(active.currentScreen);
    for (const { target, point } of this.positions(active, currentSlide)) {
      target.wrapper?.setAttribute('transform', translate({
        x: point.x - target.x,
        y: point.y - target.y,
      }));
    }
    active.overlay?.setAttribute('transform', translate({
      x: currentSlide.x - active.startSlide.x,
      y: currentSlide.y - active.startSlide.y,
    }));
  }

  private clear(active: ActiveMove): void {
    this.active = null;
    const view = this.options.root.ownerDocument.defaultView;
    if (active.frame !== null && view?.cancelAnimationFrame) view.cancelAnimationFrame(active.frame);
    active.overlay?.removeAttribute('transform');
    for (const target of active.targets) {
      if (target.wrapper?.parentNode) target.wrapper.replaceWith(target.partition);
    }
    if (active.cursor !== null) this.options.root.style.cursor = active.cursor;
    delete this.options.root.dataset.editDragging;
    try {
      if (this.options.root.hasPointerCapture?.(active.pointerId)) {
        this.options.root.releasePointerCapture(active.pointerId);
      }
    } catch { /* 指针可能已由浏览器在 cancel/lostcapture 路径释放。 */ }
  }
}
