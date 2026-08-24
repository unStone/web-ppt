import type { EditDoc, ElementId } from '@web-ppt/edit-core';
import {
  elementFrameToSlidePoint, elementParentToSlideMatrix, inverseTransformSpaceVector,
  slideToElementParentPoint, spaceOrientationParity, transformSpaceVector,
} from './space';
import type { SpacePoint } from './space';
import type { TransformFrame } from './transform-frame';

export const ROTATION_SNAP_DEGREES = 15;

export function pointerAngle(center: SpacePoint, pointer: SpacePoint): number {
  return Math.atan2(pointer.y - center.y, pointer.x - center.x) * 180 / Math.PI;
}

export function shortestRotationDelta(degrees: number): number {
  const normalized = ((degrees + 180) % 360 + 360) % 360 - 180;
  return normalized === -180 ? 180 : normalized;
}

export function constrainedRotation(degrees: number, shiftKey: boolean): number {
  return shiftKey ? Math.round(degrees / ROTATION_SNAP_DEGREES) * ROTATION_SNAP_DEGREES : degrees;
}

export function rotatePointAround(point: SpacePoint, center: SpacePoint, degrees: number): SpacePoint {
  const radians = degrees * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const x = point.x - center.x;
  const y = point.y - center.y;
  return { x: center.x + cos * x - sin * y, y: center.y + sin * x + cos * y };
}

function nearestEquivalentAngle(degrees: number, reference: number): number {
  return degrees + Math.round((reference - degrees) / 360) * 360;
}

/** 多选中心在幻灯片空间刚性旋转；方向轴反解回父空间，避免把组缩放误当成角度。 */
export function rotateElementAroundSlideCenter(
  doc: EditDoc,
  id: ElementId,
  source: TransformFrame,
  selectionCenter: SpacePoint,
  degrees: number,
): TransformFrame {
  const center = elementFrameToSlidePoint(doc, id, { x: source.w / 2, y: source.h / 2 });
  const nextCenter = rotatePointAround(center, selectionCenter, degrees);
  const nextParentCenter = slideToElementParentPoint(doc, id, nextCenter);
  const parent = elementParentToSlideMatrix(doc, id);
  const radians = source.rot * Math.PI / 180;
  const sourceWorldAxis = transformSpaceVector(parent, {
    x: Math.cos(radians), y: Math.sin(radians),
  });
  const nextWorldAxis = rotatePointAround(sourceWorldAxis, { x: 0, y: 0 }, degrees);
  const nextParentAxis = inverseTransformSpaceVector(parent, nextWorldAxis);
  const rot = nearestEquivalentAngle(
    Math.atan2(nextParentAxis.y, nextParentAxis.x) * 180 / Math.PI,
    source.rot + degrees * spaceOrientationParity(parent),
  );
  return {
    ...source,
    x: nextParentCenter.x - source.w / 2,
    y: nextParentCenter.y - source.h / 2,
    rot,
  };
}
