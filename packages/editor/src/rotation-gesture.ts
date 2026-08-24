import type { Editor, ElementId } from '@web-ppt/edit-core';
import { findElementPartition } from './dom-identity';
import { PointerGestureLifecycle } from './pointer-gesture';
import type { PointerGestureSnapshot } from './pointer-gesture';
import {
  constrainedRotation, pointerAngle, rotateElementAroundSlideCenter, shortestRotationDelta,
} from './rotation-geometry';
import { updateSelectionOverlayFrame } from './selection-overlay';
import { outermostSelectedElementIds } from './selection-roots';
import { screenToSlidePoint, slideToElementParentPoint } from './space';
import type { AffineMatrix, SpacePoint } from './space';
import { transformFrameCorners, transformPreviewMatrix } from './transform-frame';
import type { TransformFrame } from './transform-frame';

const SVG_NS = 'http://www.w3.org/2000/svg';
type RotationCorners = [SpacePoint, SpacePoint, SpacePoint, SpacePoint];

interface RotationTarget {
  id: ElementId;
  source: TransformFrame;
  partition: SVGElement;
  wrapper: SVGGElement | null;
}

interface RotationSession {
  targets: RotationTarget[];
  selectionCenter: SpacePoint;
  angleCenter: SpacePoint;
  previousAngle: number;
  accumulatedDelta: number;
  originalCorners: RotationCorners;
}

interface RotationProposal {
  frames: { target: RotationTarget; frame: TransformFrame }[];
  corners: RotationCorners;
  displayedRotation: number | null;
}

interface RotationGestureOptions {
  root: HTMLElement;
  stage: HTMLElement;
  staticLayer: HTMLElement;
  interactionLayer: SVGSVGElement;
  editor: Editor;
  zoom: () => number;
}

const matrixAttribute = (matrix: AffineMatrix): string =>
  `matrix(${matrix.a} ${matrix.b} ${matrix.c} ${matrix.d} ${matrix.e} ${matrix.f})`;

function axisAlignedCorners(points: readonly SpacePoint[]): RotationCorners {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const right = Math.max(...xs);
  const bottom = Math.max(...ys);
  return [
    { x: left, y: top }, { x: right, y: top },
    { x: right, y: bottom }, { x: left, y: bottom },
  ];
}

const midpoint = (left: SpacePoint, right: SpacePoint): SpacePoint => ({
  x: (left.x + right.x) / 2,
  y: (left.y + right.y) / 2,
});

export class RotationGestureController {
  private readonly options: RotationGestureOptions;
  private readonly lifecycle: PointerGestureLifecycle;

  constructor(options: RotationGestureOptions) {
    this.options = options;
    this.lifecycle = new PointerGestureLifecycle(options.root);
  }

  get isActive(): boolean { return this.lifecycle.isActive; }

  begin(event: PointerEvent, ids: readonly ElementId[]): void {
    this.cancel();
    const roots = outermostSelectedElementIds(this.options.editor.doc, ids);
    if (roots.some((id) => this.options.editor.doc.elements[id]?.meta.editable !== 'full')) return;
    const targets = roots
      .map((id): RotationTarget | null => {
        const partition = findElementPartition(this.options.staticLayer, id);
        if (!partition) return null;
        const element = this.options.editor.effectiveElement(id);
        return {
          id,
          source: {
            x: element.x, y: element.y, w: element.w, h: element.h, rot: element.rot,
            flipH: element.flipH, flipV: element.flipV,
          },
          partition, wrapper: null,
        };
      });
    if (!targets.length || targets.some((target) => target === null)) return;
    const typedTargets = targets as RotationTarget[];
    const targetCorners = typedTargets.map((target) =>
      transformFrameCorners(this.options.editor.doc, target.id, target.source));
    const originalCorners = typedTargets.length === 1
      ? targetCorners[0]
      : axisAlignedCorners(targetCorners.flat());
    const selectionCenter = midpoint(originalCorners[0], originalCorners[2]);
    const angleCenter = typedTargets.length === 1
      ? {
        x: typedTargets[0].source.x + typedTargets[0].source.w / 2,
        y: typedTargets[0].source.y + typedTargets[0].source.h / 2,
      }
      : selectionCenter;
    const startSlide = this.currentSlide({ x: event.clientX, y: event.clientY });
    const start = typedTargets.length === 1
      ? slideToElementParentPoint(this.options.editor.doc, typedTargets[0].id, startSlide)
      : startSlide;
    const session: RotationSession = {
      targets: typedTargets, selectionCenter, angleCenter,
      previousAngle: pointerAngle(angleCenter, start), accumulatedDelta: 0, originalCorners,
    };
    this.lifecycle.begin(event, {
      cursor: 'grabbing', dataset: { name: 'editRotating', value: '' },
      start: () => this.startPreview(session),
      observePointer: (snapshot) => this.observe(session, snapshot),
      frame: (snapshot) => this.applyFrame(session, snapshot),
      finish: (snapshot) => this.commit(session, snapshot),
      clear: () => this.clearPreview(session),
    });
  }

  move(event: PointerEvent): void { this.lifecycle.move(event); }
  finish(event: PointerEvent): void { this.lifecycle.finish(event); }
  modifier(event: KeyboardEvent): boolean {
    return event.key === 'Shift' && this.lifecycle.modifier(event);
  }
  cancel(): void { this.lifecycle.cancel(); }
  cancelPointer(event: PointerEvent): void { this.lifecycle.cancelPointer(event); }

  private currentSlide(screen: SpacePoint): SpacePoint {
    const rect = this.options.stage.getBoundingClientRect();
    return screenToSlidePoint(screen, {
      left: rect.left, top: rect.top, zoom: this.options.zoom(),
    });
  }

  private anglePointer(session: RotationSession, screen: SpacePoint): SpacePoint {
    const slide = this.currentSlide(screen);
    return session.targets.length === 1
      ? slideToElementParentPoint(this.options.editor.doc, session.targets[0].id, slide)
      : slide;
  }

  private observe(session: RotationSession, snapshot: PointerGestureSnapshot): void {
    const angle = pointerAngle(session.angleCenter, this.anglePointer(session, snapshot.screen));
    session.accumulatedDelta += shortestRotationDelta(angle - session.previousAngle);
    session.previousAngle = angle;
  }

  private proposal(session: RotationSession, snapshot: PointerGestureSnapshot): RotationProposal {
    if (session.targets.length === 1) {
      const target = session.targets[0];
      const rot = constrainedRotation(target.source.rot + session.accumulatedDelta, snapshot.shiftKey);
      const frame = { ...target.source, rot };
      return {
        frames: [{ target, frame }],
        corners: transformFrameCorners(this.options.editor.doc, target.id, frame),
        displayedRotation: rot,
      };
    }
    const delta = constrainedRotation(session.accumulatedDelta, snapshot.shiftKey);
    const frames = session.targets.map((target) => ({
      target,
      frame: rotateElementAroundSlideCenter(
        this.options.editor.doc, target.id, target.source, session.selectionCenter, delta,
      ),
    }));
    return {
      frames,
      corners: axisAlignedCorners(frames.flatMap(({ target, frame }) =>
        transformFrameCorners(this.options.editor.doc, target.id, frame))),
      displayedRotation: null,
    };
  }

  private startPreview(session: RotationSession): void {
    for (const target of session.targets) {
      const wrapper = this.options.root.ownerDocument.createElementNS(SVG_NS, 'g');
      wrapper.dataset.editRotationGhost = target.id;
      target.partition.before(wrapper);
      wrapper.append(target.partition);
      target.wrapper = wrapper;
    }
    if (session.targets.length === 1) this.showAngle(true);
  }

  private applyFrame(session: RotationSession, snapshot: PointerGestureSnapshot): void {
    const proposal = this.proposal(session, snapshot);
    for (const { target, frame } of proposal.frames) {
      target.wrapper?.setAttribute('transform', matrixAttribute(transformPreviewMatrix(target.source, frame)));
    }
    updateSelectionOverlayFrame(this.options.interactionLayer, proposal.corners, this.options.zoom());
    if (proposal.displayedRotation !== null) {
      const angle = this.angleElement();
      if (angle) angle.textContent = `${Math.round(proposal.displayedRotation * 10) / 10}°`;
    }
  }

  private commit(session: RotationSession, snapshot: PointerGestureSnapshot): (() => void) | null {
    const proposal = this.proposal(session, snapshot);
    if (!proposal.frames.some(({ target, frame }) => this.changed(target.source, frame))) return null;
    return () => this.options.editor.transaction((transaction) => {
      for (const { target, frame } of proposal.frames) {
        transaction.exec({ type: 'SetXfrm', id: target.id, x: frame.x, y: frame.y, rot: frame.rot });
      }
    }, '旋转元素');
  }

  private clearPreview(session: RotationSession): void {
    for (const target of session.targets) {
      if (target.wrapper?.parentNode) target.wrapper.replaceWith(target.partition);
    }
    updateSelectionOverlayFrame(
      this.options.interactionLayer, session.originalCorners, this.options.zoom(),
    );
    this.showAngle(false);
  }

  private angleElement(): SVGTextElement | null {
    return this.options.interactionLayer.querySelector('[data-edit-rotation-angle]');
  }

  private showAngle(visible: boolean): void {
    const angle = this.angleElement();
    if (!angle) return;
    angle.toggleAttribute('data-edit-rotation-active', visible);
    angle.style.display = visible ? '' : 'none';
  }

  private changed(source: TransformFrame, frame: TransformFrame): boolean {
    return Math.abs(source.x - frame.x) >= 1e-9 || Math.abs(source.y - frame.y) >= 1e-9
      || Math.abs(source.rot - frame.rot) >= 1e-9;
  }
}
