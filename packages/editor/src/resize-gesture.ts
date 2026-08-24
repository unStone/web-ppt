import {
  outermostSelectedElementIds, screenToSlidePoint, slideToElementParentPoint,
} from '@web-ppt/edit-core';
import type { AffineMatrix, Editor, ElementId, SpacePoint } from '@web-ppt/edit-core';
import { findElementPartition } from './dom-identity';
import { PointerGestureLifecycle } from './pointer-gesture';
import type { PointerGestureSnapshot } from './pointer-gesture';
import {
  MIN_RESIZE_SIZE, resizeElementFrame, resizeMultiElementFrames,
} from './resize-geometry';
import type { ResizeHandle } from './resize-geometry';
import { updateSelectionOverlayFrame } from './selection-overlay';
import { transformFrameCorners, transformPreviewMatrix } from './transform-frame';
import type { TransformFrame } from './transform-frame';

const SVG_NS = 'http://www.w3.org/2000/svg';
type ResizeCorners = [SpacePoint, SpacePoint, SpacePoint, SpacePoint];

interface ResizeTarget {
  id: ElementId;
  source: TransformFrame;
  partition: SVGElement;
  wrapper: SVGGElement | null;
}

interface ResizeSession {
  handle: ResizeHandle;
  targets: ResizeTarget[];
  selectionSource: TransformFrame;
  originalCorners: ResizeCorners;
}

interface ResizeProposal {
  frames: { target: ResizeTarget; frame: TransformFrame }[];
  corners: ResizeCorners;
  handleFlip: { horizontal: boolean; vertical: boolean };
}

interface ResizeGestureOptions {
  root: HTMLElement;
  stage: HTMLElement;
  staticLayer: HTMLElement;
  interactionLayer: SVGSVGElement;
  editor: Editor;
  zoom: () => number;
}

const matrixAttribute = (matrix: AffineMatrix): string =>
  `matrix(${matrix.a} ${matrix.b} ${matrix.c} ${matrix.d} ${matrix.e} ${matrix.f})`;
const axisCorners = (frame: TransformFrame): ResizeCorners => [
  { x: frame.x, y: frame.y }, { x: frame.x + frame.w, y: frame.y },
  { x: frame.x + frame.w, y: frame.y + frame.h }, { x: frame.x, y: frame.y + frame.h },
];

function axisAlignedFrame(points: readonly SpacePoint[]): TransformFrame {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return {
    x, y,
    w: Math.max(Math.max(...xs) - x, MIN_RESIZE_SIZE),
    h: Math.max(Math.max(...ys) - y, MIN_RESIZE_SIZE),
    rot: 0, flipH: false, flipV: false,
  };
}

export class ResizeGestureController {
  private readonly options: ResizeGestureOptions;
  private readonly lifecycle: PointerGestureLifecycle;

  constructor(options: ResizeGestureOptions) {
    this.options = options;
    this.lifecycle = new PointerGestureLifecycle(options.root);
  }

  get isActive(): boolean { return this.lifecycle.isActive; }

  begin(event: PointerEvent, handle: ResizeHandle, ids: readonly ElementId[]): void {
    this.cancel();
    const targets = outermostSelectedElementIds(this.options.editor.doc, ids)
      .map((id): ResizeTarget | null => {
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
    const typedTargets = targets as ResizeTarget[];
    const points = typedTargets.flatMap((target) =>
      transformFrameCorners(this.options.editor.doc, target.id, target.source));
    const selectionSource = axisAlignedFrame(points);
    const session: ResizeSession = {
      handle, targets: typedTargets, selectionSource,
      originalCorners: typedTargets.length === 1
        ? transformFrameCorners(this.options.editor.doc, typedTargets[0].id, typedTargets[0].source)
        : axisCorners(selectionSource),
    };
    const cursor = event.target && (event.target as SVGElement).style?.cursor || 'default';
    this.lifecycle.begin(event, {
      cursor, dataset: { name: 'editResizing', value: handle },
      start: () => this.startPreview(session),
      frame: (snapshot) => this.applyFrame(session, snapshot),
      finish: (snapshot) => this.commit(session, snapshot),
      clear: () => this.clearPreview(session),
    });
  }

  move(event: PointerEvent): void { this.lifecycle.move(event); }
  finish(event: PointerEvent): void { this.lifecycle.finish(event); }
  modifier(event: KeyboardEvent): boolean {
    return (event.key === 'Shift' || event.key === 'Alt') && this.lifecycle.modifier(event);
  }
  cancel(): void { this.lifecycle.cancel(); }
  cancelPointer(event: PointerEvent): void { this.lifecycle.cancelPointer(event); }

  private currentSlide(screen: SpacePoint): SpacePoint {
    const rect = this.options.stage.getBoundingClientRect();
    return screenToSlidePoint(screen, {
      left: rect.left, top: rect.top, zoom: this.options.zoom(),
    });
  }

  private proposal(session: ResizeSession, snapshot: PointerGestureSnapshot): ResizeProposal {
    const slide = this.currentSlide(snapshot.screen);
    const modifiers = { altKey: snapshot.altKey, shiftKey: snapshot.shiftKey };
    if (session.targets.length === 1) {
      const target = session.targets[0];
      const parent = slideToElementParentPoint(this.options.editor.doc, target.id, slide);
      const frame = resizeElementFrame(target.source, session.handle, parent, modifiers);
      return {
        frames: [{ target, frame }],
        corners: transformFrameCorners(this.options.editor.doc, target.id, frame),
        handleFlip: {
          horizontal: frame.flipH !== target.source.flipH,
          vertical: frame.flipV !== target.source.flipV,
        },
      };
    }

    const selection = resizeElementFrame(session.selectionSource, session.handle, slide, modifiers);
    const resized = resizeMultiElementFrames(
      this.options.editor.doc, session.targets, session.selectionSource, selection,
    );
    const frames = session.targets.map((target, index) => ({ target, frame: resized[index] }));
    const committedSelection = axisAlignedFrame(frames.flatMap(({ target, frame }) =>
      transformFrameCorners(this.options.editor.doc, target.id, frame)));
    return {
      frames,
      corners: axisCorners(committedSelection),
      handleFlip: {
        horizontal: selection.flipH !== session.selectionSource.flipH,
        vertical: selection.flipV !== session.selectionSource.flipV,
      },
    };
  }

  private startPreview(session: ResizeSession): void {
    for (const target of session.targets) {
      const wrapper = this.options.root.ownerDocument.createElementNS(SVG_NS, 'g');
      wrapper.dataset.editResizeGhost = target.id;
      target.partition.before(wrapper);
      wrapper.append(target.partition);
      target.wrapper = wrapper;
    }
  }

  private applyFrame(session: ResizeSession, snapshot: PointerGestureSnapshot): void {
    const proposal = this.proposal(session, snapshot);
    for (const { target, frame } of proposal.frames) {
      target.wrapper?.setAttribute('transform', matrixAttribute(transformPreviewMatrix(target.source, frame)));
    }
    updateSelectionOverlayFrame(
      this.options.interactionLayer, proposal.corners, this.options.zoom(), proposal.handleFlip,
    );
  }

  private commit(session: ResizeSession, snapshot: PointerGestureSnapshot): (() => void) | null {
    const proposal = this.proposal(session, snapshot);
    if (!proposal.frames.some(({ target, frame }) => !this.sameFrame(target.source, frame))) return null;
    return () => this.options.editor.transaction((transaction) => {
      for (const { target, frame } of proposal.frames) {
        transaction.exec({
          type: 'SetXfrm', id: target.id,
          x: frame.x, y: frame.y, w: frame.w, h: frame.h,
          ...(Math.abs(frame.rot - target.source.rot) >= 1e-9 ? { rot: frame.rot } : {}),
        });
        if (frame.flipH !== target.source.flipH || frame.flipV !== target.source.flipV) {
          transaction.exec({ type: 'SetFlip', id: target.id, h: frame.flipH, v: frame.flipV });
        }
      }
    }, '缩放元素');
  }

  private clearPreview(session: ResizeSession): void {
    for (const target of session.targets) {
      if (target.wrapper?.parentNode) target.wrapper.replaceWith(target.partition);
    }
    updateSelectionOverlayFrame(this.options.interactionLayer, session.originalCorners, this.options.zoom());
  }

  private sameFrame(left: TransformFrame, right: TransformFrame): boolean {
    return Math.abs(left.x - right.x) < 1e-9 && Math.abs(left.y - right.y) < 1e-9
      && Math.abs(left.w - right.w) < 1e-9 && Math.abs(left.h - right.h) < 1e-9
      && Math.abs(left.rot - right.rot) < 1e-9
      && left.flipH === right.flipH && left.flipV === right.flipV;
  }
}
