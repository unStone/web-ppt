import type { EditDoc, ElementId } from '@web-ppt/edit-core';
import type { AffineMatrix, SpacePoint } from './space';
import {
  elementFrameToSlidePoint, elementParentToSlideMatrix, inverseTransformSpaceVector,
  slideToElementParentPoint,
} from './space';
import { MIN_FRAME_SIZE } from './transform-frame';
import type { TransformFrame } from './transform-frame';

export const RESIZE_HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
export type ResizeHandle = typeof RESIZE_HANDLES[number];

export function isResizeHandle(value: string | undefined): value is ResizeHandle {
  return RESIZE_HANDLES.some((handle) => handle === value);
}

export interface ResizeModifiers {
  altKey: boolean;
  shiftKey: boolean;
}

export const MIN_RESIZE_SIZE = MIN_FRAME_SIZE;
const ROTATION_SEARCH_STEP = 0.25;
const ROTATION_SEARCH_STEPS = 180 / ROTATION_SEARCH_STEP;
export const RESIZE_HANDLE_AXES: Record<ResizeHandle, readonly [number, number]> = {
  nw: [-1, -1], n: [0, -1], ne: [1, -1], e: [1, 0],
  se: [1, 1], s: [0, 1], sw: [-1, 1], w: [-1, 0],
};

export function resizeHandleAfterFlip(handle: ResizeHandle, horizontal: boolean, vertical: boolean): ResizeHandle {
  const [x, y] = RESIZE_HANDLE_AXES[handle];
  return RESIZE_HANDLES.find((candidate) => {
    const [candidateX, candidateY] = RESIZE_HANDLE_AXES[candidate];
    return candidateX === (horizontal ? -x : x) && candidateY === (vertical ? -y : y);
  }) ?? handle;
}

function unrotate(point: SpacePoint, center: SpacePoint, degrees: number): SpacePoint {
  const radians = -degrees * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const x = point.x - center.x;
  const y = point.y - center.y;
  return { x: center.x + cos * x - sin * y, y: center.y + sin * x + cos * y };
}

function signedAxisSize(
  min: number,
  size: number,
  direction: number,
  current: number,
  fromCenter: boolean,
): number {
  if (!direction) return size;
  if (fromCenter) return 2 * (current - min - size / 2) * direction;
  const anchor = direction < 0 ? min + size : min;
  return (current - anchor) * direction;
}

function normalizeAxis(min: number, size: number, direction: number, signedSize: number, fromCenter: boolean): {
  min: number;
  size: number;
  crossed: boolean;
} {
  if (!direction) return { min, size, crossed: false };
  const nextSize = Math.max(Math.abs(signedSize), MIN_RESIZE_SIZE);
  if (fromCenter) return { min: min + (size - nextSize) / 2, size: nextSize, crossed: signedSize < 0 };
  const anchor = direction < 0 ? min + size : min;
  const nextMin = signedSize >= 0
    ? direction > 0 ? anchor : anchor - nextSize
    : direction > 0 ? anchor - nextSize : anchor;
  return { min: nextMin, size: nextSize, crossed: signedSize < 0 };
}

export function resizeElementFrame(
  source: TransformFrame,
  handle: ResizeHandle,
  pointerInParent: SpacePoint,
  modifiers: ResizeModifiers = { altKey: false, shiftKey: false },
): TransformFrame {
  const center = { x: source.x + source.w / 2, y: source.y + source.h / 2 };
  const localPointer = unrotate(pointerInParent, center, source.rot);
  const [horizontal, vertical] = RESIZE_HANDLE_AXES[handle];
  let signedWidth = signedAxisSize(
    source.x, source.w, horizontal, localPointer.x, modifiers.altKey,
  );
  let signedHeight = signedAxisSize(
    source.y, source.h, vertical, localPointer.y, modifiers.altKey,
  );
  if (modifiers.shiftKey && horizontal && vertical
    && source.w > MIN_RESIZE_SIZE && source.h > MIN_RESIZE_SIZE) {
    const scale = Math.max(Math.abs(signedWidth / source.w), Math.abs(signedHeight / source.h));
    signedWidth = Math.sign(signedWidth || 1) * source.w * scale;
    signedHeight = Math.sign(signedHeight || 1) * source.h * scale;
  }
  const x = normalizeAxis(source.x, source.w, horizontal, signedWidth, modifiers.altKey);
  const y = normalizeAxis(source.y, source.h, vertical, signedHeight, modifiers.altKey);
  const nextCenterInUnrotatedParent = { x: x.min + x.size / 2, y: y.min + y.size / 2 };
  const dx = nextCenterInUnrotatedParent.x - center.x;
  const dy = nextCenterInUnrotatedParent.y - center.y;
  const radians = source.rot * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const nextCenter = {
    x: center.x + cos * dx - sin * dy,
    y: center.y + sin * dx + cos * dy,
  };
  return {
    x: nextCenter.x - x.size / 2,
    y: nextCenter.y - y.size / 2,
    w: x.size, h: y.size, rot: source.rot,
    flipH: x.crossed ? !source.flipH : source.flipH,
    flipV: y.crossed ? !source.flipV : source.flipV,
  };
}

interface FrameWorldAxes {
  x: SpacePoint;
  y: SpacePoint;
}

function scaledVectorLength(vector: SpacePoint, scale: SpacePoint): number {
  return Math.hypot(vector.x * scale.x, vector.y * scale.y) / Math.hypot(vector.x, vector.y);
}

function frameWorldAxes(parent: AffineMatrix, degrees: number): FrameWorldAxes {
  const radians = degrees * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    x: { x: parent.a * cos + parent.c * sin, y: parent.b * cos + parent.d * sin },
    y: { x: -parent.a * sin + parent.c * cos, y: -parent.b * sin + parent.d * cos },
  };
}

function fitFrameSizeToScaledAabb(
  source: TransformFrame,
  sourceAxes: FrameWorldAxes,
  nextAxes: FrameWorldAxes,
  scale: SpacePoint,
): { w: number; h: number } | null {
  const sourceWidth = Math.abs(sourceAxes.x.x) * source.w + Math.abs(sourceAxes.y.x) * source.h;
  const sourceHeight = Math.abs(sourceAxes.x.y) * source.w + Math.abs(sourceAxes.y.y) * source.h;
  const width = sourceWidth * scale.x;
  const height = sourceHeight * scale.y;
  const determinant = Math.abs(nextAxes.x.x) * Math.abs(nextAxes.y.y)
    - Math.abs(nextAxes.y.x) * Math.abs(nextAxes.x.y);
  const fittedW = (width * Math.abs(nextAxes.y.y) - Math.abs(nextAxes.y.x) * height) / determinant;
  const fittedH = (Math.abs(nextAxes.x.x) * height - width * Math.abs(nextAxes.x.y)) / determinant;
  const canFitBounds = Math.abs(determinant) > 1e-9
    && [fittedW, fittedH].every((value) => Number.isFinite(value) && value >= MIN_RESIZE_SIZE);
  return canFitBounds ? { w: fittedW, h: fittedH } : null;
}

function nearestEquivalentAngle(degrees: number, reference: number): number {
  return degrees + Math.round((reference - degrees) / 360) * 360;
}

function frameFitError(
  source: TransformFrame,
  sourceAxes: FrameWorldAxes,
  nextAxes: FrameWorldAxes,
  scale: SpacePoint,
  size: { w: number; h: number },
  orientationParity: number,
): number {
  const targetX = {
    x: sourceAxes.x.x * source.w * scale.x,
    y: sourceAxes.x.y * source.w * scale.y * orientationParity,
  };
  const targetY = {
    x: sourceAxes.y.x * source.h * scale.x * orientationParity,
    y: sourceAxes.y.y * source.h * scale.y,
  };
  const error = (nextAxes.x.x * size.w - targetX.x) ** 2
    + (nextAxes.x.y * size.w - targetX.y) ** 2
    + (nextAxes.y.x * size.h - targetY.x) ** 2
    + (nextAxes.y.y * size.h - targetY.y) ** 2;
  const magnitude = targetX.x ** 2 + targetX.y ** 2 + targetY.x ** 2 + targetY.y ** 2;
  return error / Math.max(magnitude, MIN_RESIZE_SIZE ** 2);
}

/** 非等比变换会产生 shear；在守住共同 AABB 的可表达矩形中，选择与目标仿射轴误差最小的分解。 */
function findNearestAabbPreservingFrame(
  source: TransformFrame,
  parent: AffineMatrix,
  scale: SpacePoint,
  orientationParity: number,
): { w: number; h: number; rot: number } {
  const sourceAxes = frameWorldAxes(parent, source.rot);
  const desiredWorldX = {
    x: sourceAxes.x.x * scale.x,
    y: sourceAxes.x.y * scale.y * orientationParity,
  };
  const parentX = inverseTransformSpaceVector(parent, desiredWorldX);
  const desiredRotation = nearestEquivalentAngle(
    Math.atan2(parentX.y, parentX.x) * 180 / Math.PI,
    source.rot,
  );
  let best: { w: number; h: number; rot: number; error: number } | null = null;
  const consider = (rotation: number): boolean => {
    const rot = nearestEquivalentAngle(rotation, source.rot);
    const axes = frameWorldAxes(parent, rot);
    const size = fitFrameSizeToScaledAabb(source, sourceAxes, axes, scale);
    if (!size) return false;
    const error = frameFitError(source, sourceAxes, axes, scale, size, orientationParity);
    if (!best || error < best.error) best = { ...size, rot, error };
    return error < 1e-12;
  };
  // 先精确探测父矩阵四个轴对齐角，否则极窄的正尺寸可行区可能落在 0.25° 网格之间。
  const criticalRotations = [
    Math.atan2(-parent.a, parent.c),
    Math.atan2(-parent.b, parent.d),
    Math.atan2(parent.c, parent.a),
    Math.atan2(parent.d, parent.b),
  ].map((radians) => radians * 180 / Math.PI);
  for (const rotation of criticalRotations) {
    if (consider(rotation)) return best!;
  }
  // 0.25° 把最坏轴向偏差限制在约 0.125°；1441 个候选仍由 60 元素真实 Chrome 门禁约束在 8ms 内。
  for (let step = 0; step <= ROTATION_SEARCH_STEPS; step++) {
    const offset = step * ROTATION_SEARCH_STEP;
    for (const rotation of step ? [desiredRotation + offset, desiredRotation - offset] : [desiredRotation]) {
      if (consider(rotation)) return best!;
    }
  }
  if (best) return best;
  return {
    w: source.w * scaledVectorLength(sourceAxes.x, scale),
    h: source.h * scaledVectorLength(sourceAxes.y, scale),
    rot: desiredRotation,
  };
}

function mapSelectionAxis(
  value: number,
  sourceMin: number,
  sourceSize: number,
  nextMin: number,
  nextSize: number,
  flipped: boolean,
): number {
  const ratio = (value - sourceMin) / sourceSize;
  return nextMin + (flipped ? 1 - ratio : ratio) * nextSize;
}

interface MultiResizeTarget {
  id: ElementId;
  source: TransformFrame;
}

function frameFitKey(
  source: TransformFrame,
  parent: AffineMatrix,
  scale: SpacePoint,
  orientationParity: number,
): string {
  return [
    source.w, source.h, source.rot,
    parent.a, parent.b, parent.c, parent.d,
    scale.x, scale.y, orientationParity,
  ].join('/');
}

export function resizeMultiElementFrames(
  doc: EditDoc,
  targets: readonly MultiResizeTarget[],
  selectionSource: TransformFrame,
  selectionNext: TransformFrame,
): TransformFrame[] {
  const horizontalFlip = selectionSource.flipH !== selectionNext.flipH;
  const verticalFlip = selectionSource.flipV !== selectionNext.flipV;
  const scale = {
    x: selectionNext.w / selectionSource.w,
    y: selectionNext.h / selectionSource.h,
  };
  const orientationParity = (horizontalFlip === verticalFlip) ? 1 : -1;
  const fitCache = new Map<string, { w: number; h: number; rot: number }>();
  return targets.map(({ id, source }) => {
    const center = elementFrameToSlidePoint(doc, id, { x: source.w / 2, y: source.h / 2 });
    const mappedCenter = {
      x: mapSelectionAxis(
        center.x, selectionSource.x, selectionSource.w,
        selectionNext.x, selectionNext.w, horizontalFlip,
      ),
      y: mapSelectionAxis(
        center.y, selectionSource.y, selectionSource.h,
        selectionNext.y, selectionNext.h, verticalFlip,
      ),
    };
    const parentCenter = slideToElementParentPoint(doc, id, mappedCenter);
    const parent = elementParentToSlideMatrix(doc, id);
    const key = frameFitKey(source, parent, scale, orientationParity);
    let fitted = fitCache.get(key);
    if (!fitted) {
      fitted = findNearestAabbPreservingFrame(source, parent, scale, orientationParity);
      fitCache.set(key, fitted);
    }
    return {
      x: parentCenter.x - fitted.w / 2,
      y: parentCenter.y - fitted.h / 2,
      w: fitted.w,
      h: fitted.h,
      rot: fitted.rot,
      flipH: horizontalFlip ? !source.flipH : source.flipH,
      flipV: verticalFlip ? !source.flipV : source.flipV,
    };
  });
}
